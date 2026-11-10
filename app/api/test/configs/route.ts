/** 测试配置模板 API - 服务器端存储 */
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import type { SerialMonitorConfig } from '../../../../src/types/serial';

// ========== 数据目录配置 ==========
const DATA_DIR = path.join(process.cwd(), '.data');
const CONFIGS_FILE = path.join(DATA_DIR, 'test-configs.json');
const GROUPS_FILE = path.join(DATA_DIR, 'test-config-groups.json');

export interface IterationParameterData {
  id: string;
  name: string;
  mode: 'range' | 'custom';
  start: number;
  end: number;
  step: number;
  values: string[];
}

export interface AdjustmentCommandData {
  id: string;
  name: string;
  target: 'host' | 'bmc';
  sessionId: string | null;
  command: string;
  parameterName: string;
  paramId: string;
}

export interface MonitorCommandData {
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
  continuous?: boolean;
  startCommand?: string;
  fetchCommand?: string;
  /** 串口（BMC SOL）监控配置 */
  serial?: SerialMonitorConfig;
}

export interface SavedTestConfigData {
  id: string;
  name: string;
  description?: string;
  configType: 'iteration' | 'monitor';
  /** 所属分组 ID；为空表示未分组 */
  groupId?: string | null;
  createdAt: string;
  iterationParams: IterationParameterData[];
  adjustmentCommands: AdjustmentCommandData[];
  monitorCommands: MonitorCommandData[];
  envVars: Array<{ key: string; value: string }>;
  // 旧数据兼容字段
  testSuite?: string;
}

/** 配置模板分组 */
export interface ConfigGroupData {
  id: string;
  name: string;
  configType: 'iteration' | 'monitor';
  createdAt: string;
}

// 确保目录存在
function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

// 读取配置列表
function loadConfigs(): SavedTestConfigData[] {
  try {
    if (fs.existsSync(CONFIGS_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIGS_FILE, 'utf-8'));
    }
  } catch {
    console.error('Failed to load test-configs');
  }
  return [];
}

// 保存配置列表
function saveConfigs(configs: SavedTestConfigData[]) {
  ensureDir();
  fs.writeFileSync(CONFIGS_FILE, JSON.stringify(configs, null, 2));
}

// 读取分组列表
function loadGroups(): ConfigGroupData[] {
  try {
    if (fs.existsSync(GROUPS_FILE)) {
      return JSON.parse(fs.readFileSync(GROUPS_FILE, 'utf-8'));
    }
  } catch {
    console.error('Failed to load test-config-groups');
  }
  return [];
}

// 保存分组列表
function saveGroups(groups: ConfigGroupData[]) {
  ensureDir();
  fs.writeFileSync(GROUPS_FILE, JSON.stringify(groups, null, 2));
}

/** 迁移旧数据：testSuite='monitor' 转为 configType='monitor'，其余为 'iteration' */
function migrateConfigs() {
  const configs = loadConfigs();
  let changed = false;
  for (const config of configs) {
    if (!config.configType) {
      config.configType = config.testSuite === 'monitor' ? 'monitor' : 'iteration';
      changed = true;
    }
    if ('testSuite' in config) {
      delete (config as any).testSuite;
      changed = true;
    }
  }
  if (changed) {
    saveConfigs(configs);
  }
}

/** GET /api/test/configs - 获取配置模板列表 */
export async function GET(request: NextRequest) {
  migrateConfigs();
  const { searchParams } = new URL(request.url);
  const configType = searchParams.get('configType');

  const configs = loadConfigs();
  const groups = loadGroups();

  if (configType) {
    return NextResponse.json({
      success: true,
      configs: configs.filter((c) => c.configType === configType),
      groups: groups.filter((g) => g.configType === configType),
    });
  }

  return NextResponse.json({ success: true, configs, groups });
}

