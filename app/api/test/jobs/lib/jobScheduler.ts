/** 定时任务调度器 - 到点后自动启动后台测试任务（单阶段与流水线通用） */
import { getAllJobs, getJob, updateJob, addJobLog } from './jobStore';
import { runJob } from './jobRunner';

/** setTimeout 的最大延迟（约 24.8 天），超过需要分段重新挂起 */
const MAX_TIMEOUT = 2_147_483_647;

// 定时器挂在 globalThis 上，避免模块热重载后丢失已挂起的定时任务
const TIMERS_KEY = '__blue_sky_job_scheduler_timers__';
const globalTimers = (globalThis as Record<string, unknown>)[TIMERS_KEY] as
  | Map<string, ReturnType<typeof setTimeout>>
  | undefined;
const timers = globalTimers || new Map<string, ReturnType<typeof setTimeout>>();
(globalThis as Record<string, unknown>)[TIMERS_KEY] = timers;

function clearTimer(jobId: string): void {
  const timer = timers.get(jobId);
  if (timer) {
    clearTimeout(timer);
    timers.delete(jobId);
  }
}

/** 到点启动任务 */
function fire(jobId: string): void {
  timers.delete(jobId);
  const job = getJob(jobId);
  if (!job || job.status !== 'pending') return;

  addJobLog(jobId, 'info', '定时启动时间已到，开始执行任务');
  updateJob(jobId, { scheduledStartAt: undefined });
  runJob(jobId).catch((err) => {
    console.error(`[JobScheduler] Job ${jobId} crashed:`, err);
  });
}

/** 为任务挂起定时器；startAt 非法则忽略，已过期则立即启动 */
export function scheduleJobStart(jobId: string, startAt: string | undefined): void {
  clearTimer(jobId);
  if (!startAt) return;

  const target = new Date(startAt).getTime();
  if (!Number.isFinite(target)) {
    console.warn(`[JobScheduler] Job ${jobId} 定时时间无效: ${startAt}`);
    return;
  }

  const arm = () => {
    const remaining = target - Date.now();
    if (remaining <= 0) {
      fire(jobId);
      return;
    }
    // 超过 setTimeout 上限时分段挂起，避免被截断成提前执行
    const delay = Math.min(remaining, MAX_TIMEOUT);
    const timer = setTimeout(arm, delay);
    // 不阻止 Node 进程退出
    (timer as unknown as { unref?: () => void }).unref?.();
    timers.set(jobId, timer);
  };

  arm();
}

/** 取消任务的定时器（中止 / 删除任务时调用） */
export function cancelScheduledStart(jobId: string): void {
  clearTimer(jobId);
}

/** 服务器重启后重新挂起所有未执行的定时任务（幂等，可重复调用） */
export function restoreScheduledJobs(): void {
  const scheduled = getAllJobs().filter(
    (job) => job.status === 'pending' && !!job.scheduledStartAt,
  );
  if (scheduled.length === 0) return;

  console.log('[JobScheduler] 恢复定时任务:', scheduled.length);
  for (const job of scheduled) {
    scheduleJobStart(job.id, job.scheduledStartAt);
  }
}

// 模块首次加载时恢复未执行的定时任务（服务器重启场景）
restoreScheduledJobs();
