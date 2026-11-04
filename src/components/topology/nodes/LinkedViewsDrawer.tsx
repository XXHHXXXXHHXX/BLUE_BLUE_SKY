'use client';

import React, { useCallback, useRef, useState } from 'react';
import { type NodeProps } from '@xyflow/react';
import { EyeOutlined, RightOutlined, DownOutlined } from '@ant-design/icons';
import ViewNode from './ViewNode';
import type { TopologyNode } from '../../../types/topology';

interface LinkedViewsDrawerProps {
  /** 与宿主节点相连的查看组件列表（由画布注入 data._linkedViews） */
  views: TopologyNode[];
  /** 宿主节点当前所处模式，透传给查看组件以保持一致的渲染行为 */
  mode?: 'design' | 'monitor';
}

/**
 * 关联查看组件抽屉
 *
 * 当有一个或多个「查看组件」连线到当前节点时，在节点右侧显示一个抽屉按钮，
 * 点击后用一个额外的白色容器展开这些查看组件（可交互），再次点击收起。
 * 展开时提升所在 React Flow 节点的层级，避免被相邻节点遮挡。
 */
const LinkedViewsDrawer: React.FC<LinkedViewsDrawerProps> = ({ views, mode }) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  // 记录展开前的节点层级，收起时还原
  const prevZIndexRef = useRef<string>('');

  const toggle = useCallback((e: React.MouseEvent) => {
    // 阻止冒泡，避免触发节点选中/双击打开编辑面板
    e.stopPropagation();
    const next = !open;
    // 展开时提升所在 React Flow 节点层级，收起时还原，避免被相邻节点遮挡
    const nodeEl = rootRef.current?.closest('.react-flow__node') as HTMLElement | null;
    if (nodeEl) {
      if (next) {
        prevZIndexRef.current = nodeEl.style.zIndex;
        nodeEl.style.zIndex = '1000';
      } else {
        nodeEl.style.zIndex = prevZIndexRef.current;
      }
    }
    setOpen(next);
  }, [open]);

  if (views.length === 0) return null;

  return (
    <div ref={rootRef} className="linked-views-drawer nodrag nopan">
      <div
        className={`linked-views-toggle${open ? ' is-open' : ''}`}
        onClick={toggle}
        title={open ? '收起关联查看组件' : `展开关联查看组件（${views.length}）`}
      >
        <EyeOutlined />
        <span className="linked-views-toggle-count">{views.length}</span>
        {open ? <DownOutlined /> : <RightOutlined />}
      </div>

      {open && (
        <div className="linked-views-panel nodrag nopan" onClick={(e) => e.stopPropagation()}>
          <div className="linked-views-panel-header">
            关联查看组件（{views.length}）
          </div>
          <div className="linked-views-panel-body">
            {views.map((view) => (
              <div className="linked-views-item" key={view.id}>
                <ViewNode
                  {...({
                    ...view,
                    data: { ...view.data, ...(mode ? { _mode: mode } : {}) },
                  } as unknown as NodeProps)}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default LinkedViewsDrawer;
