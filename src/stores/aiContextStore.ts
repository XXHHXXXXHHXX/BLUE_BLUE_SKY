/** AI 助手上下文：页面把「当前选中的对象」写进来，AI 助手读取后作为对话上下文
 *
 * 全局挂载后 AI 助手不再由单个页面传 props，改用这个轻量 store 共享选中态。
 * 同时承担「AI 请求打开某个面板」的单向广播（requestOpenPanel → AppLayout 消费）。
 */
import { create } from 'zustand';

/** AI 可请求打开的面板 */
export type AiPanelRequest = 'packageLibrary' | 'reportManager';

/** AI 请求在数据分析页启动一次「实时建模」 */
export interface AiLiveAnalysisRequest {
  reportId: string;
  target?: string;
  direction?: 'max' | 'min';
  rank?: number;
}

interface AiContextState {
  /** 当前选中的报告 ID 列表（数据分析等页面写入） */
  selectedReportIds: string[];
  /** 当前选中的拓扑 ID（拓扑监控/设计页写入） */
  selectedTopologyId: string | null;
  /** 待处理的面板打开请求（AppLayout 消费后清空） */
  panelRequest: AiPanelRequest | null;
  /** 待处理的实时建模请求（数据分析页消费后清空） */
  liveAnalysisRequest: AiLiveAnalysisRequest | null;

  setSelectedReportIds: (ids: string[]) => void;
  setSelectedTopologyId: (id: string | null) => void;
  requestOpenPanel: (panel: string) => void;
  consumePanelRequest: () => AiPanelRequest | null;
  requestLiveAnalysis: (req: AiLiveAnalysisRequest) => void;
  consumeLiveAnalysisRequest: () => AiLiveAnalysisRequest | null;
}

export const useAiContextStore = create<AiContextState>((set, get) => ({
  selectedReportIds: [],
  selectedTopologyId: null,
  panelRequest: null,
  liveAnalysisRequest: null,
  setSelectedReportIds: (ids) => set({ selectedReportIds: ids }),
  setSelectedTopologyId: (id) => set({ selectedTopologyId: id }),
  requestOpenPanel: (panel) => {
    if (panel === 'packageLibrary' || panel === 'reportManager') {
      set({ panelRequest: panel });
    }
  },
  consumePanelRequest: () => {
    const current = get().panelRequest;
    if (current) set({ panelRequest: null });
    return current;
  },
  requestLiveAnalysis: (req) => {
    if (req && req.reportId) set({ liveAnalysisRequest: req });
  },
  consumeLiveAnalysisRequest: () => {
    const current = get().liveAnalysisRequest;
    if (current) set({ liveAnalysisRequest: null });
    return current;
  },
}));
