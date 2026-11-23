/** AI 插件注册中心
 *
 * 职责：
 * - 汇总内置插件 + `.data/ai-plugins/*.json` 声明式插件
 * - 按 id 启停（状态存 `.data/ai-plugin-state.json`）
 * - 组装 LLM 工具表与 system prompt 提示
 * - 工具重名检测（后加载的插件重名工具会被跳过并记入 error）
 */
import fs from 'fs';
import path from 'path';
import { BUILTIN_PLUGINS } from './builtinPlugins';
import { readPluginFiles, toAiPlugin } from './declarativePlugin';
import type { AiPlugin, AiPluginSummary, AiToolSpec } from './pluginTypes';

const DATA_DIR = path.join(process.cwd(), '.data');
const STATE_FILE = path.join(DATA_DIR, 'ai-plugin-state.json');

interface PluginState {
  /** 被禁用的插件 id 列表（默认全部启用，只记录例外，便于新增插件自动生效） */
  disabled: string[];
}

function loadState(): PluginState {
  try {
    if (!fs.existsSync(STATE_FILE)) return { disabled: [] };
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
    return { disabled: Array.isArray(raw?.disabled) ? raw.disabled.filter((v: unknown) => typeof v === 'string') : [] };
  } catch {
    return { disabled: [] };
  }
}

function saveState(state: PluginState) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${STATE_FILE}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, STATE_FILE);
}

/** 加载全部插件（内置 + 声明式），声明式加载失败的也返回以便展示错误 */
export function loadAllPlugins(): Array<{ plugin?: AiPlugin; error?: string; file?: string }> {
  const result: Array<{ plugin?: AiPlugin; error?: string; file?: string }> = BUILTIN_PLUGINS.map((p) => ({ plugin: p }));
  for (const entry of readPluginFiles()) {
    if (entry.error || !entry.plugin) {
      result.push({ error: entry.error || '未知错误', file: entry.file });
    } else {
      result.push({ plugin: toAiPlugin(entry.plugin, entry.file), file: entry.file });
    }
  }
  return result;
}

/** 插件管理接口用的摘要列表 */
export function listPluginSummaries(): AiPluginSummary[] {
  const { disabled } = loadState();
  const disabledSet = new Set(disabled);
  return loadAllPlugins().map((entry) => {
    if (!entry.plugin) {
      return {
        id: entry.file || 'unknown',
        name: entry.file || '未知插件',
        description: '',
        source: 'declarative' as const,
        file: entry.file,
        enabled: false,
        toolNames: [],
        error: entry.error,
      };
    }
    const p = entry.plugin;
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      source: p.source,
      file: p.file,
      enabled: !disabledSet.has(p.id),
      toolNames: p.tools.map((t) => t.name),
      promptHint: p.promptHint,
    };
  });
}

/** 启用/禁用插件 */
export function setPluginEnabled(pluginId: string, enabled: boolean): AiPluginSummary[] {
  const state = loadState();
  const set = new Set(state.disabled);
  if (enabled) set.delete(pluginId);
  else set.add(pluginId);
  saveState({ disabled: Array.from(set) });
  return listPluginSummaries();
}

/** 组装当前启用的工具表（含重名检测） */
export function buildToolRegistry(): {
  tools: AiToolSpec[];
  promptHints: string[];
  skipped: Array<{ pluginId: string; toolName: string; reason: string }>;
} {
  const { disabled } = loadState();
  const disabledSet = new Set(disabled);
  const tools: AiToolSpec[] = [];
  const promptHints: string[] = [];
  const skipped: Array<{ pluginId: string; toolName: string; reason: string }> = [];
  const usedNames = new Set<string>();

  for (const entry of loadAllPlugins()) {
    const plugin = entry.plugin;
    if (!plugin) continue;
    if (disabledSet.has(plugin.id)) continue;
    if (plugin.promptHint) promptHints.push(plugin.promptHint);
    for (const tool of plugin.tools) {
      if (usedNames.has(tool.name)) {
        skipped.push({
          pluginId: plugin.id,
          toolName: tool.name,
          reason: '工具名与已启用插件冲突，已跳过',
        });
        continue;
      }
      usedNames.add(tool.name);
      tools.push(tool);
    }
  }

  return { tools, promptHints, skipped };
}

/** 测试用：重置状态文件（不导出到生产调用路径） */
export function __resetPluginStateForTest() {
  try {
    if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
  } catch {
    // ignore
  }
}
