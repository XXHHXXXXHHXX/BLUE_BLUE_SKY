/**
 * BMC 会话管理 Store - 类似 Xshell 的会话持久化
 * 与拓扑完全解耦，独立存储在 localStorage 中
 */
import { create } from 'zustand';
import type { BMCConfig } from '../types/topology';

const STORAGE_KEY = 'blue_sky_bmc_sessions_v1';

export interface BMCSession extends BMCConfig {
  id: string;
  name: string;
}

interface BMCSessionState {
  sessions: BMCSession[];
  activeSessionId: string | null;   // 当前在面板中选中编辑的会话
  connectedSessionId: string | null; // 已通过测试连接、可用于监控的会话

  // 初始化加载
  loadSessions: () => void;

  // CRUD
  addSession: (session: Omit<BMCSession, 'id'>) => string;
  updateSession: (id: string, updates: Partial<Omit<BMCSession, 'id'>>) => void;
  deleteSession: (id: string) => void;

  // 选中与连接
  setActiveSessionId: (id: string | null) => void;
  setConnectedSessionId: (id: string | null) => void;

  // 获取当前可用于监控的 BMC 配置
  getConnectedConfig: () => BMCConfig | null;

  // 测试连接（仅前端调用后端 API，结果由面板组件消费）
  testConnection: (config: BMCConfig) => Promise<{ success: boolean; message: string }>;
}

function loadFromStorage(): BMCSession[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    // ignore
  }
  return [];
}

function saveToStorage(sessions: BMCSession[]) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  } catch {
    // ignore
  }
}

export const useBMCSessionStore = create<BMCSessionState>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  connectedSessionId: null,

  loadSessions: () => {
    const sessions = loadFromStorage();
    set({ sessions });
  },

  addSession: (session) => {
    const id = `bmc-session-${Date.now()}`;
    const newSession: BMCSession = { id, ...session };
    const sessions = [...get().sessions, newSession];
    set({ sessions, activeSessionId: id });
    saveToStorage(sessions);
    return id;
  },

  updateSession: (id, updates) => {
    const sessions = get().sessions.map((s) =>
      s.id === id ? { ...s, ...updates } : s
    );
    set({ sessions });
    saveToStorage(sessions);
  },

  deleteSession: (id) => {
    const sessions = get().sessions.filter((s) => s.id !== id);
    const nextActive = sessions.length > 0 ? sessions[0].id : null;
    const nextConnected = get().connectedSessionId === id ? null : get().connectedSessionId;
    set({
      sessions,
      activeSessionId: nextActive,
      connectedSessionId: nextConnected,
    });
    saveToStorage(sessions);
  },

  setActiveSessionId: (id) => set({ activeSessionId: id }),

  setConnectedSessionId: (id) => set({ connectedSessionId: id }),

  getConnectedConfig: () => {
    const { sessions, connectedSessionId } = get();
    if (!connectedSessionId) return null;
    const session = sessions.find((s) => s.id === connectedSessionId);
    if (!session) return null;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id: _id, name: _name, ...config } = session;
    return config;
  },

  testConnection: async (config) => {
    try {
      const response = await fetch('/api/bmc/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config }),
      });
      const result = await response.json();
      return {
        success: result.success,
        message: result.message || '测试连接完成',
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: `测试连接失败: ${errMsg}`,
      };
    }
  },
}));

// 客户端初始化时自动加载
if (typeof window !== 'undefined') {
  useBMCSessionStore.getState().loadSessions();
}
