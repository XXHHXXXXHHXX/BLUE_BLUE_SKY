/** 火眼自动化平台执行模式
 *
 * 流程：
 *  1. 通过 prepare/commit 把用例追加到指定的 bluesky 队列
 *  2. 轮询队列 item 状态；一旦变为 running，立即启动监控命令采集
 *  3. 等待 item 进入终态（completed / failed / cancelled / interrupted / skipped）
 *  4. completed 时拉取 run 结果，把 metrics 作为分数，连同监控采样一起落为一条结果
 *
 * 支持两种用法：
 *  - 单阶段任务：`runHuoyanJob(jobId)`，自行维护任务整体状态
 *  - 流水线阶段：`runHuoyanStage(jobId, config, stage, stageIndex)`，只返回阶段结果，
 *    整体状态由 jobRunner 的阶段循环维护
 */
import path from 'path';
import {
  addJobLog,
  appendJobResult,
  getJob,
  registerJobRunner,
  unregisterJobRunner,
  updateJob,
  type Job,
  type JobResult,
  type PipelineStage,
} from './jobStore';
import { appendQueueItem, cancelRun, fetchQueue, fetchRun, skipQueueItem, HuoyanError } from './huoyanClient';
import { MonitorCollector } from './monitorCollector';
import { resolveHuoyanTimeoutMs, type HuoyanJobConfig } from '../../../../../src/types/huoyan';

/** 轮询队列状态的间隔（毫秒） */
const POLL_INTERVAL_MS = 5000;

const ACTIVE_STATUSES = new Set(['queued', 'prechecking', 'waiting_for_targets', 'running']);
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled', 'interrupted', 'skipped']);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 把火眼 run 的 metrics 转成蓝天分数：主分数优先取 intrate/score，其余作为命名分数 */
function metricsToScore(metrics: Record<string, number> | undefined): {
  score: number;
  scores?: Record<string, number>;
} {
  if (!metrics) return { score: 0 };
  const numeric: Record<string, number> = {};
  for (const [key, value] of Object.entries(metrics)) {
    if (typeof value === 'number' && Number.isFinite(value)) numeric[key] = value;
  }
  const entries = Object.entries(numeric);
  if (entries.length === 0) return { score: 0 };

  const primaryKey = ['intrate', 'score', 'basemean'].find((k) => k in numeric);
  const score = primaryKey ? numeric[primaryKey] : entries[0][1];
  return { score, scores: numeric };
}

/** 运行中的火眼任务 → 通知平台取消的回调（供流水线中止时调用） */
const activeHuoyanCancels = new Map<string, () => void>();

/** 通知该任务当前进行中的火眼用例取消/跳过；返回是否命中 */
export function cancelActiveHuoyan(jobId: string): boolean {
  const fn = activeHuoyanCancels.get(jobId);
  if (!fn) return false;
  fn();
  return true;
}

export interface HuoyanStageOutcome {
  success: boolean;
  results: JobResult[];
  errorMessage?: string;
}

interface ExecuteOptions {
  /** 流水线阶段（提供时结果带 stageId/stageName，且不修改任务整体状态） */
  stage?: PipelineStage;
  stageIndex?: number;
}

