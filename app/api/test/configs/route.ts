/** 测试配置模板 API - 服务器端存储 */
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

// ========== 数据目录配置 ==========
const DATA_DIR = path.join(process.cwd(), '.data');
const CONFIGS_FILE = path.join(DATA_DIR, 'test-configs.json');

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
}

export interface SavedTestConfigData {
  id: string;
  name: string;
  description?: string;
  configType: 'iteration' | 'monitor';
  createdAt: string;
  iterationParams: IterationParameterData[];
  adjustmentCommands: AdjustmentCommandData[];
  monitorCommands: MonitorCommandData[];
  envVars: Array<{ key: string; value: string }>;
  // 旧数据兼容字段
  testSuite?: string;
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

  if (configType) {
    return NextResponse.json({
      success: true,
      configs: configs.filter((c) => c.configType === configType),
    });
  }

  return NextResponse.json({ success: true, configs });
}

/** POST /api/test/configs - 保存配置模板 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, description, configType, iterationParams, adjustmentCommands, monitorCommands, envVars } = body;

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

/** DELETE /api/test/configs - 删除配置模板 */
export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

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
