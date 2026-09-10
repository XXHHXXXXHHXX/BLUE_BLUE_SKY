/** 电源域/PVT数据类型定义 */

/** 节点类别: 源/路/载 */
export type NodeCategory = 'source' | 'path' | 'load';

/** 源模块数据 (AC, PSU, VR, PSIP) */
export interface SourceData {
  inputVoltage: number | null;   // 输入电压 V
  outputVoltage: number | null;  // 输出电压 V
  current: number | null;        // 电流 A（兼容旧版）
  inputCurrent: number | null;   // 输入电流 A
  outputCurrent: number | null;  // 输出电流 A
  inputPower: number | null;     // 输入功率 W
  outputPower: number | null;    // 输出功率 W
  efficiency: number | null;     // 转换效率 %
  temperature?: number | null;   // 温度 °C
}

/** 负载模块数据 */
export interface LoadData {
  power: number | null;          // 功耗 W
  temperature?: number | null;   // 温度 °C
}

/** 路径数据 */
export interface PathData {
  loss: number;           // 损耗 W
  lossPercent: number;    // 损耗百分比 %
}

/** 风扇数据 */
export interface FanData extends LoadData {
  rpm: number | null;            // 转速 RPM
  speedPercent: number | null;   // 速度百分比 %
}

/** CPU电源域 */
export interface CPUPowerDomain {
  name: string;           // 域名称
  voltage: number;        // 电压 V
  current: number;        // 电流 A
  power: number;          // 功耗 W
}

/** CPU完整数据 */
export interface CPUData extends LoadData {
  powerDomains: CPUPowerDomain[];
  amuEvents: AMUEvent[];
}

/** AMU功耗事件 */
export interface AMUEvent {
  id: string;
  timestamp: string;
  type: 'warning' | 'error' | 'info';
  domain: string;
  message: string;
  value: number;
}

/** 温度传感器数据 */
export interface SensorData {
  temperature: number | null;    // 温度 °C
  location: string | null;       // 位置描述
}

/** 内存数据 */
export interface MemoryData extends LoadData {
  thermalThrottle: boolean | null;  // 是否热节流
}

/** 硬盘数据 */
export interface DiskData extends LoadData {
  status: 'normal' | 'warning' | 'error' | null;
}

/** IO接口数据 */
export interface IOData extends LoadData {
  linkSpeed: string | null;      // 链路速率
}

/** 标卡数据 */
export interface CardData extends LoadData {
  slotId: string | null;
}

/** 管理板数据 */
export interface MgmtBoardData {
  status: 'online' | 'offline' | null;
  temperature: number | null;
}

/** 供电效率分析记录 */
export interface EfficiencyRecord {
  id: string;
  timestamp: string;
  stage: string;          // 转换阶段 (AC→PSU, PSU→VR等)
  inputPower: number;
  outputPower: number;
  efficiency: number;
  loss: number;
  notes: string;
}

/** 温度计数据 */
export interface ThermometerData {
  temperature: number | null;      // 温度 °C
  temperatureStatus: string | null; // 温度状态描述
}

/** 散热瓶颈案例 */
export interface ThermalCase {
  id: string;
  timestamp: string;
  location: string;
  temperature: number;
  threshold: number;
  description: string;
  solution: string;
}
