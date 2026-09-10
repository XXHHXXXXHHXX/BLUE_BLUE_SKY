/**
 * SSH会话管理 Store - 类似于XShell的会话管理
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export interface SSHSession {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  // 密码加密存储（简单Base64，实际生产环境应使用更安全的加密方式）
  passwordEncrypted: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
  useCount: number;
}

interface SSHSessionState {
  sessions: SSHSession[];
  
  // Actions
  addSession: (session: Omit<SSHSession, 'id' | 'createdAt' | 'updatedAt' | 'useCount'>) => void;
  removeSession: (id: string) => void;
  updateSession: (id: string, updates: Partial<Omit<SSHSession, 'id'>>) => void;
  getSessionById: (id: string) => SSHSession | undefined;
  getDecryptedPassword: (id: string) => string | undefined;
  recordUsage: (id: string) => void;
  searchSessions: (keyword: string) => SSHSession[];
  getSortedSessions: () => SSHSession[];
}

// 简单的Base64加密（实际生产环境应使用更安全的加密方式）
const encryptPassword = (password: string): string => {
  try {
    return btoa(password);
  } catch {
    return password;
  }
};

const decryptPassword = (encrypted: string): string => {
  try {
    return atob(encrypted);
  } catch {
    return encrypted;
  }
};

export const useSSHSessionStore = create<SSHSessionState>()(
  persist(
    (set, get) => ({
      sessions: [],

      addSession: (sessionData) => {
        const now = new Date().toISOString();
        const id = `ssh-${Date.now()}`;

        const newSession: SSHSession = {
          id,
          name: sessionData.name,
          host: sessionData.host,
          port: sessionData.port || 22,
          username: sessionData.username,
          passwordEncrypted: encryptPassword(sessionData.passwordEncrypted),
          description: sessionData.description,
          createdAt: now,
          updatedAt: now,
          useCount: 0,
        };

        set((state) => ({
          sessions: [...state.sessions, newSession],
        }));
      },

      removeSession: (id) => {
        set((state) => ({
          sessions: state.sessions.filter((s) => s.id !== id),
        }));
      },

      updateSession: (id, updates) => {
        set((state) => ({
          sessions: state.sessions.map((s) => {
            if (s.id !== id) return s;
            
            const updated: SSHSession = {
              ...s,
              ...updates,
              updatedAt: new Date().toISOString(),
            };
            
            // 如果更新了密码，需要重新加密
            if (updates.passwordEncrypted) {
              updated.passwordEncrypted = encryptPassword(updates.passwordEncrypted);
            }
            
            return updated;
          }),
        }));
      },

      getSessionById: (id) => {
        return get().sessions.find((s) => s.id === id);
      },

      getDecryptedPassword: (id) => {
        const session = get().sessions.find((s) => s.id === id);
        if (!session) return undefined;
        return decryptPassword(session.passwordEncrypted);
      },

      recordUsage: (id) => {
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === id
              ? { ...s, useCount: s.useCount + 1, lastUsedAt: new Date().toISOString() }
              : s
          ),
        }));
      },

      searchSessions: (keyword) => {
        const { sessions } = get();
        if (!keyword.trim()) return sessions;

        const lowerKeyword = keyword.toLowerCase();
        return sessions.filter(
          (s) =>
            s.name.toLowerCase().includes(lowerKeyword) ||
            s.host.toLowerCase().includes(lowerKeyword) ||
            s.username.toLowerCase().includes(lowerKeyword) ||
            s.description?.toLowerCase().includes(lowerKeyword)
        );
      },

      getSortedSessions: () => {
        const { sessions } = get();
        // 按最后使用时间排序，最近使用的在前
        return [...sessions].sort((a, b) => {
          if (a.lastUsedAt && b.lastUsedAt) {
            return new Date(b.lastUsedAt).getTime() - new Date(a.lastUsedAt).getTime();
          }
          if (a.lastUsedAt) return -1;
          if (b.lastUsedAt) return 1;
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        });
      },
    }),
    {
      name: 'blue-sky-ssh-sessions',
      partialize: (state) => ({ sessions: state.sessions }),
    }
  )
);
