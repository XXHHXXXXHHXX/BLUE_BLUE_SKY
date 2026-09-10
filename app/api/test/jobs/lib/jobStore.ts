/** 后台测试任务状态管理 - 内存 + 文件持久化 */
import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), '.data');
const JOBS_FILE = path.join(DATA_DIR, 'test-jobs.json');
const JOB_DATA_POINTS_DIR = path.join(DATA_DIR, 'job-data-points');

export interface JobLog {
  type: string;
  message: string;
  timestamp: string;
}

export interface JobResult {
  iteration: number;
  power: number;
  score: number;
  status: 'success' | 'error';
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
  /** 本轮迭代的日志压缩包本地路径 */
  logArchivePath?: string;
  /** 所属流水线阶段 */
  stageId?: string;
  stageName?: string;
}

export interface JobConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  iterationParams: Array<{
    id: string;
    name: string;
    mode: 'range' | 'custom';
    start: number;
    end: number;
    step: number;
    values: string[];
  }>;
  adjustmentCommands: Array<{
    id: string;
    name: string;
    target: 'host' | 'bmc';
    sessionId?: string;
    bmcConfig?: {
      host: string;
      port: number;
      username: string;
      password: string;
    };
    command: string;
    parameterName: string;
  }>;
  envVars?: Array<{ key: string; value: string }>;
  monitorCommands?: Array<{
    id: string;
    name: string;
    command: string;
    target: 'host' | 'bmc';
    bmcConfig?: {
      host: string;
      port: number;
      username: string;
      password: string;
    };
    interval: number;
    enabled: boolean;
    mode?: 'single' | 'list';
    columns?: string[];
    jumpThreshold?: number;
    jumpThresholdType?: 'percent' | 'absolute';
    skipJumps?: number;
    skipFirst?: number;
    takeLast?: number;
    skipLast?: number;
    excludeZero?: boolean;
  }>;
  // 心跳检测配置
  heartbeatEnabled?: boolean;
  heartbeatInterval?: number;
  heartbeatMaxFailures?: number;
  // 告警配置
  alertWebhook?: string;
  // 日志监控配置
  logMonitorConfig?: {
    enabled: boolean;
    command: string;
    interval: number;
    target: 'host' | 'bmc';
    bmcConfig?: {
      host: string;
      port: number;
      username: string;
      password: string;
    };
  };
  // 统一 BMC 会话选择
  globalBmcSessionId?: string | null;
  // 已部署的远程测试包路径（流水线/多阶段任务使用）
  remotePath?: string;
  // 当前正在运行的测试脚本目录（用于中止时执行 stop.sh）
  activeScriptDir?: string;
  // 流水线阶段（多阶段顺序执行）
  stages?: PipelineStage[];
  currentStageIndex?: number;
}

/** 流水线阶段配置（复用 JobConfig 的大部分字段，去掉主机连接信息） */
export interface PipelineStage {
  id: string;
  name: string;
  order: number;
  remotePath: string;
  iterationParams: JobConfig['iterationParams'];
  adjustmentCommands: JobConfig['adjustmentCommands'];
  monitorCommands?: JobConfig['monitorCommands'];
  envVars?: JobConfig['envVars'];
  heartbeatEnabled?: boolean;
  heartbeatInterval?: number;
  heartbeatMaxFailures?: number;
  alertWebhook?: string;
  logMonitorConfig?: JobConfig['logMonitorConfig'];
  globalBmcSessionId?: string | null;
  /** 屏蔽监控采样日志输出（节省内存+终端输出） */
  suppressMonitorLogs?: boolean;
}

export interface Job {
  id: string;
  tabId?: string;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'aborted' | 'error';
  config: JobConfig;
  progress: {
    currentIteration: number;
    totalIterations: number;
    currentLabel: string;
  };
  logs: JobLog[];
  results: JobResult[];
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
  abortRequested?: boolean;
  stageResults?: Record<string, {
    stageId: string;
    stageName: string;
    status: 'pending' | 'running' | 'completed' | 'error' | 'skipped';
    results: JobResult[];
    errorMessage?: string;
  }>;
  /** 自定义平均值计算范围覆盖，key 为 commandId，value 为范围（1-based 索引） */
  customAvgRanges?: Record<string, { avgStart?: number; avgEnd?: number }>;
}

