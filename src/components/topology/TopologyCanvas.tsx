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
import Toolbar from './Toolbar';
import NodeDetailPanel from '../panels/NodeDetailPanel';
import CPUPowerDomain from '../panels/CPUPowerDomain';
import TopologyOverviewPanel from '../panels/TopologyOverviewPanel';
import { useTopologyStore } from '../../stores/topologyStore';
import { useMonitorStore } from '../../stores/monitorStore';
import type { TopologyNode } from '../../types/topology';
import type { CPUData } from '../../types/power';

const edgeTypes = { powerEdge: PowerEdge };

const TopologyCanvas: React.FC = () => {
  const {
    nodes,
    edges,
    selectedNodeIds,
    onNodesChange,
    onEdgesChange,
    setSelectedNodeIds,
    updateFanSpeed,
    updateSourceVoltage,
  } = useTopologyStore();

  // 从 monitorStore 获取监控状态
  const { isPolling } = useMonitorStore();

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [cpuModalOpen, setCpuModalOpen] = useState(false);
  const [cpuModalNodeId, setCpuModalNodeId] = useState<string | null>(null);
  const [cpuModalData, setCpuModalData] = useState<CPUData | null>(null);
  const [overviewOpen, setOverviewOpen] = useState(false);

  // 从 store 实时获取选中的节点数据
  const selectedNode = useMemo(() => {
    if (!selectedNodeId) return null;
    return nodes.find((n) => n.id === selectedNodeId) || null;
  }, [nodes, selectedNodeId]);

  // Track drag state to prevent detail panel opening during drag
  const isDragging = useRef(false);

  // 监控状态现在存储在 sessionStorage 中，每个标签页独立
  // 不需要从后端同步

  // === 连线高亮：选中节点时高亮相关边和连接的节点 ===
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

  // 注入高亮标记和控制回调到节点 data
  const processedNodes = useMemo(
    () =>
      nodes.map((n) => {
        const extra: Record<string, unknown> = {
          _highlighted: highlightedNodeIds.has(n.id),
        };
        // 注入控制回调
        if (n.data.nodeType === 'fan') {
          extra.onSpeedChange = (speed: number) => updateFanSpeed(n.id, speed);
        }
        if (n.data.nodeType === 'vr' || n.data.nodeType === 'psip') {
          extra.onVoltageChange = (voltage: number) => updateSourceVoltage(n.id, voltage);
        }
        return { ...n, data: { ...n.data, ...extra } };
      }),
    [nodes, highlightedNodeIds, updateFanSpeed, updateSourceVoltage],
  );

  // 注入高亮标记到边 data
  const processedEdges = useMemo(
    () =>
      edges.map((e) => ({
        ...e,
        data: {
          ...e.data!,
          _highlighted: highlightedEdgeIds.has(e.id),
        },
      })),
    [edges, highlightedEdgeIds],
  );

  const handleSelectionChange = useCallback(
    (params: OnSelectionChangeParams) => {
      const ids = params.nodes.map((n) => n.id);
      setSelectedNodeIds(ids);
    },
    [setSelectedNodeIds],
  );

  // 单击仅选中节点（高亮），不弹出详情面板
  const handleNodeClick: NodeMouseHandler<TopologyNode> = useCallback(
    () => {
      // 单击不打开面板，仅通过 onSelectionChange 高亮
    },
    [],
  );

  // 双击打开详情面板
  const handleNodeDoubleClick: NodeMouseHandler<TopologyNode> = useCallback(
    (_event, node) => {
      setSelectedNodeId(node.id);
    },
    [],
  );

  const handleNodeDragStart = useCallback(() => {
    isDragging.current = false;
  }, []);

  const handleNodeDrag = useCallback(() => {
    isDragging.current = true;
  }, []);

  const handlePaneClick = useCallback(() => {
    setSelectedNodeId(null);
  }, []);

  // Listen for CPU detail custom event
  useEffect(() => {
    const handler = (e: Event) => {
      const { nodeId, data } = (e as CustomEvent).detail;
      setCpuModalNodeId(nodeId);
      setCpuModalData(data);
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
        <Toolbar />
      </ReactFlow>

      <NodeDetailPanel
        open={selectedNodeId !== null}
        onClose={() => setSelectedNodeId(null)}
        node={selectedNode}
      />

      <CPUPowerDomain
        open={cpuModalOpen}
        onClose={() => setCpuModalOpen(false)}
        nodeId={cpuModalNodeId}
        cpuData={cpuModalData}
      />

      <TopologyOverviewPanel
        open={overviewOpen}
        onToggle={() => setOverviewOpen((v) => !v)}
        isPolling={isPolling}
      />
    </div>
  );
};

export default TopologyCanvas;
