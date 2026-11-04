'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  Controls,
  MiniMap,
  type OnSelectionChangeParams,
  type NodeMouseHandler,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { staticNodeTypes } from './nodes';
import PowerEdge from './edges/PowerEdge';
import ControlEdge from './edges/ControlEdge';
import SensorEdge from './edges/SensorEdge';
import CloneToolbar from './CloneToolbar';
import CloneNodeDetailPanel from '../panels/CloneNodeDetailPanel';
import CloneTopologyOverviewPanel from '../panels/CloneTopologyOverviewPanel';
import CPUPowerDomain from '../panels/CPUPowerDomain';
import { useCloneTopologyStore, initCloneStore, loadCloneTopologyId } from '../../stores/cloneTopologyStore';
import { calculateAggregatorStats, AGGREGATOR_NODE_TYPE } from '../../services/lossCalculation';
import type { TopologyNode } from '../../types/topology';
import type { CPUData } from '../../types/power';


const edgeTypes = { powerEdge: PowerEdge, controlEdge: ControlEdge, sensorEdge: SensorEdge };

interface CloneCanvasProps {
  // 可选的初始拓扑ID
  initialTopologyId?: string;
}

const CloneCanvas: React.FC<CloneCanvasProps> = ({ initialTopologyId }) => {
  const {
    nodes,
    edges,
    selectedNodeIds,
    onNodesChange,
    onEdgesChange,
    setSelectedNodeIds,
    overviewOpen,
    toggleOverview,
    selectedNodeId,
    setSelectedNodeId,
    loadTopologiesList,
    switchTopology,
  } = useCloneTopologyStore();

  // 监控状态现在存储在 sessionStorage 中，每个标签页独立

  const [cpuModalOpen, setCpuModalOpen] = useState(false);
  const [cpuModalNodeId, setCpuModalNodeId] = useState<string | null>(null);
  const [cpuModalData, setCpuModalData] = useState<CPUData | null>(null);
  const [cpuModalCommandMode, setCpuModalCommandMode] = useState(false);
  const [cpuModalCommandDomains, setCpuModalCommandDomains] = useState<{ name: string; value: number | null }[]>([]);
  const [cpuModalCommandTime, setCpuModalCommandTime] = useState<string>();
  const [cpuModalCommandError, setCpuModalCommandError] = useState<string>();
  // 电源域命令配置（用于弹窗内刷新按钮重新下发命令）
  const [cpuModalApiConfig, setCpuModalApiConfig] = useState<{
    powerDomainCommand?: string;
    powerDomainCommandFields?: { name: string; label: string }[];
  }>();

  // 从 store 实时获取选中的节点数据
  const selectedNode = useMemo(() => {
    if (!selectedNodeId) return null;
    return nodes.find((n) => n.id === selectedNodeId) || null;
  }, [nodes, selectedNodeId]);

  // Track drag state
  const isDragging = useRef(false);

  // 初始化加载
  useEffect(() => {
    const init = async () => {
      // 监控状态存储在 sessionStorage 中，每个标签页独立
      
      await loadTopologiesList();
      
      // 优先使用 localStorage 中保存的拓扑ID（用户已在页面内切换过）
      const savedTopologyId = loadCloneTopologyId();
      
      if (savedTopologyId) {
        // 验证该拓扑是否仍然存在
        const { topologies } = useCloneTopologyStore.getState();
        const exists = topologies.some(t => t.id === savedTopologyId);
        if (exists) {
          await switchTopology(savedTopologyId);
        } else {
          // 拓扑不存在了，清除保存的ID并使用默认初始化
          localStorage.removeItem('blue_sky_clone_topology_id');
          await initCloneStore();
        }
      } else if (initialTopologyId) {
        // 如果没有保存的ID，使用 URL 参数中的初始拓扑ID
        await switchTopology(initialTopologyId);
      } else {
        // 否则使用默认初始化
        await initCloneStore();
      }
    };
    
    init();
  }, [loadTopologiesList, switchTopology, initialTopologyId]);

  // 连线高亮
  const highlightedEdgeIds = useMemo(() => {
    if (selectedNodeIds.length === 0) return new Set<string>();
    return new Set(
      edges
        .filter(
          (e) =>
            selectedNodeIds.includes(e.source) ||
            selectedNodeIds.includes(e.target),
        )
        .map((e) => e.id),
    );
  }, [edges, selectedNodeIds]);

  const highlightedNodeIds = useMemo(() => {
    if (selectedNodeIds.length === 0) return new Set<string>();
    const ids = new Set<string>();
    edges.forEach((e) => {
      if (selectedNodeIds.includes(e.source)) ids.add(e.target);
      if (selectedNodeIds.includes(e.target)) ids.add(e.source);
    });
    selectedNodeIds.forEach((id) => ids.add(id));
    return ids;
  }, [edges, selectedNodeIds]);

  // 链路聚合器统计：上游输出合计、下游输入合计、整体链路损耗
  const aggregatorStats = useMemo(() => calculateAggregatorStats(nodes, edges), [nodes, edges]);

  // 注入高亮标记和控制回调到节点 data
  const processedNodes = useMemo(
    () =>
      nodes.map((n) => {
        const extra: Record<string, unknown> = {
          _highlighted: highlightedNodeIds.has(n.id),
          ...(aggregatorStats.has(n.id) ? { _aggregatorStats: aggregatorStats.get(n.id) } : {}),
        };
        return { ...n, data: { ...n.data, ...extra } };
      }),
    [nodes, highlightedNodeIds, aggregatorStats],
  );

  // 与链路聚合器相连的边：损耗由聚合器卡片汇总，边上不再显示单条损耗
  const aggregatorEdgeIds = useMemo(() => {
    const ids = new Set(
      nodes.filter((n) => (n.data as { nodeType?: string }).nodeType === AGGREGATOR_NODE_TYPE).map((n) => n.id),
    );
    if (ids.size === 0) return new Set<string>();
    return new Set(edges.filter((e) => ids.has(e.source) || ids.has(e.target)).map((e) => e.id));
  }, [nodes, edges]);

  // 注入高亮标记到边 data
  const processedEdges = useMemo(
    () =>
      edges.map((e) => ({
        ...e,
        data: {
          ...e.data!,
          _highlighted: highlightedEdgeIds.has(e.id),
          ...(aggregatorEdgeIds.has(e.id) ? { _aggregatedLoss: true } : {}),
        },
      })),
    [edges, highlightedEdgeIds, aggregatorEdgeIds],
  );

  const handleSelectionChange = useCallback(
    (params: OnSelectionChangeParams) => {
      const ids = params.nodes.map((n) => n.id);
      setSelectedNodeIds(ids);
    },
    [setSelectedNodeIds],
  );

  // 单击仅选中节点
  const handleNodeClick: NodeMouseHandler<TopologyNode> = useCallback(
    () => {
      // 单击不打开面板，仅高亮
    },
    [],
  );

  // 双击打开详情面板
  const handleNodeDoubleClick: NodeMouseHandler<TopologyNode> = useCallback(
    (_event, node) => {
      setSelectedNodeId(node.id);
    },
    [setSelectedNodeId],
  );

  const handleNodeDragStart = useCallback(() => {
    isDragging.current = false;
  }, []);

  const handleNodeDrag = useCallback(() => {
    isDragging.current = true;
  }, []);

  const handlePaneClick = useCallback(() => {
    setSelectedNodeId(null);
  }, [setSelectedNodeId]);

  // 监听 CPU detail 事件
  useEffect(() => {
    const handler = (e: Event) => {
      const { nodeId, data, commandMode, powerDomains, commandTime, commandError } = (e as CustomEvent).detail;
      setCpuModalNodeId(nodeId);
      setCpuModalData(data);
      setCpuModalCommandMode(!!commandMode);
      setCpuModalCommandDomains(commandMode ? powerDomains || [] : []);
      setCpuModalCommandTime(commandMode ? commandTime : undefined);
      setCpuModalCommandError(commandMode ? commandError : undefined);
      // 取该节点当前的电源域命令配置，供弹窗刷新按钮使用
      const node = useCloneTopologyStore.getState().nodes.find((n) => n.id === nodeId);
      setCpuModalApiConfig(node?.data?.apiConfig);
      setCpuModalOpen(true);
    };
    window.addEventListener('open-cpu-detail', handler);
    return () => window.removeEventListener('open-cpu-detail', handler);
  }, []);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', background: '#fff' }}>
      <ReactFlow
        nodes={processedNodes}
        edges={processedEdges}
        nodeTypes={staticNodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onSelectionChange={handleSelectionChange}
        onNodeClick={handleNodeClick}
        onNodeDoubleClick={handleNodeDoubleClick}
        onNodeDragStart={handleNodeDragStart}
        onNodeDrag={handleNodeDrag}
        onPaneClick={handlePaneClick}
        nodesDraggable={false}
        zoomOnDoubleClick={false}
        fitView
      >
        <Controls showInteractive={false} />
        <MiniMap />
        <CloneToolbar />
      </ReactFlow>

      <CloneNodeDetailPanel
        open={selectedNodeId !== null}
        onClose={() => setSelectedNodeId(null)}
        node={selectedNode}
      />

      <CPUPowerDomain
        open={cpuModalOpen}
        onClose={() => setCpuModalOpen(false)}
        nodeId={cpuModalNodeId}
        cpuData={cpuModalData}
        commandMode={cpuModalCommandMode}
        commandPowerDomains={cpuModalCommandDomains}
        commandTime={cpuModalCommandTime}
        commandError={cpuModalCommandError}
        powerDomainCommand={cpuModalApiConfig?.powerDomainCommand}
        powerDomainCommandFields={cpuModalApiConfig?.powerDomainCommandFields}
      />

      <CloneTopologyOverviewPanel
        open={overviewOpen}
        onToggle={toggleOverview}
      />
    </div>
  );
};

export default CloneCanvas;
