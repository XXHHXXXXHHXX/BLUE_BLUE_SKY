/** 串口解析模板（TS 代码模板，前后端共享的类型与元信息）
 *
 * 模板就是一段 TypeScript 片段，在服务端 Node 沙箱里执行（见 src/server/serialTemplateRuntime.ts）：
 *
 *   const meta = { name: 'power 0（各电源域功耗）', command: 'power 0', uarts: [1], unit: 'mW' };
 *   function parse(output: string): Record<string, number>[] { ... }
 *   function label(metric: string): string { ... }   // 可选，指标显示名
 *
 * 页面只做三件事：选模板 / 粘贴或上传代码 / 试解析。
 */

import {
  templateSnapshotOf,
  type SerialTemplateRecord,
  type SerialTemplateSnapshot,
} from '../utils/serialCodeTemplates.builtin';

export type {
  CompiledSerialTemplate,
  SerialTemplateMeta,
  SerialTemplateParseResult,
  SerialTemplateSnapshot,
  SerialTemplateRecord,
} from '../utils/serialTemplateContract';
export type {
  SerialAnchor,
  SerialDslTemplate,
  SerialMetricRule,
  SerialSampleMode,
  SerialSumCheck,
} from '../utils/serialDsl';
export {
  BUILTIN_SERIAL_TEMPLATES,
  DEFAULT_SERIAL_PROMPT,
  DEFAULT_SERIAL_TEMPLATE_ID,
  legacyKindToTemplateId,
  findSerialTemplateRecord,
  hasTemplateVariant,
  serialTemplateOptions,
  templateSnapshotOf,
  templateSnapshotVariant,
} from '../utils/serialCodeTemplates.builtin';

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

/** SOL 会话激活/关闭命令（BMC Linux shell） */
export const SERIAL_SOL_ACTIVATE = 'bash -l -c "source /etc/profile; ipmcset -t sol -d activate -v 1 0"';
export const SERIAL_SOL_DEACTIVATE = 'bash -l -c "ipmcset -t sol -d deactivate -v 1 0"';

/** 串口监控配置（挂在单条 MonitorCommand 上）
 *
 * 解析方式完全由代码模板决定：
 *   - template   ：内联快照（代码 + 元信息）。任务提交时写入，历史任务重放不受模板库后续修改影响
 *   - templateId ：模板库引用；提交任务时解析成 template
 */
export interface SerialMonitorConfig {
  /** 目标 UART */
  uart: SerialUartId;
  /** 解析模板内联快照（代码 + 元信息），优先使用 */
  template?: SerialTemplateSnapshot;
  /** 解析模板库 ID（builtin:* 或 serial-template-*） */
  templateId?: string;
  /** 命令文本覆盖模板默认命令；留空用模板 meta.command */
  command?: string;
  /** 最小发送间隔（ms）；0 表示背靠背尽可能快 */
  minIntervalMs?: number;
  /** 采集指标白名单；留空表示按首轮解析结果自动发现全部指标 */
  metrics?: string[];
  /** UART 切换后等待稳定时间（ms），默认 1000 */
  uartSettleMs?: number;
  /** 每 N 个采样落一次盘做快照，默认 500 */
  snapshotEvery?: number;
  /** 旧版命令类型字段：仅出现在已落盘的旧配置里，加载时删除 */
  kind?: string;
}

/** 模板允许在该 UART 上使用（meta.uarts 为空或不设表示不限） */
export function isTemplateAllowedOnUart(
  meta: { uarts?: number[] },
  uart: SerialUartId
): boolean {
  return !meta.uarts || meta.uarts.length === 0 || meta.uarts.includes(uart);
}

/** 该配置是否走只读观察（AP 串口无提示符，或模板显式声明 observe） */
export function isSerialObserveMode(
  meta: { observe?: boolean },
  uart: SerialUartId
): boolean {
  return meta.observe === true
    || SERIAL_UART_PRESETS.find((p) => p.id === uart)?.mode === 'observe';
}

/** 校验一条串口监控配置，返回错误文案；null 表示通过
 *
 * 只做结构性校验（UART 匹配、命令非空）；代码本身的语法/运行时错误由服务端编译时给出。
 * 前端提交前与阶段校验共用，保证前后端判定一致。
 */
export function validateSerialMonitorConfig(
  config: SerialMonitorConfig,
  userTemplates: SerialTemplateRecord[] = []
): string | null {
  const snapshot = templateSnapshotOf(config, userTemplates);
  if (!snapshot) return '未选择解析模板';
  if (snapshot.kind === 'code' && !snapshot.code?.trim()) {
    return `解析模板「${snapshot.name}」代码为空`;
  }
  if (snapshot.kind === 'dsl' && !snapshot.dsl) {
    return `解析模板「${snapshot.name}」表单内容为空`;
  }

  if (!isTemplateAllowedOnUart(snapshot.meta, config.uart)) {
    const allowed = (snapshot.meta.uarts ?? [])
      .map((id) => SERIAL_UART_PRESETS.find((p) => p.id === id)?.label ?? `UART ${id}`)
      .join(' / ');
    const current = SERIAL_UART_PRESETS.find((p) => p.id === config.uart)?.label ?? `UART ${config.uart}`;
    return `解析模板「${snapshot.name}」不支持 ${current}，仅支持 ${allowed}`;
  }

  const observe = isSerialObserveMode(snapshot.meta, config.uart);
  if (!observe && !(config.command || snapshot.meta.command || '').trim()) {
    return `解析模板「${snapshot.name}」未配置下发命令`;
  }
  return null;
}
