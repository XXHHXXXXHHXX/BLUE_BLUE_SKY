/** 后台测试任务 API - 中止任务 */
import { NextResponse } from 'next/server';
import { requestAbortJob } from '../../lib/jobStore';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/** POST /api/test/jobs/[id]/abort - 中止任务 */
export async function POST(_request: Request, { params }: RouteParams) {
  const { id } = await params;
  const ok = requestAbortJob(id);

  if (!ok) {
    return NextResponse.json(
      { success: false, message: '任务不存在或已结束' },
      { status: 400 }
    );
  }

  return NextResponse.json({ success: true, message: '已发送中止信号' });
}
