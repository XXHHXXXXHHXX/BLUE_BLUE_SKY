'use client';

import React, { createContext, useContext } from 'react';

/**
 * 节点缩放上下文
 *
 * 设计页 / 监控页 / 分身页各自使用独立的 store 保存 nodeScales，
 * 节点包装器通过本上下文读取当前画布对应的缩放表，避免硬编码某个 store
 * 导致「设计页有效、监控页无效」。
 */
export interface NodeScaleContextValue {
  /** 节点 id → 缩放比例（1 表示原始大小） */
  nodeScales: Record<string, number>;
  /** 设置某个节点的缩放比例（监控/分身页只读，可不提供） */
  setNodeScale?: (nodeId: string, scale: number) => void;
}

const NodeScaleContext = createContext<NodeScaleContextValue | null>(null);

export const NodeScaleProvider: React.FC<{
  value: NodeScaleContextValue;
  children: React.ReactNode;
}> = ({ value, children }) => (
  <NodeScaleContext.Provider value={value}>{children}</NodeScaleContext.Provider>
);

/** 读取缩放上下文；未提供时返回 null（由调用方回退到默认 store） */
export function useNodeScaleContext(): NodeScaleContextValue | null {
  return useContext(NodeScaleContext);
}
