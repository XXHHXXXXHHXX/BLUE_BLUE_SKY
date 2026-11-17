/** 火眼平台代理：单次运行结果 */
import { NextRequest, NextResponse } from 'next/server';
import { fetchRun, HuoyanError } from '../../jobs/lib/huoyanClient';

interface RouteParams {
  params: Promise<{ runId: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const { runId } = await params;
  const { searchParams } = new URL(request.url);
  const baseUrl = searchParams.get('baseUrl') || undefined;
  try {
    const run = await fetchRun({ baseUrl }, runId);
    return NextResponse.json({ success: true, run });
  } catch (err) {
    const e = err as HuoyanError;
    return NextResponse.json(
      { success: false, message: e.message || '获取火眼运行结果失败', code: e.code },
      { status: 502 },
    );
  }
}
