/** 拓扑图状态管理 - 支持每个拓扑独立BMC配置和用户级拓扑选择 */
import { create } from 'zustand';
import {
  applyNodeChanges,
  applyEdgeChanges,
  type NodeChange,
  type EdgeChange,
  type Connection,
} from '@xyflow/react';
import type { TopologyNode, TopologyEdge, HardwareNodeType, ApiConfig, TopologyExportData, EdgeArrowType } from '../types/topology';
import { createDefaultNodeData } from '../services/mockData';
import {
  fetchTopology,
  saveTopology,
  saveVersion as saveVersionToBackend,
  fetchVersions,
  rollbackToVersion as rollbackToVersionBackend,
  updateVersionMeta as updateVersionMetaBackend,
  deleteVersion as deleteVersionBackend,
  clearVersions as clearVersionsBackend,
  resetTopology as resetTopologyBackend,
  fetchTopologies,
  createTopology as createTopologyBackend,
  updateTopology as updateTopologyBackend,
  deleteTopology as deleteTopologyBackend,
  fetchTopologyById,
  type TopologyVersion,
  type TopologyMeta,
} from '../services/backendApi';
import { useMonitorStore } from './monitorStore';

interface ClipboardItem {
  node: TopologyNode;
}

interface TopologyState {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  selectedNodeIds: string[];
  clipboard: ClipboardItem[];
  nodeScales: Record<string, number>;
  isLoading: boolean;
  error: string | null;

  // 多拓扑管理
  topologies: TopologyMeta[];
  currentTopologyId: string | null;
  isLoadingTopologies: boolean;

  // 节点/边变更
  onNodesChange: (changes: NodeChange<TopologyNode>[]) => void;
  onEdgesChange: (changes: EdgeChange<TopologyEdge>[]) => void;

  // 批量更新数据
  updateNodes: (nodes: TopologyNode[]) => void;
  updateEdges: (edges: TopologyEdge[]) => void;

  // 选中
  setSelectedNodeIds: (ids: string[]) => void;
  selectedEdgeIds: string[];
  setSelectedEdgeIds: (ids: string[]) => void;

  // 剪贴板
  copySelectedNodes: () => void;
  pasteNodes: () => Promise<void>;
  deleteSelectedNodes: () => Promise<void>;
  deleteSelectedEdges: () => Promise<void>;

  // 节点缩放
  setNodeScale: (nodeId: string, scale: number) => void;

  // 设计模式操作
  addNode: (type: HardwareNodeType, position: { x: number; y: number }) => Promise<void>;
  addEdge: (connection: Connection) => Promise<void>;
  removeNode: (id: string) => Promise<void>;
  removeEdge: (id: string) => Promise<void>;
  updateEdgeLabel: (edgeId: string, label: string | undefined) => Promise<void>;
  updateEdgeArrowType: (edgeId: string, arrowType: EdgeArrowType) => Promise<void>;
  updateEdgeBendOffset: (edgeId: string, bendOffset: number) => Promise<void>;
  updateNodeIcon: (nodeId: string, iconName: string) => Promise<void>;

  // 别名 & 自定义图标 & API配置
  updateNodeAlias: (nodeId: string, alias: string) => Promise<void>;
  updateNodeCustomIconUrl: (nodeId: string, url: string | undefined) => Promise<void>;
  updateNodeApiConfig: (nodeId: string, config: ApiConfig) => Promise<void>;

  // 控制类操作（发送到后端执行）
  updateFanSpeed: (nodeId: string, speed: number) => Promise<void>;
  updateSourceVoltage: (nodeId: string, voltage: number) => Promise<void>;
  updateNodeControlRange: (nodeId: string, range: { min: number; max: number } | undefined) => Promise<void>;

  // 导入导出
  exportTopology: () => TopologyExportData;
  importTopology: (data: TopologyExportData) => Promise<boolean>;

  // 后端持久化 & 版本管理
  loadFromBackend: () => Promise<void>;
  saveToBackend: () => Promise<boolean>;
  saveManual: (label?: string) => Promise<void>;
  getVersions: () => Promise<TopologyVersion[]>;
  rollbackToVersion: (versionId: string) => Promise<boolean>;
  updateVersionMeta: (versionId: string, label: string, notes?: string) => Promise<boolean>;
  deleteVersion: (versionId: string) => Promise<void>;
  clearVersionHistory: () => Promise<void>;

  // 重置
  resetToDefault: () => Promise<void>;

