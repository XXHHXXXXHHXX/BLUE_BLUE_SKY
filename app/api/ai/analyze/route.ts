import { streamText, tool, isStepCount } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { spawn } from 'child_process';
import {
  fetchUrlTool,
  fetchUrlInputSchema,
  webSearchTool,
  webSearchInputSchema,
  calculateTool,
  calculateInputSchema,
  currentTimeTool,
  currentTimeInputSchema,
  serperSearchTool,
  serperSearchInputSchema,
} from '@/src/utils/aiTools';
import { generateExcelReport, generatePPTReport } from '@/src/utils/aiReportGenerator';

const DATA_DIR = path.join(process.cwd(), '.data');
const REPORTS_FILE = path.join(DATA_DIR, 'test-reports.json');
const FOLDERS_FILE = path.join(DATA_DIR, 'test-report-folders.json');
const PYTHON_SCRIPT = path.join(process.cwd(), 'src', 'utils', 'analysis_engine.py');
const PYTHON_CMD = process.platform === 'win32' ? 'python' : 'python3';

interface TestReportData {
  id: string;
  name: string;
  description?: string;
  folderId?: string;
  createdAt: string;
  config: {
    host: string;
    iterationParams?: Array<{ id: string; name: string; mode: 'range' | 'custom'; start: number; end: number; step: number; values: string[] }>;
    adjustmentCommands?: Array<{ id: string; name: string; target: string; sessionId: string | null; command: string; parameterName: string }>;
    startPower?: number;
    endPower?: number;
    step?: number;
  };
  results: Array<{
    iteration: number;
    power: number;
    score: number;
    status: string;
    message?: string;
    timestamp: string;
    iterationValues?: Record<string, string>;
    iterationLabel?: string;
    monitorResults?: Record<string, {
      commandId: string;
      commandName: string;
      dataPoints: Array<{ timestamp: string; value: number; raw: string }>;
      dataPointsCount?: number;
      averageValue: number;
    }>;
    logArchivePath?: string;
  }>;
  chartData?: { powerData: number[]; scoreData: number[] };
  monitorResults?: Record<string, {
    commandId: string;
    commandName: string;
    dataPoints: Array<{ timestamp: string; value: number; raw: string }>;
    averageValue: number;
  }>;
  jobId?: string;
  stageId?: string;
  stageName?: string;
}

interface ReportFolderData {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
}

function loadReports(): TestReportData[] {
  try {
    if (fs.existsSync(REPORTS_FILE)) {
      return JSON.parse(fs.readFileSync(REPORTS_FILE, 'utf-8'));
    }
  } catch {
    console.error('[AI Analyze] Failed to load test-reports');
  }
  return [];
}

function loadFolders(): ReportFolderData[] {
  try {
    if (fs.existsSync(FOLDERS_FILE)) {
      return JSON.parse(fs.readFileSync(FOLDERS_FILE, 'utf-8'));
    }
  } catch {
    console.error('[AI Analyze] Failed to load folders');
  }
  return [];
}

function buildFolderTree(folders: ReportFolderData[], parentId: string | null = null): Array<{ id: string; name: string; children: ReturnType<typeof buildFolderTree> }> {
  return folders
    .filter((f) => f.parentId === parentId)
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
    .map((f) => ({
      id: f.id,
      name: f.name,
      children: buildFolderTree(folders, f.id),
    }));
}

function summarizeReport(report: TestReportData) {
  const scores = report.results?.map((r) => r.score) || [];
  return {
    id: report.id,
    name: report.name,
    description: report.description,
    host: report.config?.host,
    folderId: report.folderId || 'uncategorized',
    createdAt: report.createdAt,
    resultCount: report.results?.length || 0,
    iterationParams: report.config?.iterationParams?.map((p) => p.name) || [],
    monitorCommands: report.results?.[0]?.monitorResults
      ? Object.values(report.results[0].monitorResults).map((mr) => mr.commandName)
      : [],
    scoreRange: scores.length
      ? {
          min: Math.min(...scores),
          max: Math.max(...scores),
          avg: scores.reduce((a, b) => a + b, 0) / scores.length,
        }
      : null,
  };
}

