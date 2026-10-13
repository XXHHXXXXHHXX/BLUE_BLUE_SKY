/**
 * 流水线模板 Store - 服务器端存储（所有用户共享）
 * 保存/加载/删除整个流水线阶段配置，下次复用直接跑
 */
import { create } from 'zustand';
import type { PipelineStage } from './testStore';

/** 可序列化的流水线阶段配置（去掉 File 等运行时对象） */
export interface PipelineStageTemplateData {
  id: string;
  name: string;
  order: number;
  packageSource: 'upload' | 'library';
  packageLibraryId?: string;
  packageFileName: string;
  configTemplateId?: string | null;
  monitorCommands?: PipelineStage['monitorCommands'];
  envVars?: PipelineStage['envVars'];
  requiredEnvVarValues?: Record<string, string>;
}

export interface PipelineTemplate {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  stages: PipelineStageTemplateData[];
}

interface PipelineTemplateState {
  templates: PipelineTemplate[];
  isLoading: boolean;

  fetchTemplates: () => Promise<void>;
  addTemplate: (template: { name: string; description?: string; stages: PipelineStageTemplateData[] }) => Promise<void>;
  removeTemplate: (id: string) => Promise<void>;
  getTemplateById: (id: string) => PipelineTemplate | undefined;
}

export const useTestPipelineTemplateStore = create<PipelineTemplateState>()(
  (set, get) => ({
    templates: [],
    isLoading: false,

    fetchTemplates: async () => {
      set({ isLoading: true });
      try {
        const response = await fetch('/api/test/pipeline-templates');
        const data = await response.json();
        if (data.success && Array.isArray(data.templates)) {
          set({ templates: data.templates });
        }
      } catch (error) {
        console.error('Failed to fetch pipeline templates:', error);
      } finally {
        set({ isLoading: false });
      }
    },

    addTemplate: async (templateData) => {
      const response = await fetch('/api/test/pipeline-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(templateData),
      });

      const data = await response.json();
      if (!data.success) {
        throw new Error(data.message || '保存失败');
      }

      // 刷新列表
      await get().fetchTemplates();
    },

    removeTemplate: async (id) => {
      const response = await fetch(`/api/test/pipeline-templates?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });

      const data = await response.json();
      if (!data.success) {
        throw new Error(data.message || '删除失败');
      }

      // 刷新列表
      await get().fetchTemplates();
    },

    getTemplateById: (id) => {
      return get().templates.find((t) => t.id === id);
    },
  })
);
