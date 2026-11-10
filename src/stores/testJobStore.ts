/**
 * 后台测试任务 Store - 管理服务器端后台任务的创建、查询和中止
 */
import { create } from 'zustand';
import type { SerialMonitorConfig } from '../types/serial';

export interface JobLog {
  type: string;
  message: string;
  timestamp: string;
  /** 单调递增序号（服务端生成，用于增量拉取日志） */
  seq?: number;
}

export interface JobResult {
  iteration: number;
  power: number;
  /** 主分数（兼容旧数据；多分数时取 scores 的第一个值） */
  score: number;
  /** 命名多分数：分数名 → 数值 */
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
  // 流水线阶段（多阶段顺序执行）
  stages?: PipelineStage[];
  currentStageIndex?: number;
}

/** 流水线阶段配置 */
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
  stageResults?: Record<string, {
    stageId: string;
    stageName: string;
    status: 'pending' | 'running' | 'completed' | 'error' | 'skipped';
    results: JobResult[];
    errorMessage?: string;
  }>;
  customAvgRanges?: Record<string, { avgStart?: number; avgEnd?: number }>;
  /** 列表摘要（summary 模式返回，不含 results 明细） */
  resultSummary?: JobResultSummary;
}

/** 任务结果统计摘要（列表页展示用，避免拉取每轮结果明细） */
export interface JobResultSummary {
  totalCount: number;
  successCount: number;
  errorCount: number;
  scoreNames: string[];
  bestScores: Record<string, number>;
  bestScore: number;
}

export interface FetchJobsOptions {
  includeLogs?: boolean;
  includeDataPoints?: boolean;
  /** 摘要模式：只返回统计值，不返回 results 明细（任务列表页使用） */
  summary?: boolean;
  /** 服务端分页：返回条数 */
  limit?: number;
  /** 服务端分页：起始偏移 */
  offset?: number;
}

interface TestJobState {
  jobs: Job[];
  /** 服务端任务总数（分页时使用） */
  totalJobs: number;
  isLoading: boolean;

  fetchJobs: (opts?: FetchJobsOptions) => Promise<void>;
  startJob: (payload: {
    name: string;
    tabId: string;
    clientId: string;
    config: JobConfig;
    /** 定时启动时间（ISO 字符串）；为空表示立即启动 */
    scheduledStartAt?: string;
  }) => Promise<Job | null>;
  abortJob: (id: string) => Promise<void>;
  resumeJob: (id: string) => Promise<void>;
  deleteJob: (id: string) => Promise<void>;
  batchDeleteJobs: (ids: string[]) => Promise<{ deleted: string[]; failed: string[] }>;
  deleteJobsByStatus: (statuses: string[]) => Promise<{ deleted: string[] }>;
  updateJobCustomAvgRanges: (id: string, ranges: Record<string, { avgStart?: number; avgEnd?: number }>) => Promise<{ success: boolean; message: string }>;
  getJobById: (id: string) => Job | undefined;
  getRunningJobForTab: (tabId: string) => Job | undefined;
}

