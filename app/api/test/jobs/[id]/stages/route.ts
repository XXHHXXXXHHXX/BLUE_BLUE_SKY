/** 流水线阶段动态改配 / 追加 API
 *
 * 支持运行中的流水线：
 * - PATCH  修改尚未开始的阶段（迭代参数、监控命令、心跳/告警、火眼配置等）
 * - POST   在末尾追加新阶段，运行器会在当前阶段结束后接力执行
 *
 * 已开始或已结束的阶段一律拒绝修改（其配置已生效/已固化）。
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  getJob,
  toJobView,
  updatePendingStage,
  appendPipelineStage,
  isStageEditable,
  type StagePatch,
  type PipelineStage,
} from '../../lib/jobStore';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/** GET /api/test/jobs/[id]/stages - 查询各阶段是否可编辑 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const job = getJob(id);
  if (!job) {
    return NextResponse.json({ success: false, message: '任务不存在' }, { status: 404 });
  }
  const stages = (job.config.stages || []).slice().sort((a, b) => a.order - b.order);
  const editable = stages.map((stage) => ({
    stageId: stage.id,
    ...isStageEditable(job, stage.id),
  }));
  return NextResponse.json({
    success: true,
    isPipeline: stages.length > 0,
    status: job.status,
    currentStageIndex: job.config.currentStageIndex ?? 0,
    editable,
  });
}

/** PATCH /api/test/jobs/[id]/stages - 改配尚未开始的阶段 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  try {
    const body = (await request.json()) as StagePatch;
    if (!body?.stageId) {
      return NextResponse.json({ success: false, message: '缺少 stageId' }, { status: 400 });
    }
    if (!body.patch || typeof body.patch !== 'object') {
      return NextResponse.json({ success: false, message: '缺少 patch' }, { status: 400 });
    }
    const result = updatePendingStage(id, body);
    if (!result.success) {
      const status = result.message === '任务不存在' ? 404 : 409;
      return NextResponse.json({ success: false, message: result.message }, { status });
    }
    const job = getJob(id);
    return NextResponse.json({
      success: true,
      message: result.message,
      stage: result.stage,
      job: job ? toJobView(job, { includeLogs: false, includeDataPoints: false }) : null,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : '改配阶段失败';
    return NextResponse.json({ success: false, message: msg }, { status: 500 });
  }
}

/** POST /api/test/jobs/[id]/stages - 追加新阶段 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  try {
    const body = (await request.json()) as Partial<PipelineStage>;
    if (!body?.name?.trim()) {
      return NextResponse.json({ success: false, message: '缺少阶段名称' }, { status: 400 });
    }
    const isHuoyanStage = body.packageMode === 'huoyan';
    if (isHuoyanStage) {
      if (!body.huoyan?.queueId || !body.huoyan?.definitionId) {
        return NextResponse.json(
          { success: false, message: '火眼阶段缺少队列或用例定义' },
          { status: 400 },
        );
      }
    } else if (!Array.isArray(body.iterationParams) || body.iterationParams.length === 0) {
      return NextResponse.json(
        { success: false, message: '本地阶段需要至少一个迭代参数' },
        { status: 400 },
      );
    }

    const stage: PipelineStage = {
      id: body.id || '',
      name: body.name.trim(),
      order: body.order ?? 0,
      remotePath: body.remotePath || '',
      packageLibraryId: body.packageLibraryId,
      packageArchivePath: body.packageArchivePath,
      packageFileName: body.packageFileName,
      iterationParams: body.iterationParams || [],
      adjustmentCommands: body.adjustmentCommands || [],
      monitorCommands: body.monitorCommands,
      envVars: body.envVars,
      heartbeatEnabled: body.heartbeatEnabled,
      heartbeatInterval: body.heartbeatInterval,
      heartbeatMaxFailures: body.heartbeatMaxFailures,
      alertWebhook: body.alertWebhook,
      logMonitorConfig: body.logMonitorConfig,
      globalBmcSessionId: body.globalBmcSessionId,
      suppressMonitorLogs: body.suppressMonitorLogs,
      packageMode: body.packageMode,
      huoyan: body.huoyan,
    };

    const result = appendPipelineStage(id, stage);
    if (!result.success) {
      const status = result.message === '任务不存在' ? 404 : 409;
      return NextResponse.json({ success: false, message: result.message }, { status });
    }
    const job = getJob(id);
    return NextResponse.json({
      success: true,
      message: result.message,
      stage: result.stage,
      job: job ? toJobView(job, { includeLogs: false, includeDataPoints: false }) : null,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : '追加阶段失败';
    return NextResponse.json({ success: false, message: msg }, { status: 500 });
  }
}
