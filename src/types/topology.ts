/** 拓扑节点/边类型定义 */
import type { Node, Edge } from '@xyflow/react';
import type {
  SourceData, FanData, CPUData, SensorData,
  MemoryData, DiskData, IOData, CardData, MgmtBoardData,
} from './power';

/** 所有节点类型 */
export type HardwareNodeType =
  | 'ac' | 'psu' | 'vr' | 'psip' | 'busbar'
  | 'cpu' | 'memory' | 'fan' | 'disk'
  | 'io' | 'card' | 'sensor' | 'mgmtBoard' | 'chassis'
  | 'thermometer' | 'custom';

/** BMC 连接配置（通过 SSH） */
export interface BMCConfig {
  ip: string;
  username: string;
  password: string;
  port?: number;
  protocol?: 'ssh';
  enabled: boolean;
}

/** 字段阈值配置 */
export interface FieldThreshold {
  fieldKey: string;        // 字段名，如 'power', 'temperature'
  ranges: {                // 阈值范围配置
    min: number;           // 范围最小值
    max: number;           // 范围最大值
    color: string;         // 显示颜色（如 '#52c41a', 'red'）
    label?: string;        // 范围标签（如 '正常', '警告'）
  }[];
}

/** 字段映射配置：将 BMC Sensor 字段映射到前端数据字段 */
export interface FieldMapping {
  fieldKey: string;   // 前端数据字段名，如 'power', 'temperature'
  bmcField: string;   // BMC sensor 名，如 'CPU0 PWR'
  label?: string;     // 用户自定义显示名（覆盖固定字段定义和 customFieldDefs）
}

/** 固定字段定义：每种节点类型的字段和显示名是固定的 */
export interface FixedFieldDef {
  fieldKey: string;   // 数据字段名
  label: string;      // 显示名（中文）
}

