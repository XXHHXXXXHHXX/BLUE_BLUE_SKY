/** 数据轮询 API - 支持按拓扑ID查询和字段映射 */
import { NextRequest, NextResponse } from 'next/server';
import { topologyStore, updateNodeData } from '../../lib/store';
import type { SensorData } from '../../bmc/sensors/route';
import type { TopologyNode, TopologyEdge, FieldMapping, BMCConfig } from '../../../../src/types/topology';
import { FIXED_FIELD_DEFS } from '../../../../src/types/topology';
import type { CPUData, MemoryData, DiskData, FanData, IOData, CardData, SensorData as SensorNodeData, MgmtBoardData, SourceData } from '../../../../src/types/power';

/** 获取 BMC Sensor 数据（直接使用传入的配置） */
async function fetchBMCSensorsWithConfig(bmcConfig: BMCConfig | null | undefined): Promise<{ sensors?: SensorData[]; error?: string; errorCode?: string }> {
  if (!bmcConfig?.enabled) {
    return { error: 'BMC 未配置或未启用', errorCode: 'BMC_NOT_CONFIGURED' };
  }
  if (!bmcConfig.ip || !bmcConfig.username || !bmcConfig.password) {
    return { error: 'BMC 配置不完整，请检查 IP、用户名和密码', errorCode: 'BMC_CONFIG_INCOMPLETE' };
  }
  try {
    const response = await fetch(`http://localhost:${process.env.PORT || 3000}/api/bmc/sensors?topologyId=direct`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bmcConfig }),
    });
    const result = await response.json();
    if (!result.success) {
      return {
        error: result.message || '获取 BMC 数据失败',
        errorCode: result.error || 'BMC_ERROR'
      };
    }
    if (Array.isArray(result.data)) {
      return { sensors: result.data };
    }
    return { error: '无效的 BMC 响应数据', errorCode: 'INVALID_DATA' };
  } catch (error) {
    console.error('[Poll] Failed to fetch BMC sensors:', error);
    return {
      error: error instanceof Error ? error.message : '获取 BMC 数据失败',
      errorCode: 'BMC_ERROR'
    };
  }
}

/** 解析并计算 BMC Sensor 表达式
 * 支持简单二元运算，如 "CPU0 PWR/POWER2"、"CPU0 PWR + CPU1 PWR"
 * 如果任一 sensor 不存在或值为 null，或除数为 0，返回 null
 */
function evaluateBmcExpression(expression: string, sensors: SensorData[]): number | null {
  const trimmed = expression.trim();
  if (!trimmed) return null;

  // 尝试匹配二元运算表达式：左侧 运算符 右侧
  const match = trimmed.match(/^(.+?)\s*([+\-*/])\s*(.+)$/);
  if (match) {
    const [, leftExpr, op, rightExpr] = match;
    const leftSensor = sensors.find(
      s => s.sensorName.toLowerCase().trim() === leftExpr.toLowerCase().trim()
    );
    const rightSensor = sensors.find(
      s => s.sensorName.toLowerCase().trim() === rightExpr.toLowerCase().trim()
    );

    if (leftSensor?.value == null || rightSensor?.value == null) {
      return null;
    }

    const leftVal = Number(leftSensor.value);
    const rightVal = Number(rightSensor.value);

    switch (op) {
      case '+': return leftVal + rightVal;
      case '-': return leftVal - rightVal;
      case '*': return leftVal * rightVal;
      case '/': return rightVal !== 0 ? leftVal / rightVal : null;
    }
  }

  // 无运算符，按普通 sensor 名称匹配
  const sensor = sensors.find(
    s => s.sensorName.toLowerCase().trim() === trimmed.toLowerCase()
  );
  const num = sensor?.value != null ? Number(sensor.value) : null;
  return num !== null && Number.isNaN(num) ? null : num;
}

