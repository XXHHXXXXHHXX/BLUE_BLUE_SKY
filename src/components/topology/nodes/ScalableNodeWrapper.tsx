'use client';

import React, { useCallback, useRef } from 'react';
import { type NodeProps, Handle, Position } from '@xyflow/react';
import { useTopologyStore } from '../../../stores/topologyStore';
import { getNodeLossFieldAnnotation } from '../../../services/lossCalculation';

/**
 * 四侧连接点组件：为节点提供上/下/左/右各方向的 source 和 target Handle。
 * Handle 放在缩放容器外部，这样无论节点如何缩放，Handle 始终保持在固定位置。
 */
const ScalableHandles: React.FC = () => (
  <>
    {/* 默认 Handle（无 id，向后兼容） */}
    <Handle type="target" position={Position.Left} />
    <Handle type="source" position={Position.Right} />

    {/* 额外 Handle（带 id） */}
    <Handle type="target" position={Position.Top} id="target-top" />
    <Handle type="source" position={Position.Top} id="source-top" />

    <Handle type="target" position={Position.Bottom} id="target-bottom" />
    <Handle type="source" position={Position.Bottom} id="source-bottom" />

    <Handle type="target" position={Position.Right} id="target-right" />
    <Handle type="source" position={Position.Left} id="source-left" />
  </>
);

/** 读取用户自定义渲染颜色（nodeColor），作为 CSS 变量注入卡片 */
function getNodeColorVar(data: Record<string, unknown>): React.CSSProperties | undefined {
  const color = data?.nodeColor as string | undefined;
  if (!color || typeof color !== 'string' || !color.trim()) return undefined;
  return { ['--node-color' as string]: color.trim() } as React.CSSProperties;
}

/** 链路损耗计算字段标注徽标（仅设计模式显示） */
const LossFieldBadge: React.FC<{ data: Record<string, unknown> }> = ({ data }) => {
  if (data?._mode !== 'design') return null;
  const annotation = getNodeLossFieldAnnotation(data?.nodeType as string | undefined);
  if (!annotation?.source && !annotation?.target) return null;

  let text: string;
  let detail: string;
  if (annotation.source && annotation.target) {
    if (annotation.source.key === annotation.target.key) {
      text = `链路损耗计算: ${annotation.source.key}`;
      detail = `链路损耗计算字段：${annotation.source.label}（${annotation.source.key}）`;
    } else {
      text = `链路损耗: ${annotation.source.key} / ${annotation.target.key}`;
      detail = `链路损耗计算：上游(源)用 ${annotation.source.label}(${annotation.source.key})，下游(目标)用 ${annotation.target.label}(${annotation.target.key})`;
    }
  } else {
    const def = annotation.source ?? annotation.target!;
    text = `链路损耗计算: ${def.key}`;
    detail = `链路损耗计算字段：${def.label}（${def.key}）`;
  }

  return (
    <div
      className="node-loss-field-badge nodrag nopan"
      title={detail}
      style={{
        marginTop: 6,
        padding: '2px 6px',
        fontSize: 10,
        lineHeight: 1.4,
        background: '#fff7e6',
        border: '1px solid #ffd591',
        borderRadius: 4,
        color: '#d46b08',
        whiteSpace: 'nowrap',
      }}
    >
      {text}
    </div>
  );
};

/**
 * HOC: 给节点添加缩放功能和关联高亮
 * - transform: scale() 等比例缩放节点内容
 * - hover 时在四个角显示缩放手柄，拖拽可等比例缩放
 * - _highlighted 标记时显示高亮边框
 * 
 * 关键点：Handle 放在缩放区域之外，这样无论节点如何缩放，
 * 连线的箭头始终吸附在相同的位置（节点边缘固定位置）
 */
