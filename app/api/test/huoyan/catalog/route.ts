/** 火眼平台代理：用例目录 */
import { NextRequest, NextResponse } from 'next/server';
import { fetchCatalog, HuoyanError } from '../../jobs/lib/huoyanClient';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const baseUrl = searchParams.get('baseUrl') || undefined;
  try {
    const definitions = await fetchCatalog({ baseUrl });
    return NextResponse.json({ success: true, definitions });
  } catch (err) {
    const e = err as HuoyanError;
    return NextResponse.json(
      { success: false, message: e.message || '获取火眼用例目录失败', code: e.code },
      { status: 502 },
    );
  }
}
