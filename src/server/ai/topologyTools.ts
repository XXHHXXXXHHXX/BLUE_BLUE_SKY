/** 拓扑相关工具实现（监控 + 设计）
 *
 * 直接读写服务端拓扑存储（`.data/topologies/<id>/topology.json`），
 * 与前端画布共用同一份数据；AI 修改后前端刷新即可看到。
 */
import { topologiesStore, topologyStore, monitorStore, type TopologyMeta } from '../../../app/api/lib/store';
import { createDefaultNodeData } from '../../services/mockData';
import type { TopologyExportData, TopologyNode, TopologyEdge, HardwareNodeType } from '../../types/topology';

/** 拓扑列表（含节点数） */
export function listTopologies(): Array<Pick<TopologyMeta, 'id' | 'name' | 'description' | 'nodeCount' | 'updatedAt' | 'isDefault'>> {
  return topologiesStore.data.topologies.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    nodeCount: t.nodeCount,
    updatedAt: t.updatedAt,
    isDefault: t.isDefault,
  }));
}

/** 读取拓扑详情（节点/连线精简为可读结构，避免 token 过长） */
export function getTopologySummary(topologyId: string): Record<string, unknown> | null {
  const index = topologiesStore.data;
  const meta = index.topologies.find((t) => t.id === topologyId);
  if (!meta) return null;
  const data = topologyStore.getTopology(topologyId);
  return {
    id: meta.id,
    name: meta.name,
    description: meta.description,
    nodeCount: data.nodes.length,
    edgeCount: data.edges.length,
    nodes: data.nodes.map((n) => ({
      id: n.id,
      type: n.data?.nodeType,
      label: n.data?.label,
      alias: n.data?.displayAlias,
      position: n.position,
    })),
    edges: data.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.data?.label,
      loss: e.data?.loss,
      lossPercent: e.data?.lossPercent,
    })),
  };
}

/** 读取原始拓扑数据（供导出/分析） */
export function getTopologyRaw(topologyId: string): TopologyExportData | null {
  const meta = topologiesStore.data.topologies.find((t) => t.id === topologyId);
  if (!meta) return null;
  return topologyStore.getTopology(topologyId);
}

export interface AddNodeInput {
  topologyId: string;
  nodeType: HardwareNodeType;
  label?: string;
  position?: { x: number; y: number };
}

