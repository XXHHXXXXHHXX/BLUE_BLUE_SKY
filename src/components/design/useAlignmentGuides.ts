'use client';

import { useCallback, useRef, useState } from 'react';
import { useReactFlow, type OnNodeDrag } from '@xyflow/react';
import { useDesignTopologyStore } from '../../stores/designTopologyStore';
import type { TopologyNode } from '../../types/topology';

/** 对齐吸附阈值（px），拖拽距离小于该值时自动吸附并显示参考线 */
const SNAP_THRESHOLD = 8;

/** 节点默认尺寸（当 measured 尚未测量时兜底） */
const DEFAULT_W = 200;
const DEFAULT_H = 100;

/** 对齐参考线 */
export interface AlignmentGuide {
  orientation: 'vertical' | 'horizontal';
  /** 参考线位置（flow 坐标） */
  position: number;
}

interface NodeBox {
  left: number;
  right: number;
  centerX: number;
  top: number;
  bottom: number;
  centerY: number;
}

interface SnapResult {
  dx: number;
  dy: number;
  guides: AlignmentGuide[];
}

/** 获取节点矩形（考虑节点缩放比例） */
function getNodeBox(node: TopologyNode): NodeBox {
  const scale = useDesignTopologyStore.getState().nodeScales[node.id] ?? 1;
  const w = (node.measured?.width ?? DEFAULT_W) * scale;
  const h = (node.measured?.height ?? DEFAULT_H) * scale;
  const x = node.position.x;
  const y = node.position.y;
  return {
    left: x,
    right: x + w,
    centerX: x + w / 2,
    top: y,
    bottom: y + h,
    centerY: y + h / 2,
  };
}

/**
 * 计算拖拽节点相对其它节点的对齐吸附量与参考线
 * - 垂直参考线：左边缘 / 中心 / 右边缘 对齐
 * - 水平参考线：上边缘 / 中心 / 下边缘 对齐
 */
function computeSnap(dragNodes: TopologyNode[], others: TopologyNode[]): SnapResult {
  const main = dragNodes[0];
  if (!main) return { dx: 0, dy: 0, guides: [] };
  const mainBox = getNodeBox(main);

  let bestDx: number | null = null;
  let bestGuideX: number | null = null;

  let bestDy: number | null = null;
  let bestGuideY: number | null = null;

  const mainXs = [mainBox.left, mainBox.centerX, mainBox.right];
  const mainYs = [mainBox.top, mainBox.centerY, mainBox.bottom];

  for (const other of others) {
    const b = getNodeBox(other);
    const refXs = [b.left, b.centerX, b.right];
    const refYs = [b.top, b.centerY, b.bottom];

    // X 方向对齐（垂直参考线）
    for (const myX of mainXs) {
      for (const refX of refXs) {
        const delta = refX - myX;
        if (Math.abs(delta) < SNAP_THRESHOLD && (bestDx === null || Math.abs(delta) < Math.abs(bestDx))) {
          bestDx = delta;
          bestGuideX = refX;
        }
      }
    }

    // Y 方向对齐（水平参考线）
    for (const myY of mainYs) {
      for (const refY of refYs) {
        const delta = refY - myY;
        if (Math.abs(delta) < SNAP_THRESHOLD && (bestDy === null || Math.abs(delta) < Math.abs(bestDy))) {
          bestDy = delta;
          bestGuideY = refY;
        }
      }
    }
  }

  const dx = bestDx ?? 0;
  const dy = bestDy ?? 0;
  const guides: AlignmentGuide[] = [];
  if (bestGuideX !== null) {
    guides.push({ orientation: 'vertical', position: bestGuideX });
  }
  if (bestGuideY !== null) {
    guides.push({ orientation: 'horizontal', position: bestGuideY });
  }
  return { dx, dy, guides };
}

/**
 * 拖拽对齐参考线 Hook：拖拽节点时检测与其它模块的边缘/中心对齐并吸附
 *
 * 使用 useReactFlow 的 getNodes/setNodes 与 React Flow 内部拖拽状态同步，
 * 避免手动更新 store 导致与 React Flow 拖拽位置竞争产生抖动。
 */
export function useAlignmentGuides() {
  const [guides, setGuides] = useState<AlignmentGuide[]>([]);
  const draggingRef = useRef(false);
  const { getNodes, setNodes } = useReactFlow();

  /** 拖拽开始时重置参考线状态 */
  const handleNodeDragStart: OnNodeDrag<TopologyNode> = useCallback(() => {
    draggingRef.current = true;
    setGuides([]);
  }, []);

  /** 拖拽过程中检测对齐并吸附 */
  const handleNodeDrag: OnNodeDrag<TopologyNode> = useCallback(
    (_event, _node, nodes) => {
      if (!draggingRef.current || !nodes || nodes.length === 0) return;

      // 使用 React Flow 内部节点（含拖拽中的最新位置）
      const allNodes = getNodes();
      const dragIds = new Set(nodes.map((n) => n.id));
      const others = allNodes.filter((n) => !dragIds.has(n.id));
      const dragNodes = allNodes.filter((n) => dragIds.has(n.id));
      if (dragNodes.length === 0) return;

      const { dx, dy, guides: nextGuides } = computeSnap(dragNodes, others);

      if (dx !== 0 || dy !== 0) {
        // 更新 React Flow 内部节点（含拖拽最新位置 + 吸附修正）
        const updated = allNodes.map((n) => {
          if (dragIds.has(n.id)) {
            return { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } };
          }
          return n;
        });
        // 同步 React Flow 内部状态，避免下一帧拖拽基准被未吸附位置覆盖
        setNodes(updated);
        // 同步到 store：只更新 position，保留 store 节点的原有字段
        const storeNodes = useDesignTopologyStore.getState().nodes;
        useDesignTopologyStore.getState().updateNodes(
          storeNodes.map((n) =>
            dragIds.has(n.id)
              ? { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } }
              : n,
          ),
        );
      }

      setGuides(nextGuides);
    },
    [getNodes, setNodes],
  );

  /** 拖拽结束时清空参考线 */
  const handleNodeDragStop: OnNodeDrag<TopologyNode> = useCallback(() => {
    draggingRef.current = false;
    setGuides([]);
  }, []);

  return {
    guides,
    onNodeDragStart: handleNodeDragStart,
    onNodeDrag: handleNodeDrag,
    onNodeDragStop: handleNodeDragStop,
  };
}
