/**
 * 分身拓扑 Store - 完全独立的 store，与原 topologyStore 隔离
 * 用于分身页面，确保不同分身之间互不干扰
 */
import { create } from 'zustand';
import {
  applyNodeChanges,
  applyEdgeChanges,
  type NodeChange,
  type EdgeChange,
} from '@xyflow/react';
import type { TopologyNode, TopologyEdge, TopologyExportData } from '../types/topology';

import {
  fetchTopology,
  saveTopology,
  fetchTopologies,
  fetchTopologyById,
  type TopologyMeta,
} from '../services/backendApi';

interface ClipboardItem {
  node: TopologyNode;
}

interface CloneTopologyState {
  // 基础状态
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  selectedNodeIds: string[];
  selectedEdgeIds: string[];
  clipboard: ClipboardItem[];
  nodeScales: Record<string, number>;
  isLoading: boolean;
  error: string | null;

  // 多拓扑管理
  topologies: TopologyMeta[];
  currentTopologyId: string | null;
  isLoadingTopologies: boolean;

  // 详情面板状态
  selectedNodeId: string | null;
  overviewOpen: boolean;

  // 操作方法
  onNodesChange: (changes: NodeChange<TopologyNode>[]) => void;
  onEdgesChange: (changes: EdgeChange<TopologyEdge>[]) => void;
  updateNodes: (nodes: TopologyNode[]) => void;
  updateEdges: (edges: TopologyEdge[]) => void;
  setSelectedNodeIds: (ids: string[]) => void;
  setSelectedEdgeIds: (ids: string[]) => void;
  setNodeScale: (nodeId: string, scale: number) => void;

  // 详情面板
  setSelectedNodeId: (id: string | null) => void;
  setOverviewOpen: (open: boolean) => void;
  toggleOverview: () => void;

  // 导入导出
  exportTopology: () => TopologyExportData;
  importTopology: (data: TopologyExportData) => Promise<boolean>;

  // 后端持久化
  loadFromBackend: () => Promise<void>;
  saveToBackend: () => Promise<boolean>;

  // 多拓扑管理
  loadTopologiesList: () => Promise<void>;
  switchTopology: (id: string) => Promise<boolean>;

  // 控制类操作
  updateFanSpeed: (nodeId: string, speed: number) => Promise<void>;
  updateSourceVoltage: (nodeId: string, voltage: number) => Promise<void>;
  updateNodeAlias: (nodeId: string, alias: string) => void;
}

/** 从 localStorage 加载分身选择的拓扑ID - 使用独立的 key */
export function loadCloneTopologyId(): string | null {
  try {
    const saved = localStorage.getItem('blue_sky_clone_topology_id');
    return saved || null;
  } catch {
    return null;
  }
}

/** 保存分身选择的拓扑ID到 localStorage */
function saveCloneTopologyId(id: string | null): void {
  try {
    if (id) {
      localStorage.setItem('blue_sky_clone_topology_id', id);
    } else {
      localStorage.removeItem('blue_sky_clone_topology_id');
    }
  } catch {
    // ignore
  }
}