export const useTestJobStore = create<TestJobState>((set, get) => ({
  jobs: [],
  totalJobs: 0,
  isLoading: false,

  fetchJobs: async (opts = {}) => {
    set({ isLoading: true });
    try {
      const params = new URLSearchParams();
      if (opts.includeLogs === false) params.set('includeLogs', 'false');
      if (opts.includeDataPoints === false) params.set('includeDataPoints', 'false');
      if (opts.summary) params.set('summary', 'true');
      if (opts.limit !== undefined) params.set('limit', String(opts.limit));
      if (opts.offset !== undefined) params.set('offset', String(opts.offset));
      const query = params.toString();
      const res = await fetch(`/api/test/jobs${query ? `?${query}` : ''}`);
      const data = await res.json();
      console.log('[testJobStore] fetchJobs response:', data.success, 'jobs count:', (data.jobs || []).length);
      if (data.success) {
        set({
          jobs: data.jobs || [],
          totalJobs: typeof data.total === 'number' ? data.total : (data.jobs || []).length,
        });
      }
    } catch (err) {
      console.error('[testJobStore] fetchJobs failed:', err);
    } finally {
      set({ isLoading: false });
    }
  },

  startJob: async ({ name, tabId, clientId, config, scheduledStartAt }) => {
    try {
      const res = await fetch('/api/test/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, tabId, clientId, config, scheduledStartAt }),
      });
      const data = await res.json();
      if (data.success && data.job) {
        set((state) => ({
          jobs: [data.job, ...state.jobs],
        }));
        return data.job as Job;
      }
      if (data.message) {
        throw new Error(data.message);
      }
    } catch (err) {
      console.error('[testJobStore] startJob failed:', err);
      throw err;
    }
    return null;
  },

  abortJob: async (id) => {
    try {
      // 立即更新本地状态，不需要等轮询
      set((state) => ({
        jobs: state.jobs.map((j) =>
          j.id === id ? { ...j, status: 'aborted' as const } : j
        ),
      }));
      await fetch(`/api/test/jobs/${id}/abort`, { method: 'POST' });
    } catch (err) {
      console.error('[testJobStore] abortJob failed:', err);
    }
  },

  resumeJob: async (id) => {
    try {
      const res = await fetch(`/api/test/jobs/${id}/resume`, { method: 'POST' });
      const data = await res.json();
      if (data.success && data.job) {
        set((state) => ({
          jobs: state.jobs.map((j) =>
            j.id === id ? (data.job as Job) : j
          ),
        }));
        return;
      }
      throw new Error(data.message || '恢复任务失败');
    } catch (err) {
      console.error('[testJobStore] resumeJob failed:', err);
      throw err;
    }
  },

  deleteJob: async (id) => {
    try {
      await fetch(`/api/test/jobs?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      set((state) => ({
        jobs: state.jobs.filter((j) => j.id !== id),
      }));
    } catch (err) {
      console.error('[testJobStore] deleteJob failed:', err);
    }
  },

  batchDeleteJobs: async (ids) => {
    try {
      const res = await fetch(`/api/test/jobs?ids=${ids.join(',')}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (data.success) {
        set((state) => ({
          jobs: state.jobs.filter((j) => !ids.includes(j.id)),
        }));
      }
      return { deleted: data.deleted || [], failed: data.failed || [] };
    } catch (err) {
      console.error('[testJobStore] batchDeleteJobs failed:', err);
      return { deleted: [], failed: ids };
    }
  },

  deleteJobsByStatus: async (statuses) => {
    try {
      const res = await fetch(`/api/test/jobs?status=${statuses.join(',')}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (data.success) {
        set((state) => ({
          jobs: state.jobs.filter((j) => !statuses.includes(j.status)),
        }));
      }
      return { deleted: data.deleted || [] };
    } catch (err) {
      console.error('[testJobStore] deleteJobsByStatus failed:', err);
      return { deleted: [] };
    }
  },

  updateJobCustomAvgRanges: async (id, ranges) => {
    try {
      const res = await fetch(`/api/test/jobs/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customAvgRanges: ranges }),
      });
      const data = await res.json();
      if (data.success) {
        set((state) => ({
          jobs: state.jobs.map((j) =>
            j.id === id && data.job ? { ...j, ...data.job, customAvgRanges: data.customAvgRanges } : j
          ),
        }));
      }
      return { success: data.success, message: data.message };
    } catch (err) {
      console.error('[testJobStore] updateJobCustomAvgRanges failed:', err);
      return { success: false, message: '更新失败' };
    }
  },

  getJobById: (id) => {
    return get().jobs.find((j) => j.id === id);
  },

  getRunningJobForTab: (tabId) => {
    return get().jobs.find(
      (j) =>
        j.tabId === tabId && (j.status === 'running' || j.status === 'pending')
    );
  },
}));

// 注意：不再在模块加载时自动拉取全量任务列表。
// 历史任务很多时，任何页面只要 import 该 store 就会触发一次全量拉取并常驻内存，
// 导致浏览器内存暴涨。需要任务数据的页面自行按需调用 fetchJobs（列表页使用 summary + limit）。
