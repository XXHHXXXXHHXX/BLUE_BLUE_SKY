/**
 * 测试报告 Store - 服务器端存储（所有用户共享）
 * 报告统一扁平化管理，按目录层级分类
 */
import { create } from 'zustand';
import type { TestResult } from './testStore';

export interface ReportFolder {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TestReport {
  id: string;
  name: string;
  description?: string;
  /** 所属目录 ID，未分类目录兜底 */
  folderId?: string;
  createdAt: string;
  config: {
    host: string;
    iterationParams?: Array<{ id: string; name: string; mode: 'range' | 'custom'; start: number; end: number; step: number; values: string[] }>;
    adjustmentCommands?: Array<{ id: string; name: string; target: string; sessionId: string | null; command: string; parameterName: string }>;
    // 兼容旧数据
    startPower?: number;
    endPower?: number;
    step?: number;
  };
  results: TestResult[];
  /** 关联的原始任务ID，用于日志下载 */
  jobId?: string;
  chartData?: {
    powerData: number[];
    scoreData: number[];
  };
  monitorResults?: Record<string, {
    commandId: string;
    commandName: string;
    dataPoints: Array<{ timestamp: string; value: number; raw: string }>;
    dataPointsCount?: number;
    averageValue: number;
  }>;
  /** 环境信息，例如 CPU、网卡、磁盘等键值对 */
  environment?: Record<string, string>;
  stageId?: string;
  stageName?: string;
  /** 自定义平均值计算范围覆盖，key 为 commandId */
  customAvgRanges?: Record<string, { avgStart?: number; avgEnd?: number }>;
}

export interface FolderTreeNode {
  key: string;
  title: string;
  children?: FolderTreeNode[];
  isLeaf?: boolean;
  data: ReportFolder;
}

const DEFAULT_FOLDER_ID = 'uncategorized';

interface TestReportState {
  reports: TestReport[];
  folders: ReportFolder[];
  isLoading: boolean;
  selectedFolderId: string | null;

  // Actions
  fetchReports: () => Promise<void>;
  addReport: (report: Omit<TestReport, 'id' | 'createdAt'>) => Promise<void>;
  removeReport: (id: string) => Promise<void>;
  updateReport: (id: string, data: { name?: string; description?: string; folderId?: string; environment?: Record<string, string> }) => Promise<void>;
  updateReportCustomAvgRanges: (id: string, ranges: Record<string, { avgStart?: number; avgEnd?: number }>) => Promise<{ success: boolean; message: string }>;
  moveReportToFolder: (reportId: string, folderId: string) => Promise<void>;
  getReportById: (id: string) => TestReport | undefined;
  getReportsByFolder: (folderId: string | null) => TestReport[];
  searchReports: (folderId: string | null, keyword: string) => TestReport[];
  exportReport: (id: string) => string;

  // Folder actions
  fetchFolders: () => Promise<void>;
  createFolder: (parentId: string | null, name: string) => Promise<ReportFolder>;
  renameFolder: (id: string, name: string) => Promise<void>;
  deleteFolder: (id: string) => Promise<void>;
  getDefaultFolderId: () => string;
  getFolderById: (id: string) => ReportFolder | undefined;
  getFolderTree: () => FolderTreeNode[];
  getSelectedFolderId: () => string | null;
  setSelectedFolderId: (folderId: string | null) => void;
  buildFolderTreeOptions: () => { value: string; title: string; children?: any[] }[];
}

export const DEFAULT_FOLDER_NAME = '未分类';

export function isDefaultFolder(folderId?: string | null) {
  return folderId === DEFAULT_FOLDER_ID;
}

// 生成ECharts配置
export const generateChartOption = (report: TestReport) => {
  const labels = report.results.map((r) => r.iterationLabel || `${r.power}`);
  const scoreData = report.results.map((r) => r.score);

  return {
    title: {
      text: report.name,
      subtext: `测试主机: ${report.config.host}`,
      left: 'center',
    },
    tooltip: {
      trigger: 'axis',
      formatter: (params: any[]) => {
        const data = params[0];
        return `迭代: ${data.dataIndex + 1}<br/>参数: ${labels[data.dataIndex]}<br/>分数: ${data.value}`;
      },
    },
    grid: {
      left: '3%',
      right: '4%',
      bottom: '3%',
      containLabel: true,
    },
    xAxis: {
      type: 'category',
      name: '迭代',
      data: labels,
      boundaryGap: false,
    },
    yAxis: {
      type: 'value',
      name: '分数',
    },
    series: [
      {
        name: '性能分数',
        type: 'line',
        data: scoreData,
        smooth: true,
        symbol: 'circle',
        symbolSize: 8,
        lineStyle: {
          width: 2,
          color: '#1890ff',
        },
        itemStyle: {
          color: '#1890ff',
        },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(24,144,255,0.3)' },
              { offset: 1, color: 'rgba(24,144,255,0.05)' },
            ],
          },
        },
      },
    ],
  };
};

