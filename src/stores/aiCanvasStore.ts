/** AI 可视化画布：AI 在对话中通过工具把内容「画」到界面上
 *
 * 与具体业务页面无关——任何页面都能用。AI 调用 render* 类客户端工具后，
 * 这里累积 block，AiCanvas 组件按类型渲染（图表/指标/表格/公式/时间线/文本）。
 * 同一 id 重复渲染视为更新（用于「公式实时变幻」「图表逐步变形」）。
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

export const useAiCanvasStore = create<AiCanvasState>((set, get) => ({
  open: false,
  blocks: [],
  title: 'AI 可视化画布',

  setOpen: (open) => set({ open }),
  setTitle: (title) => set({ title: title || 'AI 可视化画布' }),

  upsertBlock: (block) => {
    const existing = get().blocks.find((b) => b.id === block.id);
    if (existing) {
      set((state) => ({
        blocks: state.blocks.map((b) =>
          b.id === block.id
            ? { ...b, ...block, revision: b.revision + 1, createdAt: b.createdAt }
            : b,
        ),
      }));
      return;
    }
    set((state) => ({
      blocks: [
        ...state.blocks,
        { ...block, revision: 1, createdAt: Date.now() },
      ],
      // 首次渲染自动展开画布，让用户立刻看到
      open: true,
    }));
  },

  removeBlock: (id) => set((state) => ({ blocks: state.blocks.filter((b) => b.id !== id) })),
  clear: () => set({ blocks: [] }),
}));
