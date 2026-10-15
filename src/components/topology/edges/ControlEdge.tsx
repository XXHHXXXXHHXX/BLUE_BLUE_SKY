'use client';

import React from 'react';
import { type EdgeProps, getSmoothStepPath, EdgeLabelRenderer } from '@xyflow/react';

interface ControlEdgeLocal {
  label?: string;
  color?: string;
  [key: string]: unknown;
}

/**
 * 控制关系边：控制模块 → 被控制模块
 * 使用虚线表示控制关系，与功率连线（实线）区分
 */
const ControlEdge: React.FC<EdgeProps> = ({
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

  const local = data as ControlEdgeLocal | undefined;
  const color = local?.color || '#722ed1';
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
              background: '#f9f0ff',
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

export default ControlEdge;
