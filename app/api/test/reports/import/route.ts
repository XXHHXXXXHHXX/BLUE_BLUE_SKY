/** 测试报告导入 API - 从 dataPoints 文件夹手动导入生成报告 */
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), '.data');
const REPORTS_FILE = path.join(DATA_DIR, 'test-reports.json');
const FOLDERS_FILE = path.join(DATA_DIR, 'test-report-folders.json');
const REPORTS_DATA_DIR = path.join(DATA_DIR, 'reports');
const DEFAULT_FOLDER_ID = 'uncategorized';

interface DataPoint {
  timestamp: string;
  value: number;
  raw: string;
}

interface MonitorResultInput {
  commandId: string;
  commandName: string;
  averageValue: number;
  dataPoints: DataPoint[];
  dataPointsCount?: number;
}

interface ReportResultInput {
  iteration: number;
  power: number;
  score: number;
  status: 'success' | 'error';
  message?: string;
  timestamp: string;
  iterationValues?: Record<string, string>;
  iterationLabel?: string;
  monitorResults?: Record<string, MonitorResultInput>;
}

interface ScanInfo {
  iterations: number[];
  commands: { id: string; name: string }[];
  dataPointsCount: number;
  hasMetadata: boolean;
  metadata?: Record<string, unknown>;
}

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadReports(): any[] {
  try {
    if (fs.existsSync(REPORTS_FILE)) {
      return JSON.parse(fs.readFileSync(REPORTS_FILE, 'utf-8'));
    }
  } catch {
    console.error('[Report Import] Failed to load reports');
  }
  return [];
}

/** 保存前剔除所有原始采样点，防止旧报告撑爆 JSON */
function stripReportDataPointsForSave(report: any) {
  const stripMr = (mr?: any) =>
    mr && typeof mr === 'object'
      ? { ...mr, dataPoints: [], dataPointsCount: mr.dataPointsCount ?? mr.dataPoints?.length ?? 0 }
      : mr;
  const stripMrs = (mrs?: any) => {
    if (!mrs || typeof mrs !== 'object') return mrs;
    const result: any = {};
    for (const [key, mr] of Object.entries(mrs)) {
      result[key] = stripMr(mr);
    }
    return result;
  };
  return {
    ...report,
    monitorResults: stripMrs(report.monitorResults),
    results: Array.isArray(report.results)
      ? report.results.map((r: any) => ({ ...r, monitorResults: stripMrs(r.monitorResults) }))
      : report.results,
  };
}

function saveReports(reports: any[]) {
  ensureDir();
  const cleaned = reports.map(stripReportDataPointsForSave);
  try {
    fs.writeFileSync(REPORTS_FILE, JSON.stringify(cleaned, null, 2));
  } catch (err) {
    console.error('[Report Import] Failed to save reports with pretty print, trying compact:', err);
    try {
      fs.writeFileSync(REPORTS_FILE, JSON.stringify(cleaned));
    } catch (err2) {
      console.error('[Report Import] Failed to save reports:', err2);
      throw err2;
    }
  }
}

function loadFolders(): any[] {
  try {
    if (fs.existsSync(FOLDERS_FILE)) {
      return JSON.parse(fs.readFileSync(FOLDERS_FILE, 'utf-8'));
    }
  } catch {
    console.error('[Report Import] Failed to load folders');
  }
  return [];
}

function ensureDefaultFolder() {
  const folders = loadFolders();
  if (!folders.some((f) => f.id === DEFAULT_FOLDER_ID)) {
    const now = new Date().toISOString();
    folders.push({
      id: DEFAULT_FOLDER_ID,
      name: '未分类',
      parentId: null,
      createdAt: now,
      updatedAt: now,
    });
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(FOLDERS_FILE, JSON.stringify(folders, null, 2));
  }
}

function normalizeFolderId(folderId?: string | null): string {
  return folderId || DEFAULT_FOLDER_ID;
}

function isInsideProject(targetPath: string): boolean {
  const resolved = path.resolve(targetPath);
  const cwd = path.resolve(process.cwd());
  return resolved === cwd || resolved.startsWith(cwd + path.sep);
}