/** 根据字段映射更新节点数据 - 映射到对应的数据结构 */
function updateNodesWithFieldMappings(nodes: TopologyNode[], sensors: SensorData[]): TopologyNode[] {
  return nodes.map(node => {
    const fieldMappings = node.data.apiConfig?.fieldMappings;
    const nodeType = node.data.nodeType;
    
    // 如果没有配置字段映射，返回原节点（保持原有数据结构）
    if (!fieldMappings || fieldMappings.length === 0) {
      return node;
    }
    
    // 深拷贝节点
    const newNode = JSON.parse(JSON.stringify(node));
    
    // 根据字段映射从 BMC 数据获取值
    const mappedData: Record<string, number | string | boolean | null> = {};
    console.log(`[Poll] Processing node ${node.id} (${nodeType}), fieldMappings:`, fieldMappings);
    console.log(`[Poll] Available sensors:`, sensors.map(s => s.sensorName));
    
    for (const mapping of fieldMappings) {
      const { fieldKey, bmcField } = mapping;
      
      const value = evaluateBmcExpression(bmcField, sensors);
      
      console.log(`[Poll] Matching fieldKey=${fieldKey}, bmcField=${bmcField} -> value=${value}`);
      
      mappedData[fieldKey] = value;
      console.log(`[Poll]   -> assigned value=${value}`);
    }
    
    // 过滤所有 NaN 值，统一转为 null
    for (const key of Object.keys(mappedData)) {
      if (Number.isNaN(mappedData[key])) {
        mappedData[key] = null;
      }
    }
    
    // 根据节点类型，将映射的数据应用到对应的数据结构
    switch (nodeType) {
      case 'cpu':
        newNode.data.cpuData = buildCPUData(newNode.data.cpuData, mappedData);
        break;
      case 'memory':
        newNode.data.memoryData = buildMemoryData(newNode.data.memoryData, mappedData);
        break;
      case 'disk':
        newNode.data.diskData = buildDiskData(newNode.data.diskData, mappedData);
        break;
      case 'fan':
        newNode.data.fanData = buildFanData(newNode.data.fanData, mappedData);
        break;
      case 'io':
        newNode.data.ioData = buildIOData(newNode.data.ioData, mappedData);
        break;
      case 'card':
        newNode.data.cardData = buildCardData(newNode.data.cardData, mappedData);
        break;
      case 'sensor':
        newNode.data.sensorData = buildSensorData(newNode.data.sensorData, mappedData);
        break;
      case 'mgmtBoard':
        newNode.data.mgmtData = buildMgmtBoardData(newNode.data.mgmtData, mappedData);
        break;
      case 'ac':
      case 'psu':
      case 'vr':
      case 'psip':
        newNode.data.sourceData = buildSourceData(newNode.data.sourceData, mappedData);
        break;
      case 'custom':
        // 自定义模块的所有字段直接写入 displayMetrics
        break;
    }

    // 将自定义字段（不在 FIXED_FIELD_DEFS 中的字段）的值写入 displayMetrics
    const fixedKeys = new Set((FIXED_FIELD_DEFS[nodeType || ''] || []).map((d) => d.fieldKey));
    const customMappings = fieldMappings.filter((m) => !fixedKeys.has(m.fieldKey));
    if (customMappings.length > 0) {
      newNode.data.displayMetrics = newNode.data.displayMetrics || {};
      for (const m of customMappings) {
        newNode.data.displayMetrics[m.fieldKey] = mappedData[m.fieldKey] ?? null;
      }
    }

    return newNode;
  });
}

/** 构建 CPUData */
function buildCPUData(existing: CPUData | undefined, mapped: Record<string, number | string | boolean | null>): CPUData {
  // 如果字段在 mapped 中存在（用户配置了），使用 mapped 值（包括 null）；否则回退到 existing
  const power = mapped.hasOwnProperty('power') 
    ? (mapped.power !== null ? Number(mapped.power) : null)
    : (existing?.power ?? null);
  const temperature = mapped.hasOwnProperty('temperature')
    ? (mapped.temperature !== null ? Number(mapped.temperature) : null)
    : (existing?.temperature ?? null);
  return {
    power,
    temperature,
    powerDomains: existing?.powerDomains ?? [],
    amuEvents: existing?.amuEvents ?? [],
  };
}

