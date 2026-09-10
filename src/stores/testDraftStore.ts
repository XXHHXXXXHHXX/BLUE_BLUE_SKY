/**
 * 测试草稿箱 Store - 服务器端持久化存储
 * 每次测试完成或中止时自动保存，防止数据丢失
 */
import { create } from 'zustand';
import type { TestResult, IterationParameter, AdjustmentCommand, MonitorCommand, LogMonitorConfig } from './testStore';

export interface TestDraft {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  savedAt: string;
  sourceTabName: string;
  host: string;
  config: {
    iterationParams: IterationParameter[];
    adjustmentCommands: AdjustmentCommand[];
    monitorCommands: MonitorCommand[];
    envVars: Array<{ key: string; value: string }>;
    logMonitorConfig?: LogMonitorConfig;
    globalBmcSessionId?: string | null;
  };
  results: TestResult[];
  status: 'completed' | 'aborted' | 'error';
}

interface TestDraftState {
  drafts: TestDraft[];
  isLoading: boolean;

  // Actions
  fetchDrafts: () => Promise<void>;
  addDraft: (draft: Omit<TestDraft, 'id' | 'createdAt' | 'savedAt'>) => Promise<TestDraft>;
  removeDraft: (id: string) => Promise<void>;
  getDraftById: (id: string) => TestDraft | undefined;
  clearAllDrafts: () => Promise<void>;
}

export const useTestDraftStore = create<TestDraftState>((set, get) => ({
  drafts: [],
  isLoading: false,

  fetchDrafts: async () => {
    set({ isLoading: true });
    try {
      const res = await fetch('/api/test/drafts');
      const data = await res.json();
      if (data.success) {
        set({ drafts: data.drafts || [] });
      }
    } catch (err) {
      console.error('[testDraftStore] fetchDrafts failed:', err);
    } finally {
      set({ isLoading: false });
    }
  },

  addDraft: async (draftData) => {
    const tempDraft: TestDraft = {
      ...draftData,
      id: `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
      savedAt: new Date().toISOString(),
    };

    // 乐观更新：先更新本地状态
    set((state) => ({
      drafts: [tempDraft, ...state.drafts],
    }));

    try {
      const res = await fetch('/api/test/drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draftData),
      });
      const data = await res.json();
      if (data.success && data.draft) {
        set((state) => ({
          drafts: state.drafts.map((d) => (d.id === tempDraft.id ? data.draft : d)),
        }));
        return data.draft;
      }
    } catch (err) {
      console.error('[testDraftStore] addDraft failed:', err);
    }

    return tempDraft;
  },

  removeDraft: async (id) => {
    // 乐观更新
    set((state) => ({
      drafts: state.drafts.filter((d) => d.id !== id),
    }));

    try {
      await fetch(`/api/test/drafts?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
    } catch (err) {
      console.error('[testDraftStore] removeDraft failed:', err);
    }
  },

  getDraftById: (id) => {
    return get().drafts.find((d) => d.id === id);
  },

  clearAllDrafts: async () => {
    set({ drafts: [] });
    try {
      await fetch('/api/test/drafts?all=1', { method: 'DELETE' });
    } catch (err) {
      console.error('[testDraftStore] clearAllDrafts failed:', err);
    }
  },
}));

// 客户端初始化时自动加载草稿列表
if (typeof window !== 'undefined') {
  useTestDraftStore.getState().fetchDrafts();
}
