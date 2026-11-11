/** 流水线模板 API - 服务器端存储（所有用户共享） */
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import type { SerialMonitorConfig } from '../../../../src/types/serial';

// ========== 数据目录配置 ==========
const DATA_DIR = path.join(process.cwd(), '.data');
const TEMPLATES_FILE = path.join(DATA_DIR, 'pipeline-templates.json');
const GROUPS_FILE = path.join(DATA_DIR, 'pipeline-template-groups.json');

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
    /** 串口（BMC SOL）监控配置 */
    serial?: SerialMonitorConfig;
  }>;
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
  /** 所属分组 ID；为空表示未分组 */
  groupId?: string | null;
}

/** 流水线模板分组 */
export interface PipelineTemplateGroup {
  id: string;
  name: string;
  createdAt: string;
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

// 读取分组列表
function loadGroups(): PipelineTemplateGroup[] {
  try {
    if (fs.existsSync(GROUPS_FILE)) {
      return JSON.parse(fs.readFileSync(GROUPS_FILE, 'utf-8'));
    }
  } catch {
    console.error('Failed to load pipeline-template-groups');
  }
  return [];
}

// 保存分组列表
function saveGroups(groups: PipelineTemplateGroup[]) {
  ensureDir();
  fs.writeFileSync(GROUPS_FILE, JSON.stringify(groups, null, 2));
}

/** GET /api/test/pipeline-templates - 获取流水线模板列表 */
export async function GET() {
  return NextResponse.json({ success: true, templates: loadTemplates(), groups: loadGroups() });
}

/** PATCH /api/test/pipeline-templates - 分组管理：创建分组 / 批量分组 / 重命名 / 重命名分组 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, id, name, ids, groupId, groupName } = body as {
      action?: string;
      id?: string;
      name?: string;
      ids?: string[];
      groupId?: string | null;
      groupName?: string;
    };

    // 创建分组
    if (action === 'createGroup') {
      if (!name || !name.trim()) {
        return NextResponse.json({ success: false, message: '分组名称不能为空' }, { status: 400 });
      }
      const groups = loadGroups();
      const group: PipelineTemplateGroup = {
        id: `pipeline-group-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: name.trim(),
        createdAt: new Date().toISOString(),
      };
      groups.push(group);
      saveGroups(groups);
      return NextResponse.json({ success: true, group });
    }

    // 重命名分组
    if (groupId && groupName !== undefined) {
      const groups = loadGroups();
      const group = groups.find((g) => g.id === groupId);
      if (!group) {
        return NextResponse.json({ success: false, message: '分组不存在' }, { status: 404 });
      }
      if (!groupName.trim()) {
        return NextResponse.json({ success: false, message: '分组名称不能为空' }, { status: 400 });
      }
      group.name = groupName.trim();
      saveGroups(groups);
      return NextResponse.json({ success: true, group });
    }

    // 批量设置所属分组（groupId 为 null 表示移出分组）
    if (Array.isArray(ids)) {
      const templates = loadTemplates();
      const idSet = new Set(ids);
      let updated = 0;
      for (const template of templates) {
        if (idSet.has(template.id)) {
          template.groupId = groupId ?? null;
          updated++;
        }
      }
      saveTemplates(templates);
      return NextResponse.json({ success: true, updated });
    }

    // 重命名模板
    if (id && name !== undefined) {
      const templates = loadTemplates();
      const template = templates.find((t) => t.id === id);
      if (!template) {
        return NextResponse.json({ success: false, message: '模板不存在' }, { status: 404 });
      }
      if (!name.trim()) {
        return NextResponse.json({ success: false, message: '模板名称不能为空' }, { status: 400 });
      }
      template.name = name.trim();
      template.updatedAt = new Date().toISOString();
      saveTemplates(templates);
      return NextResponse.json({ success: true, template });
    }

    return NextResponse.json({ success: false, message: '缺少必要参数' }, { status: 400 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : '更新失败';
    console.error('[PipelineTemplates API] Patch error:', msg);
    return NextResponse.json({ success: false, message: msg }, { status: 500 });
  }
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

/** DELETE /api/test/pipeline-templates - 删除流水线模板；带 groupId 时删除分组（组内模板变为未分组） */
export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  const groupId = searchParams.get('groupId');

  // 删除分组：组内模板解绑，模板本身保留
  if (groupId) {
    const groups = loadGroups();
    const idx = groups.findIndex((g) => g.id === groupId);
    if (idx === -1) {
      return NextResponse.json({ success: false, message: '分组不存在' }, { status: 404 });
    }
    groups.splice(idx, 1);
    saveGroups(groups);

    const templates = loadTemplates();
    let unbound = 0;
    for (const template of templates) {
      if (template.groupId === groupId) {
        template.groupId = null;
        unbound++;
      }
    }
    if (unbound > 0) saveTemplates(templates);

    return NextResponse.json({ success: true, message: '已删除分组', unbound });
  }

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