/** 新增节点（默认数据由 createDefaultNodeData 生成，与画布「添加模块」一致） */
export function addTopologyNode(input: AddNodeInput): { node?: TopologyNode; error?: string } {
  const data = getTopologyRaw(input.topologyId);
  if (!data) return { error: `拓扑不存在: ${input.topologyId}` };

  const nodeType = input.nodeType;
  if (!nodeType) return { error: '缺少 nodeType' };

  let nodeData: TopologyNode['data'];
  try {
    nodeData = createDefaultNodeData(nodeType);
  } catch (err) {
    return { error: err instanceof Error ? err.message : '生成默认节点数据失败' };
  }
  if (input.label) nodeData = { ...nodeData, label: input.label };

  // 位置缺省时放在已有节点右侧，避免重叠
  const position = input.position ?? {
    x: 80 + (data.nodes.length % 6) * 220,
    y: 80 + Math.floor(data.nodes.length / 6) * 180,
  };

  const node: TopologyNode = {
    id: `${nodeType}-ai-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    type: nodeType,
    position,
    data: nodeData,
  };

  data.nodes.push(node);
  topologyStore.saveTopology(input.topologyId, data);
  return { node };
}

export interface AddEdgeInput {
  topologyId: string;
  source: string;
  target: string;
  label?: string;
}

/** 新增连线（默认电源边，控制/监测节点自动切换边类型） */
export function addTopologyEdge(input: AddEdgeInput): { edge?: TopologyEdge; error?: string } {
  const data = getTopologyRaw(input.topologyId);
  if (!data) return { error: `拓扑不存在: ${input.topologyId}` };

  const sourceNode = data.nodes.find((n) => n.id === input.source);
  const targetNode = data.nodes.find((n) => n.id === input.target);
  if (!sourceNode) return { error: `源节点不存在: ${input.source}` };
  if (!targetNode) return { error: `目标节点不存在: ${input.target}` };

  const isControl = sourceNode.data?.nodeType === 'control' || targetNode.data?.nodeType === 'control';
  const isSensor = sourceNode.data?.nodeType === 'sensor' || targetNode.data?.nodeType === 'sensor';
  const edgeType = isControl ? 'controlEdge' : isSensor ? 'sensorEdge' : 'powerEdge';

  const edge: TopologyEdge = {
    id: `e-ai-${input.source}-${input.target}-${Date.now()}`,
    source: input.source,
    target: input.target,
    type: edgeType,
    data: isControl
      ? { loss: 0, lossPercent: 0, animated: false, label: input.label || '控制', color: '#722ed1' }
      : isSensor
      ? { loss: 0, lossPercent: 0, animated: false, label: input.label || '监测', color: '#52c41a' }
      : { loss: 0, lossPercent: 0, lossEnabled: true, animated: true, ...(input.label ? { label: input.label } : {}) },
  };

  data.edges.push(edge);
  topologyStore.saveTopology(input.topologyId, data);
  return { edge };
}

/** 删除节点（同时删除关联连线） */
export function removeTopologyNode(topologyId: string, nodeId: string): { removed: boolean; removedEdges: number; error?: string } {
  const data = getTopologyRaw(topologyId);
  if (!data) return { removed: false, removedEdges: 0, error: `拓扑不存在: ${topologyId}` };
  const existed = data.nodes.some((n) => n.id === nodeId);
  if (!existed) return { removed: false, removedEdges: 0, error: `节点不存在: ${nodeId}` };

  const before = data.edges.length;
  data.nodes = data.nodes.filter((n) => n.id !== nodeId);
  data.edges = data.edges.filter((e) => e.source !== nodeId && e.target !== nodeId);
  topologyStore.saveTopology(topologyId, data);
  return { removed: true, removedEdges: before - data.edges.length };
}

/** 删除连线 */
export function removeTopologyEdge(topologyId: string, edgeId: string): { removed: boolean; error?: string } {
  const data = getTopologyRaw(topologyId);
  if (!data) return { removed: false, error: `拓扑不存在: ${topologyId}` };
  const before = data.edges.length;
  data.edges = data.edges.filter((e) => e.id !== edgeId);
  if (data.edges.length === before) return { removed: false, error: `连线不存在: ${edgeId}` };
  topologyStore.saveTopology(topologyId, data);
  return { removed: true };
}

/** 更新节点别名/标签 */
export function updateTopologyNode(
  topologyId: string,
  nodeId: string,
  patch: { label?: string; alias?: string },
): { updated: boolean; error?: string } {
  const data = getTopologyRaw(topologyId);
  if (!data) return { updated: false, error: `拓扑不存在: ${topologyId}` };
  const node = data.nodes.find((n) => n.id === nodeId);
  if (!node) return { updated: false, error: `节点不存在: ${nodeId}` };
  if (patch.label !== undefined) node.data = { ...node.data, label: patch.label };
  if (patch.alias !== undefined) node.data = { ...node.data, displayAlias: patch.alias };
  topologyStore.saveTopology(topologyId, data);
  return { updated: true };
}

/** 新建拓扑（可选从现有拓扑复制） */
export function createTopologyRecord(name: string, description?: string, copyFromId?: string): { meta?: TopologyMeta; error?: string } {
  if (!name?.trim()) return { error: '拓扑名称不能为空' };
  const id = `topo-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  try {
    const meta = topologyStore.createTopology(id, name.trim(), description, copyFromId);
    return { meta };
  } catch (err) {
    return { error: err instanceof Error ? err.message : '创建拓扑失败' };
  }
}

/** 监控状态（服务端全局） */
export function getMonitorState(): { isPolling: boolean; pollInterval: number; updatedAt: string } {
  const state = monitorStore.data;
  return {
    isPolling: state.isPolling,
    pollInterval: state.pollInterval,
    updatedAt: state.updatedAt,
  };
}

/** 设置监控启停与轮询间隔 */
export function setMonitorState(patch: { isPolling?: boolean; pollInterval?: number }): {
  isPolling: boolean;
  pollInterval: number;
} {
  const current = monitorStore.data;
  if (typeof patch.isPolling === 'boolean') current.isPolling = patch.isPolling;
  if (typeof patch.pollInterval === 'number' && patch.pollInterval > 0) {
    current.pollInterval = patch.pollInterval;
  }
  current.updatedAt = new Date().toISOString();
  current.updatedBy = 'ai';
  monitorStore.data = current;
  return { isPolling: current.isPolling, pollInterval: current.pollInterval };
}
