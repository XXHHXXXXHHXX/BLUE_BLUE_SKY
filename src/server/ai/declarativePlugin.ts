/** 声明式插件：用 JSON 定义 HTTP 工具，无需改代码即可扩展 agent 能力
 *
 * 文件位置：`.data/ai-plugins/*.json`
 *
 * 示例：
 * ```json
 * {
 *   "id": "weather",
 *   "name": "天气查询",
 *   "description": "查询城市天气",
 *   "tools": [{
 *     "name": "getWeather",
 *     "description": "查询指定城市的天气",
 *     "parameters": {
 *       "type": "object",
 *       "properties": { "city": { "type": "string" } },
 *       "required": ["city"]
 *     },
 *     "request": {
 *       "url": "https://api.example.com/weather?city={{city}}",
 *       "method": "GET",
 *       "headers": { "Authorization": "Bearer {{env.WEATHER_KEY}}" },
 *       "timeoutMs": 15000
 *     },
 *     "responsePath": "data"
 *   }]
 * }
 * ```
 */
import fs from 'fs';
import path from 'path';
import { jsonSchemaToZod, type JsonSchemaNode } from './jsonSchemaToZod';
import type { AiPlugin, AiToolSpec } from './pluginTypes';

const DATA_DIR = path.join(process.cwd(), '.data');
export const PLUGINS_DIR = path.join(DATA_DIR, 'ai-plugins');

export interface DeclarativeRequestSpec {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  /** 请求体模板：字符串按模板替换；对象递归替换 */
  body?: unknown;
  timeoutMs?: number;
}

export interface DeclarativeToolSpec {
  name: string;
  description: string;
  parameters?: JsonSchemaNode;
  request: DeclarativeRequestSpec;
  /** 从响应 JSON 里取子路径，如 "data.list"；不填返回完整响应 */
  responsePath?: string;
}

export interface DeclarativePluginFile {
  id: string;
  name: string;
  description?: string;
  promptHint?: string;
  tools: DeclarativeToolSpec[];
}

/** 模板替换：`{{arg}}` 取参数，`{{env.NAME}}` 取环境变量 */
export function renderTemplate(template: string, args: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key: string) => {
    if (key.startsWith('env.')) {
      const envKey = key.slice(4);
      return process.env[envKey] ?? '';
    }
    const value = args[key];
    if (value === undefined || value === null) return '';
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
  });
}

/** 递归替换对象/数组里的字符串模板 */
export function renderTemplateDeep(value: unknown, args: Record<string, unknown>): unknown {
  if (typeof value === 'string') return renderTemplate(value, args);
  if (Array.isArray(value)) return value.map((v) => renderTemplateDeep(v, args));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = renderTemplateDeep(v, args);
    }
    return out;
  }
  return value;
}

/** 按点路径取响应子对象 */
export function pickByPath(data: unknown, pathStr?: string): unknown {
  if (!pathStr) return data;
  let cur: unknown = data;
  for (const segment of pathStr.split('.').filter(Boolean)) {
    if (cur === null || cur === undefined) return undefined;
    if (Array.isArray(cur)) {
      const idx = Number(segment);
      cur = Number.isInteger(idx) ? cur[idx] : undefined;
    } else if (typeof cur === 'object') {
      cur = (cur as Record<string, unknown>)[segment];
    } else {
      return undefined;
    }
  }
  return cur;
}

/** 校验插件文件结构，返回错误描述（null 表示合法） */
export function validatePluginFile(raw: unknown): { error?: string; plugin?: DeclarativePluginFile } {
  if (!raw || typeof raw !== 'object') return { error: '插件文件必须是 JSON 对象' };
  const obj = raw as Record<string, unknown>;
  if (typeof obj.id !== 'string' || !obj.id.trim()) return { error: '缺少 id' };
  if (typeof obj.name !== 'string' || !obj.name.trim()) return { error: '缺少 name' };
  if (!Array.isArray(obj.tools) || obj.tools.length === 0) return { error: 'tools 必须是非空数组' };

  const seen = new Set<string>();
  const tools: DeclarativeToolSpec[] = [];
  for (let i = 0; i < obj.tools.length; i += 1) {
    const t = obj.tools[i] as Record<string, unknown>;
    if (!t || typeof t !== 'object') return { error: `tools[${i}] 不是对象` };
    if (typeof t.name !== 'string' || !t.name.trim()) return { error: `tools[${i}] 缺少 name` };
    if (seen.has(t.name)) return { error: `工具名重复: ${t.name}` };
    seen.add(t.name);
    if (typeof t.description !== 'string' || !t.description.trim()) {
      return { error: `tools[${i}] 缺少 description` };
    }
    const req = t.request as Record<string, unknown> | undefined;
    if (!req || typeof req !== 'object' || typeof req.url !== 'string' || !req.url.trim()) {
      return { error: `tools[${i}] 缺少 request.url` };
    }
    const method = typeof req.method === 'string' ? req.method.toUpperCase() : 'GET';
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      return { error: `tools[${i}] request.method 非法: ${method}` };
    }
    tools.push({
      name: t.name,
      description: t.description,
      parameters: t.parameters as JsonSchemaNode | undefined,
      request: {
        url: req.url,
        method: method as DeclarativeRequestSpec['method'],
        headers: (req.headers as Record<string, string>) || undefined,
        body: req.body,
        timeoutMs: typeof req.timeoutMs === 'number' ? req.timeoutMs : undefined,
      },
      responsePath: typeof t.responsePath === 'string' ? t.responsePath : undefined,
    });
  }

  return {
    plugin: {
      id: obj.id,
      name: obj.name,
      description: typeof obj.description === 'string' ? obj.description : '',
      promptHint: typeof obj.promptHint === 'string' ? obj.promptHint : undefined,
      tools,
    },
  };
}

