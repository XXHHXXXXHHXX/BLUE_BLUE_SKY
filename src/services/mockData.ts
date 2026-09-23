/** Mock数据生成服务 */
import type {
  SourceData, FanData, CPUData, CPUPowerDomain,
  AMUEvent, SensorData, MemoryData, DiskData, IOData,
  CardData, MgmtBoardData, ThermometerData,
} from '../types/power';
import { CPU_POWER_DOMAINS, CPU_POWER_DOMAIN_FIELD_DEFS } from '../types/power';
import type { TopologyNode, TopologyEdge, PowerEdgeData, HardwareNodeData, FieldMapping } from '../types/topology';
import { FIXED_FIELD_DEFS } from '../types/topology';

/** 在基准值附近生成随机波动 */
function fluctuate(base: number, percent: number = 5): number {
  const delta = base * (percent / 100);
  return +(base + (Math.random() - 0.5) * 2 * delta).toFixed(2);
}

/** 生成源模块Mock数据 */
export function mockSourceData(base: Partial<SourceData> = {}): SourceData {
  const inputVoltage = fluctuate(base.inputVoltage ?? 220, 2);
  const outputVoltage = fluctuate(base.outputVoltage ?? 12, 2);
  const current = fluctuate(base.current ?? 30, 5);
  const inputCurrent = fluctuate(base.inputCurrent ?? current, 5);
  const outputCurrent = fluctuate(base.outputCurrent ?? current, 5);
  const outputPower = +(outputVoltage * outputCurrent).toFixed(2);
  const efficiency = fluctuate(base.efficiency ?? 92, 1);
  const inputPower = +(outputPower / (efficiency / 100)).toFixed(2);
  return {
    inputVoltage, outputVoltage, current, inputCurrent, outputCurrent,
    inputPower, outputPower, efficiency,
    temperature: fluctuate(base.temperature ?? 45, 3),
    psuIntakeTemp: fluctuate(base.psuIntakeTemp ?? 35, 3),
    psuMosTemp: fluctuate(base.psuMosTemp ?? 55, 3),
    psuRearIntakeTemp: fluctuate(base.psuRearIntakeTemp ?? 38, 3),
    busbarVoltage: fluctuate(base.busbarVoltage ?? outputVoltage, 2),
    busbarCurrent: fluctuate(base.busbarCurrent ?? current, 5),
    busbarPower: fluctuate(base.busbarPower ?? outputPower, 5),
  };
}

/** 生成风扇Mock数据 */
export function mockFanData(base: Partial<FanData> = {}): FanData {
  const speedPercent = base.speedPercent ?? 60;
  const rpm = Math.round(fluctuate(base.rpm ?? 5000, 3));
  return {
    power: fluctuate(base.power ?? 15, 5),
    rpm,
    speedPercent,
    temperature: fluctuate(40, 5),
    fanInputVoltage: fluctuate(base.fanInputVoltage ?? 12, 2),
    fanInputCurrent: fluctuate(base.fanInputCurrent ?? 1.25, 5),
  };
}

/** 生成CPU电源域数据 */
function mockPowerDomains(): CPUPowerDomain[] {
  const configs: Record<string, { v: number; a: number }> = {
    TA_CORE_DVFS: { v: 0.85, a: 80 },
    DDRIO: { v: 1.1, a: 15 },
    TB_CORE_DVFS: { v: 0.85, a: 75 },
    IO_NB_AVS: { v: 0.95, a: 10 },
    UNCORE_DVFS: { v: 0.9, a: 25 },
    IO_NA_AVS: { v: 0.95, a: 8 },
    SERDES: { v: 0.9, a: 12 },
  };
  return CPU_POWER_DOMAINS.map(name => {
    const c = configs[name] || { v: 0.9, a: 10 };
    return {
      name,
      voltage: fluctuate(c.v, 3),
      current: fluctuate(c.a, 5),
      power: +(fluctuate(c.v, 3) * fluctuate(c.a, 5)).toFixed(2),
    };
  });
}

/** 生成AMU事件 */
function mockAMUEvents(): AMUEvent[] {
  const types: AMUEvent['type'][] = ['info', 'warning', 'error'];
  const messages = [
    '电源域功耗正常',
    '功耗接近阈值',
    '检测到功耗尖峰',
    '电压波动检测',
    '温度告警关联',
  ];
  return Array.from({ length: 5 }, (_, i) => ({
    id: `amu-${Date.now()}-${i}`,
    timestamp: new Date(Date.now() - i * 60000).toISOString(),
    type: types[Math.floor(Math.random() * types.length)],
    domain: CPU_POWER_DOMAINS[Math.floor(Math.random() * CPU_POWER_DOMAINS.length)],
    message: messages[Math.floor(Math.random() * messages.length)],
    value: fluctuate(100, 20),
  }));
}

