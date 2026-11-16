/** 串口解析模板库 - 服务器端存储（所有用户共享）
 *
 * 模板是 TS 代码片段，保存时先在沙箱里编译一次：既能立刻反馈语法/契约错误，
 * 也把代码里 `meta` 声明的信息（名称、命令、UART 限制）提取到记录上供 UI 使用。
 */

import fs from 'fs';
import path from 'path';
import { buildTemplateSnapshot as buildSnapshot } from '../serialTemplateCompiler';
import {
  BUILTIN_SERIAL_TEMPLATES,
  DEFAULT_SERIAL_TEMPLATE_ID,
  legacyKindToTemplateId,
  templateSnapshotOf,
} from '../../utils/serialCodeTemplates.builtin';
import type {
  SerialTemplateRecord,
  SerialTemplateSnapshot,
} from '../../utils/serialTemplateContract';
import type { SerialDslTemplate } from '../../utils/serialDsl';
import type { SerialMonitorConfig } from '../../types/serial';

const DATA_DIR = path.join(process.cwd(), '.data');
const TEMPLATES_FILE = path.join(DATA_DIR, 'serial-parse-templates.json');

export interface StoredSerialTemplate extends SerialTemplateRecord {
  builtin: false;
  createdAt: string;
  updatedAt: string;
}

export function loadUserSerialTemplates(): StoredSerialTemplate[] {
  try {
    if (!fs.existsSync(TEMPLATES_FILE)) return [];
    const raw = fs.readFileSync(TEMPLATES_FILE, 'utf-8');
    if (!raw.trim()) return [];
    const parsed = JSON.parse(raw) as StoredSerialTemplate[];
    return Array.isArray(parsed) ? parsed.filter((t) => t && !t.builtin && t.template) : [];
  } catch (err) {
    console.error('[SerialTemplates] 读取模板库失败:', err);
    return [];
  }
}

function saveUserSerialTemplates(templates: StoredSerialTemplate[]) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(TEMPLATES_FILE, JSON.stringify(templates, null, 2));
}

/** 全部可用模板（内置在前） */
export function loadAllSerialTemplates(): SerialTemplateRecord[] {
  return [...BUILTIN_SERIAL_TEMPLATES, ...loadUserSerialTemplates()];
}

export function findSerialTemplate(id: string): SerialTemplateRecord | undefined {
  return loadAllSerialTemplates().find((t) => t.id === id);
}

export interface SerialTemplatePayload {
  kind: 'code' | 'dsl';
  code?: string;
  dsl?: SerialDslTemplate;
}

export function createUserSerialTemplate(
  payload: SerialTemplatePayload,
  nameOverride?: string
): { ok: true; record: StoredSerialTemplate } | { ok: false; errors: string[] } {
  let template: SerialTemplateSnapshot;
  try {
    template = buildSnapshot(payload.kind, payload, nameOverride);
  } catch (err) {
    return { ok: false, errors: [err instanceof Error ? err.message : String(err)] };
  }

  const templates = loadUserSerialTemplates();
  const now = new Date().toISOString();
  const record: StoredSerialTemplate = {
    id: `serial-template-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    builtin: false,
    template,
    createdAt: now,
    updatedAt: now,
  };
  templates.push(record);
  saveUserSerialTemplates(templates);
  return { ok: true, record };
}

export function updateUserSerialTemplate(
  id: string,
  payload: SerialTemplatePayload,
  nameOverride?: string
): { ok: true; record: StoredSerialTemplate } | { ok: false; errors: string[]; notFound?: boolean } {
  if (id.startsWith('builtin:')) {
    return { ok: false, errors: ['内置模板不可修改，请另存为自定义模板'] };
  }

  const templates = loadUserSerialTemplates();
  const index = templates.findIndex((t) => t.id === id);
  if (index < 0) return { ok: false, errors: ['模板不存在'], notFound: true };

  let template: SerialTemplateSnapshot;
  try {
    template = buildSnapshot(payload.kind, payload, nameOverride);
  } catch (err) {
    return { ok: false, errors: [err instanceof Error ? err.message : String(err)] };
  }

  const record: StoredSerialTemplate = {
    ...templates[index],
    template,
    updatedAt: new Date().toISOString(),
  };
  templates[index] = record;
  saveUserSerialTemplates(templates);
  return { ok: true, record };
}

export function deleteUserSerialTemplate(id: string): boolean {
  if (id.startsWith('builtin:')) return false;
  const templates = loadUserSerialTemplates();
  const next = templates.filter((t) => t.id !== id);
  if (next.length === templates.length) return false;
  saveUserSerialTemplates(next);
  return true;
}

/** 规范化串口监控配置：旧 kind 迁移为 templateId，并把模板快照内联进配置
 *
 * 内联后历史任务/配置模板的重放结果不再受模板库后续修改影响。
 * 返回是否发生了变更（调用方据此决定是否回写存储）。
 */
export function normalizeSerialMonitorConfig(serial: SerialMonitorConfig | undefined): boolean {
  if (!serial) return false;
  let changed = false;

  if (serial.kind) {
    if (!serial.templateId && !serial.template) {
      serial.templateId = legacyKindToTemplateId(serial.kind);
    }
    delete serial.kind;
    changed = true;
  }

  if (!serial.template) {
    const snapshot = templateSnapshotOf(serial, loadUserSerialTemplates());
    if (snapshot) {
      serial.template = snapshot;
      // 用户模板被删除时，内联快照保证任务仍可重放
      if (!serial.templateId) serial.templateId = DEFAULT_SERIAL_TEMPLATE_ID;
      changed = true;
    }
  }

  return changed;
}

/** 规范化监控命令列表中的串口配置 */
export function normalizeSerialMonitorCommands<
  T extends { serial?: SerialMonitorConfig }
>(commands: T[] | undefined): boolean {
  if (!commands) return false;
  return commands.reduce((changed, cmd) => normalizeSerialMonitorConfig(cmd.serial) || changed, false);
}
