/** 火眼平台代理：队列列表（含每项状态，用于前端展示队列占用情况） */
import { NextRequest, NextResponse } from 'next/server';
import { fetchQueues, HuoyanError } from '../../jobs/lib/huoyanClient';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const baseUrl = searchParams.get('baseUrl') || undefined;
  try {
    const queues = await fetchQueues({ baseUrl });
    return NextResponse.json({ success: true, queues });
  } catch (err) {
    const e = err as HuoyanError;
    return NextResponse.json(
      { success: false, message: e.message || '获取火眼队列失败', code: e.code },
      { status: 502 },
    );
  }
}
