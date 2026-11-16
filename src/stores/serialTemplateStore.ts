/** 串口解析模板库 Store - 服务器端存储（内置模板只读，用户模板可增删改）
 *
 * 支持两种模板形态：TS 代码脚本（默认）与表单模板（结构化字段）。
 * 试解析统一走 /api/test/serial-templates 的 test 动作（编译在服务端沙箱执行）。
 */
import { create } from 'zustand';
import type {
  SerialTemplateRecord,
  SerialTemplateSnapshot,
} from '../utils/serialTemplateContract';
import type { SerialDslTemplate } from '../utils/serialDsl';

/** 保存/试解析时提交的模板内容 */
export type SerialTemplatePayload =
  | { kind: 'code'; code: string }
  | { kind: 'dsl'; dsl: SerialDslTemplate };

/** 试解析结果（服务端编译执行后返回，前端只展示） */
export interface SerialTemplateTestResult {
  snapshot: SerialTemplateSnapshot;
  hasData: boolean;
  samples: Array<Record<string, number>>;
  metrics: Array<{ id: string; label: string }>;
  warnings: string[];
  checkFailures: string[];
}

interface SerialTemplateState {
  templates: SerialTemplateRecord[];
  isLoading: boolean;

  fetchTemplates: () => Promise<void>;
  saveTemplate: (
    payload: SerialTemplatePayload,
    id?: string,
    name?: string
  ) => Promise<SerialTemplateRecord | null>;
  deleteTemplate: (id: string) => Promise<boolean>;
  testTemplate: (
    payload: SerialTemplatePayload,
    sample: string
  ) => Promise<SerialTemplateTestResult | { error: string }>;
  getTemplate: (id: string) => SerialTemplateRecord | undefined;
}

export const useSerialTemplateStore = create<SerialTemplateState>()((set, get) => ({
  templates: [],
  isLoading: false,

  fetchTemplates: async () => {
    set({ isLoading: true });
    try {
      const res = await fetch('/api/test/serial-templates');
      const data = await res.json();
      if (data.success) set({ templates: data.templates as SerialTemplateRecord[] });
    } catch (err) {
      console.error('加载串口解析模板失败:', err);
    } finally {
      set({ isLoading: false });
    }
  },

  saveTemplate: async (payload, id, name) => {
    try {
      const res = await fetch('/api/test/serial-templates', {
        method: id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(id ? { id, name, ...payload } : { name, ...payload }),
      });
      const data = await res.json();
      if (!data.success) return null;
      await get().fetchTemplates();
      return data.template as SerialTemplateRecord;
    } catch (err) {
      console.error('保存串口解析模板失败:', err);
      return null;
    }
  },

  deleteTemplate: async (id) => {
    try {
      const res = await fetch(`/api/test/serial-templates?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      const data = await res.json();
      if (!data.success) return false;
      await get().fetchTemplates();
      return true;
    } catch (err) {
      console.error('删除串口解析模板失败:', err);
      return false;
    }
  },

  testTemplate: async (payload, sample) => {
    try {
      const res = await fetch('/api/test/serial-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'test', sample, ...payload }),
      });
      const data = await res.json();
      if (!data.success) {
        return { error: typeof data.message === 'string' ? data.message : '试解析失败' };
      }
      return {
        snapshot: data.snapshot as SerialTemplateSnapshot,
        hasData: !!data.hasData,
        samples: data.samples as Array<Record<string, number>>,
        metrics: data.metrics as Array<{ id: string; label: string }>,
        warnings: (data.warnings ?? []) as string[],
        checkFailures: (data.checkFailures ?? []) as string[],
      };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  },

  getTemplate: (id) => get().templates.find((t) => t.id === id),
}));
