/** 测试报告 API - 服务器端存储 */
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getJob } from '../jobs/lib/jobStore';

// ========== 数据目录配置 ==========
const DATA_DIR = path.join(process.cwd(), '.data');
const REPORTS_FILE = path.join(DATA_DIR, 'test-reports.json');
const FOLDERS_FILE = path.join(DATA_DIR, 'test-report-folders.json');
const REPORTS_DATA_DIR = path.join(DATA_DIR, 'reports');
const JOB_DATA_POINTS_DIR = path.join(DATA_DIR, 'job-data-points');
const DEFAULT_FOLDER_ID = 'uncategorized';

interface TestReportData {
  id: string;
  name: string;
  description?: string;
  /** 所属目录 ID */
  folderId?: string;
  createdAt: string;
  config: {
    host: string;
    iterationParams?: Array<{ id: string; name: string; mode: 'range' | 'custom'; start: number; end: number; step: number; values: string[] }>;
    adjustmentCommands?: Array<{ id: string; name: string; target: string; sessionId: string | null; command: string; parameterName: string }>;
    // 兼容旧数据
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
  chartData?: {
    powerData: number[];
    scoreData: number[];
  };
  monitorResults?: Record<string, {
    commandId: string;
    commandName: string;
    dataPoints: Array<{ timestamp: string; value: number; raw: string }>;
    averageValue: number;
  }>;
  /** 环境信息键值对 */
  environment?: Record<string, string>;
  jobId?: string;
  stageId?: string;
  stageName?: string;
  /** 自定义平均值计算范围覆盖，key 为 commandId，value 为范围（1-based 索引） */
  customAvgRanges?: Record<string, { avgStart?: number; avgEnd?: number }>;
  // 旧数据兼容字段，读取后会被删除
  testSuite?: string;
}

interface ReportFolderData {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
  // 旧数据兼容字段
  testSuite?: string;
}

// 确保目录存在
function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

// 读取报告列表
function loadReports(): TestReportData[] {
  try {
    if (fs.existsSync(REPORTS_FILE)) {
      return JSON.parse(fs.readFileSync(REPORTS_FILE, 'utf-8'));
    }
  } catch {
    console.error('Failed to load test-reports');
  }
  return [];
}

/** 保存前剔除所有原始采样点，避免旧报告数据撑爆 JSON */
function stripReportDataPointsForSave(report: TestReportData): TestReportData {
  type MonitorResultEntry = {
    commandId: string;
    commandName: string;
    dataPoints: Array<{ timestamp: string; value: number; raw: string }>;
    dataPointsCount?: number;
    averageValue: number;
  };
  type StrippedMonitorResultEntry = Omit<MonitorResultEntry, 'dataPoints'> & {
    dataPoints: never[];
    dataPointsCount: number;
  };

  const stripMr = (mr: MonitorResultEntry): StrippedMonitorResultEntry => ({
    ...mr,
    dataPoints: [],
    dataPointsCount: mr.dataPointsCount ?? mr.dataPoints.length,
  });

  const stripMonitorResults = (monitorResults?: Record<string, MonitorResultEntry>) => {
    if (!monitorResults) return undefined;
    const result: Record<string, StrippedMonitorResultEntry> = {};
    for (const [key, mr] of Object.entries(monitorResults)) {
      result[key] = stripMr(mr);
    }
    return result;
  };

  return {
    ...report,
    monitorResults: stripMonitorResults(report.monitorResults) as TestReportData['monitorResults'],
    results: report.results.map((r) => ({
      ...r,
      monitorResults: stripMonitorResults(r.monitorResults) as typeof r.monitorResults,
    })),
  };
}

// 保存报告列表
function saveReports(reports: TestReportData[]) {
  ensureDir();
  const cleaned = reports.map(stripReportDataPointsForSave);
  try {
    fs.writeFileSync(REPORTS_FILE, JSON.stringify(cleaned, null, 2));
  } catch (err) {
    console.error('[Reports API] Failed to save reports with pretty print, trying compact:', err);
    try {
      fs.writeFileSync(REPORTS_FILE, JSON.stringify(cleaned));
    } catch (err2) {
      console.error('[Reports API] Failed to save reports:', err2);
      throw err2;
    }
  }
}

function calculateAverageFromPoints(
  points: Array<{ timestamp: string; value: number; raw: string }>,
  avgStart?: number,
  avgEnd?: number
): number {
  if (!points || points.length === 0) return 0;
  const start = avgStart !== undefined ? Math.max(0, avgStart - 1) : 0;
  const end = avgEnd !== undefined ? Math.min(points.length, avgEnd) : points.length;
  if (start >= end) return 0;
  const subset = points.slice(start, end);
  const validValues = subset.map((p) => p.value).filter((v) => !isNaN(v));
  return validValues.length > 0 ? validValues.reduce((a, b) => a + b, 0) / validValues.length : 0;
}

function getReportDataPointsFile(reportId: string, iteration: number, commandId: string): string {
  return path.join(REPORTS_DATA_DIR, reportId, 'dataPoints', `iteration-${iteration}-${commandId}.json`);
}

function getJobDataPointsFile(jobId: string, iteration: number, commandId: string, stageId?: string): string {
  if (stageId) {
    return path.join(JOB_DATA_POINTS_DIR, jobId, `stage-${stageId}`, `iteration-${iteration}-${commandId}.json`);
  }
  return path.join(JOB_DATA_POINTS_DIR, jobId, `iteration-${iteration}-${commandId}.json`);
}

function readJsonArraySync<T>(filePath: string): T[] {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T[];
    }
  } catch {
    // ignore
  }
  return [];
}

