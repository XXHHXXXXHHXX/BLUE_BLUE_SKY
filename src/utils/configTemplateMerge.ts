/** 配置模板拼接
 *
 * 把多个「最小单元」配置模板拼成一个可直接用于跑用例的配置：
 * - 迭代参数模板：拼接 iterationParams / adjustmentCommands / envVars
 * - 监控配置模板：拼接 monitorCommands / envVars
 *
 * 拼接时必须做的两件事（否则跨模板数据会串）：
 * 1. 重新生成所有 id，避免多个模板里同名 id 互相覆盖
 * 2. `adjustmentCommands[i].paramId` 重映射到新的迭代参数 id，否则命令会绑错参数
 *
 * envVars 按 key 去重，后面的模板覆盖前面的（并记录冲突 key 供 UI 提示）。
 */
import type {
  IterationParameter,
  AdjustmentCommand,
  MonitorCommand,
  LogMonitorConfig,
} from '../stores/testStore';
import type { SavedTestConfig } from '../stores/testIterationConfigStore';

export interface MergeResult<T> {
  value: T;
  /** 参与拼接的模板名（按顺序） */
  sources: string[];
  /** 环境变量 key 冲突（后者覆盖前者） */
  envConflicts: string[];
  /** 被去重掉的重复监控命令条数 */
  dedupedCommandCount: number;
}

/** 生成一个本次拼接内唯一的 id */
function makeIdFactory() {
  const used = new Set<string>();
  let seq = 0;
  return (prefix: string): string => {
    let id = '';
    do {
      seq += 1;
      id = `${prefix}-${Date.now().toString(36)}-${seq}`;
    } while (used.has(id));
    used.add(id);
    return id;
  };
}

/** 按 key 合并环境变量，后者覆盖前者 */
function mergeEnvVars(
  configs: SavedTestConfig[],
): { envVars: Array<{ key: string; value: string }>; conflicts: string[] } {
  const map = new Map<string, string>();
  const conflicts: string[] = [];
  for (const config of configs) {
    for (const item of config.envVars || []) {
      const key = (item?.key || '').trim();
      if (!key) continue;
      if (map.has(key) && map.get(key) !== item.value) {
        conflicts.push(key);
      }
      map.set(key, item.value ?? '');
    }
  }
  return {
    envVars: Array.from(map.entries()).map(([key, value]) => ({ key, value })),
    conflicts: Array.from(new Set(conflicts)),
  };
}

export interface MergedIterationConfig {
  iterationParams: IterationParameter[];
  adjustmentCommands: AdjustmentCommand[];
  envVars: Array<{ key: string; value: string }>;
  logMonitorConfig?: LogMonitorConfig;
  globalBmcSessionId?: string | null;
}

/**
 * 拼接多个迭代参数配置模板。
 *
 * 模板顺序即拼接顺序；参数与调整命令按模板依次追加。
 * 旧模板里 `paramId` 缺失时按数组索引回退到同模板的参数（与单模板加载逻辑一致）。
 */