// 使用 globalThis 保持跨模块热重载的内存共享
const GLOBAL_KEY = '__blue_sky_jobs__';
const globalJobs = (globalThis as Record<string, unknown>)[GLOBAL_KEY] as Map<string, Job> | undefined;
const jobs = globalJobs || new Map<string, Job>();
(globalThis as Record<string, unknown>)[GLOBAL_KEY] = jobs;

const MAX_LOGS_PER_JOB = 5000;

function loadJobs(): void {
  // 如果 globalThis 中已有数据，说明是模块热重载，不需要重新加载文件
  if (globalJobs && jobs.size > 0) {
    console.log('[JobStore] loadJobs: using global shared jobs, count:', jobs.size);
    return;
  }
  try {
    if (fs.existsSync(JOBS_FILE)) {
      const raw = fs.readFileSync(JOBS_FILE, 'utf-8');
      if (!raw.trim()) {
        console.log('[JobStore] loadJobs: empty file at', JOBS_FILE);
        return;
      }
      const data = JSON.parse(raw) as Job[];
      console.log('[JobStore] loadJobs: loaded', data.length, 'jobs from', JOBS_FILE);
      for (const job of data) {
        // 恢复时，正在运行或等待中的任务标记为中断（因为服务器可能已重启）
        if (job.status === 'running' || job.status === 'pending') {
          job.status = 'aborted';
          job.errorMessage = '服务器重启，任务已中止';
          if (job.logs.length >= MAX_LOGS_PER_JOB) {
            job.logs.shift();
          }
          job.logs.push({
            type: 'info',
            message: '服务器重启，任务已中止',
            timestamp: new Date().toISOString(),
          });
        }
        jobs.set(job.id, job);
      }
    } else {
      console.log('[JobStore] loadJobs: no file at', JOBS_FILE);
    }
  } catch (err) {
    console.error('[JobStore] Failed to load jobs:', err);
    // 文件损坏时备份，避免持续解析失败
    try {
      if (fs.existsSync(JOBS_FILE)) {
        const backupPath = `${JOBS_FILE}.bak.${Date.now()}`;
        fs.renameSync(JOBS_FILE, backupPath);
        console.log('[JobStore] Backed up corrupted jobs file to', backupPath);
      }
    } catch (backupErr) {
      console.error('[JobStore] Failed to backup corrupted jobs file:', backupErr);
    }
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let pendingSave = false;

function stripResultDataPoints(r: JobResult): JobResult {
  if (!r.monitorResults) return r;
  const monitorResults: Record<string, {
    commandId: string;
    commandName: string;
    dataPoints: Array<{ timestamp: string; value: number; raw: string }>;
    dataPointsCount?: number;
    averageValue: number;
  }> = {};
  for (const [key, mr] of Object.entries(r.monitorResults)) {
    monitorResults[key] = {
      commandId: mr.commandId,
      commandName: mr.commandName,
      averageValue: mr.averageValue,
      dataPoints: [],
      dataPointsCount: mr.dataPointsCount ?? mr.dataPoints.length,
    };
  }
  return { ...r, monitorResults };
}

/** 落盘时剔除 monitorResults.dataPoints 大数组和 shell 终端 stdout/stderr 日志，
 *  避免 JSON 序列化导致栈溢出/文件过大。
 *  内存中仍保留完整 dataPoints 和日志，供运行中查询；持久化只保留统计与关键日志。 */
function getJobsForSave(): Job[] {
  const PERSIST_LOG_TYPES = new Set([
    'info',
    'start',
    'complete',
    'iteration_start',
    'iteration_end',
    'iteration_error',
    'error',
    'warning',
    'monitor_sample',
    'stdout_summary',
    'stderr_summary',
  ]);
  return Array.from(jobs.values()).map((job) => {
    const strippedStageResults = job.stageResults
      ? Object.fromEntries(
          Object.entries(job.stageResults).map(([key, sr]) => [
            key,
            { ...sr, results: sr.results.map(stripResultDataPoints) },
          ])
        )
      : undefined;
    return {
      ...job,
      results: job.results.map(stripResultDataPoints),
      stageResults: strippedStageResults,
      logs: job.logs.filter((log) => PERSIST_LOG_TYPES.has(log.type)),
    };
  });
}

function flushSaveJobs(): void {
  saveTimer = null;
  if (!pendingSave) return;
  pendingSave = false;
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const tempFile = `${JOBS_FILE}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(getJobsForSave(), null, 2));
    fs.renameSync(tempFile, JOBS_FILE);
    console.log('[JobStore] Saved jobs:', jobs.size, 'to', JOBS_FILE);
  } catch (err) {
    console.error('[JobStore] Failed to save jobs:', err);
  }
}

function saveJobs(): void {
  pendingSave = true;
  if (saveTimer) return; // 已在等待中，合并为一次保存
  saveTimer = setTimeout(flushSaveJobs, 3000); // 3 秒后落盘，合并高频日志/采样变更
}

/** 强制立即保存，不等待 3 秒防抖 */
export function forceSaveJobs(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (!pendingSave) return;
  pendingSave = false;
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const tempFile = `${JOBS_FILE}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(getJobsForSave(), null, 2));
    fs.renameSync(tempFile, JOBS_FILE);
    console.log('[JobStore] Force saved jobs:', jobs.size, 'to', JOBS_FILE);
  } catch (err) {
    console.error('[JobStore] Force save failed:', err);
  }
}

