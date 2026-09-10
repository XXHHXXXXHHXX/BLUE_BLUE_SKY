'use client';

import { useState, useCallback } from 'react';
import { Button } from 'antd';
import { FullscreenOutlined, FullscreenExitOutlined } from '@ant-design/icons';

export interface UseMaximizableModalOptions {
  /** 缩小（默认）状态下的弹窗宽度 */
  minWidth?: number | string;
  /** 放大状态下的弹窗宽度，默认几乎占满屏幕 */
  maxWidth?: number | string;
  /** 缩小状态下表格默认 pageSize */
  minPageSize?: number;
  /** 放大状态下表格默认 pageSize，可显示更多行 */
  maxPageSize?: number;
  /** 表格横向滚动配置 */
  tableScrollX?: string | number;
  /** 表格固定高度滚动 */
  tableScrollY?: number | string;
}

export interface MaximizableModalHelpers {
  isMaximized: boolean;
  toggle: () => void;
  /** 可直接插入到 Modal title 右侧的放大/缩小按钮 */
  titleButton: React.ReactElement;
  /** 把原始标题包装成带放大/缩小按钮的标题 */
  renderTitle: (title: React.ReactNode) => React.ReactElement;
  /** 当前应使用的弹窗宽度 */
  width: number | string;
  /** 放大时需要的顶部偏移 */
  style: React.CSSProperties | undefined;
  /** Modal body 的滚动样式 */
  bodyStyle: React.CSSProperties;
  /** 当前应使用的表格 pageSize */
  pageSize: number;
  /** 表格滚动配置 */
  tableScroll: { x: string | number; y?: number | string };
}

/**
 * 为 Modal 提供 Windows 式放大/缩小能力。
 * 放大时弹窗变宽、body 变高，表格默认 pageSize 变大以显示更多行。
 */
export function useMaximizableModal(options: UseMaximizableModalOptions = {}): MaximizableModalHelpers {
  const {
    minWidth = 900,
    maxWidth = '95vw',
    minPageSize = 5,
    maxPageSize = 20,
    tableScrollX = 'max-content',
    tableScrollY,
  } = options;

  const [isMaximized, setIsMaximized] = useState(false);

  const toggle = useCallback(() => setIsMaximized((prev) => !prev), []);

  const titleButton = (
    <Button
      key="maximize-toggle"
      type="text"
      size="small"
      icon={isMaximized ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
      onClick={toggle}
      title={isMaximized ? '缩小' : '放大'}
    />
  );

  const renderTitle = (title: React.ReactNode) => (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingRight: 28,
        width: '100%',
      }}
    >
      <span>{title}</span>
      {titleButton}
    </div>
  );

  const width = isMaximized ? maxWidth : minWidth;
  const style: React.CSSProperties | undefined = isMaximized ? { top: 24 } : undefined;
  const bodyStyle: React.CSSProperties = {
    maxHeight: isMaximized ? 'calc(100vh - 180px)' : 'calc(100vh - 240px)',
    overflow: 'auto',
  };

  const pageSize = isMaximized ? maxPageSize : minPageSize;
  const tableScroll: { x: string | number; y?: number | string } = {
    x: tableScrollX,
  };
  if (tableScrollY !== undefined) {
    tableScroll.y = tableScrollY;
  }

  return {
    isMaximized,
    toggle,
    titleButton,
    renderTitle,
    width,
    style,
    bodyStyle,
    pageSize,
    tableScroll,
  };
}

export default useMaximizableModal;
