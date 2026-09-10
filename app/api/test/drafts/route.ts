/** 测试草稿 API - 服务器端存储 */
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

// ========== 数据目录配置 ==========
const DATA_DIR = path.join(process.cwd(), '.data');
const DRAFTS_FILE = path.join(DATA_DIR, 'test-drafts.json');

interface TestDraftData {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  savedAt: string;
  sourceTabName: string;
  host: string;
  config: {
    iterationParams: Array<{
      id: string;
      name: string;
      mode: 'range' | 'custom';
      start: number;
      end: number;
      step: number;
      values: string[];
    }>;
    adjustmentCommands: Array<{
      id: string;
      name: string;
      target: string;
      sessionId: string | null;
      command: string;
      parameterName: string;
      paramId: string;
    }>;
    monitorCommands: Array<{
      id: string;
      name: string;
      command: string;
      target: string;
      sessionId: string | null;
      interval: number;
      enabled: boolean;
      jumpThreshold?: number;
      jumpThresholdType?: string;
      skipJumps?: number;
      skipFirst?: number;
      takeLast?: number;
      skipLast?: number;
    }>;
    envVars: Array<{ key: string; value: string }>;
  };
  results: Array<{
    iteration: number;
    power: number;
    score: number;
    status: string;
    message?: string;
    timestamp: string;
    iterationValues?: Record<string, string>;
    iterationLabel?: string;
    monitorResults?: Record<string, {
      commandId: string;
      commandName: string;
      dataPoints: Array<{ timestamp: string; value: number; raw: string }>;
      averageValue: number;
    }>;
  }>;
  status: 'completed' | 'aborted' | 'error';
  // 旧数据兼容字段
  testSuite?: string;
}

// 确保目录存在
function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

// 读取草稿列表
function loadDrafts(): TestDraftData[] {
  try {
    if (fs.existsSync(DRAFTS_FILE)) {
      return JSON.parse(fs.readFileSync(DRAFTS_FILE, 'utf-8'));
    }
  } catch {
    console.error('Failed to load test-drafts');
  }
  return [];
}

// 保存草稿列表
function saveDrafts(drafts: TestDraftData[]) {
  ensureDir();
  fs.writeFileSync(DRAFTS_FILE, JSON.stringify(drafts, null, 2));
}

/** 迁移旧数据：删除 testSuite 字段 */
function migrateDrafts() {
  const drafts = loadDrafts();
  let changed = false;
  for (const draft of drafts) {
    if ('testSuite' in draft) {
      delete (draft as any).testSuite;
      changed = true;
    }
  }
  if (changed) {
    saveDrafts(drafts);
  }
}

/** GET /api/test/drafts - 获取草稿列表 */
export async function GET() {
  migrateDrafts();
  const drafts = loadDrafts();
  return NextResponse.json({ success: true, drafts });
}

/** POST /api/test/drafts - 保存草稿 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, description, sourceTabName, host, config, results, status } = body;

    if (!name || !results) {
      return NextResponse.json({ success: false, message: '缺少必要参数' }, { status: 400 });
    }

    migrateDrafts();
    const drafts = loadDrafts();
    const newDraft: TestDraftData = {
      id: `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
      savedAt: new Date().toISOString(),
      name,
      description,
      sourceTabName,
      host,
      config,
      results,
      status: status || 'completed',
    };

    drafts.unshift(newDraft);
    saveDrafts(drafts);

    return NextResponse.json({ success: true, draft: newDraft });
  } catch (error) {
    const msg = error instanceof Error ? error.message : '保存失败';
    console.error('[Drafts API] Save error:', msg);
    return NextResponse.json({ success: false, message: msg }, { status: 500 });
  }
}

/** DELETE /api/test/drafts - 删除草稿 */
export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  const all = searchParams.get('all');

  migrateDrafts();
  const drafts = loadDrafts();

  if (all === '1') {
    saveDrafts([]);
    return NextResponse.json({ success: true, message: '已清空所有草稿' });
  }

  if (!id) {
    return NextResponse.json({ success: false, message: '缺少草稿ID' }, { status: 400 });
  }

  const idx = drafts.findIndex((d) => d.id === id);
  if (idx === -1) {
    return NextResponse.json({ success: false, message: '草稿不存在' }, { status: 404 });
  }

  drafts.splice(idx, 1);
  saveDrafts(drafts);

  return NextResponse.json({ success: true, message: '已删除' });
}