/** 构建 MemoryData */
function buildMemoryData(existing: MemoryData | undefined, mapped: Record<string, number | string | boolean | null>): MemoryData {
  // 如果字段在 mapped 中存在（用户配置了），使用 mapped 值（包括 null）；否则回退到 existing
  const power = mapped.hasOwnProperty('power')
    ? (mapped.power !== null ? Number(mapped.power) : null)
    : (existing?.power ?? null);
  const temperature = mapped.hasOwnProperty('temperature')
    ? (mapped.temperature !== null ? Number(mapped.temperature) : null)
    : (existing?.temperature ?? null);
  const thermalThrottle = mapped.hasOwnProperty('thermalThrottle')
    ? (mapped.thermalThrottle !== null ? Boolean(mapped.thermalThrottle) : null)
    : (existing?.thermalThrottle ?? null);
  return { power, temperature, thermalThrottle };
}

/** 构建 DiskData */
function buildDiskData(existing: DiskData | undefined, mapped: Record<string, number | string | boolean | null>): DiskData {
  const power = mapped.hasOwnProperty('power')
    ? (mapped.power !== null ? Number(mapped.power) : null)
    : (existing?.power ?? null);
  const temperature = mapped.hasOwnProperty('temperature')
    ? (mapped.temperature !== null ? Number(mapped.temperature) : null)
    : (existing?.temperature ?? null);
  const status = mapped.hasOwnProperty('status')
    ? (mapped.status !== null ? (mapped.status === 1 || mapped.status === 'normal' ? 'normal' : 'warning') : null)
    : (existing?.status ?? null);
  return { power, temperature, status: status as 'normal' | 'warning' | 'error' | null };
}

/** 构建 FanData */
function buildFanData(existing: FanData | undefined, mapped: Record<string, number | string | boolean | null>): FanData {
  const power = mapped.hasOwnProperty('power')
    ? (mapped.power !== null ? Number(mapped.power) : null)
    : (existing?.power ?? null);
  const temperature = mapped.hasOwnProperty('temperature')
    ? (mapped.temperature !== null ? Number(mapped.temperature) : null)
    : (existing?.temperature ?? null);
  const rpm = mapped.hasOwnProperty('rpm')
    ? (mapped.rpm !== null ? Number(mapped.rpm) : null)
    : (existing?.rpm ?? null);
  const speedPercent = mapped.hasOwnProperty('speedPercent')
    ? (mapped.speedPercent !== null ? Number(mapped.speedPercent) : null)
    : (existing?.speedPercent ?? null);
  return { power, temperature, rpm, speedPercent };
}

/** 构建 IOData */
function buildIOData(existing: IOData | undefined, mapped: Record<string, number | string | boolean | null>): IOData {
  const power = mapped.hasOwnProperty('power')
    ? (mapped.power !== null ? Number(mapped.power) : null)
    : (existing?.power ?? null);
  const temperature = mapped.hasOwnProperty('temperature')
    ? (mapped.temperature !== null ? Number(mapped.temperature) : null)
    : (existing?.temperature ?? null);
  const linkSpeed = mapped.hasOwnProperty('linkSpeed')
    ? (mapped.linkSpeed !== null ? String(mapped.linkSpeed) : null)
    : (existing?.linkSpeed ?? null);
  return { power, temperature, linkSpeed };
}

/** 构建 CardData */
function buildCardData(existing: CardData | undefined, mapped: Record<string, number | string | boolean | null>): CardData {
  const power = mapped.hasOwnProperty('power')
    ? (mapped.power !== null ? Number(mapped.power) : null)
    : (existing?.power ?? null);
  const temperature = mapped.hasOwnProperty('temperature')
    ? (mapped.temperature !== null ? Number(mapped.temperature) : null)
    : (existing?.temperature ?? null);
  const slotId = mapped.hasOwnProperty('slotId')
    ? (mapped.slotId !== null ? String(mapped.slotId) : null)
    : (existing?.slotId ?? null);
  return { power, temperature, slotId };
}

/** 构建 SensorData */
function buildSensorData(existing: SensorNodeData | undefined, mapped: Record<string, number | string | boolean | null>): SensorNodeData {
  const temperature = mapped.hasOwnProperty('temperature')
    ? (mapped.temperature !== null ? Number(mapped.temperature) : null)
    : (existing?.temperature ?? null);
  const location = mapped.hasOwnProperty('location')
    ? (mapped.location !== null ? String(mapped.location) : null)
    : (existing?.location ?? null);
  return { temperature, location };
}

