'use client';

import React from 'react';
import { Handle, Position } from '@xyflow/react';

/**
 * 四侧连接点组件：为节点提供上/下/左/右各方向的 source 和 target Handle。
 * - Left target 和 Right source 不设 id，保持与旧边数据的向后兼容。
 * - 其余 Handle 设置唯一 id，新建边时通过 sourceHandle/targetHandle 引用。
 */
const MultiSideHandles: React.FC = () => (
  <>
    {/* 左侧 Handle */}
    <Handle type="target" position={Position.Left} id="target-left" />
    <Handle type="source" position={Position.Left} id="source-left" />

    {/* 右侧 Handle */}
    <Handle type="target" position={Position.Right} id="target-right" />
    <Handle type="source" position={Position.Right} id="source-right" />

    {/* 顶部 Handle */}
    <Handle type="target" position={Position.Top} id="target-top" />
    <Handle type="source" position={Position.Top} id="source-top" />

    {/* 底部 Handle */}
    <Handle type="target" position={Position.Bottom} id="target-bottom" />
    <Handle type="source" position={Position.Bottom} id="source-bottom" />
  </>
);

export default MultiSideHandles;
