/** 后台测试任务 API - 列表 & 创建 */
import { NextRequest, NextResponse } from 'next/server';
import {
  getAllJobs,
  getJob,
  createJob,
  updateJob,
  addJobLog,
  deleteJob,
  batchDeleteJobs,
  deleteJobsByStatus,
  toJobView,
  type JobConfig,
} from './lib/jobStore';
import { runJob } from './lib/jobRunner';
import { scheduleJobStart, cancelScheduledStart, restoreScheduledJobs } from './lib/jobScheduler';

/** GET /api/test/jobs - 获取任务列表 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const includeLogs = searchParams.get('includeLogs') !== 'false';
  const includeDataPoints = searchParams.get('includeDataPoints') !== 'false';

  // 服务器重启后，前端首次拉取任务列表时重新挂起未执行的定时任务（幂等）
  restoreScheduledJobs();

  const jobs = getAllJobs().map((job) =>
    toJobView(job, { includeLogs, includeDataPoints })
  );

  return NextResponse.json({ success: true, jobs });
}

/** POST /api/test/jobs - 创建并启动新任务 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, tabId, clientId, config, scheduledStartAt } = body as {
      name: string;
      tabId?: string;
      clientId?: string;
      config: JobConfig;
      /** 定时启动时间（ISO 字符串）；为空表示立即启动 */
      scheduledStartAt?: string;
    };

    if (!config || !config.host || !config.iterationParams) {
      return NextResponse.json(
        { success: false, message: '缺少必要参数' },
        { status: 400 }
      );
    }

    // 校验定时时间：必须是合法的未来时间
    let scheduleAt: string | undefined;
    if (scheduledStartAt) {
      const ts = new Date(scheduledStartAt).getTime();
      if (!Number.isFinite(ts)) {
        return NextResponse.json(
          { success: false, message: '定时启动时间格式无效' },
          { status: 400 }
        );
      }
      if (ts <= Date.now()) {
        return NextResponse.json(
          { success: false, message: '定时启动时间必须晚于当前时间' },
          { status: 400 }
        );
      }
      scheduleAt = new Date(ts).toISOString();
    }

    const job = createJob(config, name || '未命名任务', tabId, clientId);

    if (scheduleAt) {
      // 定时任务：保持 pending，由调度器到点启动
      updateJob(job.id, { scheduledStartAt: scheduleAt });
      addJobLog(job.id, 'info', `任务已排定，将于 ${new Date(scheduleAt).toLocaleString()} 自动开始`);
      scheduleJobStart(job.id, scheduleAt);
    } else {
      // 在后台启动任务，不阻塞 HTTP 响应
      runJob(job.id).catch((err) => {
        console.error(`[Jobs API] Job ${job.id} crashed:`, err);
      });
    }

    return NextResponse.json({ success: true, job: getJob(job.id) || job });
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
    idList.forEach(cancelScheduledStart);
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
    getAllJobs()
      .filter((job) => statuses.includes(job.status))
      .forEach((job) => cancelScheduledStart(job.id));
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

  cancelScheduledStart(id);
  const ok = deleteJob(id);
  if (!ok) {
    return NextResponse.json(
      { success: false, message: '任务不存在' },
      { status: 404 }
    );
  }

  return NextResponse.json({ success: true, message: '已删除' });
}
