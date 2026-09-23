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
  temperature?: number | null;   // 温度 °C（兼容旧版）
  psuIntakeTemp?: number | null;      // PSU(入风口)温度 °C
  psuMosTemp?: number | null;         // PSU(主功率MOS)温度 °C
  psuRearIntakeTemp?: number | null;  // 后扩PSU位置(PSU入风)温度 °C
  busbarVoltage?: number | null;      // 母线电压 V
  busbarCurrent?: number | null;      // 母线电流 A
  busbarPower?: number | null;        // 母线功耗 W
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
  fanInputVoltage?: number | null;   // 风扇输入电压 V
  fanInputCurrent?: number | null;   // 风扇输入电流 A
}

/** CPU电源域 */
export interface CPUPowerDomain {
  name: string;           // 域名称
  voltage: number;        // 电压 V
  current: number;        // 电流 A
  power: number;          // 功耗 W
}

/** CPU电源域字段定义：电源域详情弹窗内的固定字段 */
export interface CPUPowerDomainFieldDef {
  domain: string;               // 域名称，如 'TA_CORE_DVFS'
  measure: 'voltage' | 'current' | 'power';  // 测量类型
  fieldKey: string;             // 数据字段名
  label: string;                // 显示名（中文）
}

/** CPU电源域详情内的固定字段定义（7 个域 × 输出电压/电流/功率） */
export const CPU_POWER_DOMAIN_FIELD_DEFS: CPUPowerDomainFieldDef[] = [
  // TA_CORE_DVFS
  { domain: 'TA_CORE_DVFS', measure: 'voltage', fieldKey: 'cpuDomainTaCoreDvfsOutputVoltage', label: 'CPU电源域TA_CORE_DVFS输出电压' },
  { domain: 'TA_CORE_DVFS', measure: 'current', fieldKey: 'cpuDomainTaCoreDvfsOutputCurrent', label: 'CPU电源域TA_CORE_DVFS输出电流' },
  { domain: 'TA_CORE_DVFS', measure: 'power', fieldKey: 'cpuDomainTaCoreDvfsOutputPower', label: 'CPU电源域TA_CORE_DVFS输出功率' },
  // DDRIO
  { domain: 'DDRIO', measure: 'voltage', fieldKey: 'cpuDomainDdrioOutputVoltage', label: 'CPU电源域DDRIO输出电压' },
  { domain: 'DDRIO', measure: 'current', fieldKey: 'cpuDomainDdrioOutputCurrent', label: 'CPU电源域DDRIO输出电流' },
  { domain: 'DDRIO', measure: 'power', fieldKey: 'cpuDomainDdrioOutputPower', label: 'CPU电源域DDRIO输出功率' },
  // TB_CORE_DVFS
  { domain: 'TB_CORE_DVFS', measure: 'voltage', fieldKey: 'cpuDomainTbCoreDvfsOutputVoltage', label: 'CPU电源域TB_CORE_DVFS输出电压' },
  { domain: 'TB_CORE_DVFS', measure: 'current', fieldKey: 'cpuDomainTbCoreDvfsOutputCurrent', label: 'CPU电源域TB_CORE_DVFS输出电流' },
  { domain: 'TB_CORE_DVFS', measure: 'power', fieldKey: 'cpuDomainTbCoreDvfsOutputPower', label: 'CPU电源域TB_CORE_DVFS输出功率' },
  // IO_NB_AVS
  { domain: 'IO_NB_AVS', measure: 'voltage', fieldKey: 'cpuDomainIoNbAvsOutputVoltage', label: 'CPU电源域IO_NB_AVS输出电压' },
  { domain: 'IO_NB_AVS', measure: 'current', fieldKey: 'cpuDomainIoNbAvsOutputCurrent', label: 'CPU电源域IO_NB_AVS输出电流' },
  { domain: 'IO_NB_AVS', measure: 'power', fieldKey: 'cpuDomainIoNbAvsOutputPower', label: 'CPU电源域IO_NB_AVS输出功率' },
  // UNCORE_DVFS
  { domain: 'UNCORE_DVFS', measure: 'voltage', fieldKey: 'cpuDomainUncoreDvfsOutputVoltage', label: 'CPU电源域UNCORE_DVFS输出电压' },
  { domain: 'UNCORE_DVFS', measure: 'current', fieldKey: 'cpuDomainUncoreDvfsOutputCurrent', label: 'CPU电源域UNCORE_DVFS输出电流' },
  { domain: 'UNCORE_DVFS', measure: 'power', fieldKey: 'cpuDomainUncoreDvfsOutputPower', label: 'CPU电源域UNCORE_DVFS输出功率' },
  // IO_NA_AVS
  { domain: 'IO_NA_AVS', measure: 'voltage', fieldKey: 'cpuDomainIoNaAvsOutputVoltage', label: 'CPU电源域IO_NA_AVS输出电压' },
  { domain: 'IO_NA_AVS', measure: 'current', fieldKey: 'cpuDomainIoNaAvsOutputCurrent', label: 'CPU电源域IO_NA_AVS输出电流' },
  { domain: 'IO_NA_AVS', measure: 'power', fieldKey: 'cpuDomainIoNaAvsOutputPower', label: 'CPU电源域IO_NA_AVS输出功率' },
  // SERDES
  { domain: 'SERDES', measure: 'voltage', fieldKey: 'cpuDomainSerdesOutputVoltage', label: 'CPU电源域SERDES输出电压' },
  { domain: 'SERDES', measure: 'current', fieldKey: 'cpuDomainSerdesOutputCurrent', label: 'CPU电源域SERDES输出电流' },
  { domain: 'SERDES', measure: 'power', fieldKey: 'cpuDomainSerdesOutputPower', label: 'CPU电源域SERDES输出功率' },
];

