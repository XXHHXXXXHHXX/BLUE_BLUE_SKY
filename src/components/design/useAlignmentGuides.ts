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
 *
 * 每个锚点（左/中/右、上/中/下）各自保留最近的一条参考线，
 * 避免中心对齐被边缘对齐“抢占”导致无法居中；吸附取所有候选中绝对差值最小的偏移。
 */
function computeSnap(dragNodes: TopologyNode[], others: TopologyNode[]): SnapResult {
  const main = dragNodes[0];
  if (!main) return { dx: 0, dy: 0, guides: [] };
  const mainBox = getNodeBox(main);

  // 每个锚点最近的参考线 { delta, guidePosition }
  const bestByAnchorX: (number | null)[] = [null, null, null]; // left / centerX / right
  const bestByAnchorY: (number | null)[] = [null, null, null]; // top / centerY / bottom
  const guideByAnchorX: (number | null)[] = [null, null, null];
  const guideByAnchorY: (number | null)[] = [null, null, null];

  const mainXs = [mainBox.left, mainBox.centerX, mainBox.right];
  const mainYs = [mainBox.top, mainBox.centerY, mainBox.bottom];

  for (const other of others) {
    const b = getNodeBox(other);
    const refXs = [b.left, b.centerX, b.right];
    const refYs = [b.top, b.centerY, b.bottom];

    // X 方向对齐（垂直参考线）
    for (let i = 0; i < 3; i++) {
      for (const refX of refXs) {
        const delta = refX - mainXs[i];
        if (Math.abs(delta) < SNAP_THRESHOLD && (bestByAnchorX[i] === null || Math.abs(delta) < Math.abs(bestByAnchorX[i]!))) {
          bestByAnchorX[i] = delta;
          guideByAnchorX[i] = refX;
        }
      }
    }

    // Y 方向对齐（水平参考线）
    for (let i = 0; i < 3; i++) {
      for (const refY of refYs) {
        const delta = refY - mainYs[i];
        if (Math.abs(delta) < SNAP_THRESHOLD && (bestByAnchorY[i] === null || Math.abs(delta) < Math.abs(bestByAnchorY[i]!))) {
          bestByAnchorY[i] = delta;
          guideByAnchorY[i] = refY;
        }
      }
    }
  }

  // 吸附偏移：取所有候选中绝对差值最小的
  let bestDx: number | null = null;
  let bestGuideX: number | null = null;
  let bestDy: number | null = null;
  let bestGuideY: number | null = null;

  for (let i = 0; i < 3; i++) {
    const d = bestByAnchorX[i];
    if (d !== null && (bestDx === null || Math.abs(d) < Math.abs(bestDx))) {
      bestDx = d;
      bestGuideX = guideByAnchorX[i];
    }
  }
  for (let i = 0; i < 3; i++) {
    const d = bestByAnchorY[i];
    if (d !== null && (bestDy === null || Math.abs(d) < Math.abs(bestDy))) {
      bestDy = d;
      bestGuideY = guideByAnchorY[i];
    }
  }

  const dx = bestDx ?? 0;
  const dy = bestDy ?? 0;

  // 参考线：每个锚点各自保留（去重）
  const guides: AlignmentGuide[] = [];
  const seenX = new Set<number>();
  const seenY = new Set<number>();
  for (let i = 0; i < 3; i++) {
    if (guideByAnchorX[i] !== null && !seenX.has(guideByAnchorX[i]!)) {
      seenX.add(guideByAnchorX[i]!);
      guides.push({ orientation: 'vertical', position: guideByAnchorX[i]! });
    }
  }
  for (let i = 0; i < 3; i++) {
    if (guideByAnchorY[i] !== null && !seenY.has(guideByAnchorY[i]!)) {
      seenY.add(guideByAnchorY[i]!);
      guides.push({ orientation: 'horizontal', position: guideByAnchorY[i]! });
    }
  }
  return { dx, dy, guides };
}

/**
 * 拖拽对齐参考线 Hook：拖拽节点时检测与其它模块的边缘/中心对齐并吸附
 *
 * 实现要点：
 * - 拖拽过程中不调用 setNodes/更新 store，避免与 React Flow 内部拖拽状态竞争导致卡住；
 *   仅用 onNodeDrag 传入的实时节点快照计算对齐并显示参考线。
 * - 松手（onNodeDragStop）时基于最终位置做一次吸附修正，一次性 setNodes + 更新 store。
 */
export function useAlignmentGuides() {
  const [guides, setGuides] = useState<AlignmentGuide[]>([]);
  const draggingRef = useRef(false);
  const { getNodes, setNodes } = useReactFlow<TopologyNode>();

  /** 提交吸附修正：把拖拽节点的位置加上 dx/dy，并同步 React Flow 内部状态与 store */
  const applySnap = useCallback(
    (dragIds: Set<string>, dx: number, dy: number) => {
      if ((dx === 0 && dy === 0) || dragIds.size === 0) return;

      const allNodes = getNodes();
      const updated = allNodes.map((n) => {
        if (dragIds.has(n.id)) {
          return { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } };
        }
        return n;
      });
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
    },
    [getNodes, setNodes],
  );

  /** 拖拽开始时重置参考线状态 */
  const handleNodeDragStart: OnNodeDrag<TopologyNode> = useCallback(() => {
    draggingRef.current = true;
    setGuides([]);
  }, []);

  /** 拖拽过程中：仅计算对齐参考线并显示，不修改节点位置（避免与拖拽状态竞争） */
  const handleNodeDrag: OnNodeDrag<TopologyNode> = useCallback(
    (_event, _node, nodes) => {
      if (!draggingRef.current || !nodes || nodes.length === 0) return;

      // nodes 是拖拽中的实时节点快照（React Flow 内部状态），无需 getNodes()
      const dragIds = new Set(nodes.map((n) => n.id));
      const allNodes = getNodes();
      const others = allNodes.filter((n) => !dragIds.has(n.id));
      const dragNodes = nodes as TopologyNode[];
      if (dragNodes.length === 0) return;

      // 仅计算参考线，不吸附移动位置
      const { guides: nextGuides } = computeSnap(dragNodes, others);
      setGuides(nextGuides);
    },
    [getNodes],
  );

  /** 拖拽结束时：基于最终位置做一次吸附修正，然后清空参考线 */
  const handleNodeDragStop: OnNodeDrag<TopologyNode> = useCallback(
    (_event, _node, nodes) => {
      draggingRef.current = false;
      if (!nodes || nodes.length === 0) {
        setGuides([]);
        return;
      }

      const dragIds = new Set(nodes.map((n) => n.id));
      const allNodes = getNodes();
      const others = allNodes.filter((n) => !dragIds.has(n.id));
      const dragNodes = nodes as TopologyNode[];

      if (dragNodes.length > 0) {
        const { dx, dy } = computeSnap(dragNodes, others);
        applySnap(dragIds, dx, dy);
      }

      setGuides([]);
    },
    [getNodes, applySnap],
  );

  return {
    guides,
    onNodeDragStart: handleNodeDragStart,
    onNodeDrag: handleNodeDrag,
    onNodeDragStop: handleNodeDragStop,
  };
}