function updateReportCustomAvgRanges(
  reportId: string,
  ranges: Record<string, { avgStart?: number; avgEnd?: number }>
): { success: boolean; message: string } {
  const reports = loadReports();
  const report = reports.find((r) => r.id === reportId);
  if (!report) {
    return { success: false, message: '报告不存在' };
  }

  report.customAvgRanges = { ...report.customAvgRanges, ...ranges };

  for (const result of report.results) {
    if (!result.monitorResults) continue;
    for (const [commandId, range] of Object.entries(ranges)) {
      const mr = result.monitorResults[commandId];
      if (!mr) continue;

      let points = mr.dataPoints;
      if ((!points || points.length === 0) && mr.dataPointsCount && mr.dataPointsCount > 0) {
        points = readJsonArraySync(getReportDataPointsFile(reportId, result.iteration, commandId));
      }

      if (points && points.length > 0) {
        mr.averageValue = calculateAverageFromPoints(points, range.avgStart, range.avgEnd);
      }
    }
  }

  saveReports(reports);
  return { success: true, message: `已更新 ${Object.keys(ranges).length} 个监控命令的平均值计算范围` };
}

// 目录相关辅助
function loadFolders(): ReportFolderData[] {
  try {
    if (fs.existsSync(FOLDERS_FILE)) {
      return JSON.parse(fs.readFileSync(FOLDERS_FILE, 'utf-8'));
    }
  } catch {
    console.error('[Reports API] Failed to load folders');
  }
  return [];
}

function saveFolders(folders: ReportFolderData[]) {
  ensureDir();
  fs.writeFileSync(FOLDERS_FILE, JSON.stringify(folders, null, 2));
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
    saveFolders(folders);
  }
}

/** 将旧测试套后缀的默认目录 ID 统一迁移为 uncategorized */
function normalizeFolderId(folderId?: string | null): string | undefined {
  if (!folderId) return undefined;
  return folderId.startsWith('uncategorized-') ? DEFAULT_FOLDER_ID : folderId;
}