export function mergeIterationConfigs(
  configs: SavedTestConfig[],
): MergeResult<MergedIterationConfig> {
  const list = configs.filter((c) => c.configType === 'iteration');
  const nextId = makeIdFactory();

  const iterationParams: IterationParameter[] = [];
  const adjustmentCommands: AdjustmentCommand[] = [];

  for (const config of list) {
    // 旧模板参数 id → 本次拼接后的新 id
    const paramIdMap = new Map<string, string>();
    const params = config.iterationParams || [];

    params.forEach((param, index) => {
      const newId = nextId('param');
      if (param.id) paramIdMap.set(param.id, newId);
      // 同时按索引兜底，兼容历史数据里 paramId 缺失的情况
      paramIdMap.set(`__index__${index}`, newId);
      iterationParams.push({
        ...param,
        id: newId,
        mode: param.mode || 'range',
        values: param.values || [],
      });
    });

    (config.adjustmentCommands || []).forEach((cmd, index) => {
      const oldParamId = cmd.paramId || params[index]?.id || '';
      const mapped =
        (oldParamId && paramIdMap.get(oldParamId)) ||
        paramIdMap.get(`__index__${index}`) ||
        '';
      adjustmentCommands.push({
        ...cmd,
        id: nextId('adj'),
        paramId: mapped,
        parameterName:
          cmd.parameterName || params[index]?.name || iterationParams.find((p) => p.id === mapped)?.name || '',
      });
    });
  }

  const { envVars, conflicts } = mergeEnvVars(list);

  // logMonitorConfig / globalBmcSessionId：取最后一个显式配置的模板
  let logMonitorConfig: LogMonitorConfig | undefined;
  let globalBmcSessionId: string | null | undefined;
  for (const config of list) {
    if (config.logMonitorConfig !== undefined) logMonitorConfig = config.logMonitorConfig;
    if (config.globalBmcSessionId !== undefined) globalBmcSessionId = config.globalBmcSessionId;
  }

  return {
    value: { iterationParams, adjustmentCommands, envVars, logMonitorConfig, globalBmcSessionId },
    sources: list.map((c) => c.name),
    envConflicts: conflicts,
    dedupedCommandCount: 0,
  };
}

export interface MergedMonitorConfig {
  monitorCommands: MonitorCommand[];
  envVars: Array<{ key: string; value: string }>;
}

/**
 * 拼接多个监控配置模板。
 *
 * 监控结果以 `commandId` 为 key 存放，因此每条命令都必须拿到新 id；
 * 完全相同的命令（同 target / sessionId / command）只保留第一条，避免重复采样。
 */
export function mergeMonitorConfigs(
  configs: SavedTestConfig[],
): MergeResult<MergedMonitorConfig> {
  const list = configs.filter((c) => c.configType === 'monitor');
  const nextId = makeIdFactory();

  const monitorCommands: MonitorCommand[] = [];
  const seen = new Set<string>();
  let dedupedCommandCount = 0;

  for (const config of list) {
    for (const cmd of config.monitorCommands || []) {
      const signature = `${cmd.target || 'host'}|${cmd.sessionId || ''}|${(cmd.command || '').trim()}`;
      // 持续模式 / 串口模式命令内容不同，signature 里带上启动/获取命令避免误判重复
      const fullSignature = cmd.continuous
        ? `${signature}|${(cmd.startCommand || '').trim()}|${(cmd.fetchCommand || '').trim()}`
        : signature;
      if (seen.has(fullSignature)) {
        dedupedCommandCount += 1;
        continue;
      }
      seen.add(fullSignature);
      monitorCommands.push({ ...cmd, id: nextId('mon') });
    }
  }

  const { envVars, conflicts } = mergeEnvVars(list);

  return {
    value: { monitorCommands, envVars },
    sources: list.map((c) => c.name),
    envConflicts: conflicts,
    dedupedCommandCount,
  };
}

/** 拼接结果摘要（用于 UI 提示） */
export function describeMerge(result: MergeResult<unknown>, kind: 'iteration' | 'monitor'): string {
  const parts: string[] = [`已拼接 ${result.sources.length} 个模板`];
  if (kind === 'iteration') {
    const v = result.value as MergedIterationConfig;
    parts.push(`${v.iterationParams.length} 个迭代参数`, `${v.adjustmentCommands.length} 条调整命令`);
  } else {
    const v = result.value as MergedMonitorConfig;
    parts.push(`${v.monitorCommands.length} 条监控命令`);
    if (result.dedupedCommandCount > 0) {
      parts.push(`去重 ${result.dedupedCommandCount} 条重复命令`);
    }
  }
  if (result.envConflicts.length > 0) {
    parts.push(`环境变量覆盖：${result.envConflicts.join(', ')}`);
  }
  return parts.join('，');
}
