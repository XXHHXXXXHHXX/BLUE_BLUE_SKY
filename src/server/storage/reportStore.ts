/**
 * 测试报告存储 - 基于通用记录存储引擎
 *
 * 对外仍暴露 loadReports / saveReports 等语义，但内部：
 * - 列表/搜索/分页走内存索引，只读取当前页的记录文件
 * - 新增/更新/删除只写单条记录文件
 * - test-reports.json 作为聚合快照定期重建，保证旧版本可读
 */
import path from 'path';
import fs from 'fs';
import { getRecordStore, type RecordStore } from './recordStore';

const DATA_DIR = path.join(process.cwd(), '.data');
export const REPORTS_FILE = path.join(DATA_DIR, 'test-reports.json');
export const FOLDERS_FILE = path.join(DATA_DIR, 'test-report-folders.json');
export const REPORTS_DATA_DIR = path.join(DATA_DIR, 'reports');
export const JOB_DATA_POINTS_DIR = path.join(DATA_DIR, 'job-data-points');
export const DEFAULT_FOLDER_ID = 'uncategorized';

export interface ReportMonitorResultEntry {
  commandId: string;
  commandName: string;
  dataPoints: Array<{ timestamp: string; value: number; raw: string }>;
  dataPointsCount?: number;
  averageValue: number;
}

export interface TestReportData {
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
    /** 命名多分数：分数名 → 数值 */
    scores?: Record<string, number>;
    status: string;
    message?: string;
    timestamp: string;
    iterationValues?: Record<string, string>;
    iterationLabel?: string;
    monitorResults?: Record<string, ReportMonitorResultEntry>;
    logArchivePath?: string;
  }>;
  chartData?: {
    powerData: number[];
    scoreData: number[];
    /** 命名多分数序列：分数名 → 每轮数值 */
    scoreSeries?: Record<string, Array<number | null>>;
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

export interface ReportFolderData {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
  // 旧数据兼容字段
  testSuite?: string;
}

function reportSortKey(report: TestReportData): number {
  const ts = Date.parse(report.createdAt || '');
  return Number.isFinite(ts) ? ts : 0;
}

function normalizeReport(report: TestReportData): TestReportData {
  const normalized: TestReportData = { ...report };
  if (!normalized.folderId) normalized.folderId = DEFAULT_FOLDER_ID;
  if (normalized.folderId.startsWith('uncategorized-')) normalized.folderId = DEFAULT_FOLDER_ID;
  if ('testSuite' in normalized) delete (normalized as { testSuite?: string }).testSuite;
  return normalized;
}

let store: RecordStore<TestReportData> | null = null;

export function getReportStore(): RecordStore<TestReportData> {
  if (!store) {
    store = getRecordStore<TestReportData>({
      collection: 'reports',
      snapshotFile: REPORTS_FILE,
      idOf: (report) => report.id,
      sortKeyOf: reportSortKey,
      filterOf: (report) => ({ folderId: report.folderId || DEFAULT_FOLDER_ID }),
      searchFieldsOf: (report) => [
        report.name,
        report.description,
        report.config?.host,
      ],
      normalize: normalizeReport,
    });
  }
  return store;
}

/** 读取全部报告（全量语义，供导入/合并/AI 分析等场景使用） */
export function loadReports(): TestReportData[] {
  return getReportStore().getAll();
}

/**
 * 保存全部报告（全量语义）。
 * 仅在导入、合并等整体替换场景使用；常规增删改请用 putReport/removeReport。
 */
export function saveReports(reports: TestReportData[]): void {
  getReportStore().replaceAll(reports);
}

/** 新增或更新单条报告 */
export function putReport(report: TestReportData): void {
  getReportStore().put(report);
}

/** 按 ID 读取单条报告 */
export function getReportById(id: string): TestReportData | undefined {
  return getReportStore().getById(id);
}

/** 删除单条报告 */
export function removeReport(id: string): boolean {
  return getReportStore().remove(id);
}

// ==================== 目录 ====================

export function loadFolders(): ReportFolderData[] {
  try {
    if (fs.existsSync(FOLDERS_FILE)) {
      return JSON.parse(fs.readFileSync(FOLDERS_FILE, 'utf-8')) as ReportFolderData[];
    }
  } catch {
    console.error('[ReportStore] Failed to load folders');
  }
  return [];
}

export function saveFolders(folders: ReportFolderData[]): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(FOLDERS_FILE, JSON.stringify(folders, null, 2));
}

/** 收集某目录及其所有子目录 ID */
export function collectFolderIds(folderId: string, folders: ReportFolderData[]): Set<string> {
  const ids = new Set([folderId]);
  const visited = new Set<string>();
  const collect = (parentId: string) => {
    if (visited.has(parentId)) return;
    visited.add(parentId);
    for (const f of folders) {
      if (f.parentId === parentId) {
        ids.add(f.id);
        collect(f.id);
      }
    }
  };
  collect(folderId);
  return ids;
}

/** 计算每个目录下的报告数量（含子目录），直接使用索引计数，不读取报告正文 */
export function buildFolderCounts(
  store: RecordStore<TestReportData>,
  folders: ReportFolderData[]
): Record<string, number> {
  const direct = store.countBy('folderId');
  const counts: Record<string, number> = {};
  const countFor = (folderId: string, stack: Set<string> = new Set()): number => {
    if (counts[folderId] !== undefined) return counts[folderId];
    if (stack.has(folderId)) return 0;
    stack.add(folderId);
    let count = direct[folderId] || 0;
    for (const f of folders) {
      if (f.parentId === folderId) count += countFor(f.id, stack);
    }
    stack.delete(folderId);
    counts[folderId] = count;
    return count;
  };
  for (const f of folders) countFor(f.id);
  countFor(DEFAULT_FOLDER_ID);
  return counts;
}

/** 列表返回时剔除原始采样点，避免旧报告/异常数据把大数组载入前端导致 OOM */
export function stripReportForList(report: TestReportData): TestReportData {
  const stripMonitorResults = (
    monitorResults?: Record<string, ReportMonitorResultEntry>
  ) => {
    if (!monitorResults) return undefined;
    const result: Record<string, ReportMonitorResultEntry> = {};
    for (const [key, mr] of Object.entries(monitorResults)) {
      result[key] = {
        commandId: mr.commandId,
        commandName: mr.commandName,
        averageValue: mr.averageValue,
        dataPoints: [],
        dataPointsCount: mr.dataPointsCount ?? mr.dataPoints?.length ?? 0,
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

/** 保存前剔除所有原始采样点，避免旧报告数据撑爆 JSON */
export function stripReportDataPointsForSave(report: TestReportData): TestReportData {
  const stripMr = (mr: ReportMonitorResultEntry): ReportMonitorResultEntry => ({
    ...mr,
    dataPoints: [],
    dataPointsCount: mr.dataPointsCount ?? mr.dataPoints?.length ?? 0,
  });

  const stripMonitorResults = (monitorResults?: Record<string, ReportMonitorResultEntry>) => {
    if (!monitorResults) return undefined;
    const result: Record<string, ReportMonitorResultEntry> = {};
    for (const [key, mr] of Object.entries(monitorResults)) {
      result[key] = stripMr(mr);
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
