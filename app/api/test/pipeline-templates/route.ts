/** 流水线模板 API - 服务器端存储（所有用户共享） */
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

// ========== 数据目录配置 ==========
const DATA_DIR = path.join(process.cwd(), '.data');
const TEMPLATES_FILE = path.join(DATA_DIR, 'pipeline-templates.json');

/** 流水线模板中保存的阶段配置（序列化前端 PipelineStage，去掉 File 等运行时对象） */
export interface PipelineStageTemplate {
  id: string;
  name: string;
  order: number;
  packageSource: 'upload' | 'library';
  packageLibraryId?: string;
  packageFileName: string;
  /** 关联的迭代配置模板 ID（可选） */
  configTemplateId?: string | null;
  /** 阶段独立监控命令 */
  monitorCommands?: Array<{
    id: string;
    name: string;
    command: string;
    target: 'host' | 'bmc';
    sessionId: string | null;
    interval: number;
    enabled: boolean;
    mode?: 'single' | 'list';
    columns?: string[];
    jumpThreshold?: number;
    jumpThresholdType?: 'percent' | 'absolute';
    skipJumps?: number;
    skipFirst?: number;
    takeLast?: number;
    skipLast?: number;
    excludeZero?: boolean;
    continuous?: boolean;
    startCommand?: string;
    fetchCommand?: string;
  }>;
  /** 阶段独立环境变量 */
  envVars?: Array<{ key: string; value: string }>;
  /** 用例包要求的必填环境变量及其填写值 */
  requiredEnvVarValues?: Record<string, string>;
}

export interface PipelineTemplateData {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  stages: PipelineStageTemplate[];
}

// 确保目录存在
function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

// 读取模板列表
function loadTemplates(): PipelineTemplateData[] {
  try {
    if (fs.existsSync(TEMPLATES_FILE)) {
      const raw = fs.readFileSync(TEMPLATES_FILE, 'utf-8');
      return JSON.parse(raw);
    }
  } catch {
    console.error('Failed to load pipeline-templates');
  }
  return [];
}

// 保存模板列表
function saveTemplates(templates: PipelineTemplateData[]) {
  ensureDir();
  fs.writeFileSync(TEMPLATES_FILE, JSON.stringify(templates, null, 2));
}

/** GET /api/test/pipeline-templates - 获取流水线模板列表 */
export async function GET() {
  return NextResponse.json({ success: true, templates: loadTemplates() });
}

/** POST /api/test/pipeline-templates - 保存流水线模板 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, description, stages } = body;

    if (!name || !Array.isArray(stages) || stages.length === 0) {
      return NextResponse.json({ success: false, message: '缺少必要参数（模板名称和至少一个阶段）' }, { status: 400 });
    }

    const now = new Date().toISOString();
    const templates = loadTemplates();
    const newTemplate: PipelineTemplateData = {
      id: `pipeline-template-${Date.now()}`,
      name,
      description,
      createdAt: now,
      updatedAt: now,
      stages: stages as PipelineStageTemplate[],
    };

    templates.unshift(newTemplate);
    saveTemplates(templates);

    return NextResponse.json({ success: true, template: newTemplate });
  } catch (error) {
    const msg = error instanceof Error ? error.message : '保存失败';
    console.error('[PipelineTemplates API] Save error:', msg);
    return NextResponse.json({ success: false, message: msg }, { status: 500 });
  }
}

/** DELETE /api/test/pipeline-templates - 删除流水线模板 */
export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json({ success: false, message: '缺少模板ID' }, { status: 400 });
  }

  const templates = loadTemplates();
  const idx = templates.findIndex((t) => t.id === id);
  if (idx === -1) {
    return NextResponse.json({ success: false, message: '模板不存在' }, { status: 404 });
  }

  templates.splice(idx, 1);
  saveTemplates(templates);

  return NextResponse.json({ success: true, message: '已删除' });
}