export function getAllJobs(): Job[] {
  const all = Array.from(jobs.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  console.log('[JobStore] getAllJobs:', all.length, 'jobs');
  return all;
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

export function createJob(config: JobConfig, name: string, tabId?: string): Job {
  const job: Job = {
    id: `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    tabId,
    name,
    status: 'pending',
    config,
    progress: { currentIteration: 0, totalIterations: 0, currentLabel: '' },
    logs: [],
    results: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  jobs.set(job.id, job);
  console.log('[JobStore] createJob:', job.id, 'total jobs:', jobs.size);
  saveJobs();
  return job;
}

export function updateJob(id: string, updates: Partial<Omit<Job, 'id'>>): Job | undefined {
  const job = jobs.get(id);
  if (!job) return undefined;
  Object.assign(job, updates, { updatedAt: new Date().toISOString() });
  saveJobs();
  return job;
}

export function addJobLog(id: string, type: string, message: string): void {
  const job = jobs.get(id);
  if (!job) return;
  if (job.logs.length >= MAX_LOGS_PER_JOB) {
    job.logs.shift();
  }
  job.logs.push({ type, message, timestamp: new Date().toISOString() });
  job.updatedAt = new Date().toISOString();
  saveJobs();
}

export function appendJobResult(id: string, result: JobResult): void {
  const job = jobs.get(id);
  if (!job) return;
  job.results.push(result);
  job.updatedAt = new Date().toISOString();

  if (result.monitorResults) {
    persistIterationMonitorDataPoints(id, result.iteration, result.monitorResults, result.stageId);
    clearIterationMonitorDataPointsFromMemory(id, result.iteration);
  }

  saveJobs();
}

// ========== 监控采样点分页查询 ==========
function getJobDataPointsDir(jobId: string): string {
  return path.join(JOB_DATA_POINTS_DIR, jobId);
}

function getIterationDataPointsFile(jobId: string, iteration: number, commandId: string, stageId?: string): string {
  if (stageId) {
    return path.join(getJobDataPointsDir(jobId), `stage-${stageId}`, `iteration-${iteration}-${commandId}.json`);
  }
  return path.join(getJobDataPointsDir(jobId), `iteration-${iteration}-${commandId}.json`);
}

function writeJsonArraySync(filePath: string, data: unknown[]): void {
  fs.writeFileSync(filePath, JSON.stringify(data), 'utf-8');
}

function readJsonArraySync<T>(filePath: string): T[] {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as T[];
  } catch {
    return [];
  }
}

export interface MonitorDataPoint {
  timestamp: string;
  value: number;
  raw: string;
}

export interface MonitorDataQueryResult {
  commandId: string;
  commandName: string;
  iteration: number;
  total: number;
  dataPoints: MonitorDataPoint[];
}

export function getMonitorDataPoints(
  id: string,
  iteration: number,
  commandId: string,
  offset: number,
  limit: number,
  stageId?: string
): MonitorDataQueryResult | undefined {
  const job = jobs.get(id);
  if (!job) return undefined;

  let result = job.results.find((r) => r.iteration === iteration);
  if (stageId) {
    const stageResults = job.stageResults?.[stageId];
    if (stageResults) {
      result = stageResults.results.find((r) => r.iteration === iteration);
    }
  }
  if (!result) return undefined;

  const monitorResult = result.monitorResults?.[commandId];
  if (!monitorResult) return undefined;

  let all: Array<{ timestamp: string; value: number; raw: string }> = [];
  let total = 0;

  if (monitorResult.dataPoints && monitorResult.dataPoints.length > 0) {
    all = monitorResult.dataPoints;
    total = all.length;
  } else {
    total = monitorResult.dataPointsCount ?? 0;
    if (total > 0) {
      all = readJsonArraySync(getIterationDataPointsFile(id, iteration, commandId, stageId));
    }
  }

  const safeOffset = Math.max(0, offset);
  const safeLimit = Math.max(1, limit);

  return {
    commandId,
    commandName: monitorResult.commandName,
    iteration,
    total,
    dataPoints: all.slice(safeOffset, safeOffset + safeLimit),
  };
}

export type MonitorResultsForPersist = Record<string, {
  commandId: string;
  commandName: string;
  dataPoints: Array<{ timestamp: string; value: number; raw: string }>;
  averageValue: number;
}>;

export function persistIterationMonitorDataPoints(
  jobId: string,
  iteration: number,
  monitorResults: MonitorResultsForPersist,
  stageId?: string
): void {
  const jobDir = stageId
    ? path.join(getJobDataPointsDir(jobId), `stage-${stageId}`)
    : getJobDataPointsDir(jobId);
  if (!fs.existsSync(jobDir)) {
    fs.mkdirSync(jobDir, { recursive: true });
  }

  for (const [key, mr] of Object.entries(monitorResults)) {
    if (mr.dataPoints && mr.dataPoints.length > 0) {
      const filePath = getIterationDataPointsFile(jobId, iteration, key, stageId);
      writeJsonArraySync(filePath, mr.dataPoints);
    }
  }
}

export function clearIterationMonitorDataPointsFromMemory(jobId: string, iteration: number): void {
  const job = jobs.get(jobId);
  if (!job) return;

  const result = job.results.find((r) => r.iteration === iteration);
  if (!result || !result.monitorResults) return;

  for (const [, mr] of Object.entries(result.monitorResults)) {
    if (mr.dataPoints && mr.dataPoints.length > 0) {
      mr.dataPointsCount = mr.dataPoints.length;
      mr.dataPoints = [];
    }
  }
}

// ========== 活跃任务运行器管理（用于立即中止）==========
const activeJobRunners = new Map<string, { abort: () => void }>();

export function registerJobRunner(id: string, abortFn: () => void): void {
  activeJobRunners.set(id, { abort: abortFn });
}

export function unregisterJobRunner(id: string): void {
  activeJobRunners.delete(id);
}

export function requestAbortJob(id: string): boolean {
  const job = jobs.get(id);
  if (!job || (job.status !== 'running' && job.status !== 'pending')) return false;
  job.abortRequested = true;
  job.updatedAt = new Date().toISOString();
  saveJobs();

  // 立即触发运行器清理（停止监控、断开 SSH、远程 kill）
  const runner = activeJobRunners.get(id);
  if (runner) {
    try {
      runner.abort();
    } catch (err) {
      console.error(`[JobStore] Abort handler error for ${id}:`, err);
    }
  }

  // 20秒后如果任务还在running，强制改为aborted
  setTimeout(() => {
    const currentJob = jobs.get(id);
    if (currentJob && currentJob.status === 'running') {
      console.warn(`[JobStore] Job ${id} abort timeout (20s), forcing aborted status`);
      currentJob.status = 'aborted';
      currentJob.updatedAt = new Date().toISOString();
      currentJob.logs.push({
        type: 'error',
        message: '中止超时（20秒），已强制中止',
        timestamp: new Date().toISOString(),
      });
      saveJobs();
      activeJobRunners.delete(id);
    }
  }, 20000);

  return true;
}

export function resumeJob(id: string): Job | undefined {
  const job = jobs.get(id);
  if (!job || job.status !== 'aborted') return undefined;

  const resumeFrom = job.progress.currentIteration;

  // 清除可能不完整的结果（大于等于恢复起始迭代的结果）
  if (resumeFrom > 0) {
    job.results = job.results.filter((r) => r.iteration < resumeFrom);
  }

  job.status = 'pending';
  job.abortRequested = false;
  job.errorMessage = undefined;
  job.logs.push({
    type: 'info',
    message: `恢复任务，从第 ${Math.max(1, resumeFrom)} 轮继续执行`,
    timestamp: new Date().toISOString(),
  });
  job.updatedAt = new Date().toISOString();
  saveJobs();
  return job;
}

export interface JobViewOptions {
  includeLogs?: boolean;
  includeDataPoints?: boolean;
}

/** 按视图选项返回任务的轻量副本，避免把大日志/采样点一次性序列化到前端 */
export function toJobView(job: Job, options: JobViewOptions = {}): Job {
  const { includeLogs = true, includeDataPoints = true } = options;
  if (includeLogs && includeDataPoints) return job;

  const clone: Job = { ...job };

  if (!includeLogs) {
    clone.logs = [];
  }

  if (!includeDataPoints) {
    if (job.results.length > 0) {
      clone.results = job.results.map(stripResultDataPoints);
    }
    if (job.stageResults) {
      clone.stageResults = Object.fromEntries(
        Object.entries(job.stageResults).map(([key, sr]) => [
          key,
          { ...sr, results: sr.results.map(stripResultDataPoints) },
        ])
      );
    }
  }

  return clone;
}

function cleanJobRelatedFiles(id: string): void {
  const dirsToClean = [
    path.join(process.cwd(), '.data', 'logs', id),
    path.join(JOB_DATA_POINTS_DIR, id),
  ];
  for (const dir of dirsToClean) {
    try {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
        console.log('[JobStore] Cleaned directory for job:', id, dir);
      }
    } catch (err) {
      console.error('[JobStore] Failed to clean directory for job:', id, dir, err);
    }
  }
}

export function deleteJob(id: string): boolean {
  const deleted = jobs.delete(id);
  if (deleted) {
    saveJobs();
    cleanJobRelatedFiles(id);
  }
  return deleted;
}

export function batchDeleteJobs(ids: string[]): { deleted: string[]; failed: string[] } {
  const deleted: string[] = [];
  const failed: string[] = [];
  for (const id of ids) {
    if (jobs.has(id)) {
      jobs.delete(id);
      deleted.push(id);
      cleanJobRelatedFiles(id);
    } else {
      failed.push(id);
    }
  }
  if (deleted.length > 0) {
    saveJobs();
  }
  return { deleted, failed };
}

export function deleteJobsByStatus(statuses: Array<'pending' | 'running' | 'completed' | 'aborted' | 'error'>): { deleted: string[] } {
  const toDelete: string[] = [];
  for (const [id, job] of jobs) {
    if (statuses.includes(job.status)) {
      toDelete.push(id);
    }
  }
  for (const id of toDelete) {
    jobs.delete(id);
    cleanJobRelatedFiles(id);
  }
  if (toDelete.length > 0) {
    saveJobs();
  }
  return { deleted: toDelete };
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

export function updateJobCustomAvgRanges(
  jobId: string,
  ranges: Record<string, { avgStart?: number; avgEnd?: number }>
): { success: boolean; message: string } {
  const job = jobs.get(jobId);
  if (!job) {
    return { success: false, message: '任务不存在' };
  }

  job.customAvgRanges = { ...job.customAvgRanges, ...ranges };
  job.updatedAt = new Date().toISOString();

  for (const result of job.results) {
    if (!result.monitorResults) continue;
    for (const [commandId, range] of Object.entries(ranges)) {
      const mr = result.monitorResults[commandId];
      if (!mr) continue;

      let points = mr.dataPoints;
      if ((!points || points.length === 0) && mr.dataPointsCount && mr.dataPointsCount > 0) {
        points = readJsonArraySync(getIterationDataPointsFile(jobId, result.iteration, commandId));
      }

      if (points && points.length > 0) {
        mr.averageValue = calculateAverageFromPoints(points, range.avgStart, range.avgEnd);
      }
    }
  }

  if (job.stageResults) {
    for (const stageResult of Object.values(job.stageResults)) {
      for (const result of stageResult.results) {
        if (!result.monitorResults) continue;
        for (const [commandId, range] of Object.entries(ranges)) {
          const mr = result.monitorResults[commandId];
          if (!mr) continue;

          let points = mr.dataPoints;
          if ((!points || points.length === 0) && mr.dataPointsCount && mr.dataPointsCount > 0) {
            points = readJsonArraySync(getIterationDataPointsFile(jobId, result.iteration, commandId));
          }

          if (points && points.length > 0) {
            mr.averageValue = calculateAverageFromPoints(points, range.avgStart, range.avgEnd);
          }
        }
      }
    }
  }

  saveJobs();
  return { success: true, message: `已更新 ${Object.keys(ranges).length} 个监控命令的平均值计算范围` };
}

export function getJobCustomAvgRanges(jobId: string): Record<string, { avgStart?: number; avgEnd?: number }> | undefined {
  const job = jobs.get(jobId);
  return job?.customAvgRanges;
}

// 初始化加载
loadJobs();
