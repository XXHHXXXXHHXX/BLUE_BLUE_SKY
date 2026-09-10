'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { type EdgeProps, getSmoothStepPath, EdgeLabelRenderer, Position, useReactFlow } from '@xyflow/react';
import { useTopologyStore } from '../../../stores/topologyStore';
import { useDesignTopologyStore } from '../../../stores/designTopologyStore';
import type { EdgeArrowType } from '../../../types/topology';

/** 根据所在模式选择对应的 store action */
function useEdgeStore() {
  const designUpdateEdgeBendOffset = useDesignTopologyStore((s) => s.updateEdgeBendOffset);
  const mainUpdateEdgeBendOffset = useTopologyStore((s) => s.updateEdgeBendOffset);

  const updateEdgeBendOffset = useCallback(
    (edgeId: string, bendOffset: number, mode?: 'design' | 'monitor') => {
      if (mode === 'design') {
        designUpdateEdgeBendOffset(edgeId, bendOffset);
      } else {
        mainUpdateEdgeBendOffset(edgeId, bendOffset);
      }
    },
    [designUpdateEdgeBendOffset, mainUpdateEdgeBendOffset],
  );

  return { updateEdgeBendOffset };
}

interface PowerEdgeDataLocal {
  loss: number;
  lossPercent: number;
  animated?: boolean;
  arrowType?: EdgeArrowType;
  label?: string;
  customData?: Record<string, unknown>;
  _mode?: 'design' | 'monitor';
  _highlighted?: boolean;
  _reversed?: boolean;
  bendOffset?: number;
  [key: string]: unknown;
}

function getEdgeColor(lossPercent: number): string {
  if (Number.isNaN(lossPercent)) return '#999';
  if (lossPercent < 1) return '#52c41a';
  if (lossPercent <= 3) return '#faad14';
  return '#f5222d';
}

/** 箭头类型对应的显示文字 */
const arrowLabels: Record<EdgeArrowType, string> = {
  none: '无箭头',
  forward: '单向 →',
};

/** 箭头类型循环顺序 */
const arrowCycle: EdgeArrowType[] = ['forward', 'none'];

/**
 * 计算可弯曲的 SmoothStep 路径
 * bendOffset 用于将中间段向垂直于主方向的方向平移
 */
function getBendableSmoothStepPath(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  sourcePosition: Position,
  targetPosition: Position,
  bendOffset: number = 0,
  borderRadius: number = 8,
): [string, number, number] {
  const isHorizontalFlow =
    (sourcePosition === Position.Right || sourcePosition === Position.Left) &&
    (targetPosition === Position.Right || targetPosition === Position.Left);

  const isVerticalFlow =
    (sourcePosition === Position.Top || sourcePosition === Position.Bottom) &&
    (targetPosition === Position.Top || targetPosition === Position.Bottom);

  if (!isHorizontalFlow && !isVerticalFlow) {
    return getSmoothStepPath({
      sourceX,
      sourceY,
      targetX,
      targetY,
      sourcePosition,
      targetPosition,
      borderRadius,
      offset: 20,
    }).slice(0, 3) as [string, number, number];
  }

  if (isHorizontalFlow) {
    const midX = (sourceX + targetX) / 2 + bendOffset;
    const midY = (sourceY + targetY) / 2;
    const dirX = sourceX < targetX ? 1 : -1;
    const dirY = sourceY < targetY ? 1 : -1;

    const r = Math.min(
      borderRadius,
      Math.abs(targetY - sourceY) / 2,
      Math.abs(midX - sourceX) / 2,
      Math.abs(targetX - midX) / 2,
    );

    let path: string;
    if (Math.abs(targetY - sourceY) < 0.1) {
      path = `M ${sourceX} ${sourceY} L ${targetX} ${targetY}`;
    } else if (r < 1) {
      path = `M ${sourceX} ${sourceY} L ${midX} ${sourceY} L ${midX} ${targetY} L ${targetX} ${targetY}`;
    } else {
      path = `M ${sourceX} ${sourceY} L ${midX - dirX * r} ${sourceY} Q ${midX} ${sourceY} ${midX} ${sourceY + dirY * r} L ${midX} ${targetY - dirY * r} Q ${midX} ${targetY} ${midX + dirX * r} ${targetY} L ${targetX} ${targetY}`;
    }
    return [path, midX, midY];
  }

  // Vertical flow
  const midY = (sourceY + targetY) / 2 + bendOffset;
  const midX = (sourceX + targetX) / 2;
  const dirX = sourceX < targetX ? 1 : -1;
  const dirY = sourceY < targetY ? 1 : -1;

  const r = Math.min(
    borderRadius,
    Math.abs(targetX - sourceX) / 2,
    Math.abs(midY - sourceY) / 2,
    Math.abs(targetY - midY) / 2,
  );

  let path: string;
  if (Math.abs(targetX - sourceX) < 0.1) {
    path = `M ${sourceX} ${sourceY} L ${targetX} ${targetY}`;
  } else if (r < 1) {
    path = `M ${sourceX} ${sourceY} L ${sourceX} ${midY} L ${targetX} ${midY} L ${targetX} ${targetY}`;
  } else {
    path = `M ${sourceX} ${sourceY} L ${sourceX} ${midY - dirY * r} Q ${sourceX} ${midY} ${sourceX + dirX * r} ${midY} L ${targetX - dirX * r} ${midY} Q ${targetX} ${midY} ${targetX} ${midY + dirY * r} L ${targetX} ${targetY}`;
  }
  return [path, midX, midY];
}