  // 多拓扑管理方法
  loadTopologiesList: () => Promise<void>;
  createTopology: (name: string, description?: string, copyFromCurrent?: boolean) => Promise<boolean>;
  renameTopology: (id: string, newName: string, newDescription?: string) => Promise<boolean>;
  deleteTopology: (id: string) => Promise<boolean>;
  switchTopology: (id: string) => Promise<boolean>;
}

/** 从 localStorage 加载用户选择的拓扑ID */
function loadUserTopologyId(): string | null {
  try {
    const saved = localStorage.getItem('blue_sky_user_topology_id');
    return saved || null;
  } catch {
    return null;
  }
}

/** 保存用户选择的拓扑ID到 localStorage */
function saveUserTopologyId(id: string | null): void {
  try {
    if (id) {
      localStorage.setItem('blue_sky_user_topology_id', id);
    } else {
      localStorage.removeItem('blue_sky_user_topology_id');
    }
  } catch {
    // ignore
  }
}

let nodeCounter = 0;

export const useTopologyStore = create<TopologyState>((set, get) => ({
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
  currentTopologyId: loadUserTopologyId(),
  isLoadingTopologies: false,

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

  copySelectedNodes: () => {
    const { nodes, selectedNodeIds } = get();
    const selected = nodes.filter(n => selectedNodeIds.includes(n.id));
    set({ clipboard: selected.map(node => ({ node: { ...node } })) });
  },

  pasteNodes: async () => {
    const { clipboard, nodes } = get();
    if (clipboard.length === 0) return;
    
    const newNodes = clipboard.map(item => {
      const id = `${item.node.id}-copy-${Date.now()}`;
      return {
        ...item.node,
        id,
        position: {
          x: item.node.position.x + 50,
          y: item.node.position.y + 50,
        },
        selected: false,
      };
    });
    
    set({ nodes: [...nodes, ...newNodes] });
    await get().saveToBackend();
  },

  deleteSelectedNodes: async () => {
    const { nodes, edges, selectedNodeIds } = get();
    set({
      nodes: nodes.filter(n => !selectedNodeIds.includes(n.id)),
      edges: edges.filter(e =>
        !selectedNodeIds.includes(e.source) && !selectedNodeIds.includes(e.target)
      ),
      selectedNodeIds: [],
    });
    await get().saveToBackend();
  },

  deleteSelectedEdges: async () => {
    const { edges, selectedEdgeIds } = get();
    set({
      edges: edges.filter(e => !selectedEdgeIds.includes(e.id)),
      selectedEdgeIds: [],
    });
    await get().saveToBackend();
  },

  setNodeScale: (nodeId, scale) => {
    set({ nodeScales: { ...get().nodeScales, [nodeId]: scale } });
  },

  addNode: async (type, position) => {
    const { nodes } = get();
    nodeCounter++;
    const id = `${type}-new-${Date.now()}-${nodeCounter}`;
    const data = createDefaultNodeData(type);
    const newNode: TopologyNode = {
      id,
      type,
      position,
      data,
    };
    set({ nodes: [...nodes, newNode] });
    await get().saveToBackend();
  },

  addEdge: async (connection) => {
    const { edges } = get();
    const id = `e-${connection.source}-${connection.target}-${Date.now()}`;
    const newEdge: TopologyEdge = {
      id,
      source: connection.source!,
      target: connection.target!,
      sourceHandle: connection.sourceHandle ?? undefined,
      targetHandle: connection.targetHandle ?? undefined,
      type: 'powerEdge',
      data: { loss: 0, lossPercent: 0, animated: true },
    };
    set({ edges: [...edges, newEdge] });
    await get().saveToBackend();
  },

  removeNode: async (id) => {
    const { nodes, edges } = get();
    set({
      nodes: nodes.filter(n => n.id !== id),
      edges: edges.filter(e => e.source !== id && e.target !== id),
    });
    await get().saveToBackend();
  },

  removeEdge: async (id) => {
    const { edges } = get();
    set({ edges: edges.filter(e => e.id !== id) });
    await get().saveToBackend();
  },

  updateEdgeLabel: async (edgeId, label) => {
    const { edges } = get();
    set({
      edges: edges.map(e =>
        e.id === edgeId ? { ...e, data: { ...e.data!, label } } : e
      ),
    });
    await get().saveToBackend();
  },

  updateEdgeArrowType: async (edgeId, arrowType) => {
    const { edges } = get();
    set({
      edges: edges.map(e =>
        e.id === edgeId ? { ...e, data: { ...e.data!, arrowType } } : e
      ),
    });
    await get().saveToBackend();
  },

  updateEdgeBendOffset: async (edgeId, bendOffset) => {
    const { edges } = get();
    set({
      edges: edges.map(e =>
        e.id === edgeId ? { ...e, data: { ...e.data!, bendOffset } } : e
      ),
    });
    await get().saveToBackend();
  },

  updateNodeIcon: async (nodeId, iconName) => {
    const { nodes } = get();
    set({
      nodes: nodes.map(n =>
        n.id === nodeId
          ? { ...n, data: { ...n.data, customIcon: iconName } }
          : n
      ),
    });
    await get().saveToBackend();
  },

  updateNodeAlias: async (nodeId, alias) => {
    const { nodes } = get();
    set({
      nodes: nodes.map(n =>
        n.id === nodeId
          ? { ...n, data: { ...n.data, displayAlias: alias || undefined } }
          : n
      ),
    });
    await get().saveToBackend();
  },

  updateNodeCustomIconUrl: async (nodeId, url) => {
    const { nodes } = get();
    set({
      nodes: nodes.map(n =>
        n.id === nodeId
          ? { ...n, data: { ...n.data, customIconUrl: url } }
          : n
      ),
    });
    await get().saveToBackend();
  },

  updateNodeApiConfig: async (nodeId, config) => {
    const { nodes } = get();
    set({
      nodes: nodes.map(n =>
        n.id === nodeId
          ? { ...n, data: { ...n.data, apiConfig: config } }
          : n
      ),
    });
    await get().saveToBackend();
  },

  updateFanSpeed: async (nodeId, speed) => {
    const { nodes } = get();
    set({
      nodes: nodes.map(n =>
        n.id === nodeId && 'fanData' in n.data && n.data.fanData
          ? { ...n, data: { ...n.data, fanData: { ...n.data.fanData, speedPercent: speed } } }
          : n
      ),
    });
    
    await get().saveToBackend();
  },

  updateSourceVoltage: async (nodeId, voltage) => {
    const { nodes } = get();
    set({
      nodes: nodes.map(n =>
        n.id === nodeId && 'sourceData' in n.data && n.data.sourceData
          ? { ...n, data: { ...n.data, sourceData: { ...n.data.sourceData, outputVoltage: voltage } } }
          : n
      ),
    });
    
    await get().saveToBackend();
  },

  updateNodeControlRange: async (nodeId, range) => {
    const { nodes } = get();
    set({
      nodes: nodes.map(n =>
        n.id === nodeId
          ? { ...n, data: { ...n.data, controlRange: range } }
          : n
      ),
    });
    await get().saveToBackend();
  },

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

  /** 从后端加载拓扑 - 使用用户本地存储的currentTopologyId */
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

  /** 手动保存版本 */
  saveManual: async (label?: string) => {
    const { currentTopologyId, exportTopology } = get();
    const data = exportTopology();
    await saveTopology(data, currentTopologyId);
    await saveVersionToBackend(data, label || '手动保存', currentTopologyId);
  },

  /** 获取版本列表 */
  getVersions: async () => {
    const { currentTopologyId } = get();
    return await fetchVersions(currentTopologyId);
  },

  /** 回滚到指定版本 */
  rollbackToVersion: async (versionId) => {
    const { currentTopologyId } = get();
    const success = await rollbackToVersionBackend(versionId, currentTopologyId);
    if (success) {
      await get().loadFromBackend();
    }
    return success;
  },

  /** 更新版本元数据 */
  updateVersionMeta: async (versionId, label, notes) => {
    const { currentTopologyId } = get();
    return await updateVersionMetaBackend(versionId, label, notes, currentTopologyId);
  },

  /** 删除版本 */
  deleteVersion: async (versionId) => {
    const { currentTopologyId } = get();
    await deleteVersionBackend(versionId, currentTopologyId);
  },

  /** 清空版本历史 */
  clearVersionHistory: async () => {
    const { currentTopologyId } = get();
    await clearVersionsBackend(currentTopologyId);
  },

  /** 重置为默认拓扑 */
  resetToDefault: async () => {
    const { currentTopologyId } = get();
    await resetTopologyBackend(currentTopologyId);
    await get().loadFromBackend();
  },

  // ==================== 多拓扑管理方法 ====================

  /** 加载拓扑列表 */
  loadTopologiesList: async () => {
    set({ isLoadingTopologies: true });
    try {
      const result = await fetchTopologies();
      if (result) {
        set({
          topologies: result.topologies,
          // 不再使用后端返回的currentId，而是使用用户本地存储的
        });
      }
    } catch (err) {
      console.error('Failed to load topologies list:', err);
    } finally {
      set({ isLoadingTopologies: false });
    }
  },

  /** 创建新拓扑 */
  createTopology: async (name, description, copyFromCurrent = false) => {
    try {
      const { currentTopologyId } = get();
      const meta = await createTopologyBackend(
        name,
        description,
        copyFromCurrent ? currentTopologyId || undefined : undefined
      );
      if (meta) {
        await get().loadTopologiesList();
        return true;
      }
      return false;
    } catch (err) {
      console.error('Create topology failed:', err);
      set({ error: (err as Error).message });
      return false;
    }
  },

  /** 重命名拓扑 */
  renameTopology: async (id, newName, newDescription) => {
    try {
      const success = await updateTopologyBackend(id, newName, newDescription);
      if (success) {
        await get().loadTopologiesList();
      }
      return success;
    } catch (err) {
      console.error('Rename topology failed:', err);
      set({ error: (err as Error).message });
      return false;
    }
  },

  /** 删除拓扑 */
  deleteTopology: async (id) => {
    try {
      const { currentTopologyId } = get();
      const success = await deleteTopologyBackend(id);
      if (success) {
        // 如果删除的是当前选中的拓扑，清除用户选择
        if (id === currentTopologyId) {
          saveUserTopologyId(null);
          set({ currentTopologyId: null, nodes: [], edges: [] });
        }
        await get().loadTopologiesList();
      }
      return success;
    } catch (err) {
      console.error('Delete topology failed:', err);
      set({ error: (err as Error).message });
      return false;
    }
  },

  /** 切换拓扑 - 用户级，只影响当前用户 */
  switchTopology: async (id) => {
    try {
      // 检查监控状态
      const monitorState = useMonitorStore.getState();
      if (monitorState.isPolling) {
        set({ error: '请先关闭实时监控再切换拓扑' });
        return false;
      }

      const result = await fetchTopologyById(id);
      if (result) {
        // 保存用户选择到 localStorage
        saveUserTopologyId(id);
        
        set({
          nodes: result.nodes,
          edges: result.edges,
          nodeScales: result.nodeScales || {},
          currentTopologyId: id,
          selectedNodeIds: [],
          clipboard: [],
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
}));

// 页面加载时自动从后端加载拓扑列表和用户选择的拓扑
if (typeof window !== 'undefined') {
  const initStore = async () => {
    const store = useTopologyStore.getState();
    
    // 先加载拓扑列表
    await store.loadTopologiesList();
    
    // 重新获取最新状态（避免闭包问题）
    let { topologies } = useTopologyStore.getState();
    const { currentTopologyId } = useTopologyStore.getState();
    
    // 如果拓扑列表为空，可能是第一次加载，等待一下再试
    if (topologies.length === 0) {
      await new Promise(resolve => setTimeout(resolve, 100));
      topologies = useTopologyStore.getState().topologies;
    }
    
    // 确定要加载的拓扑ID
    let topologyIdToLoad: string | null = currentTopologyId;
    
    if (topologyIdToLoad) {
      // 验证用户选择的拓扑是否仍然存在
      const exists = topologies.some(t => t.id === topologyIdToLoad);
      if (!exists) {
        // 拓扑不存在了，清除用户选择，使用默认拓扑
        saveUserTopologyId(null);
        topologyIdToLoad = null;
      }
    }
    
    // 如果没有指定拓扑，使用默认拓扑
    if (!topologyIdToLoad) {
      const defaultTopology = topologies.find(t => t.isDefault);
      if (defaultTopology) {
        topologyIdToLoad = defaultTopology.id;
        saveUserTopologyId(topologyIdToLoad);
      }
    }
    
    // 加载拓扑数据（直接使用 fetch，绕过 switchTopology 的监控检查）
    if (topologyIdToLoad) {
      useTopologyStore.setState({ isLoading: true, error: null, currentTopologyId: topologyIdToLoad });
      try {
        const data = await fetchTopology(topologyIdToLoad);
        
        if (data) {
          useTopologyStore.setState({
            nodes: data.nodes,
            edges: data.edges,
            nodeScales: data.nodeScales || {},
            selectedNodeIds: [],
            clipboard: [],
          });
        }
      } catch (err) {
        useTopologyStore.setState({ error: (err as Error).message });
      } finally {
        useTopologyStore.setState({ isLoading: false });
      }
    }
  };
  
  initStore();
}