/** 执行一个声明式 HTTP 工具 */
export async function executeDeclarativeTool(
  spec: DeclarativeToolSpec,
  args: Record<string, unknown>,
): Promise<unknown> {
  const url = renderTemplate(spec.request.url, args);
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(spec.request.headers || {})) {
    headers[k] = renderTemplate(v, args);
  }
  const method = spec.request.method || 'GET';

  const init: RequestInit = {
    method,
    headers,
    signal: AbortSignal.timeout(spec.request.timeoutMs ?? 15000),
  };

  if (method !== 'GET' && spec.request.body !== undefined) {
    const body = renderTemplateDeep(spec.request.body, args);
    if (typeof body === 'string') {
      init.body = body;
      if (!headers['Content-Type'] && !headers['content-type']) {
        headers['Content-Type'] = 'application/json';
      }
    } else {
      init.body = JSON.stringify(body);
      if (!headers['Content-Type'] && !headers['content-type']) {
        headers['Content-Type'] = 'application/json';
      }
    }
  }

  try {
    const res = await fetch(url, init);
    const text = await res.text();
    if (!res.ok) {
      return { error: `HTTP ${res.status}: ${text.slice(0, 500)}` };
    }
    let data: unknown = text;
    try {
      data = JSON.parse(text);
    } catch {
      // 非 JSON 响应原样返回
    }
    const picked = pickByPath(data, spec.responsePath);
    return picked === undefined ? { note: `responsePath "${spec.responsePath}" 未命中`, raw: data } : picked;
  } catch (err) {
    return { error: err instanceof Error ? err.message : '请求失败' };
  }
}

/** 把声明式插件转成可执行的 AiToolSpec 列表 */
export function toToolSpecs(file: DeclarativePluginFile): AiToolSpec[] {
  return file.tools.map((spec) => ({
    name: spec.name,
    description: spec.description,
    inputSchema: jsonSchemaToZod(spec.parameters),
    execute: async (args: Record<string, unknown>) => executeDeclarativeTool(spec, args),
  }));
}

/** 读取插件目录下全部 JSON 文件 */
export function readPluginFiles(): Array<{ file: string; plugin?: DeclarativePluginFile; error?: string }> {
  if (!fs.existsSync(PLUGINS_DIR)) return [];
  const files = fs
    .readdirSync(PLUGINS_DIR)
    .filter((f) => f.toLowerCase().endsWith('.json'))
    .sort();
  return files.map((file) => {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(PLUGINS_DIR, file), 'utf-8'));
      const result = validatePluginFile(raw);
      if (result.error) return { file, error: result.error };
      return { file, plugin: result.plugin };
    } catch (err) {
      return { file, error: err instanceof Error ? err.message : '解析失败' };
    }
  });
}

/** 把声明式插件文件转成 AiPlugin */
export function toAiPlugin(file: DeclarativePluginFile, fileName: string): AiPlugin {
  return {
    id: file.id,
    name: file.name,
    description: file.description || '',
    source: 'declarative',
    file: fileName,
    tools: toToolSpecs(file),
    promptHint: file.promptHint,
  };
}

/** 校验参数（供测试与调用方复用） */
export function validateArgs(spec: DeclarativeToolSpec, args: unknown): { ok: boolean; error?: string } {
  const schema = jsonSchemaToZod(spec.parameters);
  const parsed = schema.safeParse(args);
  if (parsed.success) return { ok: true };
  return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
}
