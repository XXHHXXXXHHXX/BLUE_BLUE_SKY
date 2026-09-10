'use client';

import React from 'react';

/**
 * 交互隔离区域：通过 nodrag / nopan / nowheel CSS 类
 * 告知 React Flow 不要在此区域内启动拖拽/平移/缩放。
 *
 * 注意：不能使用 stopPropagation，否则会阻止 React 18 的事件委托机制，
 * 导致 Ant Design Slider 等组件无法接收合成事件。
 */
const InteractiveZone: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className,
}) => {
  return (
    <div
      className={`nodrag nopan nowheel ${className ?? ''}`}
      style={{ pointerEvents: 'all', position: 'relative', zIndex: 10 }}
    >
      {children}
    </div>
  );
};

export default InteractiveZone;