/** 生成CPU Mock数据 - 包含黄色警告温度 (65-75°C) */
export function mockCPUData(): CPUData {
  const domains = mockPowerDomains();
  return {
    power: domains.reduce((sum, d) => sum + d.power, 0),
    temperature: fluctuate(72, 3),
    powerDomains: domains,
    amuEvents: mockAMUEvents(),
  };
}

/** 生成传感器Mock数据 */
export function mockSensorData(location: string, baseTemp: number = 40): SensorData {
  return { temperature: fluctuate(baseTemp, 5), location };
}

/** 生成内存Mock数据 */
export function mockMemoryData(): MemoryData {
  return {
    power: fluctuate(8, 5),
    temperature: fluctuate(55, 5),
    thermalThrottle: Math.random() < 0.1,
  };
}

/** 生成硬盘Mock数据 */
export function mockDiskData(): DiskData {
  return {
    power: fluctuate(12, 5),
    temperature: fluctuate(45, 5),
    status: 'normal',
    diskInputVoltage: fluctuate(12, 2),
    diskInputCurrent: fluctuate(1.0, 5),
    nvmeInternalTemp: fluctuate(52, 5),
    nvmeMaxTemp: fluctuate(58, 5),
  };
}

/** 生成IO Mock数据 */
export function mockIOData(): IOData {
  return {
    power: fluctuate(10, 5),
    temperature: fluctuate(42, 5),
    linkSpeed: 'PCIe Gen4 x16',
  };
}

/** 生成标卡Mock数据 */
export function mockCardData(slotId: string): CardData {
  return {
    power: fluctuate(25, 5),
    temperature: fluctuate(50, 5),
    slotId,
    cardInputVoltage: fluctuate(12, 2),
    cardInputCurrent: fluctuate(2.1, 5),
    ocpMainChipTemp: fluctuate(58, 5),
    ocpOpticalMaxTemp: fluctuate(62, 5),
  };
}

/** 生成管理板Mock数据 */
export function mockMgmtBoardData(): MgmtBoardData {
  return {
    status: 'online',
    temperature: fluctuate(38, 5),
  };
}

/** 生成温度计Mock数据 */
export function mockThermometerData(base: Partial<ThermometerData> = {}): ThermometerData {
  const temperature = base.temperature ?? fluctuate(45, 10);
  let temperatureStatus = base.temperatureStatus ?? '正常';
  if (temperature >= 80) {
    temperatureStatus = '过热';
  } else if (temperature >= 60) {
    temperatureStatus = '偏热';
  } else if (temperature < 20) {
    temperatureStatus = '过冷';
  } else {
    temperatureStatus = '正常';
  }
  return { temperature, temperatureStatus };
}

/** 模块类型中文名称映射 */
export const nodeTypeLabels: Record<string, string> = {
  ac: 'AC电源',
  psu: 'PSU',
  busbar: '母线',
  vr: 'VR',
  psip: 'PSIP',
  cpu: 'CPU',
  memory: '内存',
  fan: '风扇',
  disk: '硬盘',
  io: 'IO',
  card: '标卡',
  sensor: '传感器',
  mgmtBoard: '管理板',
  chassis: '机框',
  thermometer: '温度计',
  custom: '自定义模块',
};

