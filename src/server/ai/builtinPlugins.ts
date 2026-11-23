/** 内置插件：把原有 11 个工具按能力域拆成 5 个可独立启停的插件 */
import { z } from 'zod';
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
} from '../../utils/aiTools';
import { generateExcelReport, generatePPTReport } from '../../utils/aiReportGenerator';
import {
  buildFolderTree,
  getReportDetail,
  loadFolders,
  loadReports,
  runSmartAnalysis,
  summarizeReport,
} from './reportTools';
import type { AiPlugin } from './pluginTypes';

/** 报告查询插件 */
const reportQueryPlugin: AiPlugin = {
  id: 'core.report-query',
  name: '报告查询',
  description: '列出报告与目录、读取单份报告详情',
  source: 'builtin',
  promptHint: '请优先使用 listReports、getReportDetail 等工具获取真实数据，基于数据回答。',
  tools: [
    {
      name: 'listReports',
      description: '获取测试报告列表，包含报告名称、主机、目录、样本数、分数范围等摘要',
      inputSchema: z.object({}),
      execute: async () => {
        try {
          return loadReports().map(summarizeReport);
        } catch (err) {
          return { error: err instanceof Error ? err.message : 'listReports 失败' };
        }
      },
    },
    {
      name: 'listFolders',
      description: '获取报告目录层级结构',
      inputSchema: z.object({}),
      execute: async () => {
        try {
          return buildFolderTree(loadFolders());
        } catch (err) {
          return { error: err instanceof Error ? err.message : 'listFolders 失败' };
        }
      },
    },
    {
      name: 'getReportDetail',
      description: '获取指定报告的完整数据；原始采样点会被聚合为平均值与计数，避免数据过长',
      inputSchema: z.object({ reportId: z.string() }),
      execute: async (args) => {
        try {
          const detail = getReportDetail(String(args.reportId));
          return detail ?? { error: '报告不存在' };
        } catch (err) {
          return { error: err instanceof Error ? err.message : 'getReportDetail 失败' };
        }
      },
    },
  ],
};

/** 智能分析插件（Python XGBoost + SHAP） */
const smartAnalysisPlugin: AiPlugin = {
  id: 'core.smart-analysis',
  name: '智能分析',
  description: '调用 XGBoost + SHAP 引擎做参数重要性与最优点推断',
  source: 'builtin',
  promptHint: '当用户需要数学建模、最优点推断或参数影响分析时，调用 runSmartAnalysis。',
  tools: [
    {
      name: 'runSmartAnalysis',
      description: '对指定报告调用 XGBoost + SHAP 智能分析引擎，返回参数重要性、最优点推断等',
      inputSchema: z.object({
        reportId: z.string(),
        target: z.string().optional(),
        direction: z.enum(['max', 'min']).optional(),
        rank: z.number().int().min(0).max(2).optional(),
      }),
      execute: async (args) => {
        try {
          return await runSmartAnalysis(
            String(args.reportId),
            typeof args.target === 'string' ? args.target : 'score',
            args.direction === 'min' ? 'min' : 'max',
            typeof args.rank === 'number' ? args.rank : 0,
          );
        } catch (err) {
          return { error: err instanceof Error ? err.message : 'runSmartAnalysis 失败' };
        }
      },
    },
  ],
};

/** 联网工具插件 */
const webPlugin: AiPlugin = {
  id: 'core.web',
  name: '联网检索',
  description: '网页抓取与搜索引擎查询',
  source: 'builtin',
  tools: [
    {
      name: 'fetchUrl',
      description: '抓取指定网页内容并提取文本，用于分析网页信息',
      inputSchema: fetchUrlInputSchema,
      execute: async (args) => fetchUrlTool(args as { url: string; maxLength?: number }),
    },
    {
      name: 'webSearch',
      description: '使用 DuckDuckGo 搜索引擎查找网络信息，适合查询公开资料、技术文档、新闻等',
      inputSchema: webSearchInputSchema,
      execute: async (args) => webSearchTool(args as { query: string; count?: number }),
    },
    {
      name: 'serperSearch',
      description: '使用 Serper (Google) 搜索引擎查找网络信息，结果更稳定，需要配置 SERPER_API_KEY',
      inputSchema: serperSearchInputSchema,
      execute: async (args) => serperSearchTool(args as { query: string; count?: number }),
    },
  ],
};

/** 通用计算插件 */
const utilityPlugin: AiPlugin = {
  id: 'core.utility',
  name: '通用工具',
  description: '数学计算与当前时间',
  source: 'builtin',
  tools: [
    {
      name: 'calculate',
      description: '计算数学表达式，例如 (100 + 200) / 3、score * 0.8 等',
      inputSchema: calculateInputSchema,
      execute: async (args) => calculateTool(args as { expression: string }),
    },
    {
      name: 'currentTime',
      description: '获取当前服务器时间',
      inputSchema: currentTimeInputSchema,
      execute: async () => currentTimeTool(),
    },
  ],
};

/** 报告导出插件 */
const exportPlugin: AiPlugin = {
  id: 'core.export',
  name: '报告导出',
  description: '生成 Excel / PPT 分析报告并返回下载链接',
  source: 'builtin',
  promptHint: '当用户需要可下载的分析报告时，调用 generateExcelReport 生成 Excel 或 generatePPTReport 生成 PPT。',
  tools: [
    {
      name: 'generateExcelReport',
      description: '根据选中的报告 ID 列表生成 Excel 分析报告并返回下载链接',
      inputSchema: z.object({
        reportIds: z.array(z.string()).describe('要生成报告的报告 ID 列表'),
        title: z.string().optional().describe('报告标题'),
      }),
      execute: async (args) => {
        try {
          return await generateExcelReport(
            Array.isArray(args.reportIds) ? (args.reportIds as string[]) : [],
            typeof args.title === 'string' ? args.title : undefined,
          );
        } catch (err) {
          return { error: err instanceof Error ? err.message : 'generateExcelReport 失败', url: '', fileName: '' };
        }
      },
    },
    {
      name: 'generatePPTReport',
      description: '根据选中的报告 ID 列表生成 PPT 汇报材料并返回下载链接',
      inputSchema: z.object({
        reportIds: z.array(z.string()).describe('要生成报告的报告 ID 列表'),
        title: z.string().optional().describe('报告标题'),
      }),
      execute: async (args) => {
        try {
          return await generatePPTReport(
            Array.isArray(args.reportIds) ? (args.reportIds as string[]) : [],
            typeof args.title === 'string' ? args.title : undefined,
          );
        } catch (err) {
          return { error: err instanceof Error ? err.message : 'generatePPTReport 失败', url: '', fileName: '' };
        }
      },
    },
  ],
};

export const BUILTIN_PLUGINS: AiPlugin[] = [
  reportQueryPlugin,
  smartAnalysisPlugin,
  webPlugin,
  utilityPlugin,
  exportPlugin,
];