function resolveSourcePath(inputPath: string): string {
  let resolved = path.isAbsolute(inputPath) ? inputPath : path.join(process.cwd(), '.data', inputPath);
  resolved = path.resolve(resolved);
  if (!isInsideProject(resolved)) {
    throw new Error('只能访问项目目录内的文件');
  }
  return resolved;
}

function getDataPointsDir(sourcePath: string): string {
  if (path.basename(sourcePath) === 'dataPoints') {
    return sourcePath;
  }
  const candidate = path.join(sourcePath, 'dataPoints');
  if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
    return candidate;
  }
  if (fs.statSync(sourcePath).isDirectory()) {
    // 如果源目录就是 dataPoints 的父目录且其中只有 dataPoints 文件夹，也接受
    const children = fs.readdirSync(sourcePath).filter((f) => fs.statSync(path.join(sourcePath, f)).isDirectory());
    if (children.length === 1 && children[0] === 'dataPoints') {
      return candidate;
    }
  }
  throw new Error('未找到 dataPoints 文件夹，请确认路径以 dataPoints 结尾或包含 dataPoints 子目录');
}

function inferCommandName(commandId: string): string {
  // 去掉 list 模式 __col__N 后缀用于展示
  return commandId.replace(/__col__\d+$/, '');
}

function scanDataPointsFolder(sourcePath: string): ScanInfo {
  const dataPointsDir = getDataPointsDir(sourcePath);
  if (!fs.existsSync(dataPointsDir)) {
    throw new Error(`未找到 dataPoints 文件夹: ${dataPointsDir}`);
  }

  const files = fs.readdirSync(dataPointsDir).filter((f) => f.endsWith('.json'));
  const iterationCommands = new Map<number, Set<string>>();
  const commandNames = new Map<string, string>();
  let totalCount = 0;

  for (const file of files) {
    const match = file.match(/^iteration-(\d+)-(.+)\.json$/);
    if (!match) continue;
    const iteration = parseInt(match[1], 10);
    const commandId = match[2];

    if (!iterationCommands.has(iteration)) {
      iterationCommands.set(iteration, new Set());
    }
    iterationCommands.get(iteration)!.add(commandId);

    if (!commandNames.has(commandId)) {
      commandNames.set(commandId, inferCommandName(commandId));
    }
  }

  const iterations = Array.from(iterationCommands.keys()).sort((a, b) => a - b);

  for (const iteration of iterations) {
    for (const commandId of iterationCommands.get(iteration)!) {
      const filePath = path.join(dataPointsDir, `iteration-${iteration}-${commandId}.json`);
      try {
        const points: DataPoint[] = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        totalCount += points.length;
      } catch {
        // 无法读取的点数会在导入时处理，扫描时跳过
      }
    }
  }

  const commands = Array.from(commandNames.entries()).map(([id, name]) => ({ id, name }));

  // 尝试读取同目录或父目录的 report.json 作为元数据
  const parentDir = path.dirname(dataPointsDir);
  const metadataPath = path.join(parentDir, 'report.json');
  let hasMetadata = false;
  let metadata: Record<string, unknown> | undefined;
  if (fs.existsSync(metadataPath)) {
    try {
      metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8')) as Record<string, unknown>;
      hasMetadata = true;
    } catch {
      // ignore
    }
  }

  return { iterations, commands, dataPointsCount: totalCount, hasMetadata, metadata };
}

function computeAverage(points: DataPoint[]): number {
  const valid = points.filter((p) => typeof p.value === 'number' && !isNaN(p.value));
  if (valid.length === 0) return 0;
  return valid.reduce((sum, p) => sum + p.value, 0) / valid.length;
}