/** 各模块类型的默认字段映射配置（使用 fieldKey，显示名固定） */
export const defaultFieldMappings: Record<string, FieldMapping[]> = {
  cpu: [
    { fieldKey: 'power', bmcField: 'CPU功耗' },
  ],
  memory: [
    { fieldKey: 'dimmInputVoltage', bmcField: '内存输入电压' },
    { fieldKey: 'dimmInputCurrent', bmcField: '内存输入电流' },
    { fieldKey: 'power', bmcField: '内存功耗' },
    { fieldKey: 'temperature', bmcField: '内存条温度' },
    { fieldKey: 'dimmThermalTarget', bmcField: 'DIMM控温目标' },
  ],
  disk: [
    { fieldKey: 'diskInputVoltage', bmcField: '硬盘背板输入电压' },
    { fieldKey: 'diskInputCurrent', bmcField: '硬盘背板输入电流' },
    { fieldKey: 'power', bmcField: '硬盘背板功耗' },
    { fieldKey: 'temperature', bmcField: '硬盘背板温度' },
    { fieldKey: 'nvmeInternalTemp', bmcField: 'NVMe盘内置温度' },
    { fieldKey: 'nvmeMaxTemp', bmcField: '所有NVMe盘最大温度' },
  ],
  fan: [
    { fieldKey: 'fanInputVoltage', bmcField: '风扇输入电压' },
    { fieldKey: 'fanInputCurrent', bmcField: '风扇输入电流' },
    { fieldKey: 'power', bmcField: '风扇总功耗' },
    { fieldKey: 'rpm', bmcField: '风扇风速' },
  ],
  io: [
    { fieldKey: 'power', bmcField: 'IO Power' },
    { fieldKey: 'temperature', bmcField: 'IO Temp' },
    { fieldKey: 'linkSpeed', bmcField: 'IO Link Speed' },
  ],
  card: [
    { fieldKey: 'cardInputVoltage', bmcField: '标卡输入电压' },
    { fieldKey: 'cardInputCurrent', bmcField: '标卡输入电流' },
    { fieldKey: 'power', bmcField: '标卡功耗' },
    { fieldKey: 'ocpMainChipTemp', bmcField: 'OCP卡主芯片温度' },
    { fieldKey: 'ocpOpticalMaxTemp', bmcField: 'OCP卡光模块最高温度' },
  ],
  sensor: [
    { fieldKey: 'temperature', bmcField: '板级其他温度监测点温度' },
    { fieldKey: 'location', bmcField: 'Sensor Location' },
  ],
  mgmtBoard: [
    { fieldKey: 'temperature', bmcField: 'MGMT Temp' },
    { fieldKey: 'status', bmcField: 'MGMT Status' },
  ],
  // source 类型使用 sourceData 字段
  ac: [
    { fieldKey: 'outputVoltage', bmcField: 'AC输出电压' },
    { fieldKey: 'current', bmcField: 'AC输出电流' },
    { fieldKey: 'outputPower', bmcField: 'AC输出功率' },
  ],
  busbar: [
    { fieldKey: 'busbarVoltage', bmcField: '母线电压' },
    { fieldKey: 'busbarCurrent', bmcField: '母线电流' },
    { fieldKey: 'busbarPower', bmcField: '母线功耗' },
  ],
  psu: [
    { fieldKey: 'inputVoltage', bmcField: 'PSU输入电压' },
    { fieldKey: 'inputCurrent', bmcField: 'PSU输入电流' },
    { fieldKey: 'inputPower', bmcField: 'PSU输入功率' },
    { fieldKey: 'outputVoltage', bmcField: 'PSU输出电压' },
    { fieldKey: 'outputCurrent', bmcField: 'PSU输出电流' },
    { fieldKey: 'outputPower', bmcField: 'PSU输出功率' },
    { fieldKey: 'psuIntakeTemp', bmcField: 'PSU(入风口)温度' },
    { fieldKey: 'psuMosTemp', bmcField: 'PSU(主功率MOS)温度' },
    { fieldKey: 'psuRearIntakeTemp', bmcField: '后扩PSU位置(PSU入风)温度' },
  ],
  vr: [
    { fieldKey: 'inputVoltage', bmcField: 'VR输入电压' },
    { fieldKey: 'inputCurrent', bmcField: 'VR输入电流' },
    { fieldKey: 'inputPower', bmcField: 'VR输入功率' },
    { fieldKey: 'outputVoltage', bmcField: 'VR输出电压' },
    { fieldKey: 'outputCurrent', bmcField: 'VR输出电流' },
    { fieldKey: 'outputPower', bmcField: 'VR输出功率' },
    { fieldKey: 'vrOutputVoltageControl', bmcField: 'VR输出电压调节接口' },
    { fieldKey: 'efficiency', bmcField: 'VR Efficiency' },
    { fieldKey: 'temperature', bmcField: 'VR Temperature' },
  ],
  psip: [
    { fieldKey: 'inputVoltage', bmcField: 'psip输入电压' },
    { fieldKey: 'inputCurrent', bmcField: 'psip输入电流' },
    { fieldKey: 'inputPower', bmcField: 'psip输入功率' },
    { fieldKey: 'psipOutputVoltageUnionsVtt', bmcField: 'psip输出电压 - Unions VTT' },
    { fieldKey: 'psipOutputVoltageUnionsHvcc', bmcField: 'psip输出电压 - Unions HVCC' },
    { fieldKey: 'psipOutputVoltageNimbusHvcc', bmcField: 'psip输出电压 - Nimbus HVCC' },
    { fieldKey: 'psipOutputVoltageUnionsLvcc', bmcField: 'psip输出电压 - Unions LVCC' },
    { fieldKey: 'psipOutputVoltageNimbusLvcc', bmcField: 'psip输出电压 - Nimbus LVCC' },
    { fieldKey: 'psipOutputVoltage3v3Drmos', bmcField: 'psip输出电压 - 3.3 DRMOS' },
    { fieldKey: 'psipOutputVoltage1v8Gpio', bmcField: 'psip输出电压 - 1V8 GPIO' },
    { fieldKey: 'psipOutputCurrentUnionsVtt', bmcField: 'psip输出电流 - Unions VTT' },
    { fieldKey: 'psipOutputCurrentUnionsHvcc', bmcField: 'psip输出电流 - Unions HVCC' },
    { fieldKey: 'psipOutputCurrentNimbusHvcc', bmcField: 'psip输出电流 - Nimbus HVCC' },
    { fieldKey: 'psipOutputCurrentUnionsLvcc', bmcField: 'psip输出电流 - Unions LVCC' },
    { fieldKey: 'psipOutputCurrentNimbusLvcc', bmcField: 'psip输出电流 - Nimbus LVCC' },
    { fieldKey: 'psipOutputCurrent3v3Drmos', bmcField: 'psip输出电流 - 3.3 DRMOS' },
    { fieldKey: 'psipOutputCurrent1v8Gpio', bmcField: 'psip输出电流 - 1V8 GPIO' },
    { fieldKey: 'psipOutputPowerUnionsVtt', bmcField: 'psip输出功率 - Unions VTT' },
    { fieldKey: 'psipOutputPowerUnionsHvcc', bmcField: 'psip输出功率 - Unions HVCC' },
    { fieldKey: 'psipOutputPowerNimbusHvcc', bmcField: 'psip输出功率 - Nimbus HVCC' },
    { fieldKey: 'psipOutputPowerUnionsLvcc', bmcField: 'psip输出功率 - Unions LVCC' },
    { fieldKey: 'psipOutputPowerNimbusLvcc', bmcField: 'psip输出功率 - Nimbus LVCC' },
    { fieldKey: 'psipOutputPower3v3Drmos', bmcField: 'psip输出功率 - 3.3 DRMOS' },
    { fieldKey: 'psipOutputPower1v8Gpio', bmcField: 'psip输出功率 - 1V8 GPIO' },
    { fieldKey: 'psipOutputVoltageControl', bmcField: 'psip输出电压调节接口' },
    { fieldKey: 'efficiency', bmcField: 'PSIP Efficiency' },
    { fieldKey: 'temperature', bmcField: 'PSIP Temperature' },
  ],
  chassis: [],
  custom: [
    { fieldKey: 'power', bmcField: '自定义模块功耗' },
  ],
  thermometer: [
    { fieldKey: 'temperature', bmcField: 'Thermometer Temp' },
    { fieldKey: 'temperatureStatus', bmcField: 'Thermometer Status' },
  ],
};

