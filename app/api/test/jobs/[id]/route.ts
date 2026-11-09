/** 后台测试任务 API - 获取单个任务 */
import { NextRequest, NextResponse } from 'next/server';
import { getJob, toJobView, updateJobCustomAvgRanges, getJobCustomAvgRanges } from '../lib/jobStore';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/** GET /api/test/jobs/[id] - 获取任务详情 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const job = getJob(id);

  if (!job) {
    return NextResponse.json(
      { success: false, message: '任务不存在' },
      { status: 404 }
    );
  }

  const { searchParams } = new URL(request.url);
  const includeLogs = searchParams.get('includeLogs') !== 'false';
  const includeDataPoints = searchParams.get('includeDataPoints') !== 'false';
  // 增量日志：logsAfterSeq 表示前端已收到的最大日志序号，只返回其后的新增日志
  const logsAfterSeqParam = Number(searchParams.get('logsAfterSeq'));
  const logsAfterSeq = Number.isFinite(logsAfterSeqParam) && logsAfterSeqParam >= 0
    ? Math.floor(logsAfterSeqParam)
    : undefined;
  const logsLimitParam = Number(searchParams.get('logsLimit'));
  const logsLimit = Number.isFinite(logsLimitParam) && logsLimitParam > 0
    ? Math.floor(logsLimitParam)
    : undefined;

  const view = toJobView(job, { includeLogs, includeDataPoints, logsAfterSeq, logsLimit });
  // 服务端当前最大日志序号与总条数，便于前端维护增量游标
  const logsTotal = job.logs.length;
  const lastLogSeq = job.logs.length > 0 ? job.logs[job.logs.length - 1].seq : undefined;

  return NextResponse.json({ success: true, job: view, logsTotal, lastLogSeq });
}

/** PATCH /api/test/jobs/[id] - 更新任务的自定义平均值计算范围 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const body = await request.json();
  const { customAvgRanges } = body as {
    customAvgRanges?: Record<string, { avgStart?: number; avgEnd?: number }>;
  };

  if (!customAvgRanges) {
    return NextResponse.json(
      { success: false, message: '缺少 customAvgRanges 参数' },
      { status: 400 }
    );
  }

  const result = updateJobCustomAvgRanges(id, customAvgRanges);
  if (!result.success) {
    return NextResponse.json(
      { success: false, message: result.message },
      { status: 404 }
    );
  }

  const job = getJob(id);
  return NextResponse.json({
    success: true,
    message: result.message,
    job: job ? toJobView(job, { includeLogs: false, includeDataPoints: false }) : null,
    customAvgRanges: getJobCustomAvgRanges(id),
  });
}