function getReportDetail(reportId: string): Record<string, unknown> | null {
  const reports = loadReports();
  const report = reports.find((r) => r.id === reportId);
  if (!report) return null;

  // 对采样点做聚合，避免 token 过长
  const trimmed = {
    ...report,
    results: report.results?.map((r) => ({
      ...r,
      monitorResults: r.monitorResults
        ? Object.fromEntries(
            Object.entries(r.monitorResults).map(([k, mr]) => [
              k,
              {
                commandId: mr.commandId,
                commandName: mr.commandName,
                averageValue: mr.averageValue,
                dataPointsCount: mr.dataPointsCount ?? mr.dataPoints?.length,
              },
            ])
          )
        : undefined,
    })),
  };
  return trimmed as Record<string, unknown>;
}

async function runSmartAnalysis(
  reportId: string,
  target: string,
  direction: 'max' | 'min',
  rank: number
): Promise<Record<string, unknown>> {
  const reports = loadReports();
  const report = reports.find((r) => r.id === reportId);
  if (!report) {
    return { error: '报告不存在' };
  }

  const inputData = JSON.stringify({
    report,
    target: target || 'score',
    direction: direction || 'max',
    rank: rank ?? 0,
  });

  return new Promise((resolve, reject) => {
    const python = spawn(PYTHON_CMD, [PYTHON_SCRIPT], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
      },
    });

    let stdout = '';
    let stderr = '';

    python.stdin.write(inputData);
    python.stdin.end();

    python.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    python.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    python.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Python 进程退出码 ${code}: ${stderr || stdout}`));
      } else {
        const lines = stdout.trim().split('\n');
        const jsonLine = lines.find((l) => l.trim().startsWith('{')) || lines[lines.length - 1];
        try {
          resolve(JSON.parse(jsonLine));
        } catch {
          resolve({ rawOutput: stdout.trim() });
        }
      }
    });

    python.on('error', (err) => {
      reject(err);
    });

    setTimeout(() => {
      python.kill('SIGTERM');
      reject(new Error('Python 分析引擎超时'));
    }, 30000);
  });
}

const openai = createOpenAI({
  baseURL: process.env.AI_BASE_URL,
  apiKey: process.env.AI_API_KEY,
});

function sanitizeToolOutput(output: unknown): unknown {
  if (output === null || output === undefined) return output;
  if (typeof output === 'string' || typeof output === 'number' || typeof output === 'boolean') return output;
  if (Array.isArray(output)) {
    const preview = output.slice(0, 50);
    return preview.length === output.length ? output : [...preview, { _note: `共 ${output.length} 项，已截断` }];
  }
  if (typeof output === 'object') {
    const obj = output as Record<string, unknown>;
    const keys = Object.keys(obj);
    const result: Record<string, unknown> = {};
    for (const key of keys.slice(0, 30)) {
      result[key] = sanitizeToolOutput(obj[key]);
    }
    if (keys.length > 30) {
      result._note = `对象共 ${keys.length} 个字段，已截断`;
    }
    return result;
  }
  return String(output);
}

export async function POST(request: NextRequest) {
  try {
    const { messages } = (await request.json()) as { messages: Array<{ role: string; content: string }> };
    const modelName = process.env.AI_MODEL_NAME || 'gpt-4o-mini';

    const result = streamText({
      model: openai.chat(modelName),
      system:
        '你是数据分析助手，专门帮助用户分析测试报告。你可以使用工具获取报告管理中的数据。' +
        '请优先使用 listReports、getReportDetail 等工具获取真实数据，基于数据回答。' +
        '当用户需要数学建模、最优点推断或参数影响分析时，调用 runSmartAnalysis。' +
        '当用户需要可下载的分析报告时，调用 generateExcelReport 生成 Excel 或 generatePPTReport 生成 PPT。' +
        '请使用中文回答，不要编造数据。如果无法获取数据，请明确说明。' +
        '在思考过程中请简要说明你将使用哪些工具、为什么使用它们，以及你正在做什么。' +
        '当用户需求不明确时，请直接反问用户以澄清需求，而不是猜测。' +
        '生成报告后，在回复中提供下载链接，并简要说明报告内容。',
      messages: messages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      stopWhen: isStepCount(5),
      tools: {
        listReports: tool({
          description: '获取测试报告列表，包含报告名称、主机、目录、样本数、分数范围等摘要',
          inputSchema: z.object({}),
          execute: async () => {
            try {
              console.log('[AI Agent] 工具调用: listReports');
              const reports = loadReports();
              const summary = reports.map(summarizeReport);
              console.log(`[AI Agent] listReports 返回 ${summary.length} 条报告`);
              return summary;
            } catch (err) {
              const msg = err instanceof Error ? err.message : 'listReports 失败';
              console.error('[AI Agent] listReports 错误:', msg);
              return { error: msg };
            }
          },
        }),
        listFolders: tool({
          description: '获取报告目录层级结构',
          inputSchema: z.object({}),
          execute: async () => {
            try {
              console.log('[AI Agent] 工具调用: listFolders');
              const folders = loadFolders();
              const tree = buildFolderTree(folders);
              console.log(`[AI Agent] listFolders 返回目录树`);
              return tree;
            } catch (err) {
              const msg = err instanceof Error ? err.message : 'listFolders 失败';
              console.error('[AI Agent] listFolders 错误:', msg);
              return { error: msg };
            }
          },
        }),
        getReportDetail: tool({
          description: '获取指定报告的完整数据；原始采样点会被聚合为平均值与计数，避免数据过长',
          inputSchema: z.object({ reportId: z.string() }),
          execute: async ({ reportId }: { reportId: string }) => {
            try {
              console.log('[AI Agent] 工具调用: getReportDetail, reportId=', reportId);
              const detail = getReportDetail(reportId);
              console.log(`[AI Agent] getReportDetail ${detail ? '成功' : '未找到'}`);
              return detail ?? { error: '报告不存在' };
            } catch (err) {
              const msg = err instanceof Error ? err.message : 'getReportDetail 失败';
              console.error('[AI Agent] getReportDetail 错误:', msg);
              return { error: msg };
            }
          },
        }),
        runSmartAnalysis: tool({
          description: '对指定报告调用 XGBoost + SHAP 智能分析引擎，返回参数重要性、最优点推断等',
          inputSchema: z.object({
            reportId: z.string(),
            target: z.string().optional(),
            direction: z.enum(['max', 'min']).optional(),
            rank: z.number().int().min(0).max(2).optional(),
          }),
          execute: async (args: {
            reportId: string;
            target?: string;
            direction?: 'max' | 'min';
            rank?: number;
          }) => {
            try {
              console.log('[AI Agent] 工具调用: runSmartAnalysis', args);
              const res = await runSmartAnalysis(
                args.reportId,
                args.target || 'score',
                args.direction || 'max',
                args.rank ?? 0
              );
              console.log('[AI Agent] runSmartAnalysis 完成');
              return res;
            } catch (err) {
              const msg = err instanceof Error ? err.message : 'runSmartAnalysis 失败';
              console.error('[AI Agent] runSmartAnalysis 错误:', msg);
              return { error: msg };
            }
          },
        }),
        fetchUrl: tool({
          description: '抓取指定网页内容并提取文本，用于分析网页信息',
          inputSchema: fetchUrlInputSchema,
          execute: async (args: { url: string; maxLength?: number }) => {
            try {
              console.log('[AI Agent] 工具调用: fetchUrl', args);
              const res = await fetchUrlTool(args);
              return res;
            } catch (err) {
              const msg = err instanceof Error ? err.message : 'fetchUrl 失败';
              console.error('[AI Agent] fetchUrl 错误:', msg);
              return { error: msg };
            }
          },
        }),
        webSearch: tool({
          description: '使用 DuckDuckGo 搜索引擎查找网络信息，适合查询公开资料、技术文档、新闻等',
          inputSchema: webSearchInputSchema,
          execute: async (args: { query: string; count?: number }) => {
            try {
              console.log('[AI Agent] 工具调用: webSearch', args);
              const res = await webSearchTool(args);
              return res;
            } catch (err) {
              const msg = err instanceof Error ? err.message : 'webSearch 失败';
              console.error('[AI Agent] webSearch 错误:', msg);
              return { error: msg };
            }
          },
        }),
        serperSearch: tool({
          description: '使用 Serper (Google) 搜索引擎查找网络信息，结果更稳定，需要配置 SERPER_API_KEY',
          inputSchema: serperSearchInputSchema,
          execute: async (args: { query: string; count?: number }) => {
            try {
              console.log('[AI Agent] 工具调用: serperSearch', args);
              const res = await serperSearchTool(args);
              return res;
            } catch (err) {
              const msg = err instanceof Error ? err.message : 'serperSearch 失败';
              console.error('[AI Agent] serperSearch 错误:', msg);
              return { error: msg };
            }
          },
        }),
        calculate: tool({
          description: '计算数学表达式，例如 (100 + 200) / 3、score * 0.8 等',
          inputSchema: calculateInputSchema,
          execute: async (args: { expression: string }) => {
            try {
              console.log('[AI Agent] 工具调用: calculate', args);
              const res = calculateTool(args);
              return res;
            } catch (err) {
              const msg = err instanceof Error ? err.message : 'calculate 失败';
              console.error('[AI Agent] calculate 错误:', msg);
              return { error: msg };
            }
          },
        }),
        currentTime: tool({
          description: '获取当前服务器时间',
          inputSchema: currentTimeInputSchema,
          execute: async () => {
            try {
              console.log('[AI Agent] 工具调用: currentTime');
              const res = currentTimeTool();
              return res;
            } catch (err) {
              const msg = err instanceof Error ? err.message : 'currentTime 失败';
              console.error('[AI Agent] currentTime 错误:', msg);
              return { error: msg };
            }
          },
        }),
        generateExcelReport: tool({
          description: '根据选中的报告 ID 列表生成 Excel 分析报告并返回下载链接',
          inputSchema: z.object({
            reportIds: z.array(z.string()).describe('要生成报告的报告 ID 列表'),
            title: z.string().optional().describe('报告标题'),
          }),
          execute: async (args: { reportIds: string[]; title?: string }) => {
            try {
              console.log('[AI Agent] 工具调用: generateExcelReport', args);
              const res = await generateExcelReport(args.reportIds, args.title);
              console.log('[AI Agent] generateExcelReport 完成', res.url || res.error);
              return res;
            } catch (err) {
              const msg = err instanceof Error ? err.message : 'generateExcelReport 失败';
              console.error('[AI Agent] generateExcelReport 错误:', msg);
              return { error: msg, url: '', fileName: '' };
            }
          },
        }),
        generatePPTReport: tool({
          description: '根据选中的报告 ID 列表生成 PPT 汇报材料并返回下载链接',
          inputSchema: z.object({
            reportIds: z.array(z.string()).describe('要生成报告的报告 ID 列表'),
            title: z.string().optional().describe('报告标题'),
          }),
          execute: async (args: { reportIds: string[]; title?: string }) => {
            try {
              console.log('[AI Agent] 工具调用: generatePPTReport', args);
              const res = await generatePPTReport(args.reportIds, args.title);
              console.log('[AI Agent] generatePPTReport 完成', res.url || res.error);
              return res;
            } catch (err) {
              const msg = err instanceof Error ? err.message : 'generatePPTReport 失败';
              console.error('[AI Agent] generatePPTReport 错误:', msg);
              return { error: msg, url: '', fileName: '' };
            }
          },
        }),
      },
    });

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (data: unknown) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        };

        try {
          for await (const part of result.stream) {
            switch (part.type) {
              case 'text-delta':
                send({ type: 'text-delta', text: part.text });
                break;
              case 'tool-call':
                send({
                  type: 'tool-call',
                  toolCall: { toolName: part.toolName, input: part.input, toolCallId: part.toolCallId },
                });
                break;
              case 'tool-result':
                send({
                  type: 'tool-result',
                  toolResult: {
                    toolName: part.toolName,
                    input: part.input,
                    output: sanitizeToolOutput(part.output),
                    toolCallId: part.toolCallId,
                  },
                });
                break;
              case 'tool-error':
                send({
                  type: 'tool-error',
                  toolError: {
                    toolName: part.toolName,
                    input: part.input,
                    error: String(part.error),
                    toolCallId: part.toolCallId,
                  },
                });
                break;
              case 'finish-step':
                send({
                  type: 'step-finish',
                  finishReason: (part as { finishReason?: string }).finishReason,
                });
                break;
              case 'error':
                send({ type: 'error', error: String((part as { error?: unknown }).error) });
                break;
              default:
                // 其他事件如 start/finish/reasoning 等暂不推送
                break;
            }
          }
          send({ type: 'done' });
        } catch (err) {
          send({ type: 'error', error: err instanceof Error ? err.message : '流式处理异常' });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'AI 分析服务异常';
    console.error('[AI Analyze] Error:', msg);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