/** 各模块类型的默认电源域字段映射配置（仅 CPU 使用，用于"电源域详情"弹窗） */
export const defaultPowerDomainFieldMappings: Record<string, FieldMapping[]> = {
  cpu: CPU_POWER_DOMAIN_FIELD_DEFS.map(def => ({
    fieldKey: def.fieldKey,
    bmcField: def.label,
  })),
};

/** 根据模块类型创建默认节点数据（用于设计模式添加新模块） */
export function createDefaultNodeData(type: string): HardwareNodeData {
  const label = nodeTypeLabels[type] ?? type;
  const category = (['ac', 'psu', 'vr', 'psip', 'busbar'].includes(type) ? 'source' : ['cpu', 'memory', 'fan', 'disk', 'io', 'card'].includes(type) ? 'load' : 'other') as 'source' | 'path' | 'load' | 'other';
  const fieldMappings = defaultFieldMappings[type] || [];
  const powerDomainMappings = defaultPowerDomainFieldMappings[type] || [];
  const apiConfig = (fieldMappings.length > 0 || powerDomainMappings.length > 0)
    ? { fieldMappings, ...(powerDomainMappings.length > 0 ? { powerDomainFieldMappings: powerDomainMappings } : {}) }
    : undefined;

  switch (type) {
    case 'ac':
      return { label, nodeType: 'ac' as const, category, apiConfig, sourceData: mockSourceData({ inputVoltage: 220, outputVoltage: 220, efficiency: 99 }) };
    case 'psu':
      return { label, nodeType: 'psu' as const, category, apiConfig, sourceData: mockSourceData({ inputVoltage: 220, outputVoltage: 12, efficiency: 94 }) };
    case 'vr':
      return { label, nodeType: 'vr' as const, category, apiConfig, sourceData: mockSourceData({ inputVoltage: 12, outputVoltage: 0.85, current: 100, efficiency: 90 }) };
    case 'psip':
      return { label, nodeType: 'psip' as const, category, apiConfig, sourceData: mockSourceData({ inputVoltage: 12, outputVoltage: 1.8, current: 5, efficiency: 91 }) };
    case 'busbar':
      return { label, nodeType: 'busbar' as const, category, apiConfig, sourceData: mockSourceData({ inputVoltage: 12, outputVoltage: 12, current: 50, efficiency: 99, busbarPower: 600 }) };
    case 'cpu':
      return { label, nodeType: 'cpu' as const, category, apiConfig, cpuData: mockCPUData() };
    case 'memory':
      return { label, nodeType: 'memory' as const, category, apiConfig, memoryData: mockMemoryData() };
    case 'fan':
      return { label, nodeType: 'fan' as const, category, apiConfig, fanData: mockFanData() };
    case 'disk':
      return { label, nodeType: 'disk' as const, category, apiConfig, diskData: mockDiskData() };
    case 'io':
      return { label, nodeType: 'io' as const, category, apiConfig, ioData: mockIOData() };
    case 'card':
      return { label, nodeType: 'card' as const, category, apiConfig, cardData: mockCardData('Slot-New') };
    case 'sensor':
      return { label, nodeType: 'sensor' as const, category, apiConfig, sensorData: mockSensorData('新传感器', 40) };
    case 'mgmtBoard':
      return { label, nodeType: 'mgmtBoard' as const, category, apiConfig, mgmtData: mockMgmtBoardData() };
    case 'chassis':
      return { label, nodeType: 'chassis' as const, category, apiConfig };
    case 'thermometer':
      return { label, nodeType: 'thermometer' as const, category: 'other' as const, apiConfig, thermometerData: mockThermometerData() };
    case 'custom':
      return {
        label,
        nodeType: 'custom' as const,
        category: 'load' as const,
        apiConfig: {
          fieldMappings: [
            { fieldKey: 'power', bmcField: '自定义模块功耗' },
          ],
          customFieldDefs: [
            { fieldKey: 'power', label: '功耗' },
          ],
        },
        displayMetrics: { power: fluctuate(50, 20) },
      };
    default:
      return { label, nodeType: 'chassis' as const, category, apiConfig };
  }
}