/** 迁移旧数据：删除 testSuite 字段，统一默认目录 ID */
function migrateData() {
  let folders = loadFolders();
  let foldersChanged = false;
  const oldDefaultIds = new Set<string>();

  for (const folder of folders) {
    if (folder.id && folder.id.startsWith('uncategorized-') && folder.id !== DEFAULT_FOLDER_ID) {
      oldDefaultIds.add(folder.id);
    }
  }

  if (oldDefaultIds.size > 0) {
    foldersChanged = true;
    for (const folder of folders) {
      if (folder.id.startsWith('uncategorized-')) {
        folder.id = DEFAULT_FOLDER_ID;
      }
      if (folder.parentId && folder.parentId.startsWith('uncategorized-')) {
        folder.parentId = DEFAULT_FOLDER_ID;
      }
    }
  }

  for (const folder of folders) {
    if ('testSuite' in folder) {
      delete (folder as any).testSuite;
      foldersChanged = true;
    }
  }

  if (foldersChanged) {
    // 去重：可能存在多个旧测试套的默认目录被合并
    const seen = new Set<string>();
    folders = folders.filter((f) => {
      if (seen.has(f.id)) return false;
      seen.add(f.id);
      return true;
    });
    saveFolders(folders);
  }

  const reports = loadReports();
  let reportsChanged = false;
  for (const report of reports) {
    if ('testSuite' in report) {
      delete (report as any).testSuite;
      reportsChanged = true;
    }
    const normalized = normalizeFolderId(report.folderId);
    if (normalized !== report.folderId) {
      report.folderId = normalized;
      reportsChanged = true;
    }
  }
  if (reportsChanged) {
    saveReports(reports);
  }
}

/** 为旧报告补齐 folderId 并确保默认目录存在 */
function normalizeReportFolders(reports: TestReportData[]): TestReportData[] {
  migrateData();
  ensureDefaultFolder();
  for (const report of reports) {
    if (!report.folderId) {
      report.folderId = DEFAULT_FOLDER_ID;
    }
  }
  return reports;
}

/** 列表返回时剔除原始采样点，避免旧报告/异常数据把大数组载入前端导致 OOM */
function stripReportForList(report: TestReportData): TestReportData {
  const stripMonitorResults = (
    monitorResults?: Record<string, {
      commandId: string;
      commandName: string;
      dataPoints: Array<{ timestamp: string; value: number; raw: string }>;
      dataPointsCount?: number;
      averageValue: number;
    }>
  ) => {
    if (!monitorResults) return undefined;
    const result: Record<string, {
      commandId: string;
      commandName: string;
      dataPoints: Array<{ timestamp: string; value: number; raw: string }>;
      dataPointsCount?: number;
      averageValue: number;
    }> = {};
    for (const [key, mr] of Object.entries(monitorResults)) {
      result[key] = {
        commandId: mr.commandId,
        commandName: mr.commandName,
        averageValue: mr.averageValue,
        dataPoints: [],
        dataPointsCount: mr.dataPointsCount ?? mr.dataPoints.length,
      };
    }
    return result;
  };

  return {
    ...report,
    monitorResults: stripMonitorResults(report.monitorResults),
    results: report.results.map((r) => ({
      ...r,
      monitorResults: stripMonitorResults(r.monitorResults),
    })),
  };
}

/** GET /api/test/reports - 获取报告列表 */
export async function GET() {
  const reports = normalizeReportFolders(loadReports()).map(stripReportForList);
  return NextResponse.json({ success: true, reports });
}

/** 安全 JSON 序列化，超大对象返回占位符而非抛异常 */
function safeStringify(value: any, fallback = '[too large to stringify]'): string {
  try {
    return JSON.stringify(value);
  } catch (err) {
    return fallback;
  }
}

/** 流式写入 JSON 数组，避免单次 JSON.stringify 超过字符串上限 */
function writeJsonArraySync(filePath: string, items: any[]) {
  const fd = fs.openSync(filePath, 'w');
  try {
    fs.writeSync(fd, '[');
    for (let i = 0; i < items.length; i++) {
      if (i > 0) fs.writeSync(fd, ',');
      fs.writeSync(fd, JSON.stringify(items[i]));
    }
    fs.writeSync(fd, ']');
  } finally {
    fs.closeSync(fd);
  }
}