/** CPU电源域名称列表（按定义顺序去重） */
export const CPU_POWER_DOMAINS: string[] = Array.from(
  new Set(CPU_POWER_DOMAIN_FIELD_DEFS.map((d) => d.domain))
);

/** 根据字段映射值构建 CPU 电源域数组
 * 优先使用映射值，未配置的域字段回退到已有数据
 */
export function buildCPUPowerDomains(
  mapped: Record<string, number | string | boolean | null>,
  existing: CPUPowerDomain[] | undefined
): CPUPowerDomain[] {
  return CPU_POWER_DOMAINS.map((name) => {
    const defs = CPU_POWER_DOMAIN_FIELD_DEFS.filter((d) => d.domain === name);
    const existingDomain = existing?.find((d) => d.name === name);
    const getValue = (measure: 'voltage' | 'current' | 'power'): number => {
      const def = defs.find((d) => d.measure === measure);
      if (def && Object.prototype.hasOwnProperty.call(mapped, def.fieldKey)) {
        const v = mapped[def.fieldKey];
        if (v !== null && v !== undefined && v !== '') {
          const num = Number(v);
          if (!Number.isNaN(num)) return num;
        }
      }
      return existingDomain?.[measure] ?? 0;
    };
    return {
      name,
      voltage: getValue('voltage'),
      current: getValue('current'),
      power: getValue('power'),
    };
  });
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
  diskInputVoltage?: number | null;   // 硬盘背板输入电压 V
  diskInputCurrent?: number | null;   // 硬盘背板输入电流 A
  nvmeInternalTemp?: number | null;   // NVMe盘内置温度 ℃
  nvmeMaxTemp?: number | null;        // 所有NVMe盘最大温度 ℃
}

/** IO接口数据 */
export interface IOData extends LoadData {
  linkSpeed: string | null;      // 链路速率
}

/** 标卡数据 */
export interface CardData extends LoadData {
  slotId: string | null;
  cardInputVoltage?: number | null;   // 标卡输入电压 V
  cardInputCurrent?: number | null;   // 标卡输入电流 A
  ocpMainChipTemp?: number | null;    // OCP卡主芯片温度 ℃
  ocpOpticalMaxTemp?: number | null;  // OCP卡光模块最高温度 ℃
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
