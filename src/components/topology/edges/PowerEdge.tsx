'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { type EdgeProps, getSmoothStepPath, EdgeLabelRenderer, Position, useReactFlow } from '@xyflow/react';
import { useTopologyStore } from '../../../stores/topologyStore';
import { useDesignTopologyStore } from '../../../stores/designTopologyStore';
import { getLossColor } from '../../../utils/formatters';
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
  lossEnabled?: boolean;
  customData?: Record<string, unknown>;
  _mode?: 'design' | 'monitor';
  _highlighted?: boolean;
  _reversed?: boolean;
  bendOffset?: number;
  /** 该边连接到链路聚合器，损耗由聚合器整体汇总，边上不单独展示 */
  _aggregatedLoss?: boolean;
  [key: string]: unknown;
}

/** 箭头类型对应的显示文字 */
const arrowLabels: Record<EdgeArrowType, string> = {
  none: '无箭头',
  forward: '单向 →',
};

/** 箭头类型循环顺序 */
const arrowCycle: EdgeArrowType[] = ['forward', 'none'];

/**
 * 把折线转成带圆角的 SVG 路径
 * 每个拐点按「实际行进方向」倒角，半径不超过相邻两段长度的一半。
 * 这样即使 bendOffset 把中间段拖到源/目标之外，拐角也不会因为方向判断
 * 错误而反向折回，形成尖锐的针状尖刺。
 */
function buildRoundedPath(
  points: Array<[number, number]>,
  radius: number,
): string {
  if (points.length < 2) return '';

  // 去掉连续重复点，避免长度为 0 的线段导致除零
  const pts: Array<[number, number]> = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const prev = pts[pts.length - 1];
    if (Math.hypot(points[i][0] - prev[0], points[i][1] - prev[1]) > 0.01) {
      pts.push(points[i]);
    }
  }
  if (pts.length < 2) return `M ${pts[0][0]} ${pts[0][1]}`;

  let d = `M ${pts[0][0]} ${pts[0][1]}`;

  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i - 1];
    const [cx, cy] = pts[i];
    const [nx, ny] = pts[i + 1];

    const inLen = Math.hypot(cx - px, cy - py);
    const outLen = Math.hypot(nx - cx, ny - cy);
    const r = Math.min(radius, inLen / 2, outLen / 2);
    // 三点共线（例如源与目标同高）时没有拐角，不需要倒角
    const cross = (cx - px) * (ny - cy) - (cy - py) * (nx - cx);

    if (r < 0.5 || Math.abs(cross) < 0.01) {
      // 段太短或共线，倒角没有意义，直接保留拐点
      d += ` L ${cx} ${cy}`;
      continue;
    }

    const inX = cx - ((cx - px) / inLen) * r;
    const inY = cy - ((cy - py) / inLen) * r;
    const outX = cx + ((nx - cx) / outLen) * r;
    const outY = cy + ((ny - cy) / outLen) * r;
    d += ` L ${inX} ${inY} Q ${cx} ${cy} ${outX} ${outY}`;
  }

  const last = pts[pts.length - 1];
  d += ` L ${last[0]} ${last[1]}`;
  return d;
}

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

    // 始终保持「水平 - 垂直 - 水平」的 90° 折线，只在拐点做小圆角；
    // 两端高度差极小时两个拐角会靠得很近，圆角半径会自动收缩到
    // 相邻线段长度的一半，不会退化成弧线或折返的尖刺
    const path = buildRoundedPath(
      [
        [sourceX, sourceY],
        [midX, sourceY],
        [midX, targetY],
        [targetX, targetY],
      ],
      borderRadius,
    );
    return [path, midX, midY];
  }

  // Vertical flow
  const midY = (sourceY + targetY) / 2 + bendOffset;
  const midX = (sourceX + targetX) / 2;

  const path = buildRoundedPath(
    [
      [sourceX, sourceY],
      [sourceX, midY],
      [targetX, midY],
      [targetX, targetY],
    ],
    borderRadius,
  );
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
  const lossEnabled = data?.lossEnabled !== false; // 默认参与链路损耗计算
  // 连接链路聚合器的边：损耗由聚合器卡片统一展示，边上不显示单条损耗
  const aggregatedLoss = data?._aggregatedLoss === true;
  const showLossValue = lossEnabled && !aggregatedLoss;
  const edgeLabel = data?.label;
  const customData = data?.customData;
  const isDesignMode = data?._mode === 'design';
  // 标签框只在有内容时渲染，避免关闭损耗计算后留下一个空的扁平方框
  const hasLabelContent = !!edgeLabel || showLossValue || (aggregatedLoss && isDesignMode);
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

  // 关闭链路损耗计算不改变链路颜色，固定显示绿色（即使残留旧损耗值）；
  // 连接链路聚合器的边损耗由聚合器统一展示，仍用中性灰色区分
  const color = aggregatedLoss ? '#bfbfbf' : lossEnabled ? getLossColor(lossPercent) : '#52c41a';

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
        strokeLinejoin="round"
        strokeLinecap="round"
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

          {/* Editable label area：有内容时才渲染标签框 */}
          {(hasLabelContent || editing) && (
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
                  {showLossValue && <div>{loss.toFixed(1)}W ({lossPercent.toFixed(1)}%)</div>}
                  {aggregatedLoss && !edgeLabel && isDesignMode && (
                    <div style={{ color: '#8c8c8c' }}>损耗由聚合器汇总</div>
                  )}
                </>
              )}
            </div>
          )}

          {/* 设计模式下无标签内容时，用一个小圆形「+」按钮作为添加标签入口，避免出现空的扁平方框 */}
          {!hasLabelContent && !editing && isDesignMode && (
            <div
              style={{
                width: 16,
                height: 16,
                margin: '10px auto 0',
                borderRadius: '50%',
                background: '#fff',
                border: `1px solid ${color}`,
                color,
                fontSize: 12,
                lineHeight: '14px',
                textAlign: 'center',
                cursor: 'text',
                userSelect: 'none',
                opacity: 0.75,
              }}
              onClick={handleLabelClick}
              title="点击添加标签"
            >
              +
            </div>
          )}

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