/** 构建 MgmtBoardData */
function buildMgmtBoardData(existing: MgmtBoardData | undefined, mapped: Record<string, number | string | boolean | null>): MgmtBoardData {
  const temperature = mapped.hasOwnProperty('temperature')
    ? (mapped.temperature !== null ? Number(mapped.temperature) : null)
    : (existing?.temperature ?? null);
  const status = mapped.hasOwnProperty('status')
    ? (mapped.status !== null ? (mapped.status === 1 || mapped.status === 'online' ? 'online' : 'offline') : null)
    : (existing?.status ?? null);
  return { temperature, status: status as 'online' | 'offline' | null };
}

/** 构建 SourceData */
function buildSourceData(existing: SourceData | undefined, mapped: Record<string, number | string | boolean | null>): SourceData {
  return {
    inputVoltage: mapped.hasOwnProperty('inputVoltage')
      ? (mapped.inputVoltage !== null ? Number(mapped.inputVoltage) : null)
      : (existing?.inputVoltage ?? null),
    outputVoltage: mapped.hasOwnProperty('outputVoltage')
      ? (mapped.outputVoltage !== null ? Number(mapped.outputVoltage) : null)
      : (existing?.outputVoltage ?? null),
    current: mapped.hasOwnProperty('current')
      ? (mapped.current !== null ? Number(mapped.current) : null)
      : (existing?.current ?? null),
    inputCurrent: mapped.hasOwnProperty('inputCurrent')
      ? (mapped.inputCurrent !== null ? Number(mapped.inputCurrent) : null)
      : (existing?.inputCurrent ?? null),
    outputCurrent: mapped.hasOwnProperty('outputCurrent')
      ? (mapped.outputCurrent !== null ? Number(mapped.outputCurrent) : null)
      : (existing?.outputCurrent ?? null),
    inputPower: mapped.hasOwnProperty('inputPower')
      ? (mapped.inputPower !== null ? Number(mapped.inputPower) : null)
      : (existing?.inputPower ?? null),
    outputPower: mapped.hasOwnProperty('outputPower')
      ? (mapped.outputPower !== null ? Number(mapped.outputPower) : null)
      : (existing?.outputPower ?? null),
    efficiency: mapped.hasOwnProperty('efficiency')
      ? (mapped.efficiency !== null ? Number(mapped.efficiency) : null)
      : (existing?.efficiency ?? null),
    temperature: mapped.hasOwnProperty('temperature')
      ? (mapped.temperature !== null ? Number(mapped.temperature) : null)
      : existing?.temperature,
  };
}

/** 获取节点作为 source 时的输出功率（用于损耗计算）
 * 对于源节点返回 outputPower，对于负载节点返回 power
 */
function getNodeSourcePower(node: TopologyNode): number | null {
  const data = node.data as Record<string, unknown>;
  const nodeType = data.nodeType as string;
  
  // 源类型节点（ac, psu, vr, psip）使用 outputPower
  if (['ac', 'psu', 'vr', 'psip'].includes(nodeType)) {
    const sourceData = data.sourceData as SourceData | undefined;
    // AC 节点使用 inputPower 作为输出功率（供电给 PSU）
    if (nodeType === 'ac') {
      return sourceData?.inputPower ?? null;
    }
    return sourceData?.outputPower ?? null;
  }
  
  // 负载类型节点使用 power
  if (['cpu', 'memory', 'fan', 'disk', 'io', 'card'].includes(nodeType)) {
    const loadData = (data.cpuData || data.memoryData || data.fanData || data.diskData || data.ioData || data.cardData) as 
      (CPUData | MemoryData | FanData | DiskData | IOData | CardData) | undefined;
    return loadData?.power ?? null;
  }

  // 自定义模块从 displayMetrics 中读取 power
  if (nodeType === 'custom') {
    const displayMetrics = data.displayMetrics as Record<string, number | null> | undefined;
    return displayMetrics?.power ?? null;
  }
  
  // 其他类型（sensor, mgmtBoard, chassis）无功率数据
  return null;
}

/** 获取节点作为 target 时的输入功率（用于损耗计算）
 * 对于源节点返回 inputPower，对于负载节点返回 power
 */
