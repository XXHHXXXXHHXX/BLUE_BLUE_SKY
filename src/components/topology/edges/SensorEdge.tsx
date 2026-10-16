'use client';

import React from 'react';
import { type EdgeProps, getSmoothStepPath, EdgeLabelRenderer } from '@xyflow/react';

interface SensorEdgeLocal {
  label?: string;
  color?: string;
  [key: string]: unknown;
}

/**
 * 传感器关联边：传感器 → 任意被监测模块
 * 使用绿色虚线表示传感器监测关系，与功率连线（实线）和控制边（紫色虚线）区分
 */
const SensorEdge: React.FC<EdgeProps> = ({
  id,
  data,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
}) => {
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 8,
    offset: 20,
  });

  const local = data as SensorEdgeLocal | undefined;
  const color = local?.color || '#52c41a';
  const label = local?.label;

  return (
    <>
      <path
        id={id}
        d={edgePath}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeDasharray="8 4"
        style={style}
      />
      {label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              fontSize: 10,
              fontWeight: 500,
              background: '#f6ffed',
              border: `1px solid ${color}`,
              borderRadius: 4,
              padding: '1px 6px',
              color,
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
            }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
};

export default SensorEdge;