export const useCloneTopologyStore = create<CloneTopologyState>((set, get) => ({
  nodes: [],
  edges: [],
  selectedNodeIds: [],
  selectedEdgeIds: [],
  clipboard: [],
  nodeScales: {},
  isLoading: false,
  error: null,

  // 多拓扑管理初始状态
  topologies: [],
  currentTopologyId: loadCloneTopologyId(),
  isLoadingTopologies: false,

  // 详情面板状态
  selectedNodeId: null,
  overviewOpen: false,

  onNodesChange: (changes) => {
    set({ nodes: applyNodeChanges(changes, get().nodes) });
  },

  onEdgesChange: (changes) => {
    set({ edges: applyEdgeChanges(changes, get().edges) });
  },

  updateNodes: (nodes) => set({ nodes }),
  updateEdges: (edges) => set({ edges }),

  setSelectedNodeIds: (ids) => set({ selectedNodeIds: ids }),
  setSelectedEdgeIds: (ids) => set({ selectedEdgeIds: ids }),

  setNodeScale: (nodeId, scale) => {
    set({ nodeScales: { ...get().nodeScales, [nodeId]: scale } });
  },

  // 详情面板
  setSelectedNodeId: (id) => set({ selectedNodeId: id }),
  setOverviewOpen: (open) => set({ overviewOpen: open }),
  toggleOverview: () => set((state) => ({ overviewOpen: !state.overviewOpen })),

  exportTopology: () => {
    const { nodes, edges, nodeScales } = get();
    return {
      version: '1.0.0',
      exportTime: new Date().toISOString(),
      nodes,
      edges,
      nodeScales,
    };
  },

  importTopology: async (data) => {
    if (!data || !Array.isArray(data.nodes) || !Array.isArray(data.edges)) {
      return false;
    }
    set({
      nodes: data.nodes,
      edges: data.edges,
      nodeScales: data.nodeScales || {},
      selectedNodeIds: [],
      clipboard: [],
    });
    return await get().saveToBackend();
  },

  /** 从后端加载拓扑 */
  loadFromBackend: async () => {
    const { currentTopologyId, topologies } = get();
    set({ isLoading: true, error: null });
    try {
      // 确保使用明确的拓扑ID，不依赖后端全局状态
      let topologyId = currentTopologyId;
      if (!topologyId && topologies.length > 0) {
        // 如果没有当前拓扑，使用默认拓扑
        const defaultTopology = topologies.find(t => t.isDefault);
        topologyId = defaultTopology?.id ?? null;
      }
      // 如果没有拓扑ID，不调用API
      if (!topologyId) {
        set({ isLoading: false });
        return;
      }
      const data = await fetchTopology(topologyId);
      if (data) {
        set({
          nodes: data.nodes,
          edges: data.edges,
          nodeScales: data.nodeScales || {},
        });
      }
    } catch (err) {
      set({ error: (err as Error).message });
    } finally {
      set({ isLoading: false });
    }
  },

  /** 保存拓扑到后端 */
  saveToBackend: async () => {
    const { currentTopologyId, exportTopology } = get();
    const data = exportTopology();
    return await saveTopology(data, currentTopologyId);
  },

  /** 加载拓扑列表 */
  loadTopologiesList: async () => {
    set({ isLoadingTopologies: true });
    try {
      const result = await fetchTopologies();
      if (result) {
        set({ topologies: result.topologies });
      }
    } catch (err) {
      console.error('Failed to load topologies list:', err);
    } finally {
      set({ isLoadingTopologies: false });
    }
  },

  /** 切换拓扑 - 独立于原页面 */
  switchTopology: async (id) => {
    try {
      const result = await fetchTopologyById(id);
      if (result) {
        // 保存分身选择到独立的 localStorage key
        saveCloneTopologyId(id);

        set({
          nodes: result.nodes,
          edges: result.edges,
          nodeScales: result.nodeScales || {},
          currentTopologyId: id,
          selectedNodeIds: [],
          selectedEdgeIds: [],
          clipboard: [],
          selectedNodeId: null,
        });
        return true;
      }
      return false;
    } catch (err) {
      console.error('Switch topology failed:', err);
      set({ error: (err as Error).message });
      return false;
    }
  },

  /** 风扇速度控制 - 仅本地更新，不发送后端命令 */
  updateFanSpeed: async (nodeId, speed) => {
    const { nodes } = get();
    set({
      nodes: nodes.map(n =>
        n.id === nodeId && 'fanData' in n.data && n.data.fanData
          ? { ...n, data: { ...n.data, fanData: { ...n.data.fanData, speedPercent: speed } } }
          : n
      ),
    });
    // 分身页面只更新本地状态，不实际发送控制命令
  },

  /** 电压控制 - 仅本地更新 */
  updateSourceVoltage: async (nodeId, voltage) => {
    const { nodes } = get();
    set({
      nodes: nodes.map(n =>
        n.id === nodeId && 'sourceData' in n.data && n.data.sourceData
          ? { ...n, data: { ...n.data, sourceData: { ...n.data.sourceData, outputVoltage: voltage } } }
          : n
      ),
    });
    // 分身页面只更新本地状态，不实际发送控制命令
  },

  /** 更新节点显示别名 - 仅本地更新 */
  updateNodeAlias: (nodeId, alias) => {
    const { nodes } = get();
    set({
      nodes: nodes.map(n =>
        n.id === nodeId
          ? { ...n, data: { ...n.data, displayAlias: alias || undefined } }
          : n
      ),
    });
  },
}));

/** 初始化分身 store */
export const initCloneStore = async () => {
  const store = useCloneTopologyStore.getState();

  // 先加载拓扑列表
  await store.loadTopologiesList();

  // 重新获取最新状态
  const { currentTopologyId } = useCloneTopologyStore.getState();
  let { topologies } = useCloneTopologyStore.getState();

  // 如果拓扑列表为空，可能是第一次加载，等待一下再试
  if (topologies.length === 0) {
    await new Promise(resolve => setTimeout(resolve, 100));
    topologies = useCloneTopologyStore.getState().topologies;
  }

  if (currentTopologyId) {
    // 验证分身选择的拓扑是否仍然存在
    const exists = topologies.some(t => t.id === currentTopologyId);
    if (exists) {
      await store.switchTopology(currentTopologyId);
    } else {
      // 拓扑不存在了，清除分身选择
      saveCloneTopologyId(null);
      // 加载默认拓扑
      const defaultTopology = topologies.find(t => t.isDefault);
      if (defaultTopology) {
        await store.switchTopology(defaultTopology.id);
      }
    }
  } else {
    // 分身没有选择，加载默认拓扑
    const defaultTopology = topologies.find(t => t.isDefault);
    if (defaultTopology) {
      await store.switchTopology(defaultTopology.id);
    }
  }
};