/** 默认拓扑节点 */
export function getDefaultNodes(): TopologyNode[] {
  // 为各类型节点创建 apiConfig
  const acApiConfig = { fieldMappings: defaultFieldMappings.ac };
  const psuApiConfig = { fieldMappings: defaultFieldMappings.psu };
  const vrApiConfig = { fieldMappings: defaultFieldMappings.vr };
  const psipApiConfig = { fieldMappings: defaultFieldMappings.psip };
  const cpuApiConfig = { fieldMappings: defaultFieldMappings.cpu, powerDomainFieldMappings: defaultPowerDomainFieldMappings.cpu };
  const memoryApiConfig = { fieldMappings: defaultFieldMappings.memory };
  const fanApiConfig = { fieldMappings: defaultFieldMappings.fan };
  const diskApiConfig = { fieldMappings: defaultFieldMappings.disk };
  const ioApiConfig = { fieldMappings: defaultFieldMappings.io };
  const cardApiConfig = { fieldMappings: defaultFieldMappings.card };
  const sensorApiConfig = { fieldMappings: defaultFieldMappings.sensor };
  const mgmtApiConfig = { fieldMappings: defaultFieldMappings.mgmtBoard };

  return [
    // AC电源
    { id: 'ac-1', type: 'ac', position: { x: 50, y: 750 }, data: { label: 'AC电源', nodeType: 'ac' as const, category: 'source' as const, apiConfig: acApiConfig, sourceData: mockSourceData({ inputVoltage: 220, outputVoltage: 220, efficiency: 99 }) } },
    // PSU
    { id: 'psu-1', type: 'psu', position: { x: 250, y: 700 }, data: { label: 'PSU-1', nodeType: 'psu' as const, category: 'source' as const, apiConfig: psuApiConfig, sourceData: mockSourceData({ inputVoltage: 220, outputVoltage: 12, efficiency: 94 }) } },
    { id: 'psu-2', type: 'psu', position: { x: 250, y: 820 }, data: { label: 'PSU-2', nodeType: 'psu' as const, category: 'source' as const, apiConfig: psuApiConfig, sourceData: mockSourceData({ inputVoltage: 220, outputVoltage: 12, efficiency: 93 }) } },
    // VR
    // VR - 添加效率警告测试: vr-cpu0=87% (黄色警告), vr-cpu1=83% (红色严重), vr-mem=90% (正常)
    { id: 'vr-cpu0', type: 'vr', position: { x: 500, y: 350 }, data: { label: 'VR-CPU0', nodeType: 'vr' as const, category: 'source' as const, apiConfig: vrApiConfig, sourceData: mockSourceData({ inputVoltage: 12, outputVoltage: 0.85, current: 180, efficiency: 87, temperature: 62 }) } },
    { id: 'vr-cpu1', type: 'vr', position: { x: 500, y: 500 }, data: { label: 'VR-CPU1', nodeType: 'vr' as const, category: 'source' as const, apiConfig: vrApiConfig, sourceData: mockSourceData({ inputVoltage: 12, outputVoltage: 0.85, current: 170, efficiency: 83, temperature: 82 }) } },
    { id: 'vr-mem', type: 'vr', position: { x: 500, y: 650 }, data: { label: 'VR-MEM', nodeType: 'vr' as const, category: 'source' as const, apiConfig: vrApiConfig, sourceData: mockSourceData({ inputVoltage: 12, outputVoltage: 1.2, current: 20, efficiency: 90, temperature: 55 }) } },
    // PSIP
    { id: 'psip-1', type: 'psip', position: { x: 500, y: 200 }, data: { label: 'PSIP-1', nodeType: 'psip' as const, category: 'source' as const, apiConfig: psipApiConfig, sourceData: mockSourceData({ inputVoltage: 12, outputVoltage: 1.8, current: 5, efficiency: 91 }) } },
    // CPU - 添加温度警告测试: cpu-0=75°C (黄色警告), cpu-1=82°C (红色严重)
    { id: 'cpu-0', type: 'cpu', position: { x: 750, y: 330 }, data: { label: 'CPU0', nodeType: 'cpu' as const, category: 'load' as const, apiConfig: cpuApiConfig, cpuData: { ...mockCPUData(), temperature: 75 } } },
    { id: 'cpu-1', type: 'cpu', position: { x: 750, y: 500 }, data: { label: 'CPU1', nodeType: 'cpu' as const, category: 'load' as const, apiConfig: cpuApiConfig, cpuData: { ...mockCPUData(), temperature: 82 } } },
    // 内存
    { id: 'mem-1', type: 'memory', position: { x: 750, y: 650 }, data: { label: '内存组', nodeType: 'memory' as const, category: 'load' as const, apiConfig: memoryApiConfig, memoryData: mockMemoryData() } },
    // 风扇
    { id: 'fan-1', type: 'fan', position: { x: 200, y: 30 }, data: { label: 'FAN1', nodeType: 'fan' as const, category: 'load' as const, apiConfig: fanApiConfig, fanData: mockFanData({ rpm: 5200 }) } },
    { id: 'fan-2', type: 'fan', position: { x: 400, y: 30 }, data: { label: 'FAN2', nodeType: 'fan' as const, category: 'load' as const, apiConfig: fanApiConfig, fanData: mockFanData({ rpm: 5100 }) } },
    { id: 'fan-3', type: 'fan', position: { x: 600, y: 30 }, data: { label: 'FAN3', nodeType: 'fan' as const, category: 'load' as const, apiConfig: fanApiConfig, fanData: mockFanData({ rpm: 5000 }) } },
    { id: 'fan-4', type: 'fan', position: { x: 800, y: 30 }, data: { label: 'FAN4', nodeType: 'fan' as const, category: 'load' as const, apiConfig: fanApiConfig, fanData: mockFanData({ rpm: 4900 }) } },
    // 前管理板
    { id: 'mgmt-front', type: 'mgmtBoard', position: { x: 50, y: 30 }, data: { label: '前管理板', nodeType: 'mgmtBoard' as const, category: 'other' as const, apiConfig: mgmtApiConfig, mgmtData: mockMgmtBoardData() } },
    // 后管理板
    { id: 'mgmt-rear', type: 'mgmtBoard', position: { x: 50, y: 850 }, data: { label: '后管理板', nodeType: 'mgmtBoard' as const, category: 'other' as const, apiConfig: mgmtApiConfig, mgmtData: mockMgmtBoardData() } },
    // IO
    { id: 'io-1', type: 'io', position: { x: 450, y: 850 }, data: { label: 'IO1', nodeType: 'io' as const, category: 'load' as const, apiConfig: ioApiConfig, ioData: mockIOData() } },
    { id: 'io-2', type: 'io', position: { x: 650, y: 850 }, data: { label: 'IO2', nodeType: 'io' as const, category: 'load' as const, apiConfig: ioApiConfig, ioData: mockIOData() } },
    // 硬盘
    { id: 'disk-1', type: 'disk', position: { x: 950, y: 700 }, data: { label: '硬盘组', nodeType: 'disk' as const, category: 'load' as const, apiConfig: diskApiConfig, diskData: mockDiskData() } },
    // 标卡
    { id: 'card-1', type: 'card', position: { x: 950, y: 500 }, data: { label: '标卡1', nodeType: 'card' as const, category: 'load' as const, apiConfig: cardApiConfig, cardData: mockCardData('Slot-1') } },
    // 温度传感器 - 添加温度警告测试: sensor-hot=85°C (红色严重)
    { id: 'sensor-cpu0', type: 'sensor', position: { x: 950, y: 330 }, data: { label: '传感器-CPU0', nodeType: 'sensor' as const, category: 'other' as const, apiConfig: sensorApiConfig, sensorData: mockSensorData('CPU0附近', 85) } },
    { id: 'sensor-mem', type: 'sensor', position: { x: 950, y: 650 }, data: { label: '传感器-内存', nodeType: 'sensor' as const, category: 'other' as const, apiConfig: sensorApiConfig, sensorData: mockSensorData('内存区域', 65) } },
  ];
}

