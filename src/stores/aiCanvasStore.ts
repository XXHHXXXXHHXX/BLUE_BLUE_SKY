/** AI 可视化画布：AI 在对话中通过工具把内容「画」到界面上
 *
 * 与具体业务页面无关——任何页面都能用。AI 调用 render* 类客户端工具后，
 * 这里累积 block，AiCanvas 组件按类型渲染（图表/指标/表格/公式/时间线/文本）。
 * 同一 id 重复渲染视为更新（用于「公式实时变幻」「图表逐步变形」）。
 *
 * 画布内容持久化到 localStorage：刷新页面后仍在，避免辛苦生成的分析视图丢失。
 */
import { create } from 'zustand';

export type CanvasBlockType =
  | 'chart'
  | 'metrics'
  | 'table'
  | 'formula'
  | 'timeline'
  | 'markdown';

export interface CanvasBlock {
  id: string;
  type: CanvasBlockType;
  title?: string;
  description?: string;
  /** 图表：直接透传 ECharts option */
  echartsOption?: Record<string, unknown>;
  /** 图表高度（像素），默认 320 */
  chartHeight?: number;
  /** 指标卡 */
  metrics?: Array<{ label: string; value: string | number; unit?: string; delta?: number; color?: string }>;
  /** 表格 */
  columns?: Array<{ key: string; title: string; align?: 'left' | 'center' | 'right' }>;
  rows?: Array<Record<string, unknown>>;
  /** 公式（等宽字体 + 说明） */
  formula?: string;
  /** 时间线 */
  items?: Array<{ title: string; description?: string; status?: 'done' | 'active' | 'pending' | 'error'; extra?: string }>;
  /** 文本 / markdown */
  content?: string;
  /** 更新序号：同一 id 每次更新递增，用于触发重绘动画 */
  revision: number;
  createdAt: number;
}

const STORAGE_KEY = 'blue_sky_ai_canvas_v1';
const DEFAULT_TITLE = 'AI 可视化画布';
/** 最多保留的块数，防止长期使用后内存/存储膨胀 */
const MAX_BLOCKS = 30;
/** 序列化后的体积上限（localStorage 通常 5MB，留足余量） */
const MAX_SERIALIZED_BYTES = 400_000;

const VALID_TYPES: CanvasBlockType[] = [
  'chart',
  'metrics',
  'table',
  'formula',
  'timeline',
  'markdown',
];

function isValidBlock(b: unknown): b is CanvasBlock {
  if (!b || typeof b !== 'object') return false;
  const o = b as Record<string, unknown>;
  return (
    typeof o.id === 'string' &&
    o.id.length > 0 &&
    typeof o.type === 'string' &&
    VALID_TYPES.includes(o.type as CanvasBlockType) &&
    typeof o.revision === 'number'
  );
}

function loadPersisted(): { blocks: CanvasBlock[]; title: string } {
  if (typeof window === 'undefined') return { blocks: [], title: DEFAULT_TITLE };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { blocks: [], title: DEFAULT_TITLE };
    const parsed = JSON.parse(raw) as { blocks?: unknown; title?: unknown };
    const blocks = Array.isArray(parsed.blocks) ? parsed.blocks.filter(isValidBlock) : [];
    const title = typeof parsed.title === 'string' && parsed.title ? parsed.title : DEFAULT_TITLE;
    return { blocks, title };
  } catch {
    return { blocks: [], title: DEFAULT_TITLE };
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

/** 防抖落盘；超体积时从最旧的块开始丢弃 */
function persist(blocks: CanvasBlock[], title: string) {
  if (typeof window === 'undefined') return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      let list = blocks.slice(-MAX_BLOCKS);
      let payload = JSON.stringify({ blocks: list, title });
      while (payload.length > MAX_SERIALIZED_BYTES && list.length > 1) {
        list = list.slice(1);
        payload = JSON.stringify({ blocks: list, title });
      }
      window.localStorage.setItem(STORAGE_KEY, payload);
    } catch {
      // 配额不足或序列化失败：放弃持久化，不影响当前会话使用
    }
  }, 300);
}

interface AiCanvasState {
  open: boolean;
  blocks: CanvasBlock[];
  /** 画布标题（AI 可设置） */
  title: string;

  setOpen: (open: boolean) => void;
  setTitle: (title: string) => void;
  /** 渲染/更新一个块：给定 id 则替换并递增 revision */
  upsertBlock: (block: Omit<CanvasBlock, 'revision' | 'createdAt'> & { id: string }) => void;
  removeBlock: (id: string) => void;
  clear: () => void;
}

const initial = loadPersisted();

export const useAiCanvasStore = create<AiCanvasState>((set, get) => ({
  open: false,
  blocks: initial.blocks,
  title: initial.title,

  setOpen: (open) => set({ open }),
  setTitle: (title) => {
    const next = title || DEFAULT_TITLE;
    set({ title: next });
    persist(get().blocks, next);
  },

  upsertBlock: (block) => {
    const existing = get().blocks.find((b) => b.id === block.id);
    if (existing) {
      const next = get().blocks.map((b) =>
        b.id === block.id
          ? { ...b, ...block, revision: b.revision + 1, createdAt: b.createdAt }
          : b,
      );
      set({ blocks: next });
      persist(next, get().title);
      return;
    }
    const next = [
      ...get().blocks,
      { ...block, revision: 1, createdAt: Date.now() },
    ].slice(-MAX_BLOCKS);
    set({
      blocks: next,
      // 首次渲染自动展开画布，让用户立刻看到
      open: true,
    });
    persist(next, get().title);
  },

  removeBlock: (id) => {
    const next = get().blocks.filter((b) => b.id !== id);
    set({ blocks: next });
    persist(next, get().title);
  },

  clear: () => {
    set({ blocks: [] });
    persist([], get().title);
  },
}));