/** POST /api/test/reports - 保存报告 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, description, folderId, config, results, environment, jobId, stageId, stageName } = body;

    console.log('[Reports API] Save report request:', {
      name,
      jobId,
      stageId,
      stageName,
      resultsCount: Array.isArray(results) ? results.length : 'invalid',
      configHost: config?.host,
      bodySize: safeStringify(body).length,
    });

    if (!name || !results) {
      return NextResponse.json({ success: false, message: '缺少必要参数' }, { status: 400 });
    }
    if (!Array.isArray(results)) {
      return NextResponse.json({ success: false, message: 'results 必须是数组' }, { status: 400 });
    }

    const reports = normalizeReportFolders(loadReports());
    const targetFolderId = folderId || DEFAULT_FOLDER_ID;

    const reportId = `report-${Date.now()}`;
    const reportDataDir = path.join(REPORTS_DATA_DIR, reportId, 'dataPoints');
    const sourceJob = jobId ? getJob(jobId) : undefined;
    console.log('[Reports API] sourceJob found:', !!sourceJob, sourceJob ? `results=${sourceJob.results.length}` : '');

    // 保存报告时剔除原始采样点，避免大任务（尤其 list 模式长参数）导致 JSON.stringify 超限
    // 详细采样点写入报告专属文件，后续可按需读取
    const trimmedResults = results.map((r: any, index: number) => {
      try {
        if (!r || typeof r !== 'object') {
          console.warn(`[Reports API] Invalid result at index ${index}:`, r);
          return r;
        }
        if (!r.monitorResults) return r;

        const sourceResult = sourceJob?.results.find((sr) => {
          if (sr.iteration !== r.iteration) return false;
          // stageId 可能来自旧数据为 undefined，优先按 stageId 匹配，否则只按 iteration 匹配
          if (sr.stageId === r.stageId) return true;
          if (r.stageId === undefined || sr.stageId === undefined) return true;
          return false;
        });
        if (sourceJob && !sourceResult) {
          console.warn(`[Reports API] sourceResult not found for iteration=${r.iteration}, stageId=${r.stageId}`);
        }

        const monitorResults: Record<string, {
          commandId: string;
          commandName: string;
          dataPoints: Array<{ timestamp: string; value: number; raw: string }>;
          dataPointsCount?: number;
          averageValue: number;
        }> = {};
        for (const [key, mr] of Object.entries(r.monitorResults as Record<string, {
          commandId: string;
          commandName: string;
          dataPoints: Array<{ timestamp: string; value: number; raw: string }>;
          averageValue: number;
        }>)) {
          if (!mr || typeof mr !== 'object') {
            console.warn(`[Reports API] Invalid monitorResult entry at index ${index}, key=${key}:`, mr);
            continue;
          }
          let allPoints: Array<{ timestamp: string; value: number; raw: string }> = [];
          if (jobId) {
            if (r.stageId) {
              const newFilePath = getJobDataPointsFile(jobId, r.iteration, key, r.stageId);
              allPoints = readJsonArraySync(newFilePath);
              if (allPoints.length === 0) {
                const oldFilePath = getJobDataPointsFile(jobId, r.iteration, key);
                allPoints = readJsonArraySync(oldFilePath);
              }
            } else {
              const jobDataPointsFile = getJobDataPointsFile(jobId, r.iteration, key);
              allPoints = readJsonArraySync(jobDataPointsFile);
            }
          }
          if (allPoints.length === 0) {
            allPoints = mr?.dataPoints || [];
          }
          monitorResults[key] = {
            commandId: mr?.commandId || key,
            commandName: mr?.commandName || key,
            averageValue: typeof mr?.averageValue === 'number' ? mr.averageValue : 0,
            dataPoints: [],
            dataPointsCount: allPoints.length,
          };
          if (allPoints.length > 0) {
            try {
              fs.mkdirSync(reportDataDir, { recursive: true });
              const filePath = path.join(reportDataDir, `iteration-${r.iteration}-${key}.json`);
              writeJsonArraySync(filePath, allPoints);
            } catch (err) {
              console.error(`[Reports API] Failed to save dataPoints for iteration ${r.iteration} command ${key}:`, err);
            }
          }
        }
        return { ...r, monitorResults };
      } catch (resultError) {
        console.error(`[Reports API] Failed to process result at index ${index}:`, resultError, r);
        throw resultError;
      }
    });

    const newReport: TestReportData = {
      id: reportId,
      createdAt: new Date().toISOString(),
      name,
      description,
      folderId: targetFolderId,
      config: config || { host: '' },
      results: trimmedResults,
      environment: environment || {},
      chartData: {
        powerData: trimmedResults.map((r: { power: number }) => r.power),
        scoreData: trimmedResults.map((r: { score: number }) => r.score),
      },
      // 保留迭代参数信息到报告
      monitorResults: trimmedResults[0]?.monitorResults ? {} : undefined,
      jobId,
      stageId,
      stageName,
    };

    // 复制日志文件到报告专属目录
    if (jobId && Array.isArray(results)) {
      const reportLogsDir = path.join(DATA_DIR, 'reports', newReport.id, 'logs');
      let hasLogs = false;
      for (const result of results) {
        if (result?.logArchivePath && typeof result.logArchivePath === 'string') {
          try {
            if (fs.existsSync(result.logArchivePath)) {
              if (!hasLogs) {
                fs.mkdirSync(reportLogsDir, { recursive: true });
                hasLogs = true;
              }
              // 保留原始扩展名（.tar.gz 或 .zip）
              const srcExt = result.logArchivePath.endsWith('.tar.gz') ? '.tar.gz' : '.zip';
              const destPath = path.join(reportLogsDir, `iteration-${result.iteration}${srcExt}`);
              fs.copyFileSync(result.logArchivePath, destPath);
              result.logArchivePath = destPath;
            }
          } catch (err) {
            console.error(`[Reports API] Failed to copy log for iteration ${result?.iteration}:`, err);
          }
        }
      }
    }

    reports.unshift(newReport);
    saveReports(reports);
    console.log('[Reports API] Report saved successfully:', reportId, 'total reports:', reports.length);

    return NextResponse.json({ success: true, report: newReport });
  } catch (error) {
    const msg = error instanceof Error ? error.message : '保存失败';
    const stack = error instanceof Error ? error.stack : '';
    console.error('[Reports API] Save error:', msg, stack);
    return NextResponse.json({ success: false, message: msg, stack: process.env.NODE_ENV === 'development' ? stack : undefined }, { status: 500 });
  }
}

/** DELETE /api/test/reports - 删除报告 */
export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json({ success: false, message: '缺少报告ID' }, { status: 400 });
  }

  const reports = loadReports();
  const idx = reports.findIndex((r) => r.id === id);
  if (idx === -1) {
    return NextResponse.json({ success: false, message: '报告不存在' }, { status: 404 });
  }

  reports.splice(idx, 1);
  saveReports(reports);

  // 清理报告关联的日志文件
  try {
    const reportLogsDir = path.join(DATA_DIR, 'reports', id);
    if (fs.existsSync(reportLogsDir)) {
      fs.rmSync(reportLogsDir, { recursive: true, force: true });
    }
  } catch (err) {
    console.error('[Reports API] Failed to clean report logs:', err);
  }

  return NextResponse.json({ success: true, message: '已删除' });
}