/** 默认拓扑边 */
export function getDefaultEdges(): TopologyEdge[] {
  return [
    // AC → PSU
    { id: 'e-ac-psu1', source: 'ac-1', target: 'psu-1', type: 'powerEdge', data: { loss: 2.5, lossPercent: 0.3, animated: true } },
    { id: 'e-ac-psu2', source: 'ac-1', target: 'psu-2', type: 'powerEdge', data: { loss: 2.3, lossPercent: 0.3, animated: true } },
    // PSU → VR
    { id: 'e-psu1-vrcpu0', source: 'psu-1', target: 'vr-cpu0', type: 'powerEdge', data: { loss: 8.5, lossPercent: 1.2, animated: true } },
    { id: 'e-psu1-vrcpu1', source: 'psu-1', target: 'vr-cpu1', type: 'powerEdge', data: { loss: 9.0, lossPercent: 1.3, animated: true } },
    { id: 'e-psu2-vrmem', source: 'psu-2', target: 'vr-mem', type: 'powerEdge', data: { loss: 3.0, lossPercent: 0.8, animated: true } },
    { id: 'e-psu1-psip', source: 'psu-1', target: 'psip-1', type: 'powerEdge', data: { loss: 1.5, lossPercent: 0.5, animated: true } },
    // VR → CPU（含自定义 BMC 链路信息示例）
    { id: 'e-vrcpu0-cpu0', source: 'vr-cpu0', target: 'cpu-0', type: 'powerEdge', data: { loss: 5.2, lossPercent: 2.1, animated: true, label: 'VR→CPU0', customData: { bmcLink: 'VR-CPU0 → CPU0', cableType: '12V DC', maxCurrent: '200A' } } },
    { id: 'e-vrcpu1-cpu1', source: 'vr-cpu1', target: 'cpu-1', type: 'powerEdge', data: { loss: 5.5, lossPercent: 2.2, animated: true, label: 'VR→CPU1', customData: { bmcLink: 'VR-CPU1 → CPU1', cableType: '12V DC', maxCurrent: '180A' } } },
    // VR → 内存
    { id: 'e-vrmem-mem', source: 'vr-mem', target: 'mem-1', type: 'powerEdge', data: { loss: 1.2, lossPercent: 1.5, animated: true } },
    // PSU → 风扇（fan1 使用非默认 handle 演示多侧连线）
    { id: 'e-psu2-fan1', source: 'psu-2', sourceHandle: 'source-top', target: 'fan-1', targetHandle: 'target-bottom', type: 'powerEdge', data: { loss: 0.5, lossPercent: 0.2, animated: true } },
    { id: 'e-psu2-fan2', source: 'psu-2', target: 'fan-2', type: 'powerEdge', data: { loss: 0.5, lossPercent: 0.2, animated: true } },
    { id: 'e-psu2-fan3', source: 'psu-2', target: 'fan-3', type: 'powerEdge', data: { loss: 0.5, lossPercent: 0.2, animated: true } },
    { id: 'e-psu2-fan4', source: 'psu-2', target: 'fan-4', type: 'powerEdge', data: { loss: 0.5, lossPercent: 0.2, animated: true } },
    // PSU → IO
    { id: 'e-psu1-io1', source: 'psu-1', target: 'io-1', type: 'powerEdge', data: { loss: 0.8, lossPercent: 0.3, animated: true } },
    { id: 'e-psu1-io2', source: 'psu-1', target: 'io-2', type: 'powerEdge', data: { loss: 0.8, lossPercent: 0.3, animated: true } },
    // PSU → 硬盘
    { id: 'e-psu2-disk', source: 'psu-2', target: 'disk-1', type: 'powerEdge', data: { loss: 0.6, lossPercent: 0.4, animated: true } },
    // PSIP → 标卡
    { id: 'e-psip-card', source: 'psip-1', target: 'card-1', type: 'powerEdge', data: { loss: 1.0, lossPercent: 0.6, animated: true } },
  ];
}

