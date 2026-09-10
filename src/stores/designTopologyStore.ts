/**
 * 拓扑设计 Store - 独立的草稿状态管理
 * 设计界面的修改只保存在此 store 中，不会直接影响监控界面
 * 只有点击保存时，才会将草稿同步到 topologyStore 并持久化
 */
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
  saveAutoVersion as saveAutoVersionToBackend,
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
import { useTopologyStore } from './topologyStore';

interface ClipboardItem {
  node: TopologyNode;
}

interface DesignTopologyState {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  selectedNodeIds: string[];
  selectedEdgeIds: string[];
  clipboard: ClipboardItem[];
  nodeScales: Record<string, number>;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  hasUnsavedChanges: boolean; // 是否有未保存的更改

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
  setSelectedEdgeIds: (ids: string[]) => void;

  // 剪贴板
  copySelectedNodes: () => void;
  pasteNodes: () => void;
  deleteSelectedNodes: () => void;
  deleteSelectedEdges: () => void;

  // 节点缩放
  setNodeScale: (nodeId: string, scale: number) => void;

  // 设计模式操作
  addNode: (type: HardwareNodeType, position: { x: number; y: number }) => void;
  addEdge: (connection: Connection) => void;
  removeNode: (id: string) => void;
  removeEdge: (id: string) => void;
  updateEdgeLabel: (edgeId: string, label: string | undefined) => void;
  updateEdgeArrowType: (edgeId: string, arrowType: EdgeArrowType) => void;
  updateEdgeBendOffset: (edgeId: string, bendOffset: number) => void;
  reverseEdge: (edgeId: string) => void;
  updateNodeIcon: (nodeId: string, iconName: string) => void;

  // 别名 & 自定义图标 & API配置
  updateNodeAlias: (nodeId: string, alias: string) => void;
  updateNodeCustomIconUrl: (nodeId: string, url: string | undefined) => void;
  updateNodeApiConfig: (nodeId: string, config: ApiConfig) => void;
  updateNodeFieldMappings: (nodeId: string, mappings: import('../types/topology').FieldMapping[]) => void;

  // 导入导出
  exportTopology: () => TopologyExportData;
  importTopology: (data: TopologyExportData) => void;

  // 后端持久化 & 版本管理
  loadFromBackend: () => Promise<void>;
  
  /** 保存拓扑：将草稿同步到 topologyStore 并持久化到后端 */
  saveToBackend: () => Promise<boolean>;
  
  /** 手动保存版本 */
  saveManual: (label?: string) => Promise<void>;
  
  /** 自动保存版本（覆盖最新版本） */
  autoSaveVersion: () => Promise<boolean>;
  
  getVersions: () => Promise<TopologyVersion[]>;
  rollbackToVersion: (versionId: string) => Promise<boolean>;
  updateVersionMeta: (versionId: string, label: string, notes?: string) => Promise<boolean>;
  deleteVersion: (versionId: string) => Promise<void>;
  clearVersionHistory: () => Promise<void>;

  // 重置
  resetToDefault: () => Promise<void>;
  discardChanges: () => Promise<void>; // 放弃更改，重新加载

  // 多拓扑管理方法
  loadTopologiesList: () => Promise<void>;
  createTopology: (name: string, description?: string, copyFromCurrent?: boolean) => Promise<boolean>;
  renameTopology: (id: string, newName: string, newDescription?: string) => Promise<boolean>;
  deleteTopology: (id: string) => Promise<boolean>;
  switchTopology: (id: string) => Promise<boolean>;
}

let nodeCounter = 0;

