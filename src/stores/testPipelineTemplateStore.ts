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
  /** 所属分组 ID；为空表示未分组 */
  groupId?: string | null;
}

/** 流水线模板分组 */
export interface PipelineTemplateGroup {
  id: string;
  name: string;
  createdAt: string;
}

interface PipelineTemplateState {
  templates: PipelineTemplate[];
  groups: PipelineTemplateGroup[];
  isLoading: boolean;

  fetchTemplates: () => Promise<void>;
  addTemplate: (template: { name: string; description?: string; stages: PipelineStageTemplateData[] }) => Promise<void>;
  removeTemplate: (id: string) => Promise<void>;
  getTemplateById: (id: string) => PipelineTemplate | undefined;
  renameTemplate: (id: string, name: string) => Promise<void>;
  addGroup: (name: string) => Promise<PipelineTemplateGroup>;
  renameGroup: (id: string, name: string) => Promise<void>;
  removeGroup: (id: string) => Promise<void>;
  assignTemplatesToGroup: (ids: string[], groupId: string | null) => Promise<void>;
}

export const useTestPipelineTemplateStore = create<PipelineTemplateState>()(
  (set, get) => ({
    templates: [],
    groups: [],
    isLoading: false,

    fetchTemplates: async () => {
      set({ isLoading: true });
      try {
        const response = await fetch('/api/test/pipeline-templates');
        const data = await response.json();
        if (data.success && Array.isArray(data.templates)) {
          set({
            templates: data.templates,
            groups: Array.isArray(data.groups) ? data.groups : [],
          });
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

    renameTemplate: async (id, name) => {
      const response = await fetch('/api/test/pipeline-templates', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, name }),
      });
      const data = await response.json();
      if (!data.success) throw new Error(data.message || '重命名失败');
      await get().fetchTemplates();
    },

    addGroup: async (name) => {
      const response = await fetch('/api/test/pipeline-templates', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'createGroup', name }),
      });
      const data = await response.json();
      if (!data.success || !data.group) throw new Error(data.message || '创建分组失败');
      await get().fetchTemplates();
      return data.group as PipelineTemplateGroup;
    },

    renameGroup: async (id, name) => {
      const response = await fetch('/api/test/pipeline-templates', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId: id, groupName: name }),
      });
      const data = await response.json();
      if (!data.success) throw new Error(data.message || '重命名分组失败');
      await get().fetchTemplates();
    },

    removeGroup: async (id) => {
      const response = await fetch(`/api/test/pipeline-templates?groupId=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      const data = await response.json();
      if (!data.success) throw new Error(data.message || '删除分组失败');
      await get().fetchTemplates();
    },

    assignTemplatesToGroup: async (ids, groupId) => {
      const response = await fetch('/api/test/pipeline-templates', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, groupId }),
      });
      const data = await response.json();
      if (!data.success) throw new Error(data.message || '分组失败');
      await get().fetchTemplates();
    },
  })
);