/** 各节点类型的固定字段定义 */
export const FIXED_FIELD_DEFS: Record<string, FixedFieldDef[]> = {
  cpu: [
    { fieldKey: 'power', label: 'CPU功耗' },
  ],
  memory: [
    { fieldKey: 'dimmInputVoltage', label: '内存输入电压' },
    { fieldKey: 'dimmInputCurrent', label: '内存输入电流' },
    { fieldKey: 'power', label: '内存功耗' },
    { fieldKey: 'temperature', label: '内存条温度' },
    { fieldKey: 'dimmThermalTarget', label: 'DIMM控温目标' },
  ],
  disk: [
    { fieldKey: 'diskInputVoltage', label: '硬盘背板输入电压' },
    { fieldKey: 'diskInputCurrent', label: '硬盘背板输入电流' },
    { fieldKey: 'power', label: '硬盘背板功耗' },
    { fieldKey: 'temperature', label: '硬盘背板温度' },
    { fieldKey: 'nvmeInternalTemp', label: 'NVMe盘内置温度' },
    { fieldKey: 'nvmeMaxTemp', label: '所有NVMe盘最大温度' },
  ],
  fan: [
    { fieldKey: 'fanInputVoltage', label: '风扇输入电压' },
    { fieldKey: 'fanInputCurrent', label: '风扇输入电流' },
    { fieldKey: 'power', label: '风扇总功耗' },
    { fieldKey: 'rpm', label: '风扇风速' },
  ],
  io: [
    { fieldKey: 'power', label: '功耗' },
    { fieldKey: 'temperature', label: '温度' },
    { fieldKey: 'linkSpeed', label: '链路速率' },
  ],
  card: [
    { fieldKey: 'cardInputVoltage', label: '标卡输入电压' },
    { fieldKey: 'cardInputCurrent', label: '标卡输入电流' },
    { fieldKey: 'power', label: '标卡功耗' },
    { fieldKey: 'ocpMainChipTemp', label: 'OCP卡主芯片温度' },
    { fieldKey: 'ocpOpticalMaxTemp', label: 'OCP卡光模块最高温度' },
  ],
  sensor: [
    { fieldKey: 'temperature', label: '板级其他温度监测点温度' },
    { fieldKey: 'location', label: '位置' },
  ],
  mgmtBoard: [
    { fieldKey: 'temperature', label: '温度' },
    { fieldKey: 'status', label: '状态' },
  ],
  thermometer: [
    { fieldKey: 'temperature', label: '温度' },
    { fieldKey: 'temperatureStatus', label: '温度状态' },
  ],
  // source 类型 (ac, psu, vr, psip, busbar) 使用 sourceData
  ac: [
    { fieldKey: 'outputVoltage', label: 'AC输出电压' },
    { fieldKey: 'current', label: 'AC输出电流' },
    { fieldKey: 'outputPower', label: 'AC输出功率' },
  ],
  busbar: [
    { fieldKey: 'busbarVoltage', label: '母线电压' },
    { fieldKey: 'busbarCurrent', label: '母线电流' },
    { fieldKey: 'busbarPower', label: '母线功耗' },
  ],
  psu: [
    { fieldKey: 'inputVoltage', label: 'PSU输入电压' },
    { fieldKey: 'inputCurrent', label: 'PSU输入电流' },
    { fieldKey: 'inputPower', label: 'PSU输入功率' },
    { fieldKey: 'outputVoltage', label: 'PSU输出电压' },
    { fieldKey: 'outputCurrent', label: 'PSU输出电流' },
    { fieldKey: 'outputPower', label: 'PSU输出功率' },
    { fieldKey: 'psuIntakeTemp', label: 'PSU(入风口)温度' },
    { fieldKey: 'psuMosTemp', label: 'PSU(主功率MOS)温度' },
    { fieldKey: 'psuRearIntakeTemp', label: '后扩PSU位置(PSU入风)温度' },
  ],
  vr: [
    { fieldKey: 'inputVoltage', label: 'VR输入电压' },
    { fieldKey: 'inputCurrent', label: 'VR输入电流' },
    { fieldKey: 'inputPower', label: 'VR输入功率' },
    { fieldKey: 'outputVoltage', label: 'VR输出电压' },
    { fieldKey: 'outputCurrent', label: 'VR输出电流' },
    { fieldKey: 'outputPower', label: 'VR输出功率' },
    { fieldKey: 'vrOutputVoltageControl', label: 'VR输出电压调节接口' },
    { fieldKey: 'efficiency', label: '效率' },
    { fieldKey: 'temperature', label: '温度' },
  ],
  psip: [
    { fieldKey: 'inputVoltage', label: 'psip输入电压' },
    { fieldKey: 'inputCurrent', label: 'psip输入电流' },
    { fieldKey: 'inputPower', label: 'psip输入功率' },
    { fieldKey: 'psipOutputVoltageUnionsVtt', label: 'psip输出电压 - Unions VTT' },
    { fieldKey: 'psipOutputVoltageUnionsHvcc', label: 'psip输出电压 - Unions HVCC' },
    { fieldKey: 'psipOutputVoltageNimbusHvcc', label: 'psip输出电压 - Nimbus HVCC' },
    { fieldKey: 'psipOutputVoltageUnionsLvcc', label: 'psip输出电压 - Unions LVCC' },
    { fieldKey: 'psipOutputVoltageNimbusLvcc', label: 'psip输出电压 - Nimbus LVCC' },
    { fieldKey: 'psipOutputVoltage3v3Drmos', label: 'psip输出电压 - 3.3 DRMOS' },
    { fieldKey: 'psipOutputVoltage1v8Gpio', label: 'psip输出电压 - 1V8 GPIO' },
    { fieldKey: 'psipOutputCurrentUnionsVtt', label: 'psip输出电流 - Unions VTT' },
    { fieldKey: 'psipOutputCurrentUnionsHvcc', label: 'psip输出电流 - Unions HVCC' },
    { fieldKey: 'psipOutputCurrentNimbusHvcc', label: 'psip输出电流 - Nimbus HVCC' },
    { fieldKey: 'psipOutputCurrentUnionsLvcc', label: 'psip输出电流 - Unions LVCC' },
    { fieldKey: 'psipOutputCurrentNimbusLvcc', label: 'psip输出电流 - Nimbus LVCC' },
    { fieldKey: 'psipOutputCurrent3v3Drmos', label: 'psip输出电流 - 3.3 DRMOS' },
    { fieldKey: 'psipOutputCurrent1v8Gpio', label: 'psip输出电流 - 1V8 GPIO' },
    { fieldKey: 'psipOutputPowerUnionsVtt', label: 'psip输出功率 - Unions VTT' },
    { fieldKey: 'psipOutputPowerUnionsHvcc', label: 'psip输出功率 - Unions HVCC' },
    { fieldKey: 'psipOutputPowerNimbusHvcc', label: 'psip输出功率 - Nimbus HVCC' },
    { fieldKey: 'psipOutputPowerUnionsLvcc', label: 'psip输出功率 - Unions LVCC' },
    { fieldKey: 'psipOutputPowerNimbusLvcc', label: 'psip输出功率 - Nimbus LVCC' },
    { fieldKey: 'psipOutputPower3v3Drmos', label: 'psip输出功率 - 3.3 DRMOS' },
    { fieldKey: 'psipOutputPower1v8Gpio', label: 'psip输出功率 - 1V8 GPIO' },
    { fieldKey: 'psipOutputVoltageControl', label: 'psip输出电压调节接口' },
    { fieldKey: 'efficiency', label: '效率' },
    { fieldKey: 'temperature', label: '温度' },
  ],
  chassis: [],
  custom: [],
};

