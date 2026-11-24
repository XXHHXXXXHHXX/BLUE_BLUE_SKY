/** 用例测试相关工具实现：任务查看、用例包、流水线模板、创建/停止任务 */
import fs from 'fs';
import path from 'path';
import {
  getAllJobs,
  getJob,
  createJob,
  requestAbortJob,
  toJobView,
  type JobConfig,
} from '../../../app/api/test/jobs/lib/jobStore';
import { runJob } from '../../../app/api/test/jobs/lib/jobRunner';
import { loadIndex as loadPackageIndex } from '../../../app/api/test/lib/packageStore';

const DATA_DIR = path.join(process.cwd(), '.data');
const TEMPLATES_FILE = path.join(DATA_DIR, 'pipeline-templates.json');

/** 任务列表摘要 */
export function listJobs(limit = 20): Array<Record<string, unknown>> {
  const jobs = getAllJobs().slice(0, Math.max(1, Math.min(limit, 100)));
  return jobs.map((job) => ({
    id: job.id,
    name: job.name,
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    currentStageIndex: job.config.currentStageIndex,
    stageCount: job.config.stages?.length ?? 0,
    mode: job.config.huoyan ? 'huoyan' : job.config.stages?.length ? 'pipeline' : 'iteration',
    resultCount: job.results.length,
    progress: job.progress,
    errorMessage: job.errorMessage,
  }));
}

/** 任务详情（日志可选，默认只给最近 50 条） */
export function getJobDetail(jobId: string, includeLogs = false): Record<string, unknown> | null {
  const job = getJob(jobId);
  if (!job) return null;
  const view = toJobView(job, { includeLogs: false, includeDataPoints: false });
  const logs = includeLogs ? job.logs.slice(-50) : undefined;
  return {
    ...view,
    ...(logs ? { logs } : {}),
  };
}

/** 用例包列表 */
export function listTestPackages(): Array<Record<string, unknown>> {
  return loadPackageIndex().map((pkg) => ({
    id: pkg.id,
    name: pkg.name,
    description: pkg.description,
    filename: pkg.filename,
    size: pkg.size,
    requiredEnvVars: pkg.requiredEnvVars ?? [],
    updatedAt: pkg.updatedAt,
  }));
}

/** 流水线模板列表 */
export function listPipelineTemplates(): Array<Record<string, unknown>> {
  try {
    if (!fs.existsSync(TEMPLATES_FILE)) return [];
    const raw = JSON.parse(fs.readFileSync(TEMPLATES_FILE, 'utf-8'));
    if (!Array.isArray(raw)) return [];
    return raw.map((t: Record<string, unknown>) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      stageCount: Array.isArray(t.stages) ? t.stages.length : 0,
      stages: Array.isArray(t.stages)
        ? (t.stages as Array<Record<string, unknown>>).map((s) => ({
            name: s.name,
            order: s.order,
            packageMode: s.packageMode ?? 'local',
            packageLibraryId: s.packageLibraryId,
          }))
        : [],
    }));
  } catch {
    return [];
  }
}

export interface CreateJobInput {
  name: string;
  /** 目标机 SSH 信息（本地执行模式必填） */
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  /** 用例包 ID（本地执行模式） */
  packageLibraryId?: string;
  /** 迭代参数 */
  iterationParams?: JobConfig['iterationParams'];
  /** 监控命令 */
  monitorCommands?: JobConfig['monitorCommands'];
  /** 火眼模式配置 */
  huoyan?: JobConfig['huoyan'];
  /** 流水线阶段 */
  stages?: JobConfig['stages'];
  clientId?: string;
}

/** 把 AI 传入的精简阶段配置补全为 jobRunner 需要的完整 PipelineStage
 *
 * AI 只提供 name/order/packageMode/packageLibraryId/iterationParams/monitorCommands/huoyan，
 * 其余运行时字段（id/remotePath/adjustmentCommands 等）在这里补齐默认值。
 */
