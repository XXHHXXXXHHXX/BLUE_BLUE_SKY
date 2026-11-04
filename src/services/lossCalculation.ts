/** 链路损耗计算：字段定义与取值逻辑（前后端共用，单一数据源）
 *
 * 损耗规则：链路损耗 = 上游(源)节点输出功率 − 下游(目标)节点输入功率
 *   - 电源类模块（ac/psu/vr/psip/busbar）：
 *       · 作为上游时，使用输出侧功率字段参与计算
 *       · 作为下游时，使用输入侧功率字段参与计算
 *   - 负载类模块（cpu/memory/fan/disk/io/card）：功耗 power 即其输入功率
 *   - 自定义模块：displayMetrics.power
 *   - 母线（busbar）：母线功耗 busbarPower 作为唯一链路功率，双向计算
 */
import type { TopologyNode, TopologyEdge } from '../types/topology';
import type {
  CPUData, MemoryData, FanData, DiskData, IOData, CardData, SourceData,
} from '../types/power';

/** 链路聚合器节点类型：自身不采集功率，上游输出与下游输入均由连线汇总 */
export const AGGREGATOR_NODE_TYPE = 'aggregator';

/** 链路聚合器统计结果 */
export interface AggregatorStats {
  /** 上游（连线到聚合器）各模块输出功耗之和 */
  upstreamPower: number;
  /** 下游（聚合器连线出去）各模块输入功耗之和 */
  downstreamPower: number;
  /** 整体链路损耗 = 上游输出之和 − 下游输入之和（不小于 0） */
  loss: number;
  /** 损耗百分比 = 损耗 / 上游输出之和 */
  lossPercent: number;
  /** 参与统计的上游/下游连线数量 */
  upstreamCount: number;
  downstreamCount: number;
}

/** 电源类模块（使用 sourceData 结构） */
export const SOURCE_TYPE_NODES = ['ac', 'psu', 'vr', 'psip', 'busbar'];

/** 负载类模块（使用 xxxData.power） */
export const LOAD_TYPE_NODES = ['cpu', 'memory', 'fan', 'disk', 'io', 'card'];

/** 每种节点类型用于链路损耗计算的字段
 *  source: 作为上游（源）时参与计算的字段
 *  target: 作为下游（目标）时参与计算的字段
 */
export interface LossFieldDef {
  key: string;
  label: string;
}

export interface LossFieldAnnotation {
  source: LossFieldDef | null;
  target: LossFieldDef | null;
}

export const LOSS_FIELD_MAP: Record<string, LossFieldAnnotation> = {
  ac:     { source: { key: 'outputPower', label: 'AC输出功率' }, target: { key: 'inputPower', label: 'AC输入功率' } },
  psu:    { source: { key: 'outputPower', label: 'PSU输出功率' }, target: { key: 'inputPower', label: 'PSU输入功率' } },
  vr:     { source: { key: 'outputPower', label: 'VR输出功率' }, target: { key: 'inputPower', label: 'VR输入功率' } },
  psip:   { source: { key: 'outputPower', label: 'PSIP输出功率' }, target: { key: 'inputPower', label: 'PSIP输入功率' } },
  busbar: { source: { key: 'busbarPower', label: '母线功耗' }, target: { key: 'busbarPower', label: '母线功耗' } },
  cpu:    { source: { key: 'power', label: 'CPU功耗' }, target: { key: 'power', label: 'CPU功耗' } },
  memory: { source: { key: 'power', label: '内存功耗' }, target: { key: 'power', label: '内存功耗' } },
  fan:    { source: { key: 'power', label: '风扇总功耗' }, target: { key: 'power', label: '风扇总功耗' } },
  disk:   { source: { key: 'power', label: '硬盘背板功耗' }, target: { key: 'power', label: '硬盘背板功耗' } },
  io:     { source: { key: 'power', label: '功耗' }, target: { key: 'power', label: '功耗' } },
  card:   { source: { key: 'power', label: '标卡功耗' }, target: { key: 'power', label: '标卡功耗' } },
  custom: { source: { key: 'power', label: '功耗' }, target: { key: 'power', label: '功耗' } },
};