/** 默认字段阈值配置 */
export const DEFAULT_FIELD_THRESHOLDS: Record<string, FieldThreshold[]> = {
  cpu: [
    {
      fieldKey: 'temperature',
      ranges: [
        { min: 0, max: 60, color: '#52c41a', label: '正常' },
        { min: 60, max: 80, color: '#faad14', label: '警告' },
        { min: 80, max: 150, color: '#ff4d4f', label: '危险' },
      ],
    },
    {
      fieldKey: 'power',
      ranges: [
        { min: 0, max: 200, color: '#52c41a', label: '正常' },
        { min: 200, max: 350, color: '#faad14', label: '警告' },
        { min: 350, max: 1000, color: '#ff4d4f', label: '危险' },
      ],
    },
  ],
  memory: [
    {
      fieldKey: 'temperature',
      ranges: [
        { min: 0, max: 55, color: '#52c41a', label: '正常' },
        { min: 55, max: 75, color: '#faad14', label: '警告' },
        { min: 75, max: 150, color: '#ff4d4f', label: '危险' },
      ],
    },
  ],
  disk: [
    {
      fieldKey: 'temperature',
      ranges: [
        { min: 0, max: 45, color: '#52c41a', label: '正常' },
        { min: 45, max: 60, color: '#faad14', label: '警告' },
        { min: 60, max: 150, color: '#ff4d4f', label: '危险' },
      ],
    },
  ],
  fan: [
    {
      fieldKey: 'temperature',
      ranges: [
        { min: 0, max: 50, color: '#52c41a', label: '正常' },
        { min: 50, max: 70, color: '#faad14', label: '警告' },
        { min: 70, max: 150, color: '#ff4d4f', label: '危险' },
      ],
    },
  ],
  // source 类型阈值
  psu: [
    {
      fieldKey: 'psuIntakeTemp',
      ranges: [
        { min: 0, max: 45, color: '#52c41a', label: '正常' },
        { min: 45, max: 60, color: '#faad14', label: '警告' },
        { min: 60, max: 150, color: '#ff4d4f', label: '危险' },
      ],
    },
    {
      fieldKey: 'psuMosTemp',
      ranges: [
        { min: 0, max: 55, color: '#52c41a', label: '正常' },
        { min: 55, max: 75, color: '#faad14', label: '警告' },
        { min: 75, max: 150, color: '#ff4d4f', label: '危险' },
      ],
    },
    {
      fieldKey: 'psuRearIntakeTemp',
      ranges: [
        { min: 0, max: 45, color: '#52c41a', label: '正常' },
        { min: 45, max: 60, color: '#faad14', label: '警告' },
        { min: 60, max: 150, color: '#ff4d4f', label: '危险' },
      ],
    },
  ],
  vr: [
    {
      fieldKey: 'temperature',
      ranges: [
        { min: 0, max: 70, color: '#52c41a', label: '正常' },
        { min: 70, max: 90, color: '#faad14', label: '警告' },
        { min: 90, max: 150, color: '#ff4d4f', label: '危险' },
      ],
    },
    {
      fieldKey: 'efficiency',
      ranges: [
        { min: 0, max: 85, color: '#ff4d4f', label: '低效' },
        { min: 85, max: 90, color: '#faad14', label: '一般' },
        { min: 90, max: 100, color: '#52c41a', label: '高效' },
      ],
    },
  ],
};

