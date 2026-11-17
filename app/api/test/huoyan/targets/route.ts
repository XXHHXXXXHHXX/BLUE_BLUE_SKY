/** 火眼平台代理：目标机列表 */
import { NextRequest, NextResponse } from 'next/server';
import { fetchTargets, HuoyanError } from '../../jobs/lib/huoyanClient';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const baseUrl = searchParams.get('baseUrl') || undefined;
  try {
    const targets = await fetchTargets({ baseUrl });
    return NextResponse.json({ success: true, targets });
  } catch (err) {
    const e = err as HuoyanError;
    return NextResponse.json(
      { success: false, message: e.message || '获取火眼目标机失败', code: e.code },
      { status: 502 },
    );
  }
}
