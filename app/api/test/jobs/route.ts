/** 后台测试任务 API - 列表 & 创建 */
import { NextRequest, NextResponse } from 'next/server';
import {
  getAllJobs,
  createJob,
  deleteJob,
  batchDeleteJobs,
  deleteJobsByStatus,
  toJobView,
  type JobConfig,
} from './lib/jobStore';
import { runJob } from './lib/jobRunner';

/** GET /api/test/jobs - 获取任务列表 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const includeLogs = searchParams.get('includeLogs') !== 'false';
  const includeDataPoints = searchParams.get('includeDataPoints') !== 'false';

  const jobs = getAllJobs().map((job) =>
    toJobView(job, { includeLogs, includeDataPoints })
  );

  return NextResponse.json({ success: true, jobs });
}

/** POST /api/test/jobs - 创建并启动新任务 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, tabId, config } = body as {
      name: string;
      tabId?: string;
      config: JobConfig;
    };

    if (!config || !config.host || !config.iterationParams) {
      return NextResponse.json(
        { success: false, message: '缺少必要参数' },
        { status: 400 }
      );
    }

    const job = createJob(config, name || '未命名任务', tabId);

    // 在后台启动任务，不阻塞 HTTP 响应
    runJob(job.id).catch((err) => {
      console.error(`[Jobs API] Job ${job.id} crashed:`, err);
    });

    return NextResponse.json({ success: true, job });
  } catch (error) {
    const msg = error instanceof Error ? error.message : '创建任务失败';
    console.error('[Jobs API] Create error:', msg);
    return NextResponse.json({ success: false, message: msg }, { status: 500 });
  }
}

/** DELETE /api/test/jobs?id=xxx - 删除任务 */
/** DELETE /api/test/jobs?ids=id1,id2,id3 - 批量删除任务 */
/** DELETE /api/test/jobs?status=error,aborted - 删除指定状态的任务 */
export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  const ids = searchParams.get('ids');
  const status = searchParams.get('status');

  if (ids) {
    const idList = ids.split(',').filter(Boolean);
    const result = batchDeleteJobs(idList);
    return NextResponse.json({
      success: true,
      message: `已删除 ${result.deleted.length} 个任务${result.failed.length > 0 ? `，${result.failed.length} 个不存在` : ''}`,
      deleted: result.deleted,
      failed: result.failed,
    });
  }

  if (status) {
    const statuses = status.split(',').filter((s) =>
      ['pending', 'running', 'completed', 'aborted', 'error'].includes(s)
    ) as Array<'pending' | 'running' | 'completed' | 'aborted' | 'error'>;
    if (statuses.length === 0) {
      return NextResponse.json(
        { success: false, message: '无效的状态' },
        { status: 400 }
      );
    }
    const result = deleteJobsByStatus(statuses);
    return NextResponse.json({
      success: true,
      message: `已删除 ${result.deleted.length} 个${statuses.join('/')}状态的任务`,
      deleted: result.deleted,
    });
  }

  if (!id) {
    return NextResponse.json(
      { success: false, message: '缺少任务ID' },
      { status: 400 }
    );
  }

  const ok = deleteJob(id);
  if (!ok) {
    return NextResponse.json(
      { success: false, message: '任务不存在' },
      { status: 404 }
    );
  }

  return NextResponse.json({ success: true, message: '已删除' });
}
