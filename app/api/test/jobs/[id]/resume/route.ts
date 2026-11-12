/** 后台测试任务 API - 恢复任务 */
import { NextResponse } from 'next/server';
import { resumeJob, isJobRunnerActive } from '../../lib/jobStore';
import { runJob } from '../../lib/jobRunner';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/** POST /api/test/jobs/[id]/resume - 恢复已中止的任务
 *  保留已完成的阶段与轮次数据，从中止阶段的「最后一个已完成轮次 + 1」继续执行 */
export async function POST(_request: Request, { params }: RouteParams) {
  const { id } = await params;

  // 旧运行器还在收尾时恢复会被它覆盖回 aborted，需要等它退出后再点恢复
  if (isJobRunnerActive(id)) {
    return NextResponse.json(
      { success: false, message: '任务仍在停止中，请稍候再恢复' },
      { status: 409 }
    );
  }

  const job = resumeJob(id);

  if (!job) {
    return NextResponse.json(
      { success: false, message: '任务不存在或无法恢复' },
      { status: 400 }
    );
  }

  // 在后台启动任务，不阻塞 HTTP 响应；从中止处继续而非重跑
  runJob(id, { resumeFromIteration: job.resumeFromIteration }).catch((err) => {
    console.error(`[Jobs API] Resume job ${id} crashed:`, err);
  });

  return NextResponse.json({ success: true, message: '任务已恢复', job });
}
