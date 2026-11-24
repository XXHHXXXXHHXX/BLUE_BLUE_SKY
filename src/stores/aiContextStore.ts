/** AI 助手上下文：页面把「当前选中的对象」写进来，AI 助手读取后作为对话上下文
 *
 * 全局挂载后 AI 助手不再由单个页面传 props，改用这个轻量 store 共享选中态。
 */
import { create } from 'zustand';

interface AiContextState {
  /** 当前选中的报告 ID 列表（数据分析等页面写入） */
  selectedReportIds: string[];
  /** 当前选中的拓扑 ID（拓扑监控/设计页写入） */
  selectedTopologyId: string | null;

  setSelectedReportIds: (ids: string[]) => void;
  setSelectedTopologyId: (id: string | null) => void;
}

export const useAiContextStore = create<AiContextState>((set) => ({
  selectedReportIds: [],
  selectedTopologyId: null,
  setSelectedReportIds: (ids) => set({ selectedReportIds: ids }),
  setSelectedTopologyId: (id) => set({ selectedTopologyId: id }),
}));
