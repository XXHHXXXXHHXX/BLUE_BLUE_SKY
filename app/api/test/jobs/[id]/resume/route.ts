/** 后台测试任务 API - 恢复任务 */
import { NextResponse } from 'next/server';
import { resumeJob } from '../../lib/jobStore';
import { runJob } from '../../lib/jobRunner';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/** POST /api/test/jobs/[id]/resume - 恢复已中止的任务 */
export async function POST(_request: Request, { params }: RouteParams) {
  const { id } = await params;
  const job = resumeJob(id);

  if (!job) {
    return NextResponse.json(
      { success: false, message: '任务不存在或无法恢复' },
      { status: 400 }
    );
  }

  // 在后台启动任务，不阻塞 HTTP 响应
  runJob(id, { resumeFromIteration: job.progress.currentIteration }).catch((err) => {
    console.error(`[Jobs API] Resume job ${id} crashed:`, err);
  });

  return NextResponse.json({ success: true, message: '任务已恢复', job });
}