/** PATCH /api/test/reports - 更新报告（重命名、移动目录、自定义平均值范围等） */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, name, description, folderId, environment, customAvgRanges } = body;

    if (!id) {
      return NextResponse.json({ success: false, message: '缺少报告ID' }, { status: 400 });
    }

    if (customAvgRanges) {
      const result = updateReportCustomAvgRanges(id, customAvgRanges);
      if (!result.success) {
        return NextResponse.json({ success: false, message: result.message }, { status: 404 });
      }
      const reports = normalizeReportFolders(loadReports());
      const report = reports.find((r) => r.id === id);
      return NextResponse.json({ success: true, message: result.message, report, customAvgRanges: report?.customAvgRanges });
    }

    const reports = normalizeReportFolders(loadReports());
    const report = reports.find((r) => r.id === id);
    if (!report) {
      return NextResponse.json({ success: false, message: '报告不存在' }, { status: 404 });
    }

    if (name !== undefined) report.name = name;
    if (description !== undefined) report.description = description;
    if (folderId !== undefined) report.folderId = folderId;
    if (environment !== undefined) report.environment = environment;
    saveReports(reports);

    return NextResponse.json({ success: true, report });
  } catch (error) {
    const msg = error instanceof Error ? error.message : '更新失败';
    console.error('[Reports API] Update error:', msg);
    return NextResponse.json({ success: false, message: msg }, { status: 500 });
  }
}