/** POST /api/test/configs - 保存配置模板 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // 创建分组
    if (body.action === 'createGroup') {
      const { name, configType } = body as { name?: string; configType?: 'iteration' | 'monitor' };
      if (!name || !name.trim()) {
        return NextResponse.json({ success: false, message: '分组名称不能为空' }, { status: 400 });
      }
      const groups = loadGroups();
      const newGroup: ConfigGroupData = {
        id: `group-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: name.trim(),
        configType: configType || 'iteration',
        createdAt: new Date().toISOString(),
      };
      groups.push(newGroup);
      saveGroups(groups);
      return NextResponse.json({ success: true, group: newGroup });
    }

    const { name, description, configType, iterationParams, adjustmentCommands, monitorCommands, envVars, groupId } = body;

    if (!name || !iterationParams) {
      return NextResponse.json({ success: false, message: '缺少必要参数' }, { status: 400 });
    }

    migrateConfigs();
    const configs = loadConfigs();
    const newConfig: SavedTestConfigData = {
      id: `config-${Date.now()}`,
      createdAt: new Date().toISOString(),
      name,
      description,
      configType: configType || 'iteration',
      groupId: groupId ?? null,
      iterationParams: iterationParams || [],
      adjustmentCommands: adjustmentCommands || [],
      monitorCommands: monitorCommands || [],
      envVars: envVars || [],
    };

    configs.unshift(newConfig);
    saveConfigs(configs);

    return NextResponse.json({ success: true, config: newConfig });
  } catch (error) {
    const msg = error instanceof Error ? error.message : '保存失败';
    console.error('[Configs API] Save error:', msg);
    return NextResponse.json({ success: false, message: msg }, { status: 500 });
  }
}

/** PATCH /api/test/configs - 重命名配置 / 批量分组 / 重命名分组 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, name, ids, groupId, groupName } = body as {
      id?: string;
      name?: string;
      ids?: string[];
      groupId?: string | null;
      groupName?: string;
    };

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

    // 批量设置配置所属分组（ids + groupId，groupId 为 null 表示移出分组）
    if (Array.isArray(ids)) {
      const configs = loadConfigs();
      const idSet = new Set(ids);
      let updated = 0;
      for (const config of configs) {
        if (idSet.has(config.id)) {
          config.groupId = groupId ?? null;
          updated++;
        }
      }
      saveConfigs(configs);
      return NextResponse.json({ success: true, updated });
    }

    // 重命名配置
    if (id && name !== undefined) {
      const configs = loadConfigs();
      const config = configs.find((c) => c.id === id);
      if (!config) {
        return NextResponse.json({ success: false, message: '配置不存在' }, { status: 404 });
      }
      if (!name.trim()) {
        return NextResponse.json({ success: false, message: '配置名称不能为空' }, { status: 400 });
      }
      config.name = name.trim();
      saveConfigs(configs);
      return NextResponse.json({ success: true, config });
    }

    return NextResponse.json({ success: false, message: '缺少必要参数' }, { status: 400 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : '更新失败';
    console.error('[Configs API] Patch error:', msg);
    return NextResponse.json({ success: false, message: msg }, { status: 500 });
  }
}

/** DELETE /api/test/configs - 删除配置模板；带 groupId 时删除分组（组内配置变为未分组） */
export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  const groupId = searchParams.get('groupId');

  // 删除分组：组内配置解绑，配置本身保留
  if (groupId) {
    const groups = loadGroups();
    const idx = groups.findIndex((g) => g.id === groupId);
    if (idx === -1) {
      return NextResponse.json({ success: false, message: '分组不存在' }, { status: 404 });
    }
    groups.splice(idx, 1);
    saveGroups(groups);

    const configs = loadConfigs();
    let unbound = 0;
    for (const config of configs) {
      if (config.groupId === groupId) {
        config.groupId = null;
        unbound++;
      }
    }
    if (unbound > 0) saveConfigs(configs);

    return NextResponse.json({ success: true, message: '已删除分组', unbound });
  }

  if (!id) {
    return NextResponse.json({ success: false, message: '缺少配置ID' }, { status: 400 });
  }

  migrateConfigs();
  const configs = loadConfigs();
  const idx = configs.findIndex((c) => c.id === id);
  if (idx === -1) {
    return NextResponse.json({ success: false, message: '配置不存在' }, { status: 404 });
  }

  configs.splice(idx, 1);
  saveConfigs(configs);

  return NextResponse.json({ success: true, message: '已删除' });
}
