/** BMC API接口层 - 支持 Mock 数据和后端 Sensor 数据获取 */
import type { BMCResponse, BMCControlResponse } from '../types/bmc';
import type { TopologyNode, TopologyEdge, BMCConfig, FieldMapping } from '../types/topology';
import { FIXED_FIELD_DEFS } from '../types/topology';
import type { CPUData, MemoryData, DiskData, FanData, IOData, CardData, MgmtBoardData, SourceData } from '../types/power';
import type { SensorData as BMCSensorData } from '../../app/api/bmc/sensors/route';
import { refreshNodeData, refreshEdgeData } from './mockData';
import { sendControlCommand } from './backendApi';
import { useBMCSessionStore } from '../stores/bmcSessionStore';
import { useTopologyStore } from '../stores/topologyStore';


/** 获取所有节点最新数据 */
export async function fetchAllNodeData(
  currentNodes: TopologyNode[],
  bmcConfig?: BMCConfig,
  topologyId?: string
): Promise<BMCResponse<TopologyNode[]>> {
  // 如果有 BMC 配置且启用，尝试直接获取数据
  if (bmcConfig?.enabled && bmcConfig.ip) {
    try {
      const updatedNodes = await fetchAllNodeDataFromBMC(currentNodes, bmcConfig, topologyId);
      return {
        success: true,
        data: updatedNodes,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      console.warn('BMC data fetch failed, falling back to mock:', error);
      // 失败时回退到 mock 数据
    }
  }

  // Mock 数据模式
  return {
    success: true,
    data: refreshNodeData(currentNodes),
    timestamp: new Date().toISOString(),
  };
}

/** 从后端获取所有 Sensor 数据 */
async function fetchAllSensorsFromBackend(topologyId: string): Promise<BMCSensorData[]> {
  try {
    const response = await fetch(`/api/bmc/sensors?topologyId=${topologyId}`);
    const result = await response.json();
    if (result.success && Array.isArray(result.data)) {
      return result.data;
    }
  } catch (error) {
    console.error('Failed to fetch sensors:', error);
  }
  return [];
}

/** 从 BMC 获取所有节点数据（通过字段映射） */
async function fetchAllNodeDataFromBMC(
  currentNodes: TopologyNode[],
  config: BMCConfig,
  topologyId?: string
): Promise<TopologyNode[]> {
  // 获取所有 sensor 数据
  const sensors = topologyId ? await fetchAllSensorsFromBackend(topologyId) : [];
  
  const updatedNodes: TopologyNode[] = [];

  for (const node of currentNodes) {
    const fieldMappings = node.data.apiConfig?.fieldMappings;
    
    // 如果有字段映射配置，使用新的字段映射方式
    if (fieldMappings && fieldMappings.length > 0) {
      const updatedNode = applyFieldMappings(node, sensors);
      updatedNodes.push(updatedNode);
      continue;
    }
    
    // 没有字段映射，保持原有数据结构（使用 mock 数据或旧逻辑）
    updatedNodes.push(node);
  }

  return updatedNodes;
}

/** 解析并计算 BMC Sensor 表达式
 * 支持简单二元运算，如 "CPU0 PWR/POWER2"、"CPU0 PWR + CPU1 PWR"
 * 如果任一 sensor 不存在或值为 null，或除数为 0，返回 null
 */
function evaluateBmcExpression(expression: string, sensors: BMCSensorData[]): number | null {
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
  return sensor?.value != null ? Number(sensor.value) : null;
}

/** 应用字段映射到节点 - 根据节点类型映射到对应的数据结构 */
function applyFieldMappings(node: TopologyNode, sensors: BMCSensorData[]): TopologyNode {
  const fieldMappings = node.data.apiConfig?.fieldMappings || [];
  const nodeType = node.data.nodeType;
  
  // 深拷贝节点
  const newNode = JSON.parse(JSON.stringify(node));
  
  // 根据节点类型创建对应的数据对象
  const mappedData: Record<string, number | string | boolean | null> = {};
  
  // 根据字段映射从 BMC 数据获取值
  for (const mapping of fieldMappings) {
    const { fieldKey, bmcField } = mapping;
    
    const value = evaluateBmcExpression(bmcField, sensors);
    mappedData[fieldKey] = value;
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

  // 将所有已配置字段的值写入 displayMetrics，确保前端能渲染任何字段（包括固定字段和自定义字段）
  if (fieldMappings.length > 0) {
    newNode.data.displayMetrics = newNode.data.displayMetrics || {};
    for (const m of fieldMappings) {
      newNode.data.displayMetrics[m.fieldKey] = mappedData[m.fieldKey] ?? null;
    }
  }

  return newNode;
}

/** 构建 CPUData */
function buildCPUData(existing: CPUData | undefined, mapped: Record<string, number | string | boolean | null>): CPUData {
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

/** 构建 SensorData（温度传感器） */
function buildSensorData(existing: import('../types/power').SensorData | undefined, mapped: Record<string, number | string | boolean | null>): import('../types/power').SensorData {
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

/** 获取所有边最新数据 */
export async function fetchAllEdgeData(
  currentEdges: TopologyEdge[],
  bmcConfig?: BMCConfig
): Promise<BMCResponse<TopologyEdge[]>> {
  // 边数据通常不需要从 BMC 获取，保持 mock
  void bmcConfig;
  return {
    success: true,
    data: refreshEdgeData(currentEdges),
    timestamp: new Date().toISOString(),
  };
}

/** 设置风扇转速（通过服务端 SSH 下发 Shell 命令） */
export async function setFanSpeed(
  nodeId: string,
  speedPercent: number,
): Promise<BMCControlResponse> {
  const bmcConfig = useBMCSessionStore.getState().getConnectedConfig();
  const topologyId = useTopologyStore.getState().currentTopologyId;
  const success = await sendControlCommand(nodeId, 'setFanSpeed', speedPercent, topologyId, bmcConfig);
  
  if (!success) {
    throw new Error('控制命令下发失败');
  }
  
  return {
    success: true,
    nodeId,
    action: 'setFanSpeed',
    newValue: speedPercent,
  };
}

/** 设置电压（通过服务端 SSH 下发 Shell 命令） */
export async function setVoltage(
  nodeId: string,
  voltage: number,
): Promise<BMCControlResponse> {
  const bmcConfig = useBMCSessionStore.getState().getConnectedConfig();
  const topologyId = useTopologyStore.getState().currentTopologyId;
  const success = await sendControlCommand(nodeId, 'setVoltage', voltage, topologyId, bmcConfig);
  
  if (!success) {
    throw new Error('控制命令下发失败');
  }
  
  return {
    success: true,
    nodeId,
    action: 'setVoltage',
    newValue: voltage,
  };
}
