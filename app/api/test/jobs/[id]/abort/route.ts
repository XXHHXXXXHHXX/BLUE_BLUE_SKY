/** 后台测试任务 API - 中止任务 */
import { NextResponse } from 'next/server';
import { requestAbortJob, getJob, updateJob, addJobLog } from '../../lib/jobStore';
import { cancelScheduledStart } from '../../lib/jobScheduler';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/** POST /api/test/jobs/[id]/abort - 中止任务 */
export async function POST(_request: Request, { params }: RouteParams) {
  const { id } = await params;

  // 定时任务尚未开始：直接取消调度并标记为已中止
  const job = getJob(id);
  if (job && job.status === 'pending' && job.scheduledStartAt) {
    cancelScheduledStart(id);
    updateJob(id, {
      status: 'aborted',
      scheduledStartAt: undefined,
      errorMessage: '定时任务已取消',
    });
    addJobLog(id, 'info', '定时任务已取消，未开始执行');
    return NextResponse.json({ success: true, message: '定时任务已取消' });
  }

  const ok = requestAbortJob(id);

  if (!ok) {
    return NextResponse.json(
      { success: false, message: '任务不存在或已结束' },
      { status: 400 }
    );
  }

  return NextResponse.json({ success: true, message: '已发送中止信号' });
}
