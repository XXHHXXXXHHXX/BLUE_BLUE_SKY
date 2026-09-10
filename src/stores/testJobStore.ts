/**
 * 后台测试任务 Store - 管理服务器端后台任务的创建、查询和中止
 */
import { create } from 'zustand';

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
  stageResults?: Record<string, {
    stageId: string;
    stageName: string;
    status: 'pending' | 'running' | 'completed' | 'error' | 'skipped';
    results: JobResult[];
    errorMessage?: string;
  }>;
  customAvgRanges?: Record<string, { avgStart?: number; avgEnd?: number }>;
}

interface TestJobState {
  jobs: Job[];
  isLoading: boolean;

  fetchJobs: (opts?: { includeLogs?: boolean; includeDataPoints?: boolean }) => Promise<void>;
  startJob: (payload: { name: string; tabId: string; config: JobConfig }) => Promise<Job | null>;
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
  isLoading: false,

  fetchJobs: async (opts = {}) => {
    set({ isLoading: true });
    try {
      const params = new URLSearchParams();
      if (opts.includeLogs === false) params.set('includeLogs', 'false');
      if (opts.includeDataPoints === false) params.set('includeDataPoints', 'false');
      const query = params.toString();
      const res = await fetch(`/api/test/jobs${query ? `?${query}` : ''}`);
      const data = await res.json();
      console.log('[testJobStore] fetchJobs response:', data.success, 'jobs count:', (data.jobs || []).length);
      if (data.success) {
        set({ jobs: data.jobs || [] });
      }
    } catch (err) {
      console.error('[testJobStore] fetchJobs failed:', err);
    } finally {
      set({ isLoading: false });
    }
  },

  startJob: async ({ name, tabId, config }) => {
    try {
      const res = await fetch('/api/test/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, tabId, config }),
      });
      const data = await res.json();
      if (data.success && data.job) {
        set((state) => ({
          jobs: [data.job, ...state.jobs],
        }));
        return data.job as Job;
      }
    } catch (err) {
      console.error('[testJobStore] startJob failed:', err);
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
      }
    } catch (err) {
      console.error('[testJobStore] resumeJob failed:', err);
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

// 客户端初始化时自动加载任务列表
if (typeof window !== 'undefined') {
  useTestJobStore.getState().fetchJobs();
}
