/** 关联查看组件收集：找出与每个节点相连的「查看组件」（view 节点）
 *
 * 需求：一个或多个查看组件连到某个其他组件时，该其他组件旁边应出现一个
 * 抽屉按钮，可展开查看与它相连的查看组件，也可随时收起。
 *
 * 返回 Map<节点 id, 与该节点相连的查看组件节点列表>。
 * 仅统计「查看组件 ↔ 其他组件」的连线，查看组件之间的连线不计入。
 */
import type { TopologyNode, TopologyEdge } from '../types/topology';

export function collectLinkedViews(
  nodes: TopologyNode[],
  edges: TopologyEdge[],
): Map<string, TopologyNode[]> {
  const result = new Map<string, TopologyNode[]>();
  const viewNodes = new Map<string, TopologyNode>();
  nodes.forEach((n) => {
    if ((n.data as { nodeType?: string } | undefined)?.nodeType === 'view') {
      viewNodes.set(n.id, n);
    }
  });
  if (viewNodes.size === 0) return result;

  const push = (targetId: string, view: TopologyNode) => {
    const list = result.get(targetId);
    if (list) {
      if (!list.some((v) => v.id === view.id)) list.push(view);
    } else {
      result.set(targetId, [view]);
    }
  };

  edges.forEach((edge) => {
    // 控制关系边表示控制关系，不作为「查看」关联
    if (edge.type === 'controlEdge') return;
    const sourceView = viewNodes.get(edge.source);
    const targetView = viewNodes.get(edge.target);
    // 查看组件 → 其他组件
    if (sourceView && !targetView) push(edge.target, sourceView);
    // 其他组件 → 查看组件
    if (targetView && !sourceView) push(edge.source, targetView);
  });

  return result;
}
