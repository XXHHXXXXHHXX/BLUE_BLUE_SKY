/**
 * 测试用例包库 Store - 服务器端存储（所有用户共享）
 */
import { create } from 'zustand';

export interface TestPackage {
  id: string;
  name: string;
  description: string;
  filename: string;
  size: string;
  createdAt: string;
  updatedAt: string;
  builtin?: boolean;
  /** 上传时强制指定的必填环境变量名列表 */
  requiredEnvVars?: string[];
  /** 所属分组 ID；为空表示未分组 */
  groupId?: string | null;
}

/** 用例包分组 */
export interface TestPackageGroup {
  id: string;
  name: string;
  createdAt: string;
}

interface TestPackageState {
  packages: TestPackage[];
  groups: TestPackageGroup[];
  isLoading: boolean;

  // Actions
  fetchPackages: () => Promise<void>;
  addPackage: (pkg: Omit<TestPackage, 'id' | 'createdAt' | 'updatedAt' | 'builtin'> & { file?: File }) => Promise<void>;
  removePackage: (id: string) => Promise<void>;
  getPackageById: (id: string) => TestPackage | undefined;
  getPackageFile: (id: string) => Promise<File | undefined>;
  downloadPackage: (id: string) => Promise<void>;
  searchPackages: (keyword: string) => TestPackage[];
  renamePackage: (id: string, name: string) => Promise<void>;
  addGroup: (name: string) => Promise<TestPackageGroup>;
  renameGroup: (id: string, name: string) => Promise<void>;
  removeGroup: (id: string) => Promise<void>;
  assignPackagesToGroup: (ids: string[], groupId: string | null) => Promise<void>;
}

export const useTestPackageStore = create<TestPackageState>()(
  (set, get) => ({
    packages: [],
    groups: [],
    isLoading: false,

    fetchPackages: async () => {
      set({ isLoading: true });
      try {
        const response = await fetch('/api/test/packages');
        const data = await response.json();
        if (data.success && Array.isArray(data.packages)) {
          set({
            packages: data.packages,
            groups: Array.isArray(data.groups) ? data.groups : [],
          });
        }
      } catch (error) {
        console.error('Failed to fetch packages:', error);
      } finally {
        set({ isLoading: false });
      }
    },

    addPackage: async (pkgData) => {
      const file = pkgData.file;
      if (!file) throw new Error('缺少文件');

      const formData = new FormData();
      formData.append('name', pkgData.name);
      formData.append('description', pkgData.description);
      formData.append('file', file);
      if (pkgData.requiredEnvVars && pkgData.requiredEnvVars.length > 0) {
        formData.append('requiredEnvVars', pkgData.requiredEnvVars.join(','));
      }

      const response = await fetch('/api/test/packages', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();
      if (!data.success) {
        throw new Error(data.message || '上传失败');
      }

      // 刷新列表
      await get().fetchPackages();
    },

    removePackage: async (id) => {
      if (id.startsWith('builtin-') || id === 'demo-power-test' || id === 'demo-multi-score') return;

      const response = await fetch(`/api/test/packages?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });

      const data = await response.json();
      if (!data.success) {
        throw new Error(data.message || '删除失败');
      }

      // 刷新列表
      await get().fetchPackages();
    },

    getPackageById: (id) => {
      return get().packages.find((p) => p.id === id);
    },

    getPackageFile: async (id) => {
      const pkg = get().packages.find((p) => p.id === id);
      if (!pkg) return undefined;

      const response = await fetch(`/api/test/packages?action=download&id=${encodeURIComponent(id)}`);
      if (!response.ok) return undefined;

      const blob = await response.blob();
      return new File([blob], pkg.filename, { type: 'application/zip' });
    },

    downloadPackage: async (id) => {
      const pkg = get().packages.find((p) => p.id === id);
      if (!pkg) throw new Error('用例包不存在');

      const response = await fetch(`/api/test/packages?action=download&id=${encodeURIComponent(id)}`);
      if (!response.ok) throw new Error('下载失败');

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = pkg.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },

    searchPackages: (keyword) => {
      const packages = get().packages;
      if (!keyword.trim()) return packages;

      const lowerKeyword = keyword.toLowerCase();
      return packages.filter((pkg) =>
        pkg.name.toLowerCase().includes(lowerKeyword) ||
        pkg.description.toLowerCase().includes(lowerKeyword) ||
        pkg.filename.toLowerCase().includes(lowerKeyword)
      );
    },

    renamePackage: async (id, name) => {
      const response = await fetch('/api/test/packages', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, name }),
      });
      const data = await response.json();
      if (!data.success) throw new Error(data.message || '重命名失败');
      await get().fetchPackages();
    },

    addGroup: async (name) => {
      const response = await fetch('/api/test/packages', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'createGroup', name }),
      });
      const data = await response.json();
      if (!data.success || !data.group) throw new Error(data.message || '创建分组失败');
      await get().fetchPackages();
      return data.group as TestPackageGroup;
    },

    renameGroup: async (id, name) => {
      const response = await fetch('/api/test/packages', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId: id, groupName: name }),
      });
      const data = await response.json();
      if (!data.success) throw new Error(data.message || '重命名分组失败');
      await get().fetchPackages();
    },

    removeGroup: async (id) => {
      const response = await fetch(`/api/test/packages?groupId=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      const data = await response.json();
      if (!data.success) throw new Error(data.message || '删除分组失败');
      await get().fetchPackages();
    },

    assignPackagesToGroup: async (ids, groupId) => {
      const response = await fetch('/api/test/packages', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, groupId }),
      });
      const data = await response.json();
      if (!data.success) throw new Error(data.message || '分组失败');
      await get().fetchPackages();
    },
  })
);

// 格式化文件大小
export const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
};