/** 刷新所有节点数据(模拟实时更新) */
export function refreshNodeData(nodes: TopologyNode[]): TopologyNode[] {
  return nodes.map(node => {
    const data = { ...node.data };
    switch (data.nodeType) {
      case 'ac':
      case 'psu':
      case 'vr':
      case 'psip':
      case 'busbar':
        data.sourceData = mockSourceData(data.sourceData);
        break;
      case 'cpu':
        data.cpuData = mockCPUData();
        break;
      case 'fan':
        data.fanData = mockFanData(data.fanData);
        break;
      case 'memory':
        data.memoryData = mockMemoryData();
        break;
      case 'disk':
        data.diskData = mockDiskData();
        break;
      case 'io':
        data.ioData = mockIOData();
        break;
      case 'card':
        data.cardData = mockCardData(data.cardData?.slotId || 'Slot-1');
        break;
      case 'sensor':
        data.sensorData = mockSensorData(data.sensorData?.location || 'Unknown', data.sensorData?.temperature || 0);
        break;
      case 'mgmtBoard':
        data.mgmtData = mockMgmtBoardData();
        break;
      case 'thermometer':
        data.thermometerData = mockThermometerData(data.thermometerData);
        break;
      case 'custom':
        break;
    }
    // 为自定义字段刷新 displayMetrics
    const fixedKeys = new Set((FIXED_FIELD_DEFS as Record<string, { fieldKey: string }[]>)[data.nodeType || '']?.map((d) => d.fieldKey) || []);
    const customMappings = data.apiConfig?.fieldMappings?.filter((m) => !fixedKeys.has(m.fieldKey)) || [];
    if (customMappings.length > 0) {
      const metrics: Record<string, number | null> = { ...(data.displayMetrics || {}) };
      customMappings.forEach((m) => {
        metrics[m.fieldKey] = fluctuate(50, 20);
      });
      data.displayMetrics = metrics;
    }
    return { ...node, data };
  });
}

/** 刷新边数据（保留 label / customData 等用户字段） */
export function refreshEdgeData(edges: TopologyEdge[]): TopologyEdge[] {
  return edges.map(edge => {
    const prev = edge.data!;
    // 新建边 loss=0 时给一个随机小损耗，避免永远为0
    const baseLoss = prev.loss === 0 ? +(Math.random() * 2 + 0.5).toFixed(2) : prev.loss;
    const baseLossPercent = prev.lossPercent === 0 ? +(Math.random() * 0.5 + 0.1).toFixed(2) : prev.lossPercent;
    return {
      ...edge,
      data: {
        ...prev,
        loss: fluctuate(baseLoss, 5),
        lossPercent: fluctuate(baseLossPercent, 5),
      } as PowerEdgeData,
    };
  });
}