/** 获取节点类型对应的链路损耗字段标注（无损耗数据的节点返回 null） */
export function getNodeLossFieldAnnotation(nodeType: string | undefined | null): LossFieldAnnotation | null {
  if (!nodeType) return null;
  return LOSS_FIELD_MAP[nodeType] ?? null;
}

/** 从 sourceData 中按字段 key 取值 */
function getSourceDataValue(sourceData: SourceData | undefined, key: string): number | null {
  switch (key) {
    case 'inputPower':
      return sourceData?.inputPower ?? null;
    case 'outputPower':
      return sourceData?.outputPower ?? null;
    case 'busbarPower':
      return sourceData?.busbarPower ?? null;
    default:
      return null;
  }
}

/** 获取节点作为上游（source）时的输出功率，用于链路损耗计算 */
export function getNodeSourcePower(node: TopologyNode): number | null {
  const data = node.data as Record<string, unknown>;
  const nodeType = data.nodeType as string;
  const annotation = getNodeLossFieldAnnotation(nodeType);
  if (!annotation?.source) return null;
  const key = annotation.source.key;

  if (SOURCE_TYPE_NODES.includes(nodeType)) {
    return getSourceDataValue(data.sourceData as SourceData | undefined, key);
  }

  if (LOAD_TYPE_NODES.includes(nodeType)) {
    const loadData = (data.cpuData || data.memoryData || data.fanData || data.diskData || data.ioData || data.cardData) as
      (CPUData | MemoryData | FanData | DiskData | IOData | CardData) | undefined;
    return loadData?.power ?? null;
  }

  if (nodeType === 'custom') {
    const displayMetrics = data.displayMetrics as Record<string, number | null> | undefined;
    return displayMetrics?.power ?? null;
  }

  return null;
}

/** 获取节点作为下游（target）时的输入功率，用于链路损耗计算 */
export function getNodeTargetPower(node: TopologyNode): number | null {
  const data = node.data as Record<string, unknown>;
  const nodeType = data.nodeType as string;
  const annotation = getNodeLossFieldAnnotation(nodeType);
  if (!annotation?.target) return null;
  const key = annotation.target.key;

  if (SOURCE_TYPE_NODES.includes(nodeType)) {
    return getSourceDataValue(data.sourceData as SourceData | undefined, key);
  }

  if (LOAD_TYPE_NODES.includes(nodeType)) {
    const loadData = (data.cpuData || data.memoryData || data.fanData || data.diskData || data.ioData || data.cardData) as
      (CPUData | MemoryData | FanData | DiskData | IOData | CardData) | undefined;
    return loadData?.power ?? null;
  }

  if (nodeType === 'custom') {
    const displayMetrics = data.displayMetrics as Record<string, number | null> | undefined;
    return displayMetrics?.power ?? null;
  }

  return null;
}

/** 计算所有链路聚合器的汇总统计
 *
 * 聚合器自身不采集功率，它的“上游输出”是连入它的各模块输出功耗之和，
 * “下游输入”是它连出的各模块输入功耗之和，二者之差即整体链路损耗。
 * 这样多个模块共享同一个上游输出时，不会被重复计入每条链路。
 */
