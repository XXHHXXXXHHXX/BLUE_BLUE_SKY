/** 后台测试任务状态管理 - 内存 + 单条记录持久化（快照兼容旧版本） */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { SerialMonitorConfig } from '../../../../../src/types/serial';

const DATA_DIR = path.join(process.cwd(), '.data');
const JOBS_FILE = path.join(DATA_DIR, 'test-jobs.json');
const JOB_DATA_POINTS_DIR = path.join(DATA_DIR, 'job-data-points');

export interface JobLog {
  type: string;
  message: string;
  timestamp: string;
  /** 单调递增序号（用于详情页增量拉取日志；旧数据加载时补齐） */
  seq?: number;
}

export interface JobResult {
  iteration: number;
  power: number;
  /** 主分数（兼容旧数据；多分数时取 scores 的第一个值） */
  score: number;
  /** 命名多分数：分数名 → 数值（run.sh 输出 {"scores": {...}} 时填充） */
  scores?: Record<string, number>;
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
    continuous?: boolean;
    startCommand?: string;
    fetchCommand?: string;
    /** 串口（BMC SOL）监控配置；设置后该条命令走串口采集 */
    serial?: SerialMonitorConfig;
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
    /** 日志监控模式：interval=按间隔轮询（默认），continuous=持续模式 */
    mode?: 'interval' | 'continuous';
    /** 持续模式：迭代开始前执行的启动命令（可长时间运行） */
    startCommand?: string;
    /** 持续模式：迭代结束后执行的获取命令 */
    fetchCommand?: string;
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
  /** 创建任务的浏览器客户端 ID，用于多人共用时区分任务归属 */
  clientId?: string;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'aborted' | 'error';
  /** 定时启动时间（ISO 字符串）；设置后任务保持 pending，到点自动开始执行 */
  scheduledStartAt?: string;
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
  /** 列表摘要（仅 summary 视图返回，不落盘） */
  resultSummary?: {
    totalCount: number;
    successCount: number;
    errorCount: number;
    scoreNames: string[];
    bestScores: Record<string, number>;
    bestScore: number;
  };
}

// 使用 globalThis 保持跨模块热重载的内存共享
const GLOBAL_KEY = '__blue_sky_jobs__';
const globalJobs = (globalThis as Record<string, unknown>)[GLOBAL_KEY] as Map<string, Job> | undefined;
const jobs = globalJobs || new Map<string, Job>();
(globalThis as Record<string, unknown>)[GLOBAL_KEY] = jobs;

const MAX_LOGS_PER_JOB = 5000;

const JOB_RECORDS_DIR = path.join(DATA_DIR, 'records', 'jobs');

/** 递归读取 records/jobs 下的所有任务记录文件 */
function readJobRecordFiles(): Job[] {
  const result: Job[] = [];
  if (!fs.existsSync(JOB_RECORDS_DIR)) return result;
  const walk = (dir: string) => {
    let names: string[] = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      const full = path.join(dir, name);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        walk(full);
        continue;
      }
      if (!name.endsWith('.json')) continue;
      try {
        result.push(JSON.parse(fs.readFileSync(full, 'utf-8')) as Job);
      } catch {
        // 跳过损坏记录
      }
    }
  };
  walk(JOB_RECORDS_DIR);
  return result;
}

