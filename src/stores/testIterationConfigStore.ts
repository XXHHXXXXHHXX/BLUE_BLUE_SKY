/**
 * 测试配置模板 Store - 服务器端存储（所有用户共享）
 */
import { create } from 'zustand';
import type { IterationParameter, AdjustmentCommand, MonitorCommand, LogMonitorConfig } from './testStore';

/** 配置模板分组（用于把大量模板归类，便于下拉菜单查找） */
export interface ConfigGroup {
  id: string;
  name: string;
  configType: 'iteration' | 'monitor';
  createdAt: string;
}

export interface SavedTestConfig {
  id: string;
  name: string;
  description?: string;
  configType: 'iteration' | 'monitor';
  /** 所属分组 ID；为空表示未分组 */
  groupId?: string | null;
  createdAt: string;
  iterationParams: IterationParameter[];
  adjustmentCommands: AdjustmentCommand[];
  /** 迭代配置模板不包含监控命令，监控命令由独立的监控配置模板管理 */
  monitorCommands?: MonitorCommand[];
  envVars: Array<{ key: string; value: string }>;
  logMonitorConfig?: LogMonitorConfig;
  globalBmcSessionId?: string | null;
}

interface TestConfigState {
  configs: SavedTestConfig[];
  groups: ConfigGroup[];
  isLoading: boolean;

  fetchConfigs: (configType?: 'iteration' | 'monitor') => Promise<void>;
  addConfig: (config: Omit<SavedTestConfig, 'id' | 'createdAt'>) => Promise<void>;
  removeConfig: (id: string) => Promise<void>;
  /** 重命名配置模板 */
  renameConfig: (id: string, name: string) => Promise<void>;
  /** 把多个配置合并到一个分组（groupId 为空表示移出分组） */
  assignConfigsToGroup: (ids: string[], groupId: string | null) => Promise<void>;
  /** 创建分组 */
  addGroup: (name: string, configType: 'iteration' | 'monitor') => Promise<ConfigGroup>;
  /** 重命名分组 */
  renameGroup: (id: string, name: string) => Promise<void>;
  /** 删除分组（组内配置变为未分组，不删除配置） */
  removeGroup: (id: string) => Promise<void>;
  getConfigById: (id: string) => SavedTestConfig | undefined;
  getConfigsByType: (configType: 'iteration' | 'monitor') => SavedTestConfig[];
  getGroupsByType: (configType: 'iteration' | 'monitor') => ConfigGroup[];
}

export const useTestIterationConfigStore = create<TestConfigState>()(
  (set, get) => ({
    configs: [],
    groups: [],
    isLoading: false,

    fetchConfigs: async (configType) => {
      set({ isLoading: true });
      try {
        const url = configType
          ? `/api/test/configs?configType=${encodeURIComponent(configType)}`
          : '/api/test/configs';
        const response = await fetch(url);
        const data = await response.json();
        if (data.success && Array.isArray(data.configs)) {
          set((state) => {
            const configMap = new Map(state.configs.map((c) => [c.id, c]));
            for (const config of data.configs as SavedTestConfig[]) {
              configMap.set(config.id, config);
            }
            // 如果请求没有指定 configType（如删除后刷新全部），清理已删除的配置
            if (!configType) {
              const returnedIds = new Set(data.configs.map((c: SavedTestConfig) => c.id));
              for (const id of configMap.keys()) {
                if (!returnedIds.has(id)) {
                  configMap.delete(id);
                }
              }
            }
            return { configs: Array.from(configMap.values()) };
          });
        }

        // 分组随配置一起返回；单独请求时只更新对应类型的分组
        if (data.success && Array.isArray(data.groups)) {
          set((state) => {
            if (!configType) return { groups: data.groups as ConfigGroup[] };
            const others = state.groups.filter((g) => g.configType !== configType);
            return { groups: [...others, ...(data.groups as ConfigGroup[])] };
          });
        }
      } catch (error) {
        console.error('Failed to fetch configs:', error);
      } finally {
        set({ isLoading: false });
      }
    },

    addConfig: async (configData) => {
      const response = await fetch('/api/test/configs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(configData),
      });

      const data = await response.json();
      if (!data.success) {
        throw new Error(data.message || '保存失败');
      }

      // 刷新列表
      await get().fetchConfigs(configData.configType);
    },

    removeConfig: async (id) => {
      const response = await fetch(`/api/test/configs?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });

      const data = await response.json();
      if (!data.success) {
        throw new Error(data.message || '删除失败');
      }

      // 刷新列表
      await get().fetchConfigs();
    },

    renameConfig: async (id, name) => {
      const response = await fetch('/api/test/configs', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, name }),
      });
      const data = await response.json();
      if (!data.success) {
        throw new Error(data.message || '重命名失败');
      }
      set((state) => ({
        configs: state.configs.map((c) => (c.id === id ? { ...c, name } : c)),
      }));
    },

    assignConfigsToGroup: async (ids, groupId) => {
      const response = await fetch('/api/test/configs', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, groupId }),
      });
      const data = await response.json();
      if (!data.success) {
        throw new Error(data.message || '分组失败');
      }
      const idSet = new Set(ids);
      set((state) => ({
        configs: state.configs.map((c) =>
          idSet.has(c.id) ? { ...c, groupId: groupId ?? null } : c,
        ),
      }));
    },

    addGroup: async (name, configType) => {
      const response = await fetch('/api/test/configs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'createGroup', name, configType }),
      });
      const data = await response.json();
      if (!data.success || !data.group) {
        throw new Error(data.message || '创建分组失败');
      }
      set((state) => ({ groups: [...state.groups, data.group as ConfigGroup] }));
      return data.group as ConfigGroup;
    },

    renameGroup: async (id, name) => {
      const response = await fetch('/api/test/configs', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId: id, groupName: name }),
      });
      const data = await response.json();
      if (!data.success) {
        throw new Error(data.message || '重命名分组失败');
      }
      set((state) => ({
        groups: state.groups.map((g) => (g.id === id ? { ...g, name } : g)),
      }));
    },

    removeGroup: async (id) => {
      const response = await fetch(
        `/api/test/configs?groupId=${encodeURIComponent(id)}`,
        { method: 'DELETE' },
      );
      const data = await response.json();
      if (!data.success) {
        throw new Error(data.message || '删除分组失败');
      }
      set((state) => ({
        groups: state.groups.filter((g) => g.id !== id),
        // 组内配置变为未分组
        configs: state.configs.map((c) => (c.groupId === id ? { ...c, groupId: null } : c)),
      }));
    },

    getConfigById: (id) => {
      return get().configs.find((c) => c.id === id);
    },

    getConfigsByType: (configType) => {
      return get().configs.filter((c) => c.configType === configType);
    },

    getGroupsByType: (configType) => {
      return get().groups.filter((g) => g.configType === configType);
    },
  })
);