export function calculateAggregatorStats(
  nodes: TopologyNode[],
  edges: TopologyEdge[],
): Map<string, AggregatorStats> {
  const result = new Map<string, AggregatorStats>();
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const aggregatorIds = new Set(
    nodes
      .filter((n) => (n.data as { nodeType?: string } | undefined)?.nodeType === AGGREGATOR_NODE_TYPE)
      .map((n) => n.id),
  );
  if (aggregatorIds.size === 0) return result;

  const upstreamSum = new Map<string, number>();
  const downstreamSum = new Map<string, number>();
  const upstreamCount = new Map<string, number>();
  const downstreamCount = new Map<string, number>();

  edges.forEach((edge) => {
    if (edge.type === 'controlEdge' || edge.type === 'sensorEdge') return;
    const edgeData = (edge.data || {}) as { lossEnabled?: boolean; _reversed?: boolean };
    if (edgeData.lossEnabled === false) return;

    const actualSource = edgeData._reversed === true ? edge.target : edge.source;
    const actualTarget = edgeData._reversed === true ? edge.source : edge.target;
    if (aggregatorIds.has(actualSource) && aggregatorIds.has(actualTarget)) return;

    if (aggregatorIds.has(actualTarget)) {
      // 上游：普通模块 → 聚合器，取该模块的输出功耗
      const sourceNode = nodeMap.get(actualSource);
      const power = sourceNode ? getNodeSourcePower(sourceNode) : null;
      if (power !== null && power !== undefined && !Number.isNaN(power)) {
        upstreamSum.set(actualTarget, (upstreamSum.get(actualTarget) ?? 0) + power);
        upstreamCount.set(actualTarget, (upstreamCount.get(actualTarget) ?? 0) + 1);
      }
      return;
    }

    if (aggregatorIds.has(actualSource)) {
      // 下游：聚合器 → 普通模块，取该模块的输入功耗
      const targetNode = nodeMap.get(actualTarget);
      const power = targetNode ? getNodeTargetPower(targetNode) : null;
      if (power !== null && power !== undefined && !Number.isNaN(power)) {
        downstreamSum.set(actualSource, (downstreamSum.get(actualSource) ?? 0) + power);
        downstreamCount.set(actualSource, (downstreamCount.get(actualSource) ?? 0) + 1);
      }
    }
  });

  aggregatorIds.forEach((id) => {
    const upstreamPower = upstreamSum.get(id) ?? 0;
    const downstreamPower = downstreamSum.get(id) ?? 0;
    const upCount = upstreamCount.get(id) ?? 0;
    const downCount = downstreamCount.get(id) ?? 0;
    // 只有上游、下游都有连线时链路才完整，才能计算整体损耗
    const complete = upCount > 0 && downCount > 0;
    const loss = complete ? Math.max(0, upstreamPower - downstreamPower) : 0;
    const lossPercent = complete && upstreamPower > 0 ? (loss / upstreamPower) * 100 : 0;
    result.set(id, {
      upstreamPower: Number(upstreamPower.toFixed(2)),
      downstreamPower: Number(downstreamPower.toFixed(2)),
      loss: Number(loss.toFixed(2)),
      lossPercent: Number(lossPercent.toFixed(2)),
      upstreamCount: upCount,
      downstreamCount: downCount,
    });
  });

  return result;
}

/** 计算边的损耗（基于真实功率）
 * 损耗 = 源节点输出功率 - 目标节点输入功率
 * 损耗百分比 = 损耗 / 源节点输出功率 * 100
 *
 * 链路损耗标注：连线后按以下规则计算
 *   - 对于电源类模块：作为上游时用输出功率，作为下游时用输入功率
 *   - 对于负载类模块：功耗 power 即其输入功率
 *   - 对于母线节点 busbar：母线功耗作为链路损耗的双向计算，上游和下游的损失
 *     都使用母线功耗作为唯一链路计算（上游损失 = 上游输出功率 - 母线功耗，
 *     下游损失 = 母线功耗 - 下游输入功率）
 *
 * 对于一对多的连接，按各子节点输入功率比例分配总损耗
 *
 * 注意：如果边的 _reversed 为 true，表示方向已翻转，需要交换 source/target 计算
 */