function copyDirectory(src: string, dest: string) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirectory(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/** POST /api/test/reports/import
 * action: 'scan' | 'import'
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action } = body;

    if (action === 'scan') {
      const { sourcePath } = body;
      if (!sourcePath || typeof sourcePath !== 'string') {
        return NextResponse.json({ success: false, message: '缺少源路径' }, { status: 400 });
      }
      const resolved = resolveSourcePath(sourcePath);
      const scan = scanDataPointsFolder(resolved);
      return NextResponse.json({ success: true, ...scan });
    }

    if (action === 'import') {
      const { sourcePath, reportData } = body;
      if (!sourcePath || typeof sourcePath !== 'string') {
        return NextResponse.json({ success: false, message: '缺少源路径' }, { status: 400 });
      }
      if (!reportData || !reportData.name || !reportData.results || !Array.isArray(reportData.results)) {
        return NextResponse.json({ success: false, message: '缺少报告数据' }, { status: 400 });
      }

      const resolvedSource = resolveSourcePath(sourcePath);
      const dataPointsDir = getDataPointsDir(resolvedSource);
      if (!fs.existsSync(dataPointsDir)) {
        return NextResponse.json({ success: false, message: 'dataPoints 文件夹不存在' }, { status: 400 });
      }

      // 收集所有 dataPoints 文件信息，用于补齐每个迭代的 monitorResults
      const dataPointFiles = fs.readdirSync(dataPointsDir).filter((f) => f.endsWith('.json'));
      const iterationCommands = new Map<number, Set<string>>();
      for (const file of dataPointFiles) {
        const match = file.match(/^iteration-(\d+)-(.+)\.json$/);
        if (!match) continue;
        const iteration = parseInt(match[1], 10);
        const commandId = match[2];
        if (!iterationCommands.has(iteration)) iterationCommands.set(iteration, new Set());
        iterationCommands.get(iteration)!.add(commandId);
      }

      ensureDefaultFolder();
      const reports = loadReports();
      const reportId = `report-${Date.now()}`;
      const targetDataPointsDir = path.join(REPORTS_DATA_DIR, reportId, 'dataPoints');

      // 复制 dataPoints 原始文件到报告专属目录
      copyDirectory(dataPointsDir, targetDataPointsDir);

      // 为每个结果补齐 monitorResults：优先使用前端传入，缺省时从 dataPoints 文件推断
      const trimmedResults = reportData.results.map((r: ReportResultInput) => {
        const monitorResults: Record<string, {
          commandId: string;
          commandName: string;
          dataPoints: DataPoint[];
          dataPointsCount?: number;
          averageValue: number;
        }> = {};
        const commands = iterationCommands.get(r.iteration) || new Set<string>();

        if (r.monitorResults) {
          for (const [key, mr] of Object.entries(r.monitorResults)) {
            commands.add(key);
            monitorResults[key] = {
              commandId: mr.commandId,
              commandName: mr.commandName,
              averageValue: mr.averageValue,
              dataPoints: [],
              dataPointsCount: 0,
            };
          }
        }

        for (const commandId of commands) {
          const dataPointsPath = path.join(targetDataPointsDir, `iteration-${r.iteration}-${commandId}.json`);
          let allPoints: DataPoint[] = [];
          if (fs.existsSync(dataPointsPath)) {
            try {
              allPoints = JSON.parse(fs.readFileSync(dataPointsPath, 'utf-8'));
            } catch {
              allPoints = [];
            }
          }
          const existing = monitorResults[commandId];
          monitorResults[commandId] = {
            commandId,
            commandName: existing?.commandName || inferCommandName(commandId),
            averageValue: computeAverage(allPoints),
            dataPoints: [],
            dataPointsCount: allPoints.length,
          };
        }

        return { ...r, monitorResults };
      });

      const newReport = {
        id: reportId,
        createdAt: new Date().toISOString(),
        name: reportData.name,
        description: reportData.description,
        folderId: normalizeFolderId(reportData.folderId),
        config: reportData.config || { host: '' },
        results: trimmedResults,
        environment: reportData.environment || {},
        chartData: {
          powerData: trimmedResults.map((r: { power: number }) => r.power),
          scoreData: trimmedResults.map((r: { score: number }) => r.score),
        },
        monitorResults: trimmedResults[0]?.monitorResults ? {} : undefined,
        jobId: reportData.jobId,
        stageId: reportData.stageId,
        stageName: reportData.stageName,
      };

      reports.unshift(newReport);
      saveReports(reports);

      return NextResponse.json({ success: true, report: newReport });
    }

    return NextResponse.json({ success: false, message: '未知操作' }, { status: 400 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : '导入失败';
    console.error('[Report Import] Error:', msg);
    return NextResponse.json({ success: false, message: msg }, { status: 500 });
  }
}
