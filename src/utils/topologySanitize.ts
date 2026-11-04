/**
 * 拓扑数据清洗工具
 *
 * 设计页在渲染时会给节点/边的 data 注入运行时字段（_mode: 'design'、_highlighted），
 * React Flow 也会在节点顶层维护 measured/selected/dragging 等运行时状态。
 * 这些字段若被持久化到后端，监控页加载后 data._mode === 'design' 会让
 * ViewNode/ControlNode 判定为设计模式，交互区（参数填写 + 查看/下发按钮）不渲染。
 *
 * 本工具在【保存导出】与【加载导入】两条链路上统一剔除这些运行时字段，
 * 保证持久化数据只包含业务字段。
 */
import type { TopologyExportData, TopologyNode, TopologyEdge } from '../types/topology';

/** 节点/边 data 中由画布注入的纯运行时字段（必须剔除） */
const NODE_DATA_RUNTIME_KEYS = ['_mode', '_highlighted', '_aggregatorStats'];
const EDGE_DATA_RUNTIME_KEYS = ['_mode', '_highlighted', '_aggregatedLoss'];

/** 节点顶层由 React Flow 维护的运行时字段（不应持久化） */
const NODE_TOP_LEVEL_RUNTIME_KEYS = [
  'measured',
  'selected',
  'dragging',
  'resizing',
  'width',
  'height',
] as const;

/** 边顶层由 React Flow 维护的运行时字段（不应持久化） */
const EDGE_TOP_LEVEL_RUNTIME_KEYS = ['selected', 'measured'] as const;

/** 剔除节点上的运行时字段，返回新对象（不修改入参） */
export function sanitizeNode(node: TopologyNode): TopologyNode {
  const data = (node.data || {}) as Record<string, unknown>;
  const nextData: Record<string, unknown> = {};
  for (const key of Object.keys(data)) {
    if (!NODE_DATA_RUNTIME_KEYS.includes(key)) {
      nextData[key] = data[key];
    }
  }

  const next: Record<string, unknown> = { ...(node as unknown as Record<string, unknown>) };
  next.data = nextData;
  for (const key of NODE_TOP_LEVEL_RUNTIME_KEYS) {
    delete next[key];
  }
  return next as unknown as TopologyNode;
}

/** 剔除边上的运行时字段，返回新对象（不修改入参） */
export function sanitizeEdge(edge: TopologyEdge): TopologyEdge {
  const data = (edge.data || {}) as Record<string, unknown>;
  const nextData: Record<string, unknown> = {};
  for (const key of Object.keys(data)) {
    if (!EDGE_DATA_RUNTIME_KEYS.includes(key)) {
      nextData[key] = data[key];
    }
  }

  const next: Record<string, unknown> = { ...(edge as unknown as Record<string, unknown>) };
  next.data = nextData;
  for (const key of EDGE_TOP_LEVEL_RUNTIME_KEYS) {
    delete next[key];
  }
  return next as unknown as TopologyEdge;
}

/** 清洗一份完整的拓扑导出数据（节点与边），返回新对象 */
export function sanitizeTopologyData(data: TopologyExportData): TopologyExportData {
  return {
    ...data,
    nodes: (data.nodes || []).map(sanitizeNode),
    edges: (data.edges || []).map(sanitizeEdge),
  };
}

/** 清洗节点数组（加载入口用） */
export function sanitizeNodes(nodes: TopologyNode[]): TopologyNode[] {
  return (nodes || []).map(sanitizeNode);
}

/** 清洗边数组（加载入口用） */
export function sanitizeEdges(edges: TopologyEdge[]): TopologyEdge[] {
  return (edges || []).map(sanitizeEdge);
}