export function withScalable(Component: React.FC<NodeProps>): React.FC<NodeProps> {
  const WrappedComponent: React.FC<NodeProps> = (props) => {
    const scale = useTopologyStore((s) => s.nodeScales[props.id] ?? 1);
    const setNodeScale = useTopologyStore((s) => s.setNodeScale);
    const data = props.data as Record<string, unknown>;
    const highlighted = data?._highlighted === true;
    const isDesignMode = data?._mode === 'design';

    const dragStartRef = useRef<{ startX: number; startY: number; startScale: number } | null>(null);

    const handleResizePointerDown = useCallback(
      (e: React.PointerEvent) => {
        e.stopPropagation();
        e.preventDefault();
        const target = e.currentTarget as HTMLElement;
        target.setPointerCapture(e.pointerId);
        dragStartRef.current = {
          startX: e.clientX,
          startY: e.clientY,
          startScale: scale,
        };
      },
      [scale],
    );

    const handleResizePointerMove = useCallback(
      (e: React.PointerEvent) => {
        if (!dragStartRef.current) return;
        const { startX, startY, startScale } = dragStartRef.current;
        // 使用鼠标移动距离的最大分量来决定缩放
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        // 取对角线方向的投影距离（右下为正）
        const dist = (dx + dy) / 2;
        const scaleDelta = dist / 150; // 150px 拖拽 = 1x 缩放变化
        const newScale = Math.min(2, Math.max(0.5, +(startScale + scaleDelta).toFixed(2)));
        setNodeScale(props.id, newScale);
      },
      [props.id, setNodeScale],
    );

    const handleResizePointerUp = useCallback(
      (e: React.PointerEvent) => {
        if (!dragStartRef.current) return;
        const target = e.currentTarget as HTMLElement;
        target.releasePointerCapture(e.pointerId);
        dragStartRef.current = null;
      },
      [],
    );

    const handleDoubleClick = useCallback(
      (e: React.MouseEvent) => {
        // 双击手柄重置缩放
        e.stopPropagation();
        setNodeScale(props.id, 1);
      },
      [props.id, setNodeScale],
    );

    const cornerHandleProps = {
      className: 'node-resize-handle nodrag nopan',
      onPointerDown: handleResizePointerDown,
      onPointerMove: handleResizePointerMove,
      onPointerUp: handleResizePointerUp,
      onDoubleClick: handleDoubleClick,
    };

    return (
      <div
        className={`scalable-node-wrapper${highlighted ? ' node-highlighted' : ''}`}
        style={getNodeColorVar(data)}
      >
        {/* Handle 放在缩放区域之外，保持固定位置 */}
        <ScalableHandles />
        
        {/* 内容区域：应用缩放 */}
        <div
          className="scalable-node-content"
          style={{
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
          }}
        >
          {/* 渲染节点内容 - Handle 由 HOC 统一管理 */}
          <Component {...props} />
          {/* 设计模式下标注链路损耗计算字段 */}
          {isDesignMode && <LossFieldBadge data={data} />}
        </div>
        
        {/* 缩放手柄 */}
        <div {...cornerHandleProps} style={{ top: -4, left: -4, cursor: 'nwse-resize' }} />
        <div {...cornerHandleProps} style={{ top: -4, right: -4, cursor: 'nesw-resize' }} />
        <div {...cornerHandleProps} style={{ bottom: -4, left: -4, cursor: 'nesw-resize' }} />
        <div {...cornerHandleProps} style={{ bottom: -4, right: -4, cursor: 'nwse-resize' }} />
        {scale !== 1 && (
          <div className="node-scale-badge nodrag nopan">{Math.round(scale * 100)}%</div>
        )}
      </div>
    );
  };

  WrappedComponent.displayName = `Scalable(${Component.displayName || Component.name || 'Component'})`;
  return WrappedComponent;
}

/**
 * 静态 Handle 组件 - 用于不带缩放的节点
 */
const StaticHandles: React.FC = () => (
  <>
    {/* 默认 Handle（无 id，向后兼容） */}
    <Handle type="target" position={Position.Left} />
    <Handle type="source" position={Position.Right} />

    {/* 额外 Handle（带 id） */}
    <Handle type="target" position={Position.Top} id="target-top" />
    <Handle type="source" position={Position.Top} id="source-top" />

    <Handle type="target" position={Position.Bottom} id="target-bottom" />
    <Handle type="source" position={Position.Bottom} id="source-bottom" />

    <Handle type="target" position={Position.Right} id="target-right" />
    <Handle type="source" position={Position.Left} id="source-left" />
  </>
);

/**
 * HOC: 不启用缩放的节点包装器
 * 用于监控页面和分身页面，禁用缩放功能
 */
export function withoutScalable(Component: React.FC<NodeProps>): React.FC<NodeProps> {
  const WrappedComponent: React.FC<NodeProps> = (props) => {
    const data = props.data as Record<string, unknown>;
    const highlighted = data?._highlighted === true;

    return (
      <div
        className={`scalable-node-wrapper${highlighted ? ' node-highlighted' : ''}`}
        style={getNodeColorVar(data)}
      >
        <StaticHandles />
        <Component {...props} />
      </div>
    );
  };

  WrappedComponent.displayName = `Static(${Component.displayName || Component.name || 'Component'})`;
  return WrappedComponent;
}