export const useDesignTopologyStore = create<DesignTopologyState>((set, get) => ({
  nodes: [],
  edges: [],
  selectedNodeIds: [],
  selectedEdgeIds: [],
  clipboard: [],
  nodeScales: {},
  isLoading: false,
  isSaving: false,
  error: null,
  hasUnsavedChanges: false,

  // 多拓扑管理初始状态
  topologies: [],
  currentTopologyId: null,
  isLoadingTopologies: false,

  onNodesChange: (changes) => {
    set({ 
      nodes: applyNodeChanges(changes, get().nodes),
      hasUnsavedChanges: true 
    });
  },

  onEdgesChange: (changes) => {
    set({ 
      edges: applyEdgeChanges(changes, get().edges),
      hasUnsavedChanges: true 
    });
  },

  updateNodes: (nodes) => set({ nodes, hasUnsavedChanges: true }),
  updateEdges: (edges) => set({ edges, hasUnsavedChanges: true }),

  setSelectedNodeIds: (ids) => set({ selectedNodeIds: ids }),
  setSelectedEdgeIds: (ids) => set({ selectedEdgeIds: ids }),

  copySelectedNodes: () => {
    const { nodes, selectedNodeIds } = get();
    const selected = nodes.filter(n => selectedNodeIds.includes(n.id));
    set({ clipboard: selected.map(node => ({ node: { ...node } })) });
  },

  pasteNodes: () => {
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
    
    set({ 
      nodes: [...nodes, ...newNodes],
      hasUnsavedChanges: true 
    });
  },

  deleteSelectedNodes: () => {
    const { nodes, edges, selectedNodeIds } = get();
    set({
      nodes: nodes.filter(n => !selectedNodeIds.includes(n.id)),
      edges: edges.filter(e =>
        !selectedNodeIds.includes(e.source) && !selectedNodeIds.includes(e.target)
      ),
      selectedNodeIds: [],
      hasUnsavedChanges: true,
    });
  },

  deleteSelectedEdges: () => {
    const { edges, selectedEdgeIds } = get();
    set({
      edges: edges.filter(e => !selectedEdgeIds.includes(e.id)),
      selectedEdgeIds: [],
      hasUnsavedChanges: true,
    });
  },

  setNodeScale: (nodeId, scale) => {
    set({ 
      nodeScales: { ...get().nodeScales, [nodeId]: scale },
      hasUnsavedChanges: true 
    });
  },

  addNode: (type, position) => {
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
    set({ 
      nodes: [...nodes, newNode],
      hasUnsavedChanges: true 
    });
  },

  addEdge: (connection) => {
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
    set({ 
      edges: [...edges, newEdge],
      hasUnsavedChanges: true 
    });
  },

  removeNode: (id) => {
    const { nodes, edges } = get();
    set({
      nodes: nodes.filter(n => n.id !== id),
      edges: edges.filter(e => e.source !== id && e.target !== id),
      hasUnsavedChanges: true,
    });
  },

  removeEdge: (id) => {
    const { edges } = get();
    set({ 
      edges: edges.filter(e => e.id !== id),
      hasUnsavedChanges: true 
    });
  },

  updateEdgeLabel: (edgeId, label) => {
    const { edges } = get();
    set({
      edges: edges.map(e =>
        e.id === edgeId ? { ...e, data: { ...e.data!, label } } : e
      ),
      hasUnsavedChanges: true,
    });
  },

  updateEdgeArrowType: (edgeId, arrowType) => {
    const { edges } = get();
    set({
      edges: edges.map(e =>
        e.id === edgeId ? { ...e, data: { ...e.data!, arrowType } } : e
      ),
      hasUnsavedChanges: true,
    });
  },

  updateEdgeBendOffset: (edgeId, bendOffset) => {
    const { edges } = get();
    set({
      edges: edges.map(e =>
        e.id === edgeId ? { ...e, data: { ...e.data!, bendOffset } } : e
      ),
      hasUnsavedChanges: true,
    });
  },

  reverseEdge: (edgeId) => {
    const { edges } = get();
    const edge = edges.find(e => e.id === edgeId);
    if (!edge) return;
    
    // 最简单的翻转：只改变箭头方向，完全不改变连线路径
    // source/target/handle 都不变，只是视觉上反转箭头
    const currentData = edge.data || { loss: 0, lossPercent: 0 };
    
    const newEdge: TopologyEdge = {
      ...edge,
      data: {
        loss: currentData.loss ?? 0,
        lossPercent: currentData.lossPercent ?? 0,
        animated: currentData.animated,
        arrowType: currentData.arrowType,
        label: currentData.label,
        customData: currentData.customData,
        _mode: currentData._mode,
        // _reversed 为 true 表示箭头方向反转
        _reversed: !(currentData as unknown as Record<string, unknown>)?._reversed,
      },
    };
    
    set({
      edges: edges.map(e => e.id === edgeId ? newEdge : e),
      hasUnsavedChanges: true,
    });
  },

  updateNodeIcon: (nodeId, iconName) => {
    const { nodes } = get();
    set({
      nodes: nodes.map(n =>
        n.id === nodeId
          ? { ...n, data: { ...n.data, customIcon: iconName } }
          : n
      ),
      hasUnsavedChanges: true,
    });
  },

  updateNodeAlias: (nodeId, alias) => {
    const { nodes } = get();
    set({
      nodes: nodes.map(n =>
        n.id === nodeId
          ? { ...n, data: { ...n.data, displayAlias: alias || undefined } }
          : n
      ),
      hasUnsavedChanges: true,
    });
  },

  updateNodeCustomIconUrl: (nodeId, url) => {
    const { nodes } = get();
    set({
      nodes: nodes.map(n =>
        n.id === nodeId
          ? { ...n, data: { ...n.data, customIconUrl: url } }
          : n
      ),
      hasUnsavedChanges: true,
    });
  },

  updateNodeApiConfig: (nodeId, config) => {
    const { nodes } = get();
    set({
      nodes: nodes.map(n =>
        n.id === nodeId
          ? { ...n, data: { ...n.data, apiConfig: config } }
          : n
      ),
      hasUnsavedChanges: true,
    });
  },

  updateNodeFieldMappings: (nodeId, mappings) => {
    const { nodes } = get();
    set({
      nodes: nodes.map(n =>
        n.id === nodeId
          ? { ...n, data: { ...n.data, apiConfig: { ...n.data.apiConfig, fieldMappings: mappings } } }
          : n
      ),
      hasUnsavedChanges: true,
    });
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

  importTopology: (data) => {
    if (!data || !Array.isArray(data.nodes) || !Array.isArray(data.edges)) {
      return;
    }
    set({
      nodes: data.nodes,
      edges: data.edges,
      nodeScales: data.nodeScales || {},
      selectedNodeIds: [],
      clipboard: [],
      hasUnsavedChanges: true,
    });
  },

  /** 从后端加载拓扑到设计草稿 */
  loadFromBackend: async () => {
    const { currentTopologyId, topologies } = get();
    set({ isLoading: true, error: null });
    try {
      let topologyId = currentTopologyId;
      if (!topologyId && topologies.length > 0) {
        const defaultTopology = topologies.find(t => t.isDefault);
        topologyId = defaultTopology?.id ?? null;
      }
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
          currentTopologyId: topologyId,
          hasUnsavedChanges: false,
        });
      }
    } catch (err) {
      set({ error: (err as Error).message });
    } finally {
      set({ isLoading: false });
    }
  },

  /** 
   * 保存拓扑：将草稿同步到 topologyStore 并持久化到后端
   * 这是设计界面保存时调用的方法
   */
  saveToBackend: async () => {
    const { currentTopologyId, exportTopology } = get();
    set({ isSaving: true });
    
    try {
      const data = exportTopology();
      
      // 1. 先保存到后端
      const success = await saveTopology(data, currentTopologyId);
      
      if (success && currentTopologyId) {
        // 2. 同步到主 topologyStore（这样监控界面能看到更新）
        const mainStore = useTopologyStore.getState();
        mainStore.updateNodes(data.nodes);
        mainStore.updateEdges(data.edges);
        
        // 3. 标记为已保存
        set({ hasUnsavedChanges: false });
        
        console.log('[DesignStore] Topology saved and synced to main store');
      }
      
      return success;
    } catch (err) {
      console.error('Save topology failed:', err);
      set({ error: (err as Error).message });
      return false;
    } finally {
      set({ isSaving: false });
    }
  },

  /** 手动保存版本 */
  saveManual: async (label?: string) => {
    const { currentTopologyId, exportTopology, saveToBackend } = get();
    
    // 先保存当前拓扑
    await saveToBackend();
    
    // 然后创建版本
    const data = exportTopology();
    await saveVersionToBackend(data, label || '手动保存', currentTopologyId);
  },
  
  /** 自动保存版本（覆盖最新版本） */
  autoSaveVersion: async () => {
    const { currentTopologyId, exportTopology, saveToBackend } = get();
    
    // 先保存当前拓扑结构
    const success = await saveToBackend();
    if (!success || !currentTopologyId) {
      console.warn('[DesignStore] Auto save skipped: topology save failed or no current topology');
      return false;
    }
    
    // 然后覆盖最新版本
    const data = exportTopology();
    const result = await saveAutoVersionToBackend(data, currentTopologyId);
    if (result) {
      console.log('[DesignStore] Auto saved version for topology:', currentTopologyId);
    }
    return result;
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
      // 回滚后也要同步到主 store
      const { exportTopology } = get();
      const data = exportTopology();
      const mainStore = useTopologyStore.getState();
      mainStore.updateNodes(data.nodes);
      mainStore.updateEdges(data.edges);
      set({ hasUnsavedChanges: false });
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
    // 重置后同步到主 store
    const { exportTopology } = get();
    const data = exportTopology();
    const mainStore = useTopologyStore.getState();
    mainStore.updateNodes(data.nodes);
    mainStore.updateEdges(data.edges);
    set({ hasUnsavedChanges: false });
  },

  /** 放弃更改，重新加载 */
  discardChanges: async () => {
    await get().loadFromBackend();
  },

  // ==================== 多拓扑管理方法 ====================

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
        if (id === currentTopologyId) {
          set({ 
            currentTopologyId: null, 
            nodes: [], 
            edges: [], 
            hasUnsavedChanges: false 
          });
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

  /** 切换拓扑 */
  switchTopology: async (id) => {
    try {
      const result = await fetchTopologyById(id);
      if (result) {
        set({
          nodes: result.nodes,
          edges: result.edges,
          nodeScales: result.nodeScales || {},
          currentTopologyId: id,
          selectedNodeIds: [],
          selectedEdgeIds: [],
          clipboard: [],
          hasUnsavedChanges: false,
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