const PowerEdge: React.FC<EdgeProps> = (props) => {
  const {
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    style = {},
  } = props;

  const data = props.data as PowerEdgeDataLocal | undefined;
  const rawLoss = data?.loss ?? 0;
  const rawLossPercent = data?.lossPercent ?? 0;
  const loss = Number.isNaN(rawLoss) ? 0 : rawLoss;
  const lossPercent = Number.isNaN(rawLossPercent) ? 0 : rawLossPercent;
  const animated = data?.animated !== false;
  const arrowType: EdgeArrowType = data?.arrowType ?? 'forward';
  const edgeLabel = data?.label;
  const customData = data?.customData;
  const isDesignMode = data?._mode === 'design';
  const isHighlighted = data?._highlighted === true;
  const isReversed = data?._reversed === true;
  const bendOffset = data?.bendOffset ?? 0;

  const updateEdgeLabel = useTopologyStore((s) => s.updateEdgeLabel);
  const updateEdgeArrowType = useTopologyStore((s) => s.updateEdgeArrowType);
  const { updateEdgeBendOffset } = useEdgeStore();

  const { screenToFlowPosition } = useReactFlow();

  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(edgeLabel ?? '');
  const inputRef = useRef<HTMLInputElement>(null);

  // Drag state
  const dragStateRef = useRef<{
    isDragging: boolean;
    initialBendOffset: number;
    initialFlowPos: { x: number; y: number };
    isHorizontal: boolean;
  } | null>(null);
  const [isDraggingHandle, setIsDraggingHandle] = useState(false);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  useEffect(() => {
    if (!editing) {
      setEditValue(edgeLabel ?? '');
    }
  }, [edgeLabel, editing]);

  const [edgePath, labelX, labelY] = getBendableSmoothStepPath(
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition as Position,
    targetPosition as Position,
    bendOffset,
    8,
  );

  const color = getEdgeColor(lossPercent);

  // 为每条边生成唯一的 marker ID
  const markerEndId = `arrow-end-${id}`;
  const markerStartId = `arrow-start-${id}`;

  const handleLabelClick = useCallback(() => {
    if (isDesignMode) {
      setEditing(true);
    }
  }, [isDesignMode]);

  const commitLabel = useCallback(() => {
    setEditing(false);
    const trimmed = editValue.trim();
    updateEdgeLabel(id, trimmed || undefined);
  }, [id, editValue, updateEdgeLabel]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        commitLabel();
      } else if (e.key === 'Escape') {
        setEditing(false);
        setEditValue(edgeLabel ?? '');
      }
    },
    [commitLabel, edgeLabel],
  );

  const handleCycleArrow = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      const currentIdx = arrowCycle.indexOf(arrowType);
      const next = arrowCycle[(currentIdx + 1) % arrowCycle.length];
      updateEdgeArrowType(id, next);
    },
    [id, arrowType, updateEdgeArrowType],
  );

  // Handle drag for bend point
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!isDesignMode) return;
      e.stopPropagation();
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);

      const isHorizontal =
        (sourcePosition === Position.Right || sourcePosition === Position.Left) &&
        (targetPosition === Position.Right || targetPosition === Position.Left);

      dragStateRef.current = {
        isDragging: true,
        initialBendOffset: bendOffset,
        initialFlowPos: screenToFlowPosition({ x: e.clientX, y: e.clientY }),
        isHorizontal,
      };
      setIsDraggingHandle(true);
    },
    [isDesignMode, bendOffset, sourcePosition, targetPosition, screenToFlowPosition],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragStateRef.current?.isDragging) return;
      e.stopPropagation();

      const currentFlowPos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const deltaX = currentFlowPos.x - dragStateRef.current.initialFlowPos.x;
      const deltaY = currentFlowPos.y - dragStateRef.current.initialFlowPos.y;

      const newOffset = dragStateRef.current.isHorizontal
        ? dragStateRef.current.initialBendOffset + deltaX
        : dragStateRef.current.initialBendOffset + deltaY;

      // Update store directly for smooth visual feedback
      updateEdgeBendOffset(id, newOffset, isDesignMode ? 'design' : 'monitor');
    },
    [id, isDesignMode, screenToFlowPosition, updateEdgeBendOffset],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!dragStateRef.current?.isDragging) return;
      e.stopPropagation();

      const currentFlowPos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const deltaX = currentFlowPos.x - dragStateRef.current.initialFlowPos.x;
      const deltaY = currentFlowPos.y - dragStateRef.current.initialFlowPos.y;

      const newOffset = dragStateRef.current.isHorizontal
        ? dragStateRef.current.initialBendOffset + deltaX
        : dragStateRef.current.initialBendOffset + deltaY;

      // Commit to store
      updateEdgeBendOffset(id, newOffset, isDesignMode ? 'design' : 'monitor');

      dragStateRef.current = null;
      setIsDraggingHandle(false);
    },
    [id, isDesignMode, screenToFlowPosition, updateEdgeBendOffset],
  );

  return (
    <>
      {/* SVG marker definitions for arrows */}
      <defs>
        <marker
          id={markerEndId}
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="8"
          markerHeight="8"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill={color} />
        </marker>
        <marker
          id={markerStartId}
          viewBox="0 0 10 10"
          refX="2"
          refY="5"
          markerWidth="8"
          markerHeight="8"
          orient="auto"
        >
          <path d="M 10 0 L 0 5 L 10 10 z" fill={color} />
        </marker>
      </defs>

      {/* Background path for wider hit area */}
      <path
        id={`${id}-bg`}
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={12}
      />
      {/* Highlighted glow */}
      {isHighlighted && (
        <path
          d={edgePath}
          fill="none"
          stroke={color}
          strokeWidth={8}
          strokeOpacity={0.25}
          style={{ filter: 'blur(2px)' }}
        />
      )}
      {/* Visible edge path with arrow markers */}
      {/* _reversed 为 true 时，箭头显示在起点；否则显示在终点 */}
      <path
        id={id}
        d={edgePath}
        fill="none"
        stroke={color}
        strokeWidth={isHighlighted ? 3 : 2}
        markerEnd={arrowType !== 'none' && !isReversed ? `url(#${markerEndId})` : undefined}
        markerStart={arrowType !== 'none' && isReversed ? `url(#${markerStartId})` : undefined}
        style={style}
      />
      {/* Animated flowing overlay */}
      {animated && (
        <path
          d={edgePath}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeDasharray="6 4"
          style={{
            animation: 'power-edge-flow 1s linear infinite',
          }}
        />
      )}
      <style>
        {`@keyframes power-edge-flow {
          to { stroke-dashoffset: -10; }
        }`}
      </style>
      {/* Label at midpoint */}
      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: 'all',
          }}
          className="nodrag nopan"
        >
          {/* Draggable bend handle - design mode only */}
          {isDesignMode && (
            <div
              style={{
                position: 'absolute',
                left: '50%',
                top: '50%',
                transform: 'translate(-50%, -50%)',
                width: 14,
                height: 14,
                borderRadius: '50%',
                background: isDraggingHandle ? '#1677ff' : '#fff',
                border: `2px solid ${isDraggingHandle ? '#1677ff' : color}`,
                cursor: 'move',
                zIndex: 10,
                boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
                transition: 'background 0.15s, border-color 0.15s',
              }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              title="拖拽调整连线位置"
            />
          )}

          {/* Editable label area */}
          <div
            style={{
              fontSize: 11,
              fontWeight: 500,
              background: '#fff',
              border: `1px solid ${color}`,
              borderRadius: 4,
              padding: '1px 6px',
              color,
              whiteSpace: 'nowrap',
              cursor: isDesignMode ? 'text' : 'default',
              textAlign: 'center',
              marginTop: 10,
            }}
            onClick={handleLabelClick}
          >
            {editing ? (
              <input
                ref={inputRef}
                className="edge-label-input"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={commitLabel}
                onKeyDown={handleKeyDown}
                style={{ color }}
              />
            ) : (
              <>
                {edgeLabel && <div>{edgeLabel}</div>}
                <div>{loss.toFixed(1)}W ({lossPercent.toFixed(1)}%)</div>
              </>
            )}
          </div>

          {/* Arrow type toggle button - design mode only */}
          {isDesignMode && (
            <div
              style={{
                marginTop: 2,
                fontSize: 10,
                background: '#f0f5ff',
                border: '1px solid #adc6ff',
                borderRadius: 3,
                padding: '1px 4px',
                cursor: 'pointer',
                textAlign: 'center',
                color: '#1677ff',
                userSelect: 'none',
              }}
              onClick={handleCycleArrow}
              title="点击切换箭头类型"
            >
              {arrowLabels[arrowType]}
            </div>
          )}

          {/* Custom JSON data display */}
          {customData && Object.keys(customData).length > 0 && (
            <div className="edge-custom-data">
              {Object.entries(customData).map(([key, value]) => (
                <div key={key} className="edge-custom-data-row">
                  <span className="edge-custom-data-key">{key}:</span>{' '}
                  <span className="edge-custom-data-value">
                    {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
};

export default PowerEdge;
