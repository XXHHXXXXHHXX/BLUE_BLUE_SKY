/** 火眼自动化平台执行模式
 *
 * 流程：
 *  1. 通过 prepare/commit 把用例追加到指定的 bluesky 队列
 *  2. 轮询队列 item 状态；一旦变为 running，立即启动监控命令采集
 *  3. 等待 item 进入终态（completed / failed / cancelled / interrupted / skipped）
 *  4. completed 时拉取 run 结果，把 metrics 作为分数，连同监控采样一起落为一条结果
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
} from './jobStore';
import { appendQueueItem, cancelRun, fetchQueue, fetchRun, skipQueueItem, HuoyanError } from './huoyanClient';
import { MonitorCollector } from './monitorCollector';

/** 轮询队列状态的间隔（毫秒） */
const POLL_INTERVAL_MS = 5000;
/** 等待 item 进入 running 的最长时间（毫秒），超时后按未启动处理 */
const WAIT_RUNNING_TIMEOUT_MS = 30 * 60 * 1000;

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

export async function runHuoyanJob(jobId: string): Promise<void> {
  const job = getJob(jobId);
  if (!job || !job.config.huoyan) {
    addJobLog(jobId, 'error', '缺少火眼执行配置');
    updateJob(jobId, { status: 'error', errorMessage: '缺少火眼执行配置' });
    return;
  }

  const config = job.config.huoyan;
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
  const monitor = new MonitorCollector({
    jobId,
    host: job.config.host,
    port: job.config.port,
    username: job.config.username,
    password: job.config.password,
    logDir: path.join(process.cwd(), '.data', 'logs', jobId, 'huoyan'),
    suppressMonitorLogs: false,
    onLog: (type, message) => addJobLog(jobId, type, message),
  });

  const abortHandler = () => {
    addJobLog(jobId, 'info', '正在中止火眼任务...');
    monitor.abort().catch(() => { /* ignore */ });

    // 已产生 run：取消这次运行
    if (runId) {
      cancelRun(clientOptions, runId)
        .then(() => addJobLog(jobId, 'info', `已请求火眼平台取消运行 ${runId}`))
        .catch((err) => {
          addJobLog(jobId, 'warning', `取消火眼运行失败: ${err instanceof Error ? err.message : String(err)}`);
        });
      return;
    }

    // 尚未产生 run（用例还在排队/预检）：把队列项标记为 skipped，
    // 否则平台稍后仍会照常执行它。必须带 item_id，避免误跳过队列里别人的用例。
    if (itemId) {
      skipQueueItem(clientOptions, config.queueId, itemId)
        .then(() => addJobLog(jobId, 'info', `已请求火眼平台跳过队列项 ${itemId}`))
        .catch((err) => {
          addJobLog(jobId, 'warning', `跳过火眼队列项失败: ${err instanceof Error ? err.message : String(err)}`);
        });
      return;
    }

    // 用例还没提交成功：无需通知平台，提交完成后的中止检查会处理
    addJobLog(jobId, 'info', '用例尚未提交到火眼队列，无需通知平台');
  };

  registerJobRunner(jobId, abortHandler);

  try {
    updateJob(jobId, {
      status: 'running',
      progress: { currentIteration: 0, totalIterations: 1, currentLabel: '' },
      huoyanState: { queueId: config.queueId, itemStatus: 'queued', updatedAt: new Date().toISOString() },
    });
    addJobLog(jobId, 'info', '任务开始执行（火眼模式）');
    addJobLog(jobId, 'info', `火眼平台: ${config.baseUrl || '默认地址'}，队列: ${config.queueId}`);
    addJobLog(jobId, 'info', `用例: ${config.definitionName || config.definitionId}`);
    addJobLog(
      jobId,
      'info',
      `参数: ${args.map((a) => `${a.name}=${String(a.value)}`).join(', ') || '(无)'}`,
    );
    addJobLog(
      jobId,
      'info',
      `目标机: ${config.bindings.map((b) => `${b.role}->${b.target_name}`).join(', ') || '(无)'}`,
    );

    // ===== 1. 追加用例到队列 =====
    addJobLog(jobId, 'info', '正在提交用例到火眼队列（prepare → commit）...');
    const appended = await appendQueueItem(clientOptions, config.queueId, {
      definitionId: config.definitionId,
      arguments: args,
      bindings: config.bindings,
      comment: `蓝天系统任务 ${job.name}`,
    });
    itemId = appended.itemId;
    for (const warning of appended.warnings) {
      addJobLog(jobId, 'warning', `火眼预检警告 [${warning.code}] ${warning.message}`);
    }
    addJobLog(jobId, 'info', `用例已提交，队列 item_id=${itemId}，队列状态=${appended.queue.status}`);

    // 提交期间被中止：abortHandler 当时还拿不到 itemId，这里补发跳过
    if (isAborted()) {
      addJobLog(jobId, 'info', '提交过程中收到中止请求，正在跳过刚提交的队列项...');
      await skipQueueItem(clientOptions, config.queueId, itemId).catch((err) => {
        addJobLog(jobId, 'warning', `跳过火眼队列项失败: ${err instanceof Error ? err.message : String(err)}`);
      });
      await monitor.abort();
      updateJob(jobId, { status: 'aborted' });
      return;
    }

    updateJob(jobId, {
      huoyanState: {
        queueId: config.queueId,
        itemId,
        itemStatus: 'queued',
        updatedAt: new Date().toISOString(),
      },
    });

    // ===== 2. 等待 item 开始运行 =====
    const waitDeadline = Date.now() + WAIT_RUNNING_TIMEOUT_MS;
    let itemStatus = 'queued';
    let monitorStarted = false;
    let lastLoggedStatus = '';

    while (Date.now() < waitDeadline) {
      if (isAborted()) {
        addJobLog(jobId, 'info', '测试已中止');
        await monitor.abort();
        updateJob(jobId, { status: 'aborted' });
        return;
      }

      const queue = await fetchQueue(clientOptions, config.queueId);
      const item = queue.items.find((it) => it.item_id === itemId);
      if (!item) {
        throw new HuoyanError(`队列中找不到 item ${itemId}（可能被删除）`);
      }
      itemStatus = item.status;
      runId = item.run_id || runId;

      if (itemStatus !== lastLoggedStatus) {
        addJobLog(jobId, 'info', `火眼用例状态: ${itemStatus}${runId ? `（run_id=${runId}）` : ''}`);
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
        updateJob(jobId, { progress: { currentIteration: 1, totalIterations: 1, currentLabel: '火眼用例运行中' } });
        addJobLog(jobId, 'info', '火眼用例已开始运行，启动监控命令采集...');
        await monitor.start(job.config.monitorCommands);
      }

      if (TERMINAL_STATUSES.has(itemStatus)) break;
      if (!ACTIVE_STATUSES.has(itemStatus)) break;

      await sleep(POLL_INTERVAL_MS);
    }

    if (isAborted()) {
      addJobLog(jobId, 'info', '测试已中止');
      await monitor.abort();
      updateJob(jobId, { status: 'aborted' });
      return;
    }

    if (!TERMINAL_STATUSES.has(itemStatus)) {
      throw new HuoyanError(`等待火眼用例运行超时（最后状态: ${itemStatus}）`);
    }

    // ===== 3. 汇总监控采样 =====
    const monitorResults = monitorStarted ? await monitor.stop() : {};
    if (!monitorStarted) {
      addJobLog(jobId, 'warning', '用例未进入 running 状态，未采集监控数据');
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
            addJobLog(jobId, 'error', `火眼失败 [${failure.phase || '-'}/${failure.owner || '-'}] ${failure.message || ''}`);
          }
        }
        addJobLog(
          jobId,
          'info',
          `火眼运行结果: status=${run.status}，metrics=${JSON.stringify(run.metrics || {})}`,
        );
      } catch (err) {
        addJobLog(jobId, 'warning', `获取火眼运行结果失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const success = itemStatus === 'completed' && (!runStatus || runStatus === 'succeeded');
    if (!success && !errorMessage) {
      errorMessage = `火眼用例结束状态: ${itemStatus}${runStatus && runStatus !== itemStatus ? ` / run=${runStatus}` : ''}`;
    }

    const resultItem: JobResult = {
      iteration: 1,
      power: 0,
      score: success ? score : 0,
      ...(success && scores ? { scores } : {}),
      status: success ? 'success' : 'error',
      iterationLabel: config.definitionName || config.definitionId,
      ...(errorMessage ? { message: errorMessage } : {}),
      monitorResults: Object.keys(monitorResults).length > 0 ? monitorResults : undefined,
      timestamp: new Date().toISOString(),
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
      addJobLog(jobId, 'complete', `火眼用例执行完成，分数: ${score}`);
      updateJob(jobId, {
        status: 'completed',
        progress: { currentIteration: 1, totalIterations: 1, currentLabel: '已完成' },
      });
    } else {
      addJobLog(jobId, 'error', `火眼用例执行失败: ${errorMessage}`);
      updateJob(jobId, { status: 'error', errorMessage });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    addJobLog(jobId, 'error', `火眼任务执行失败: ${message}`);
    await monitor.abort().catch(() => { /* ignore */ });
    updateJob(jobId, { status: 'error', errorMessage: message });
  } finally {
    unregisterJobRunner(jobId);
  }
}