function normalizeStages(
  stages: NonNullable<CreateJobInput['stages']>,
  input: CreateJobInput,
): NonNullable<JobConfig['stages']> {
  return stages
    .map((stage, idx) => {
      const isHuoyanStage = stage.packageMode === 'huoyan';
      const monitorCommands = (stage.monitorCommands ?? []).map((cmd, cmdIdx) => ({
        id: (cmd as { id?: string }).id || `ai-monitor-${idx}-${cmdIdx}`,
        name: cmd.name,
        command: cmd.command,
        target: (cmd as { target?: 'host' | 'bmc' }).target || 'host',
        interval: (cmd as { interval?: number }).interval || 5,
        enabled: (cmd as { enabled?: boolean }).enabled !== false,
      })) as NonNullable<JobConfig['monitorCommands']>;
      return {
        ...stage,
        id: stage.id || `ai-stage-${idx + 1}-${Date.now()}`,
        name: stage.name,
        order: typeof stage.order === 'number' ? stage.order : idx + 1,
        remotePath: stage.remotePath || '',
        packageLibraryId: stage.packageLibraryId || (isHuoyanStage ? undefined : input.packageLibraryId),
        iterationParams:
          stage.iterationParams && stage.iterationParams.length > 0
            ? stage.iterationParams
            : input.iterationParams || [],
        adjustmentCommands: stage.adjustmentCommands || [],
        monitorCommands,
        packageMode: (isHuoyanStage ? 'huoyan' : 'local') as 'local' | 'huoyan',
        ...(isHuoyanStage && stage.huoyan ? { huoyan: stage.huoyan } : {}),
      };
    })
    .sort((a, b) => a.order - b.order);
}

/** 创建并启动测试任务（会真实下发执行，需用户明确要求） */
export function createTestJob(input: CreateJobInput): { job?: Record<string, unknown>; error?: string } {
  if (!input.name?.trim()) return { error: '任务名称不能为空' };

  const isHuoyan = !!input.huoyan;
  const isPipeline = !isHuoyan && Array.isArray(input.stages) && input.stages.length > 0;

  if (isHuoyan) {
    if (!input.huoyan!.queueId || !input.huoyan!.definitionId) {
      return { error: '火眼模式缺少队列或用例定义' };
    }
  } else if (!isPipeline) {
    if (!input.host || !input.username || !input.password) {
      return { error: '本地执行模式需要 host / username / password' };
    }
    if (!Array.isArray(input.iterationParams) || input.iterationParams.length === 0) {
      return { error: '本地执行模式需要至少一个迭代参数' };
    }
  } else {
    if (!input.host || !input.username || !input.password) {
      return { error: '流水线模式需要 host / username / password' };
    }
    for (const stage of input.stages!) {
      if (stage.packageMode === 'huoyan') {
        if (!stage.huoyan?.queueId || !stage.huoyan?.definitionId) {
          return { error: `阶段 [${stage.name}] 火眼模式缺少队列或用例定义` };
        }
      } else if (
        (!stage.iterationParams || stage.iterationParams.length === 0) &&
        (!input.iterationParams || input.iterationParams.length === 0)
      ) {
        return { error: `阶段 [${stage.name}] 缺少迭代参数` };
      }
    }
  }

  const config: JobConfig = {
    host: input.host || '',
    port: input.port || 22,
    username: input.username || '',
    password: input.password || '',
    iterationParams: input.iterationParams || [],
    adjustmentCommands: [],
    monitorCommands: input.monitorCommands || [],
    packageLibraryId: input.packageLibraryId,
    ...(isHuoyan ? { huoyan: input.huoyan } : {}),
    ...(isPipeline ? { stages: normalizeStages(input.stages!, input) } : {}),
  };

  try {
    const job = createJob(config, input.name.trim(), undefined, input.clientId);
    // 后台启动，不阻塞工具返回
    runJob(job.id).catch((err) => {
      console.error(`[AI Test Tool] Job ${job.id} crashed:`, err);
    });
    return {
      job: {
        id: job.id,
        name: job.name,
        status: 'pending',
        mode: isHuoyan ? 'huoyan' : isPipeline ? 'pipeline' : 'iteration',
      },
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : '创建任务失败' };
  }
}

/** 停止运行中的任务 */
export function stopTestJob(jobId: string): { stopped: boolean; error?: string } {
  const job = getJob(jobId);
  if (!job) return { stopped: false, error: `任务不存在: ${jobId}` };
  if (job.status !== 'running' && job.status !== 'pending') {
    return { stopped: false, error: `任务当前状态为 ${job.status}，无法停止` };
  }
  const ok = requestAbortJob(jobId);
  return ok ? { stopped: true } : { stopped: false, error: '中止请求未被接受' };
}