// 导出报告为JSON
export const exportReportToJSON = (report: TestReport): string => {
  return JSON.stringify(
    {
      ...report,
      exportTime: new Date().toISOString(),
      version: '1.0',
    },
    null,
    2
  );
};

// 构建 Antd Tree 需要的目录树结构
function buildTree(folders: ReportFolder[], parentId: string | null = null): FolderTreeNode[] {
  return folders
    .filter((f) => f.parentId === parentId)
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
    .map((f) => ({
      key: f.id,
      title: f.name,
      data: f,
      children: buildTree(folders, f.id),
    }))
    .map((node) => (node.children && node.children.length ? node : { ...node, isLeaf: true }));
}

function buildTreeOptions(folders: ReportFolder[], parentId: string | null = null): { value: string; title: string; children?: any[] }[] {
  return folders
    .filter((f) => f.parentId === parentId)
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
    .map((f) => {
      const children = buildTreeOptions(folders, f.id);
      const option: { value: string; title: string; children?: any[] } = { value: f.id, title: f.name };
      if (children.length) option.children = children;
      return option;
    });
}

export const useTestReportStore = create<TestReportState>()(
  (set, get) => ({
    reports: [],
    folders: [],
    isLoading: false,
    selectedFolderId: null,

    fetchReports: async () => {
      set({ isLoading: true });
      try {
        const [reportsRes, foldersRes] = await Promise.all([
          fetch('/api/test/reports'),
          fetch('/api/test/report-folders'),
        ]);
        const reportsData = await reportsRes.json();
        const foldersData = await foldersRes.json();

        if (reportsData.success && Array.isArray(reportsData.reports)) {
          set({ reports: reportsData.reports });
        }
        if (foldersData.success && Array.isArray(foldersData.folders)) {
          set({ folders: foldersData.folders });
        }
      } catch (error) {
        console.error('Failed to fetch reports or folders:', error);
      } finally {
        set({ isLoading: false });
      }
    },

    fetchFolders: async () => {
      try {
        const res = await fetch('/api/test/report-folders');
        const data = await res.json();
        if (data.success && Array.isArray(data.folders)) {
          set({ folders: data.folders });
        }
      } catch (error) {
        console.error('Failed to fetch folders:', error);
      }
    },

    addReport: async (reportData) => {
      // 上报前剔除原始采样点，避免 list 模式长参数导致请求体/后端 JSON 超限
      const trimmedResults = reportData.results?.map((r: any) => {
        if (!r.monitorResults) return r;
        const monitorResults: Record<string, {
          commandId: string;
          commandName: string;
          dataPoints: Array<{ timestamp: string; value: number; raw: string }>;
          averageValue: number;
        }> = {};
        for (const [key, mr] of Object.entries(r.monitorResults as Record<string, {
          commandId: string;
          commandName: string;
          dataPoints: Array<{ timestamp: string; value: number; raw: string }>;
          averageValue: number;
        }>)) {
          monitorResults[key] = {
            commandId: mr.commandId,
            commandName: mr.commandName,
            averageValue: mr.averageValue,
            dataPoints: [],
          };
        }
        return { ...r, monitorResults };
      });

      const payload = {
        ...reportData,
        results: trimmedResults ?? reportData.results,
      };
      console.log('[testReportStore] addReport payload:', {
        name: payload.name,
        jobId: payload.jobId,
        stageId: payload.stageId,
        resultsCount: payload.results?.length,
        bodySize: (() => { try { return JSON.stringify(payload).length; } catch { return -1; } })(),
      });

      const response = await fetch('/api/test/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      console.log('[testReportStore] addReport response status:', response.status);
      const data = await response.json();
      console.log('[testReportStore] addReport response data:', data);
      if (!data.success) {
        throw new Error(data.message || '保存失败');
      }

      // 刷新列表
      await get().fetchReports();
    },

    removeReport: async (id) => {
      const response = await fetch(`/api/test/reports?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });

      const data = await response.json();
      if (!data.success) {
        throw new Error(data.message || '删除失败');
      }

      // 刷新列表
      await get().fetchReports();
    },

    updateReport: async (id, data) => {
      const response = await fetch('/api/test/reports', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...data }),
      });

      const resData = await response.json();
      if (!resData.success) {
        throw new Error(resData.message || '更新失败');
      }

      // 刷新列表
      await get().fetchReports();
    },

    updateReportCustomAvgRanges: async (id, ranges) => {
      const response = await fetch('/api/test/reports', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, customAvgRanges: ranges }),
      });

      const resData = await response.json();
      if (resData.success) {
        set((state) => ({
          reports: state.reports.map((r) =>
            r.id === id ? { ...r, ...resData.report, customAvgRanges: resData.customAvgRanges } : r
          ),
        }));
      }
      return { success: resData.success, message: resData.message };
    },

    moveReportToFolder: async (reportId, folderId) => {
      return get().updateReport(reportId, { folderId });
    },

    getReportById: (id) => {
      return get().reports.find((r) => r.id === id);
    },

    getReportsByFolder: (folderId) => {
      const reports = get().reports;
      if (!folderId) return reports;
      const folders = get().folders;
      const descendantIds = new Set([folderId]);
      const collect = (parentId: string) => {
        for (const f of folders) {
          if (f.parentId === parentId) {
            descendantIds.add(f.id);
            collect(f.id);
          }
        }
      };
      collect(folderId);
      return reports.filter((r) => {
        const id = r.folderId || DEFAULT_FOLDER_ID;
        return descendantIds.has(id);
      });
    },

    searchReports: (folderId, keyword) => {
      const reports = get().getReportsByFolder(folderId);
      if (!keyword.trim()) return reports;

      const lowerKeyword = keyword.toLowerCase();
      return reports.filter(
        (r) =>
          r.name.toLowerCase().includes(lowerKeyword) ||
          r.description?.toLowerCase().includes(lowerKeyword) ||
          r.config.host.toLowerCase().includes(lowerKeyword)
      );
    },

    exportReport: (id) => {
      const report = get().reports.find((r) => r.id === id);
      if (!report) return '';
      return exportReportToJSON(report);
    },

    createFolder: async (parentId, name) => {
      const response = await fetch('/api/test/report-folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentId, name }),
      });
      const data = await response.json();
      if (!data.success) {
        throw new Error(data.message || '创建目录失败');
      }
      await get().fetchFolders();
      return data.folder;
    },

    renameFolder: async (id, name) => {
      const response = await fetch('/api/test/report-folders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, name }),
      });
      const data = await response.json();
      if (!data.success) {
        throw new Error(data.message || '重命名目录失败');
      }
      await get().fetchFolders();
    },

    deleteFolder: async (id) => {
      const response = await fetch(`/api/test/report-folders?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      const data = await response.json();
      if (!data.success) {
        throw new Error(data.message || '删除目录失败');
      }
      await get().fetchReports();
      // 若当前选中目录被删除，重置为未分类
      set((state) => ({
        selectedFolderId: state.selectedFolderId === id ? DEFAULT_FOLDER_ID : state.selectedFolderId,
      }));
    },

    getDefaultFolderId: () => DEFAULT_FOLDER_ID,

    getFolderById: (id) => {
      return get().folders.find((f) => f.id === id);
    },

    getFolderTree: () => {
      return buildTree(get().folders, null);
    },

    getSelectedFolderId: () => {
      return get().selectedFolderId || DEFAULT_FOLDER_ID;
    },

    setSelectedFolderId: (folderId) => {
      set({ selectedFolderId: folderId });
    },

    buildFolderTreeOptions: () => {
      return buildTreeOptions(get().folders, null);
    },
  })
);