export function calculateEdgeLosses(nodes: TopologyNode[], edges: TopologyEdge[]): TopologyEdge[] {
  // 创建节点功率映射表
  const nodeSourcePowerMap = new Map<string, number | null>();
  const nodeTargetPowerMap = new Map<string, number | null>();
  nodes.forEach(node => {
    nodeSourcePowerMap.set(node.id, getNodeSourcePower(node));
    nodeTargetPowerMap.set(node.id, getNodeTargetPower(node));
  });

  // 链路聚合器节点：与其相连的边不单独计算损耗，损耗统一由聚合器汇总展示
  const aggregatorIds = new Set(
    nodes
      .filter((n) => (n.data as { nodeType?: string } | undefined)?.nodeType === AGGREGATOR_NODE_TYPE)
      .map((n) => n.id),
  );

  // 按 actualSource 分组，用于处理一对多情况
  // 已关闭损耗计算的边不参与分组，避免影响其他边的“一对一/一对多”判定
  const sourceToEdges = new Map<string, TopologyEdge[]>();
  edges.forEach(edge => {
    const edgeData = (edge.data || {}) as { lossEnabled?: boolean };
    if (edgeData.lossEnabled === false) return;
    const isReversed = (edge.data as { _reversed?: boolean } | undefined)?._reversed === true;
    const actualSource = isReversed ? edge.target : edge.source;
    const actualTarget = isReversed ? edge.source : edge.target;
    // 聚合器相连的边不参与普通节点的“一对多”分组，避免影响其他链路的分摊
    if (aggregatorIds.has(actualSource) || aggregatorIds.has(actualTarget)) return;
    if (!sourceToEdges.has(actualSource)) {
      sourceToEdges.set(actualSource, []);
    }
    sourceToEdges.get(actualSource)!.push(edge);
  });

  return edges.map(edge => {
    // 控制关系边（controlEdge）与传感器监测边（sensorEdge）不参与功率链路损耗计算
    if (edge.type === 'controlEdge' || edge.type === 'sensorEdge') {
      return edge;
    }
    // 链路聚合器相连的边：损耗由聚合器整体汇总，单条边不再单独计算与展示
    if (aggregatorIds.has(edge.source) || aggregatorIds.has(edge.target)) {
      const prevData = edge.data || { loss: 0, lossPercent: 0 };
      return {
        ...edge,
        data: {
          ...prevData,
          loss: 0,
          lossPercent: 0,
          _aggregatedLoss: true,
        },
      };
    }
    // 用户在右键菜单中关闭了该链路的损耗计算：不参与计算，并清零损耗值
    const edgeData = (edge.data || {}) as { lossEnabled?: boolean };
    if (edgeData.lossEnabled === false) {
      const prevData = edge.data || { loss: 0, lossPercent: 0 };
      return {
        ...edge,
        data: {
          ...prevData,
          loss: 0,
          lossPercent: 0,
        },
      };
    }
    // 检查是否反转
    const isReversed = (edge.data as { _reversed?: boolean } | undefined)?._reversed === true;

    // 如果反转，交换 source 和 target 进行计算
    const actualSource = isReversed ? edge.target : edge.source;
    const actualTarget = isReversed ? edge.source : edge.target;

    const sourcePower = nodeSourcePowerMap.get(actualSource);
    const targetPower = nodeTargetPowerMap.get(actualTarget);

    // 如果无法获取功率数据，保持原值
    if (sourcePower === null || sourcePower === undefined || Number.isNaN(sourcePower) ||
        targetPower === null || targetPower === undefined || Number.isNaN(targetPower)) {
      return edge;
    }

    const siblings = sourceToEdges.get(actualSource) || [];
    let loss: number;

    if (siblings.length <= 1) {
      // 一对一连接：直接相减
      loss = Math.max(0, sourcePower - targetPower);
    } else {
      // 一对多连接：按目标功率比例分配总损耗
      const allTargetPowers = siblings
        .map(e => {
          const rev = (e.data as { _reversed?: boolean } | undefined)?._reversed === true;
          const t = rev ? e.source : e.target;
          return nodeTargetPowerMap.get(t);
        })
        .filter((p): p is number => p !== null && p !== undefined && !Number.isNaN(p));

      const totalTargetPower = allTargetPowers.reduce((sum, p) => sum + p, 0);

      if (totalTargetPower <= 0) {
        // 所有目标节点均无输入功率数据，无法分配，保持原值
        return edge;
      } else if (sourcePower > totalTargetPower) {
        // 源输出大于下游输入之和（数据一致），按目标功率比例分配总损耗
        const totalLoss = sourcePower - totalTargetPower;
        // 按目标功率比例分配
        loss = totalLoss * (targetPower / totalTargetPower);
      } else {
        // 下游独立测量之和不小于源输出（常见于独立计量误差或多路供电），
        // 不能整体置0，改为逐链路直接相减，保证每条链路仍参与损耗计算
        loss = Math.max(0, sourcePower - targetPower);
      }
    }

    const lossPercent = sourcePower > 0 ? (loss / sourcePower) * 100 : 0;

    // 保留原有的其他字段（animated, label, customData 等）
    const prevData = edge.data || { loss: 0, lossPercent: 0 };

    return {
      ...edge,
      data: {
        ...prevData,
        loss: Number(loss.toFixed(2)),
        lossPercent: Number(lossPercent.toFixed(2)),
      },
    };
  });
}
