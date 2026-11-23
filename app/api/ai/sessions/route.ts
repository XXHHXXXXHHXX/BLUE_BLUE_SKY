/** AI 分析助手会话 API - 服务端持久化，按浏览器 clientId 隔离 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import {
  loadSessions,
  upsertSession,
  deleteSession,
  type AiChatSession,
} from '../../../../src/server/storage/aiSessionStore';

/** clientId 优先取请求头，其次取 query（DELETE 用） */
function resolveClientId(request: NextRequest): string {
  return (
    request.headers.get('x-client-id') ||
    request.nextUrl.searchParams.get('clientId') ||
    ''
  );
}

export async function GET(request: NextRequest) {
  const clientId = resolveClientId(request);
  if (!clientId) {
    return NextResponse.json({ success: false, message: '缺少 clientId' }, { status: 400 });
  }
  try {
    const sessions = loadSessions(clientId);
    return NextResponse.json({ success: true, sessions });
  } catch (error) {
    const msg = error instanceof Error ? error.message : '读取会话失败';
    console.error('[AI Sessions API] GET Error:', msg);
    return NextResponse.json({ success: false, message: msg }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const clientId = resolveClientId(request);
  if (!clientId) {
    return NextResponse.json({ success: false, message: '缺少 clientId' }, { status: 400 });
  }
  try {
    const body = (await request.json()) as { session?: AiChatSession };
    if (!body?.session?.id) {
      return NextResponse.json({ success: false, message: '缺少 session' }, { status: 400 });
    }
    const sessions = upsertSession(clientId, body.session);
    return NextResponse.json({ success: true, sessions });
  } catch (error) {
    const msg = error instanceof Error ? error.message : '保存会话失败';
    console.error('[AI Sessions API] POST Error:', msg);
    return NextResponse.json({ success: false, message: msg }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const clientId = resolveClientId(request);
  const sessionId = request.nextUrl.searchParams.get('sessionId') || '';
  if (!clientId || !sessionId) {
    return NextResponse.json({ success: false, message: '缺少 clientId 或 sessionId' }, { status: 400 });
  }
  try {
    const sessions = deleteSession(clientId, sessionId);
    return NextResponse.json({ success: true, sessions });
  } catch (error) {
    const msg = error instanceof Error ? error.message : '删除会话失败';
    console.error('[AI Sessions API] DELETE Error:', msg);
    return NextResponse.json({ success: false, message: msg }, { status: 500 });
  }
}
