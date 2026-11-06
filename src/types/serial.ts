/** BMC SOL 串口监控类型定义（前后端共享） */

/** 可用 UART 编号（对应 # =Nh 的 N） */
export type SerialUartId = 0 | 1 | 3 | 4 | 8 | 9;

/** UART 元信息
 * mode: 'observe' 只读不写（AP 串口没有 LiteOS 提示符）；'send' 下发命令并等待提示符
 */
export interface SerialUartPreset {
  id: SerialUartId;
  hex: string;
  label: string;
  mode: 'observe' | 'send';
}

export const SERIAL_UART_PRESETS: SerialUartPreset[] = [
  { id: 0, hex: '0x0', label: 'CPU0 AP 串口', mode: 'observe' },
  { id: 1, hex: '0x1', label: 'CPU0 IMU 串口', mode: 'send' },
  { id: 3, hex: '0x3', label: 'CPU0 IPU 串口1', mode: 'send' },
  { id: 4, hex: '0x4', label: 'CPU0 IPU 串口0', mode: 'send' },
  { id: 8, hex: '0x8', label: 'CPU1 IPU 串口1', mode: 'send' },
  { id: 9, hex: '0x9', label: 'CPU1 IPU 串口0', mode: 'send' },
];

export const SERIAL_UART_IDS: number[] = SERIAL_UART_PRESETS.map((p) => p.id);

export function isSerialUartId(value: unknown): value is SerialUartId {
  return typeof value === 'number' && SERIAL_UART_IDS.includes(value);
}

/** 默认 UART 切换寄存器地址（CPU 板 Smc 对象 BlockIO 写） */
export const DEFAULT_SERIAL_UART_REGISTER = '0x00008A00';

/** 默认 SOL 提示符（与 py 版 endswith("LiteOS #") 等价） */
export const DEFAULT_SERIAL_PROMPT = 'Huawei LiteOS #\\s*$';

/** SOL 会话激活/关闭命令（BMC Linux shell） */
export const SERIAL_SOL_ACTIVATE = 'bash -l -c "source /etc/profile; ipmcset -t sol -d activate -v 1 0"';
export const SERIAL_SOL_DEACTIVATE = 'bash -l -c "ipmcset -t sol -d deactivate -v 1 0"';

/** 串口监控可选的命令类型
 * - power0：各电源域功耗快照，仅 IMU（uart=1）可用
 * - powerCap：功耗封顶计算结果，仅 IPU（uart=3/4/8/9）可用
 * - custom：自定义命令，不解析，输出原样存盘
 */
export type SerialCommandKind = 'power0' | 'powerCap' | 'custom';

/** 命令预设：命令文本固定，限制可用的 UART 集合 */
export interface SerialCommandPreset {
  kind: SerialCommandKind;
  label: string;
  command: string;
  /** 允许的 UART；空表示不限（custom） */
  uarts: SerialUartId[];
  /** 是否解析输出（false 时仅存日志） */
  parsed: boolean;
}

export const SERIAL_COMMAND_PRESETS: SerialCommandPreset[] = [
  { kind: 'power0', label: 'power 0（各电源域功耗）', command: 'power 0', uarts: [1], parsed: true },
  { kind: 'powerCap', label: 'powerCap 3（功耗封顶）', command: 'powerCap 3', uarts: [3, 4, 8, 9], parsed: true },
  { kind: 'custom', label: '自定义命令（仅记录日志，不解析）', command: '', uarts: [], parsed: false },
];

export function serialCommandPreset(kind: SerialCommandKind): SerialCommandPreset {
  return SERIAL_COMMAND_PRESETS.find((p) => p.kind === kind) ?? SERIAL_COMMAND_PRESETS[2];
}

/** 该命令类型是否允许在指定 UART 上使用 */
export function isCommandAllowedOnUart(kind: SerialCommandKind, uart: SerialUartId): boolean {
  const preset = serialCommandPreset(kind);
  return preset.uarts.length === 0 || preset.uarts.includes(uart);
}

/** 串口监控配置（挂在单条 MonitorCommand 上）
 * 命令类型限定为 power0 / powerCap / custom；custom 不解析、原样保存输出。
 * AP 串口（id=0）为只读观察模式
 */
export interface SerialMonitorConfig {
  /** 目标 UART */
  uart: SerialUartId;
  /** 命令类型；缺省按 command 文本推断（兼容旧配置） */
  kind?: SerialCommandKind;
  /** 周期下发命令；power0/powerCap 由预设决定，custom 时必填；AP 观察模式留空 */
  command?: string;
  /** 最小发送间隔（ms）；0 表示背靠背尽可能快 */
  minIntervalMs?: number;
  /** 采集指标白名单；留空表示自动发现（按首轮输出的全部指标采集）。
   * power0: board / sN.total / sN.<domain>；powerCap: power / core / uncore */
  metrics?: string[];
  /** 单次输出包含多次采样时取最近 N 次；默认 0=取全部（仅 powerCap 生效）。
   * 窗口刷新远快于命令往返，各行均为新数据，无需去重 */
  samples?: number;
  /** 提示符正则；缺省 DEFAULT_SERIAL_PROMPT */
  expect?: string;
  /** UART 切换后等待稳定时间（ms），默认 1000 */
  uartSettleMs?: number;
  /** 每 N 个样本落一次盘做快照，默认 500 */
  snapshotEvery?: number;
}

/** 已知电源域名（仅作 UI 提示；不同机型/固件域名差异很大，
 * 实际采集指标由首轮输出自动发现） */
export const SERIAL_POWER0_KNOWN_DOMAINS = [
  'TA_CORE_DVFS',
  'DDRIO',
  'TB_CORE_DVFS',
  'IO_NB_AVS',
  'UNCORE_DVFS',
  'IO_NA_AVS',
  'T0_TA_CORE_DVFS',
  'T0_TB_CORE_DVFS',
  'T0_DVDD_UNCORE',
  'T1_TA_CORE_DVFS',
  'T1_TB_CORE_DVFS',
  'T1_DVDD_UNCORE',
  'T0T1_DDRIO',
  '1V1_NA_SDS',
  '1V1_NB_SDS',
] as const;

/** 指标 id 的可读名（用于 commandName 后缀） */
export function power0MetricLabel(metric: string): string {
  if (metric === 'board') return '整板合计';
  const m = metric.match(/^s(\d+)\.(.+)$/);
  if (!m) return metric;
  const [, socketIdx, rest] = m;
  if (rest === 'total') return `PS${socketIdx} 合计`;
  return `PS${socketIdx} ${rest}`;
}
