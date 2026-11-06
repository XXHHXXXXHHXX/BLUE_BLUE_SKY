/** Next.js 启动钩子：服务器启动时恢复未到点的定时测试任务 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  try {
    const { restoreScheduledJobs } = await import('./app/api/test/jobs/lib/jobScheduler');
    restoreScheduledJobs();
  } catch (err) {
    console.error('[Instrumentation] 恢复定时任务失败:', err);
  }
}