/** 执行一次火眼用例（单阶段与流水线阶段共用） */
async function executeHuoyan(
  jobId: string,
  job: Job,
  config: HuoyanJobConfig,
  options: ExecuteOptions = {},
): Promise<HuoyanStageOutcome> {
  const { stage } = options;
  const stagePrefix = stage ? `阶段 [${stage.name}] ` : '';
  const timeoutMs = resolveHuoyanTimeoutMs(config.timeoutHours);
  const timeoutHours = timeoutMs / (60 * 60 * 1000);

  // 空值参数必须省略而不是传空串：火眼的可选参数（如 _cpu_bind_seq / _use_existing_chroot）
  // 收到 '' 会被当成真实取值，直接报「绑核序列解析出错」之类的实例化错误
  const args = (config.arguments || []).filter((arg) => {
    const v = arg.value;
    if (v === null || v === undefined) return false;
    if (typeof v === 'string') return v.trim() !== '';
    if (Array.isArray(v)) return v.length > 0;
    return true;
  });
  const clientOptions = { baseUrl: config.baseUrl, clientId: `blue-sky-${jobId}` };
  const isAborted = () => !!getJob(jobId)?.abortRequested;

  let itemId: string | undefined;
  let runId: string | undefined;

  const logDir = stage
    ? path.join(process.cwd(), '.data', 'logs', jobId, stage.id, 'huoyan')
    : path.join(process.cwd(), '.data', 'logs', jobId, 'huoyan');

  const monitor = new MonitorCollector({
    jobId,
    host: job.config.host,
    port: job.config.port,
    username: job.config.username,
    password: job.config.password,
    logDir,
    suppressMonitorLogs: false,
    onLog: (type, message) => addJobLog(jobId, type, message),
  });

  /** 中止时通知火眼平台：已产生 run 则取消运行，仅排队则跳过队列项 */
  const notifyPlatformOnAbort = () => {
    addJobLog(jobId, 'info', `${stagePrefix}正在中止火眼任务...`);
    monitor.abort().catch(() => { /* ignore */ });

    if (runId) {
      cancelRun(clientOptions, runId)
        .then(() => addJobLog(jobId, 'info', `${stagePrefix}已请求火眼平台取消运行 ${runId}`))
        .catch((err) => {
          addJobLog(jobId, 'warning', `${stagePrefix}取消火眼运行失败: ${err instanceof Error ? err.message : String(err)}`);
        });
      return;
    }

    if (itemId) {
      skipQueueItem(clientOptions, config.queueId, itemId)
        .then(() => addJobLog(jobId, 'info', `${stagePrefix}已请求火眼平台跳过队列项 ${itemId}`))
        .catch((err) => {
          addJobLog(jobId, 'warning', `${stagePrefix}跳过火眼队列项失败: ${err instanceof Error ? err.message : String(err)}`);
        });
      return;
    }

    addJobLog(jobId, 'info', `${stagePrefix}用例尚未提交到火眼队列，无需通知平台`);
  };

  activeHuoyanCancels.set(jobId, notifyPlatformOnAbort);

  try {
    addJobLog(jobId, 'info', `${stagePrefix}任务开始执行（火眼模式）`);
    addJobLog(jobId, 'info', `${stagePrefix}火眼平台: ${config.baseUrl || '默认地址'}，队列: ${config.queueId}`);
    addJobLog(jobId, 'info', `${stagePrefix}用例: ${config.definitionName || config.definitionId}`);
    addJobLog(
      jobId,
      'info',
      `${stagePrefix}参数: ${args.map((a) => `${a.name}=${String(a.value)}`).join(', ') || '(无)'}`,
    );
    addJobLog(
      jobId,
      'info',
      `${stagePrefix}目标机: ${config.bindings.map((b) => `${b.role}->${b.target_name}`).join(', ') || '(无)'}`,
    );
    addJobLog(jobId, 'info', `${stagePrefix}超时时间: ${timeoutHours} 小时`);

    // ===== 1. 追加用例到队列 =====
    addJobLog(jobId, 'info', `${stagePrefix}正在提交用例到火眼队列（prepare → commit）...`);
    const appended = await appendQueueItem(clientOptions, config.queueId, {
      definitionId: config.definitionId,
      arguments: args,
      bindings: config.bindings,
      comment: `蓝天系统任务 ${job.name}${stage ? ` - ${stage.name}` : ''}`,
    });
    itemId = appended.itemId;
    for (const warning of appended.warnings) {
      addJobLog(jobId, 'warning', `${stagePrefix}火眼预检警告 [${warning.code}] ${warning.message}`);
    }
    addJobLog(jobId, 'info', `${stagePrefix}用例已提交，队列 item_id=${itemId}，队列状态=${appended.queue.status}`);

    // 提交期间被中止：abortHandler 当时还拿不到 itemId，这里补发跳过
    if (isAborted()) {
      addJobLog(jobId, 'info', `${stagePrefix}提交过程中收到中止请求，正在跳过刚提交的队列项...`);
      await skipQueueItem(clientOptions, config.queueId, itemId).catch((err) => {
        addJobLog(jobId, 'warning', `${stagePrefix}跳过火眼队列项失败: ${err instanceof Error ? err.message : String(err)}`);
      });
      await monitor.abort();
      return { success: false, results: [], errorMessage: '测试已中止' };
    }

    updateJob(jobId, {
      huoyanState: {
        queueId: config.queueId,
        itemId,
        itemStatus: 'queued',
        updatedAt: new Date().toISOString(),
      },
    });

    // ===== 2. 等待 item 进入终态（受手动超时约束） =====
    const waitDeadline = Date.now() + timeoutMs;
    let itemStatus = 'queued';
    let monitorStarted = false;
    let lastLoggedStatus = '';

    while (Date.now() < waitDeadline) {
      if (isAborted()) {
        addJobLog(jobId, 'info', `${stagePrefix}测试已中止`);
        await monitor.abort();
        return { success: false, results: [], errorMessage: '测试已中止' };
      }

      const queue = await fetchQueue(clientOptions, config.queueId);
      const item = queue.items.find((it) => it.item_id === itemId);
      if (!item) {
        throw new HuoyanError(`队列中找不到 item ${itemId}（可能被删除）`);
      }
      itemStatus = item.status;
      runId = item.run_id || runId;

      if (itemStatus !== lastLoggedStatus) {
        addJobLog(jobId, 'info', `${stagePrefix}火眼用例状态: ${itemStatus}${runId ? `（run_id=${runId}）` : ''}`);
        lastLoggedStatus = itemStatus;
        updateJob(jobId, {
          huoyanState: {
            queueId: config.queueId,
            itemId,
            runId,
            itemStatus,
            updatedAt: new Date().toISOString(),
          },
        });
      }

      // 一进入 running 就启动监控采集
      if (!monitorStarted && itemStatus === 'running') {
        monitorStarted = true;
        if (!stage) {
          updateJob(jobId, { progress: { currentIteration: 1, totalIterations: 1, currentLabel: '火眼用例运行中' } });
        }
        addJobLog(jobId, 'info', `${stagePrefix}火眼用例已开始运行，启动监控命令采集...`);
        await monitor.start(job.config.monitorCommands);
      }

      if (TERMINAL_STATUSES.has(itemStatus)) break;
      if (!ACTIVE_STATUSES.has(itemStatus)) break;

      await sleep(POLL_INTERVAL_MS);
    }

    if (isAborted()) {
      addJobLog(jobId, 'info', `${stagePrefix}测试已中止`);
      await monitor.abort();
      return { success: false, results: [], errorMessage: '测试已中止' };
    }

    if (!TERMINAL_STATUSES.has(itemStatus)) {
      // 超时：先尝试取消火眼运行，避免平台继续占用队列
      if (runId) {
        await cancelRun(clientOptions, runId).catch((err) => {
          addJobLog(jobId, 'warning', `${stagePrefix}超时后取消火眼运行失败: ${err instanceof Error ? err.message : String(err)}`);
        });
      } else if (itemId) {
        await skipQueueItem(clientOptions, config.queueId, itemId).catch((err) => {
          addJobLog(jobId, 'warning', `${stagePrefix}超时后跳过火眼队列项失败: ${err instanceof Error ? err.message : String(err)}`);
        });
      }
      throw new HuoyanError(
        `等待火眼用例运行超时（已等待 ${timeoutHours} 小时，最后状态: ${itemStatus}）`,
      );
    }

    // ===== 3. 汇总监控采样 =====
    const monitorResults = monitorStarted ? await monitor.stop() : {};
    if (!monitorStarted) {
      addJobLog(jobId, 'warning', `${stagePrefix}用例未进入 running 状态，未采集监控数据`);
    }

    // ===== 4. 拉取运行结果 =====
    let score = 0;
    let scores: Record<string, number> | undefined;
    let runStatus = itemStatus;
    let errorMessage: string | undefined;

    if (runId) {
      try {
        const run = await fetchRun(clientOptions, runId);
        runStatus = run.status;
        const converted = metricsToScore(run.metrics);
        score = converted.score;
        scores = converted.scores;
        if (run.error) errorMessage = run.error;
        if (run.failures && run.failures.length > 0) {
          for (const failure of run.failures) {
            addJobLog(jobId, 'error', `${stagePrefix}火眼失败 [${failure.phase || '-'}/${failure.owner || '-'}] ${failure.message || ''}`);
          }
        }
        addJobLog(
          jobId,
          'info',
          `${stagePrefix}火眼运行结果: status=${run.status}，metrics=${JSON.stringify(run.metrics || {})}`,
        );
      } catch (err) {
        addJobLog(jobId, 'warning', `${stagePrefix}获取火眼运行结果失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const success = itemStatus === 'completed' && (!runStatus || runStatus === 'succeeded');
    if (!success && !errorMessage) {
      errorMessage = `火眼用例结束状态: ${itemStatus}${runStatus && runStatus !== itemStatus ? ` / run=${runStatus}` : ''}`;
    }

    const resultItem: JobResult = {
      iteration: stage ? 1 : 1,
      power: 0,
      score: success ? score : 0,
      ...(success && scores ? { scores } : {}),
      status: success ? 'success' : 'error',
      iterationLabel: config.definitionName || config.definitionId,
      ...(errorMessage ? { message: errorMessage } : {}),
      monitorResults: Object.keys(monitorResults).length > 0 ? monitorResults : undefined,
      timestamp: new Date().toISOString(),
      ...(stage ? { stageId: stage.id, stageName: stage.name } : {}),
    };
    appendJobResult(jobId, resultItem);

    updateJob(jobId, {
      huoyanState: {
        queueId: config.queueId,
        itemId,
        runId,
        itemStatus,
        runStatus,
        metrics: scores,
        error: success ? undefined : errorMessage,
        updatedAt: new Date().toISOString(),
      },
    });

    if (success) {
      addJobLog(jobId, 'complete', `${stagePrefix}火眼用例执行完成，分数: ${score}`);
    } else {
      addJobLog(jobId, 'error', `${stagePrefix}火眼用例执行失败: ${errorMessage}`);
    }

    return {
      success,
      results: [resultItem],
      ...(success ? {} : { errorMessage }),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    addJobLog(jobId, 'error', `${stagePrefix}火眼任务执行失败: ${message}`);
    await monitor.abort().catch(() => { /* ignore */ });
    return { success: false, results: [], errorMessage: message };
  } finally {
    activeHuoyanCancels.delete(jobId);
  }
}

/** 单阶段火眼任务：自行维护任务整体状态 */
export async function runHuoyanJob(jobId: string): Promise<void> {
  const job = getJob(jobId);
  if (!job || !job.config.huoyan) {
    addJobLog(jobId, 'error', '缺少火眼执行配置');
    updateJob(jobId, { status: 'error', errorMessage: '缺少火眼执行配置' });
    return;
  }

  const config = job.config.huoyan;

  updateJob(jobId, {
    status: 'running',
    progress: { currentIteration: 0, totalIterations: 1, currentLabel: '' },
    huoyanState: { queueId: config.queueId, itemStatus: 'queued', updatedAt: new Date().toISOString() },
  });

  const abortHandler = () => {
    cancelActiveHuoyan(jobId);
  };
  registerJobRunner(jobId, abortHandler);

  try {
    const outcome = await executeHuoyan(jobId, job, config);
    if (getJob(jobId)?.abortRequested) {
      updateJob(jobId, { status: 'aborted' });
      return;
    }
    if (outcome.success) {
      updateJob(jobId, {
        status: 'completed',
        progress: { currentIteration: 1, totalIterations: 1, currentLabel: '已完成' },
      });
    } else {
      updateJob(jobId, { status: 'error', errorMessage: outcome.errorMessage });
    }
  } finally {
    unregisterJobRunner(jobId);
  }
}

/** 流水线中的火眼阶段：只返回阶段结果，整体状态由 jobRunner 维护 */
export async function runHuoyanStage(
  jobId: string,
  config: HuoyanJobConfig,
  stage: PipelineStage,
  stageIndex: number,
): Promise<HuoyanStageOutcome> {
  const job = getJob(jobId);
  if (!job) return { success: false, results: [], errorMessage: '任务不存在' };
  return executeHuoyan(jobId, job, config, { stage, stageIndex });
}