function getNodeTargetPower(node: TopologyNode): number | null {
  const data = node.data as Record<string, unknown>;
  const nodeType = data.nodeType as string;
  
  // 源类型节点作为 target 时，使用 inputPower（接收到的功率）
  if (['ac', 'psu', 'vr', 'psip'].includes(nodeType)) {
    const sourceData = data.sourceData as SourceData | undefined;
    return sourceData?.inputPower ?? null;
  }
  
  // 负载类型节点使用 power
  if (['cpu', 'memory', 'fan', 'disk', 'io', 'card'].includes(nodeType)) {
    const loadData = (data.cpuData || data.memoryData || data.fanData || data.diskData || data.ioData || data.cardData) as 
      (CPUData | MemoryData | FanData | DiskData | IOData | CardData) | undefined;
    return loadData?.power ?? null;
  }

  // 自定义模块从 displayMetrics 中读取 power
  if (nodeType === 'custom') {
    const displayMetrics = data.displayMetrics as Record<string, number | null> | undefined;
    return displayMetrics?.power ?? null;
  }
  
  // 其他类型（sensor, mgmtBoard, chassis）无功率数据
  return null;
}

/** 计算边的损耗（基于真实功率）
 * 损耗 = 源节点输出功率 - 目标节点输入功率
 * 损耗百分比 = 损耗 / 源节点输出功率 * 100
 * 
 * 对于一对多的连接，按各子节点输入功率比例分配总损耗
 * 
 * 注意：如果边的 _reversed 为 true，表示方向已翻转，需要交换 source/target 计算
 */
function calculateEdgeLosses(nodes: TopologyNode[], edges: TopologyEdge[]): TopologyEdge[] {
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
      
      if (totalTargetPower <= 0 || sourcePower <= totalTargetPower) {
        // 测量误差或数据问题导致总目标功率不小于源功率，认为总损耗为0
        loss = 0;
      } else {
        const totalLoss = sourcePower - totalTargetPower;
        // 按目标功率比例分配
        loss = totalLoss * (targetPower / totalTargetPower);
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

// POST /api/data/poll - 从 body 接收 topologyId 和 bmcConfig
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const topologyId = body.topologyId as string | undefined | null;
    const bmcConfig = body.bmcConfig as BMCConfig | undefined | null;
    
    console.log('[Poll] Data request received for topology:', topologyId || 'default');
    
    // 获取 BMC Sensor 数据
    const { sensors, error, errorCode } = await fetchBMCSensorsWithConfig(bmcConfig);
    
    // 如果有错误（BMC 未配置等），返回错误信息
    if (error) {
      return NextResponse.json({
        success: false,
        error: errorCode,
        message: error,
        data: {
          nodes: [],
          edges: [],
          timestamp: new Date().toISOString()
        }
      }, { status: errorCode === 'BMC_NOT_CONFIGURED' || errorCode === 'BMC_CONFIG_INCOMPLETE' ? 400 : 503 });
    }
    
    // 模拟数据获取延迟
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // 获取指定拓扑或当前拓扑
    const topology = topologyId 
      ? topologyStore.getTopology(topologyId)
      : topologyStore.data;
    
    let updatedNodes = topology.nodes;
    
    // 使用字段映射更新节点
    if (sensors && sensors.length > 0) {
      updatedNodes = updateNodesWithFieldMappings(updatedNodes, sensors);
    } else {
      // BMC 已配置但没有获取到数据，返回错误
      return NextResponse.json({
        success: false,
        error: 'BMC_NO_DATA',
        message: '无法从 BMC 获取数据，请检查 BMC 连接和配置',
        data: {
          nodes: updatedNodes,
          edges: topology.edges,
          timestamp: new Date().toISOString()
        }
      }, { status: 503 });
    }
    
    topology.nodes = updatedNodes;
    
    // 基于真实功率计算边的损耗
    const updatedEdges = calculateEdgeLosses(updatedNodes, topology.edges);
    topology.edges = updatedEdges;
    
    // 保存回存储
    if (topologyId) {
      topologyStore.saveTopology(topologyId, topology);
    } else {
      topologyStore.data = topology;
    }
    
    return NextResponse.json({
      success: true,
      data: {
        nodes: updatedNodes,
        edges: updatedEdges,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('[Poll] Error:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'INTERNAL_ERROR',
        message: '服务器内部错误' 
      },
      { status: 500 }
    );
  }
}
