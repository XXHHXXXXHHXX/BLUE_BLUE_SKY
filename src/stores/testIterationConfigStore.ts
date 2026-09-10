/**
 * 测试配置模板 Store - 服务器端存储（所有用户共享）
 */
import { create } from 'zustand';
import type { IterationParameter, AdjustmentCommand, MonitorCommand, LogMonitorConfig } from './testStore';

export interface SavedTestConfig {
  id: string;
  name: string;
  description?: string;
  configType: 'iteration' | 'monitor';
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
  isLoading: boolean;

  fetchConfigs: (configType?: 'iteration' | 'monitor') => Promise<void>;
  addConfig: (config: Omit<SavedTestConfig, 'id' | 'createdAt'>) => Promise<void>;
  removeConfig: (id: string) => Promise<void>;
  getConfigById: (id: string) => SavedTestConfig | undefined;
  getConfigsByType: (configType: 'iteration' | 'monitor') => SavedTestConfig[];
}

export const useTestIterationConfigStore = create<TestConfigState>()(
  (set, get) => ({
    configs: [],
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

    getConfigById: (id) => {
      return get().configs.find((c) => c.id === id);
    },

    getConfigsByType: (configType) => {
      return get().configs.filter((c) => c.configType === configType);
    },
  })
);
