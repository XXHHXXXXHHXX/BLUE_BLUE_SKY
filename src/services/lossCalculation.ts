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

  // 按 actualSource 分组，用于处理一对多情况
  const sourceToEdges = new Map<string, TopologyEdge[]>();
  edges.forEach(edge => {
    const isReversed = (edge.data as { _reversed?: boolean } | undefined)?._reversed === true;
    const actualSource = isReversed ? edge.target : edge.source;
    if (!sourceToEdges.has(actualSource)) {
      sourceToEdges.set(actualSource, []);
    }
    sourceToEdges.get(actualSource)!.push(edge);
  });

  return edges.map(edge => {
    // 控制关系边（controlEdge）不参与功率链路损耗计算
    if (edge.type === 'controlEdge') {
      return edge;
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