function loadJobs(): void {
  // 如果 globalThis 中已有数据，说明是模块热重载，不需要重新加载文件
  if (globalJobs && jobs.size > 0) {
    console.log('[JobStore] loadJobs: using global shared jobs, count:', jobs.size);
    return;
  }
  try {
    // 优先使用单条记录（更新更及时）；不存在时回退到聚合快照（旧版本数据）
    const recordJobs = readJobRecordFiles();
    let data: Job[] | null = null;
    let source = '';
    if (recordJobs.length > 0) {
      data = recordJobs;
      source = 'records';
    } else if (fs.existsSync(JOBS_FILE)) {
      const raw = fs.readFileSync(JOBS_FILE, 'utf-8');
      if (!raw.trim()) {
        console.log('[JobStore] loadJobs: empty file at', JOBS_FILE);
        return;
      }
      data = JSON.parse(raw) as Job[];
      source = 'snapshot';
    }

    if (!data) {
      console.log('[JobStore] loadJobs: no file at', JOBS_FILE);
      return;
    }

    console.log('[JobStore] loadJobs: loaded', data.length, 'jobs from', source);
    for (const job of data) {
      // 定时任务：仍处于 pending 且计划时间未到，保留 pending 由调度器重新挂起；
      // 计划时间已过的定时任务同样保留 pending，由调度器立即启动
      const isScheduled = job.status === 'pending' && !!job.scheduledStartAt;
      // 恢复时，正在运行或等待中的任务标记为中断（因为服务器可能已重启）
      if (!isScheduled && (job.status === 'running' || job.status === 'pending')) {
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
      // 兼容旧数据：补齐日志单调序号（详情页增量拉取依赖 seq）
      let seq = 0;
      for (const log of job.logs) {
        if (typeof log.seq !== 'number') log.seq = seq;
        seq = log.seq + 1;
      }
      jobs.set(job.id, job);
    }

    // 从旧快照迁移：把任务拆分为单条记录，后续只增量写入
    if (source === 'snapshot') {
      for (const job of jobs.values()) {
        try {
          writeJobRecord(job);
        } catch (err) {
          console.error('[JobStore] Failed to migrate job record:', job.id, err);
        }
      }
      console.log('[JobStore] Migrated', jobs.size, 'jobs to record files');
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

/** 结果中是否还有未剔除的采样点（内存里的采样点通常已落盘并清空） */
function hasInlineDataPoints(results: JobResult[]): boolean {
  for (const r of results) {
    if (!r.monitorResults) continue;
    for (const mr of Object.values(r.monitorResults)) {
      if (mr.dataPoints && mr.dataPoints.length > 0) return true;
    }
  }
  return false;
}

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

/** 生成可落盘的任务副本（剔除大数组与非关键日志） */
function getJobsForSaveOf(list: Job[]): Job[] {
  return list.map((job) => {
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

function getJobsForSave(): Job[] {
  return getJobsForSaveOf(Array.from(jobs.values()));
}

/** 待写入单条记录文件的任务 ID（只写脏任务，避免每次全量重写） */
const dirtyJobIds = new Set<string>();
/** 快照重建防抖计时器（快照仍写 test-jobs.json，供旧版本读取） */
let snapshotTimer: ReturnType<typeof setTimeout> | null = null;
const SNAPSHOT_DEBOUNCE_MS = 10000;

/** 单条任务记录的落盘路径（与记录存储引擎的目录约定一致） */
function jobRecordPath(id: string): string {
  const hash = crypto.createHash('sha1').update(id).digest('hex').slice(0, 16);
  return path.join(DATA_DIR, 'records', 'jobs', hash.slice(0, 2), `${hash}.json`);
}

/** 落盘单条任务（剔除大数组，与快照口径一致） */
function writeJobRecord(job: Job): void {
  const [persisted] = getJobsForSaveOf([job]);
  const filePath = jobRecordPath(job.id);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tempFile = `${filePath}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(persisted));
  fs.renameSync(tempFile, filePath);
}

function removeJobRecord(id: string): void {
  try {
    const filePath = jobRecordPath(id);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    // ignore
  }
}

/** 重建聚合快照（test-jobs.json），兼容旧版本读取 */
function writeJobsSnapshot(): void {
  snapshotTimer = null;
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const tempFile = `${JOBS_FILE}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(getJobsForSave(), null, 2));
    fs.renameSync(tempFile, JOBS_FILE);
    console.log('[JobStore] Saved snapshot:', jobs.size, 'jobs to', JOBS_FILE);
  } catch (err) {
    console.error('[JobStore] Failed to save jobs snapshot:', err);
  }
}

function scheduleSnapshot(): void {
  if (snapshotTimer) return;
  snapshotTimer = setTimeout(writeJobsSnapshot, SNAPSHOT_DEBOUNCE_MS);
  if (typeof snapshotTimer.unref === 'function') snapshotTimer.unref();
}

/** 只写脏任务的单条记录文件，快照按较长间隔重建 */
function flushSaveJobs(): void {
  saveTimer = null;
  if (!pendingSave) return;
  pendingSave = false;
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    for (const id of dirtyJobIds) {
      const job = jobs.get(id);
      if (!job) {
        removeJobRecord(id);
        continue;
      }
      try {
        writeJobRecord(job);
      } catch (err) {
        console.error('[JobStore] Failed to write job record:', id, err);
      }
    }
    dirtyJobIds.clear();
    scheduleSnapshot();
  } catch (err) {
    console.error('[JobStore] Failed to save jobs:', err);
  }
}

function saveJobs(id?: string): void {
  if (id) dirtyJobIds.add(id);
  pendingSave = true;
  if (saveTimer) return; // 已在等待中，合并为一次保存
  saveTimer = setTimeout(flushSaveJobs, 1000); // 1 秒后落盘，合并高频日志/采样变更
}

/** 强制立即保存：写入脏任务记录并重建快照 */
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
    for (const id of dirtyJobIds) {
      const job = jobs.get(id);
      if (!job) {
        removeJobRecord(id);
        continue;
      }
      try {
        writeJobRecord(job);
      } catch (err) {
        console.error('[JobStore] Failed to write job record:', id, err);
      }
    }
    dirtyJobIds.clear();
    if (snapshotTimer) {
      clearTimeout(snapshotTimer);
      snapshotTimer = null;
    }
    writeJobsSnapshot();
    console.log('[JobStore] Force saved jobs:', jobs.size);
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

export function createJob(config: JobConfig, name: string, tabId?: string, clientId?: string): Job {
  const job: Job = {
    id: `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    tabId,
    clientId,
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
  saveJobs(job.id);
  return job;
}

export function updateJob(id: string, updates: Partial<Omit<Job, 'id'>>): Job | undefined {
  const job = jobs.get(id);
  if (!job) return undefined;
  Object.assign(job, updates, { updatedAt: new Date().toISOString() });
  saveJobs(id);
  return job;
}

export function addJobLog(id: string, type: string, message: string): void {
  const job = jobs.get(id);
  if (!job) return;
  if (job.logs.length >= MAX_LOGS_PER_JOB) {
    job.logs.shift();
  }
  const lastSeq = job.logs.length > 0 ? job.logs[job.logs.length - 1].seq : undefined;
  job.logs.push({
    type,
    message,
    timestamp: new Date().toISOString(),
    seq: typeof lastSeq === 'number' ? lastSeq + 1 : job.logs.length,
  });
  job.updatedAt = new Date().toISOString();
  saveJobs(id);
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

  saveJobs(id);
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
      // 优先查阶段结果；阶段未结束（任务运行中）时阶段结果为空，
      // 回退到实时更新的 job.results，保证每轮完成后立即可查看采样详情
      result = stageResults.results.find((r) => r.iteration === iteration) || result;
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

/** 该任务的运行器是否仍在收尾（用于恢复前判断） */
export function isJobRunnerActive(id: string): boolean {
  return activeJobRunners.has(id);
}

export function requestAbortJob(id: string): boolean {
  const job = jobs.get(id);
  if (!job || (job.status !== 'running' && job.status !== 'pending')) return false;
  job.abortRequested = true;
  job.updatedAt = new Date().toISOString();
  saveJobs(id);

  // 立即触发运行器清理（停止监控、断开 SSH、远程 kill）
  const runner = activeJobRunners.get(id);
  if (runner) {
    try {
      runner.abort();
    } catch (err) {
      console.error(`[JobStore] Abort handler error for ${id}:`, err);
    }
  }

  // 20秒后如果任务还在running，强制改为aborted。
  // 必须同时确认 abortRequested 仍为 true：任务可能已在中止后立即恢复，
  // 此时 abortRequested 被清空，不能再把它强制中止
  setTimeout(() => {
    const currentJob = jobs.get(id);
    if (currentJob && currentJob.status === 'running' && currentJob.abortRequested) {
      console.warn(`[JobStore] Job ${id} abort timeout (20s), forcing aborted status`);
      currentJob.status = 'aborted';
      currentJob.updatedAt = new Date().toISOString();
      currentJob.logs.push({
        type: 'error',
        message: '中止超时（20秒），已强制中止',
        timestamp: new Date().toISOString(),
      });
      saveJobs(id);
      activeJobRunners.delete(id);
    }
  }, 20000);

  return true;
}

/** 清空指定阶段在磁盘上的采样点与日志归档，避免恢复后新旧数据混在一起 */
function cleanStageArtifacts(
  jobId: string,
  stageId: string | undefined,
  stageName: string | undefined,
  isPipeline: boolean,
): void {
  const dirs: string[] = [];
  if (stageId) {
    // 采样点始终按 stageId 分目录（单阶段任务的 stageId 为 'default'）
    dirs.push(path.join(JOB_DATA_POINTS_DIR, jobId, `stage-${stageId}`));
    // 日志归档：流水线按 stageId 分目录，单阶段直接位于任务根目录
    dirs.push(
      isPipeline
        ? path.join(process.cwd(), '.data', 'logs', jobId, stageId)
        : path.join(process.cwd(), '.data', 'logs', jobId),
    );
  } else {
    dirs.push(path.join(JOB_DATA_POINTS_DIR, jobId));
    dirs.push(path.join(process.cwd(), '.data', 'logs', jobId));
  }
  for (const dir of dirs) {
    try {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
        console.log(`[JobStore] Cleaned stage artifacts for job ${jobId}${stageName ? ` [${stageName}]` : ''}:`, dir);
      }
    } catch (err) {
      console.error('[JobStore] Failed to clean stage artifacts:', dir, err);
    }
  }
}

/**
 * 恢复已中止的任务：从被中止的阶段重新开始。
 *
 * 语义：
 *  - 定位被中止的阶段（流水线取 config.currentStageIndex，单阶段视为唯一阶段）；
 *  - 清除该阶段的全部结果（job.results 中该 stageId 的项、stageResults 条目）
 *    以及磁盘上的采样点 / 日志归档，保证恢复后数据不重复、不残留半轮脏数据；
 *  - 已完成的更早阶段结果保留不动；
 *  - 从该阶段第 1 轮重新执行，后续阶段继续执行到结束。
 */
export function resumeJob(id: string): Job | undefined {
  const job = jobs.get(id);
  if (!job || job.status !== 'aborted') return undefined;

  const stages = (job.config.stages || []).slice().sort((a, b) => a.order - b.order);
  const isPipeline = stages.length > 0;
  const stageIndex = Math.min(
    Math.max(0, job.config.currentStageIndex ?? 0),
    Math.max(0, stages.length - 1),
  );
  const abortedStage = isPipeline ? stages[stageIndex] : undefined;
  const abortedStageId = abortedStage?.id;
  const abortedStageName = abortedStage?.name;

  // 1. 清除被中止阶段的结果（保留更早阶段）
  if (isPipeline && abortedStageId) {
    job.results = job.results.filter((r) => r.stageId !== abortedStageId);
    if (job.stageResults) {
      const nextStageResults = { ...job.stageResults };
      delete nextStageResults[abortedStageId];
      job.stageResults = nextStageResults;
    }
    // 清除中止阶段之后（理论上不会有）的阶段结果，避免残留
    const laterStageIds = new Set(stages.slice(stageIndex + 1).map((s) => s.id));
    if (laterStageIds.size > 0) {
      job.results = job.results.filter((r) => !r.stageId || !laterStageIds.has(r.stageId));
      if (job.stageResults) {
        job.stageResults = Object.fromEntries(
          Object.entries(job.stageResults).filter(([key]) => !laterStageIds.has(key)),
        );
      }
    }
  } else {
    // 单阶段：清空全部结果
    job.results = [];
    job.stageResults = undefined;
  }

  // 2. 清除磁盘上该阶段的采样点与日志归档
  cleanStageArtifacts(id, abortedStageId, abortedStageName, isPipeline);

  // 3. 重置进度与阶段索引，从被中止阶段的首轮重新开始
  job.progress = { currentIteration: 0, totalIterations: 0, currentLabel: '' };
  job.config = { ...job.config, currentStageIndex: isPipeline ? stageIndex : 0 };
  job.status = 'pending';
  job.abortRequested = false;
  job.errorMessage = undefined;
  job.logs.push({
    type: 'info',
    message: abortedStage
      ? `恢复任务：清除阶段 [${abortedStage.name}] 的已有数据，从该阶段第 1 轮重新执行`
      : '恢复任务：清除已有数据，从第 1 轮重新执行',
    timestamp: new Date().toISOString(),
  });
  job.updatedAt = new Date().toISOString();
  saveJobs(job.id);
  return job;
}

/** 任务结果摘要：列表页只需要统计值，避免把每轮结果明细全部传输/驻留内存 */
export interface JobResultSummary {
  totalCount: number;
  successCount: number;
  errorCount: number;
  scoreNames: string[];
  bestScores: Record<string, number>;
  bestScore: number;
}

export interface JobViewOptions {
  includeLogs?: boolean;
  includeDataPoints?: boolean;
  /** 摘要模式：不返回 results / stageResults 明细，只返回 resultSummary（任务列表专用） */
  summary?: boolean;
  /** 增量拉取：只返回 seq 大于该值的日志（避免每秒传输全量日志） */
  logsAfterSeq?: number;
  /** 仅返回最近 N 条日志（未指定 logsAfterSeq 时的兜底上限） */
  logsLimit?: number;
}

/** 由结果数组计算列表页所需的统计摘要 */
export function buildResultSummary(results: JobResult[]): JobResultSummary {
  const successResults = results.filter((r) => r.status === 'success');
  const scoreNames: string[] = [];
  const seen = new Set<string>();
  for (const r of successResults) {
    for (const name of Object.keys(r.scores || {})) {
      if (!seen.has(name)) {
        seen.add(name);
        scoreNames.push(name);
      }
    }
  }
  const bestScores: Record<string, number> = {};
  for (const name of scoreNames) {
    let best = -Infinity;
    for (const r of successResults) {
      const v = r.scores?.[name];
      if (typeof v === 'number' && v > best) best = v;
    }
    if (Number.isFinite(best)) bestScores[name] = best;
  }
  const bestScore = successResults.length > 0
    ? Math.max(...successResults.map((r) => (Number.isFinite(r.score) ? r.score : -Infinity)))
    : 0;

  return {
    totalCount: results.length,
    successCount: successResults.length,
    errorCount: results.filter((r) => r.status === 'error').length,
    scoreNames,
    bestScores,
    bestScore: Number.isFinite(bestScore) ? bestScore : 0,
  };
}

/** 按视图选项返回任务的轻量副本，避免把大日志/采样点一次性序列化到前端 */
export function toJobView(job: Job, options: JobViewOptions = {}): Job {
  const {
    includeLogs = true,
    includeDataPoints = true,
    summary = false,
    logsAfterSeq,
    logsLimit,
  } = options;
  const needsLogWindow = logsAfterSeq !== undefined || logsLimit !== undefined;
  if (includeLogs && includeDataPoints && !summary && !needsLogWindow) return job;

  const clone: Job = { ...job };

  // 日志：支持增量窗口，避免详情页每秒拉取全量（最多 5000 条）日志
  if (!includeLogs) {
    clone.logs = [];
  } else if (needsLogWindow) {
    let logs = job.logs;
    if (logsAfterSeq !== undefined) {
      logs = logs.filter((l) => (l.seq ?? 0) > logsAfterSeq);
    }
    if (logsLimit !== undefined && logs.length > logsLimit) {
      logs = logs.slice(-logsLimit);
    }
    clone.logs = logs;
  }

  // 摘要模式：剔除结果明细（可能是数千轮 × 多个监控命令的元数据）
  if (summary) {
    const allResults = job.results.length > 0
      ? job.results
      : (job.stageResults
        ? Object.values(job.stageResults).flatMap((sr) => sr.results)
        : []);
    clone.results = [];
    clone.stageResults = job.stageResults
      ? Object.fromEntries(
        Object.entries(job.stageResults).map(([key, sr]) => [key, { ...sr, results: [] }])
      )
      : undefined;
    clone.resultSummary = buildResultSummary(allResults);
  } else if (!includeDataPoints) {
    // 内存中的采样点通常已落盘并清空，此时无需逐条复制结果对象（历史任务多时开销很大）
    if (job.results.length > 0 && hasInlineDataPoints(job.results)) {
      clone.results = job.results.map(stripResultDataPoints);
    }
    if (job.stageResults) {
      const stageEntries = Object.entries(job.stageResults);
      if (stageEntries.some(([, sr]) => hasInlineDataPoints(sr.results))) {
        clone.stageResults = Object.fromEntries(
          stageEntries.map(([key, sr]) => [
            key,
            { ...sr, results: sr.results.map(stripResultDataPoints) },
          ])
        );
      }
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
    saveJobs(id);
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
    for (const id of deleted) saveJobs(id);
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
    for (const id of toDelete) saveJobs(id);
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

  saveJobs(jobId);
  return { success: true, message: `已更新 ${Object.keys(ranges).length} 个监控命令的平均值计算范围` };
}

export function getJobCustomAvgRanges(jobId: string): Record<string, { avgStart?: number; avgEnd?: number }> | undefined {
  const job = jobs.get(jobId);
  return job?.customAvgRanges;
}

// 初始化加载
loadJobs();
