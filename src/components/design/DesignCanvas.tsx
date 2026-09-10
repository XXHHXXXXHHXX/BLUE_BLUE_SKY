'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  ConnectionLineType,
  type OnSelectionChangeParams,
  type Connection,
  useReactFlow,
  ReactFlowProvider,
  SelectionMode,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { nodeTypes } from '../topology/nodes';
import PowerEdge from '../topology/edges/PowerEdge';
import DesignToolbar from './DesignToolbar';
import ModulePalette from './ModulePalette';
import IconPicker from './IconPicker';
import NodeEditPanel from './NodeEditPanel';
import { useDesignTopologyStore } from '../../stores/designTopologyStore';
import type { HardwareNodeType, TopologyNode } from '../../types/topology';

const edgeTypes = { powerEdge: PowerEdge };

const DesignCanvasInner: React.FC = () => {
  const {
    nodes,
    edges,
    selectedNodeIds,
    onNodesChange,
    onEdgesChange,
    setSelectedNodeIds,
    setSelectedEdgeIds,
    copySelectedNodes,
    pasteNodes,
    deleteSelectedNodes,
    deleteSelectedEdges,
    addNode,
    addEdge,
    updateNodeIcon,
    resetToDefault,
    updateNodes,
    updateEdges,
    hasUnsavedChanges,
    saveToBackend,
    discardChanges,
    reverseEdge,
  } = useDesignTopologyStore();

  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition } = useReactFlow();

  // === 连线高亮 ===
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

  // 注入 design mode + 高亮标记到 edge data
  const designEdges = useMemo(
    () =>
      edges.map((e) => ({
        ...e,
        data: {
          ...e.data!,
          _mode: 'design' as const,
          _highlighted: highlightedEdgeIds.has(e.id),
        },
      })) as typeof edges,
    [edges, highlightedEdgeIds],
  );

  // 注入高亮标记到节点 data
  const processedNodes = useMemo(
    () =>
      nodes.map((n) => ({
        ...n,
        data: {
          ...n.data,
          _highlighted: highlightedNodeIds.has(n.id),
        },
      })),
    [nodes, highlightedNodeIds],
  );

  // 编辑面板：双击节点打开
  const [editingNode, setEditingNode] = useState<TopologyNode | null>(null);

  const handleNodeDoubleClick = useCallback(
    (_event: React.MouseEvent, node: TopologyNode) => {
      setEditingNode(node);
    },
    [],
  );

  // 当选中节点数据变化时同步到编辑面板
  const currentEditingNode = useMemo(() => {
    if (!editingNode) return null;
    return nodes.find((n) => n.id === editingNode.id) || null;
  }, [nodes, editingNode]);

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    nodeId?: string;
    edgeId?: string;
    customIcon?: string;
  } | null>(null);

  const handleSelectionChange = useCallback(
    (params: OnSelectionChangeParams) => {
      const nodeIds = params.nodes.map((n) => n.id);
      const edgeIds = params.edges.map((e) => e.id);
      setSelectedNodeIds(nodeIds);
      setSelectedEdgeIds(edgeIds);
    },
    [setSelectedNodeIds, setSelectedEdgeIds],
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      addEdge(connection);
    },
    [addEdge],
  );

  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const type = event.dataTransfer.getData('application/reactflow-type') as HardwareNodeType;
      if (!type) return;

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      addNode(type, position);
    },
    [screenToFlowPosition, addNode],
  );

  const handlePaneClick = useCallback(() => {
    setContextMenu(null);
    // 清空选择
    setSelectedNodeIds([]);
  }, [setSelectedNodeIds]);

  // 框选功能已暂时禁用
  // const getNodesInBox = useCallback((start: XYPosition, end: XYPosition): string[] => { ... }

  const handleNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: TopologyNode) => {
      event.preventDefault();
      setContextMenu({
        x: event.clientX,
        y: event.clientY,
        nodeId: node.id,
        customIcon: (node.data as Record<string, unknown>).customIcon as string | undefined,
      });
    },
    [],
  );

  const handleEdgeContextMenu = useCallback(
    (event: React.MouseEvent, edge: import('@xyflow/react').Edge) => {
      event.preventDefault();
      setContextMenu({
        x: event.clientX,
        y: event.clientY,
        edgeId: edge.id,
      });
    },
    [],
  );

  const handleClear = useCallback(() => {
    updateNodes([]);
    updateEdges([]);
  }, [updateNodes, updateEdges]);

  const handleDeleteSelected = useCallback(() => {
    deleteSelectedNodes();
    deleteSelectedEdges();
  }, [deleteSelectedNodes, deleteSelectedEdges]);

  const handleIconChange = useCallback(
    (iconName: string) => {
      if (contextMenu?.nodeId) {
        updateNodeIcon(contextMenu.nodeId, iconName);
        setContextMenu(null);
      }
    },
    [contextMenu, updateNodeIcon],
  );

  const handleReverseEdge = useCallback(() => {
    if (contextMenu?.edgeId) {
      reverseEdge(contextMenu.edgeId);
      setContextMenu(null);
    }
  }, [contextMenu, reverseEdge]);

  // 页面加载时从后端加载拓扑
  useEffect(() => {
    const store = useDesignTopologyStore.getState();
    store.loadTopologiesList().then(() => {
      store.loadFromBackend();
    });
  }, []);

  // 监听 beforeunload 事件，如果有未保存的更改则提示用户
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = '您有未保存的更改，确定要离开吗？';
        return e.returnValue;
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

  // 自动保存：有未保存更改时，30 秒后自动保存并覆盖最新版本
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    
    if (hasUnsavedChanges) {
      autoSaveTimerRef.current = setTimeout(() => {
        useDesignTopologyStore.getState().autoSaveVersion();
      }, 30000); // 30 秒防抖
    }
    
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, [hasUnsavedChanges, nodes, edges]);

  // Keyboard shortcuts: Ctrl+C, Ctrl+V, Delete
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      if (e.key === 'Delete' || e.key === 'Backspace') {
        deleteSelectedNodes();
        deleteSelectedEdges();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        e.preventDefault();
        copySelectedNodes();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        e.preventDefault();
        pasteNodes();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [copySelectedNodes, pasteNodes, deleteSelectedNodes, deleteSelectedEdges]);

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex' }}>
      <ModulePalette />
      <div ref={reactFlowWrapper} style={{ flex: 1, position: 'relative' }}>
        <ReactFlow
          nodes={processedNodes}
          edges={designEdges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={handleConnect}
          onSelectionChange={handleSelectionChange}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onPaneClick={handlePaneClick}
          onNodeDoubleClick={handleNodeDoubleClick}
          onNodeContextMenu={handleNodeContextMenu}
          onEdgeContextMenu={handleEdgeContextMenu}
          fitView
          multiSelectionKeyCode="Control"
          selectionMode={SelectionMode.Partial}
          selectionOnDrag={false}
          nodesDraggable={true}
          nodesConnectable={true}
          connectionLineStyle={{ stroke: '#1677ff', strokeWidth: 2 }}
          connectionLineType={ConnectionLineType.SmoothStep}
          defaultEdgeOptions={{ type: 'powerEdge' }}
        >
          <Background />
          <Controls />
          <MiniMap />
          <DesignToolbar
            onDelete={handleDeleteSelected}
            onClear={handleClear}
            onReset={resetToDefault}
            onCopy={copySelectedNodes}
            onPaste={pasteNodes}
            onDiscard={discardChanges}
            hasUnsavedChanges={hasUnsavedChanges}
          />
        </ReactFlow>

        {/* 节点编辑面板 */}
        <NodeEditPanel
          open={currentEditingNode !== null}
          onClose={() => setEditingNode(null)}
          node={currentEditingNode}
        />

        {/* 右键菜单 */}
        {contextMenu && (
          <div
            style={{
              position: 'fixed',
              left: contextMenu.x,
              top: contextMenu.y,
              zIndex: 1000,
              background: '#fff',
              borderRadius: 8,
              boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
              padding: 8,
              minWidth: 120,
            }}
          >
            {/* 节点右键菜单 - 更换图标 */}
            {contextMenu.nodeId && (
              <IconPicker
                value={contextMenu.customIcon}
                onChange={handleIconChange}
              >
                <div
                  style={{
                    padding: '6px 12px',
                    cursor: 'pointer',
                    borderRadius: 4,
                    fontSize: 13,
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#f0f0f0')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  更换图标
                </div>
              </IconPicker>
            )}
            
            {/* 连线右键菜单 - 翻转方向 */}
            {contextMenu.edgeId && (
              <div
                style={{
                  padding: '6px 12px',
                  cursor: 'pointer',
                  borderRadius: 4,
                  fontSize: 13,
                }}
                onClick={handleReverseEdge}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#f0f0f0')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                翻转方向
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const DesignCanvas: React.FC = () => (
  <ReactFlowProvider>
    <DesignCanvasInner />
  </ReactFlowProvider>
);

export default DesignCanvas;