/** API 配置（监测接口 + 控制接口） */
export interface ApiConfig {
  monitorApi?: {
    url: string;
    method: 'GET';
  };
  /** 控制 Shell 命令，支持 {value} 占位符，如 ipmcset -t fan -d speed -v {value} */
  controlShell?: string;
  /** Sensor 名称配置（用于 BMC ipmcget 数据匹配，兼容旧版） */
  sensorName?: string;
  /** 字段级映射配置（优先级高于 sensorName） */
  fieldMappings?: FieldMapping[];
  /** CPU电源域字段映射配置（用于"电源域详情"弹窗内的固定字段） */
  powerDomainFieldMappings?: FieldMapping[];
  /** 字段阈值配置（用于监控界面颜色显示） */
  fieldThresholds?: FieldThreshold[];
  /** 用户自定义字段定义（fieldKey + 显示名） */
  customFieldDefs?: { fieldKey: string; label: string }[];
}

/** 节点数据联合类型 */
export type HardwareNodeData = {
  label: string;
  nodeType: HardwareNodeType;
  category: 'source' | 'path' | 'load' | 'other';
  customIcon?: string;
  displayAlias?: string;      // 用户自定义显示别名
  customIconUrl?: string;     // 用户上传的自定义图标 (Data URL)
  apiConfig?: ApiConfig;      // API 接口配置
  controlRange?: { min: number; max: number };  // 控制范围（调速/调压的最小最大值）
  displayMetrics?: Record<string, number | null>;  // 用户配置的显示指标（字段映射）
} & (
  | { nodeType: 'ac'; sourceData: SourceData }
  | { nodeType: 'psu'; sourceData: SourceData }
  | { nodeType: 'vr'; sourceData: SourceData }
  | { nodeType: 'psip'; sourceData: SourceData }
  | { nodeType: 'busbar'; sourceData: SourceData }
  | { nodeType: 'cpu'; cpuData: CPUData }
  | { nodeType: 'memory'; memoryData: MemoryData }
  | { nodeType: 'fan'; fanData: FanData }
  | { nodeType: 'disk'; diskData: DiskData }
  | { nodeType: 'io'; ioData: IOData }
  | { nodeType: 'card'; cardData: CardData }
  | { nodeType: 'sensor'; sensorData: SensorData }
  | { nodeType: 'mgmtBoard'; mgmtData: MgmtBoardData }
  | { nodeType: 'chassis'; }
  | { nodeType: 'thermometer'; thermometerData: import('./power').ThermometerData }
  | { nodeType: 'custom'; }
);

/** React Flow节点类型 */
export type TopologyNode = Node<HardwareNodeData>;

/** 连线箭头类型 */
export type EdgeArrowType = 'none' | 'forward';

/** 边数据 */
export interface PowerEdgeData {
  loss: number;         // 损耗 W
  lossPercent: number;  // 损耗百分比 %
  animated?: boolean;
  arrowType?: EdgeArrowType;             // 箭头类型：无箭头 / 单向 / 双向
  label?: string;                        // 用户可编辑的标签文本
  customData?: Record<string, unknown>;  // 自定义 JSON 数据（如 BMC 链路损耗信息）
  _mode?: 'design' | 'monitor';         // 由 Canvas 注入的模式标识
  _highlighted?: boolean;
  _reversed?: boolean;
  bendOffset?: number;                   // 连线中间段偏移量（用于拖拽调整避免交叉）
  [key: string]: unknown;
}

/** React Flow边类型 */
export type TopologyEdge = Edge<PowerEdgeData>;

/** 拓扑导出数据格式 */
export interface TopologyExportData {
  version: string;
  exportTime: string;
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  nodeScales: Record<string, number>;
}
