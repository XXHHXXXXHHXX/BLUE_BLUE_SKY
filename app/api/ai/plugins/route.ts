/** AI 插件管理 API：列表 / 启停 / 重载
 *
 * 声明式插件放在 `.data/ai-plugins/*.json`，改完文件调用 reload 即可生效
 * （注册中心每次请求都会重新读取目录，reload 仅用于让前端刷新展示）。
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import {
  listPluginSummaries,
  setPluginEnabled,
  buildToolRegistry,
} from '../../../../src/server/ai/pluginRegistry';
import { PLUGINS_DIR } from '../../../../src/server/ai/declarativePlugin';

export async function GET() {
  try {
    const plugins = listPluginSummaries();
    const { tools, skipped } = buildToolRegistry();
    return NextResponse.json({
      success: true,
      plugins,
      pluginsDir: PLUGINS_DIR,
      activeToolCount: tools.length,
      skipped,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : '读取插件失败';
    console.error('[AI Plugins API] GET Error:', msg);
    return NextResponse.json({ success: false, message: msg }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { id?: string; enabled?: boolean; action?: string };
    if (body.action === 'reload') {
      // 注册中心无缓存，直接返回最新列表即可
      const plugins = listPluginSummaries();
      const { tools } = buildToolRegistry();
      return NextResponse.json({ success: true, plugins, activeToolCount: tools.length });
    }
    if (!body.id || typeof body.enabled !== 'boolean') {
      return NextResponse.json({ success: false, message: '缺少 id 或 enabled' }, { status: 400 });
    }
    const plugins = setPluginEnabled(body.id, body.enabled);
    const { tools } = buildToolRegistry();
    return NextResponse.json({ success: true, plugins, activeToolCount: tools.length });
  } catch (error) {
    const msg = error instanceof Error ? error.message : '更新插件失败';
    console.error('[AI Plugins API] POST Error:', msg);
    return NextResponse.json({ success: false, message: msg }, { status: 500 });
  }
}
