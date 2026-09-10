/** 后台测试任务 API - 分页获取某轮迭代的监控采样点 */
import { NextRequest, NextResponse } from 'next/server';
import { getMonitorDataPoints } from '../../lib/jobStore';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/** GET /api/test/jobs/[id]/monitor-data?iteration=N&commandId=xxx&offset=0&limit=100&stageId=xxx */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);

  const iterationParam = searchParams.get('iteration');
  const commandId = searchParams.get('commandId');
  const offsetParam = searchParams.get('offset');
  const limitParam = searchParams.get('limit');
  const stageId = searchParams.get('stageId') || undefined;

  if (!iterationParam || !commandId) {
    return NextResponse.json(
      { success: false, message: '缺少 iteration 或 commandId 参数' },
      { status: 400 }
    );
  }

  const iteration = parseInt(iterationParam, 10);
  if (isNaN(iteration)) {
    return NextResponse.json(
      { success: false, message: 'iteration 必须是数字' },
      { status: 400 }
    );
  }

  const offset = Math.max(0, parseInt(offsetParam || '0', 10));
  const limit = Math.max(1, Math.min(5000, parseInt(limitParam || '100', 10)));

  const data = getMonitorDataPoints(id, iteration, commandId, offset, limit, stageId);

  if (!data) {
    return NextResponse.json(
      { success: false, message: '任务、迭代或监控命令不存在' },
      { status: 404 }
    );
  }

  return NextResponse.json({ success: true, data });
}
