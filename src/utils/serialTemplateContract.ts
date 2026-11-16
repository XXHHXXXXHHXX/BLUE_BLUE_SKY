/** 串口解析模板的统一契约（前后端共享，不含 Node API）
 *
 * 模板有两种形态，编译后都落到同一个接口：
 *   - 代码模板（默认）：用户上传一段 TypeScript，`meta + parse + label?`
 *   - 表单模板：结构化 DSL（sample / anchors / metrics / checks），由引擎解释执行
 *
 * 采集器只依赖 `CompiledSerialTemplate`，不关心模板是哪种形态。
 */

import type { SerialDslTemplate } from './serialDsl';

/** 模板元信息（代码模板由 meta 提取，表单模板由字段映射） */
export interface SerialTemplateMeta {
  name: string;
  /** 周期下发命令；只读观察模板可留空 */
  command?: string;
  /** 提示符正则，缺省 /Huawei LiteOS #\s*$/ */
  expect?: string;
  /** 命令结束符，缺省 '\r'（LiteOS 串口只接受单个 CR） */
  lineEnding?: '\r' | '\n' | '\r\n';
  /** 数值单位，缺省 mW */
  unit?: string;
  /** 允许的 UART；空/缺省不限 */
  uarts?: number[];
  /** 只读观察：不下发命令，按窗口解析 */
  observe?: boolean;
  /** 不解析：原文落日志，不产采样点 */
  raw?: boolean;
  /** 一次输出含多个采样时，各行按此毫秒间隔回溯，最后一行对齐当前时刻 */
  spacingMs?: number;
}

export interface SerialTemplateParseResult {
  samples: Record<string, number>[];
  hasData: boolean;
}

export interface CompiledSerialTemplate {
  meta: SerialTemplateMeta;
  /** 提示符正则（由 meta.expect 编译，缺省 LiteOS 提示符） */
  expectRe: RegExp;
  /** 一次命令输出 → 有序采样列表（每项 `指标 id → 数值`） */
  parse(output: string): SerialTemplateParseResult;
  /** 指标显示名；模板未提供时回落为指标 id */
  label(metric: string): string;
}

/** 模板快照：落盘/内联到任务的就是它 */
export interface SerialTemplateSnapshot {
  /** 模板形态：code=TS 代码模板（默认），dsl=表单模板 */
  kind: 'code' | 'dsl';
  name: string;
  /** code 形态：TypeScript 源码 */
  code?: string;
  /** dsl 形态：结构化定义 */
  dsl?: SerialDslTemplate;
  /** 编译期提取/校验过的元信息（UI 展示与采集配置使用） */
  meta: SerialTemplateMeta;
}

export interface SerialTemplateRecord {
  id: string;
  /** 内置模板不可在 UI 中删除/覆盖 */
  builtin: boolean;
  /** 主形态（默认使用） */
  template: SerialTemplateSnapshot;
  /** 等价形态：内置模板提供另一种解析方式时在这里，供编辑器切换后续编辑 */
  alt?: SerialTemplateSnapshot;
  createdAt?: string;
  updatedAt?: string;
}

/** 默认提示符（与 py 版 endswith("LiteOS #") 等价） */
export const DEFAULT_SERIAL_PROMPT = 'Huawei LiteOS #\\s*$';

export function expectRegExpOf(meta: SerialTemplateMeta): RegExp {
  return new RegExp(meta.expect || DEFAULT_SERIAL_PROMPT);
}

/** 取快照里的模板源码（用于「另存为」与展示） */
export function templateSourceOf(snapshot: SerialTemplateSnapshot): string {
  return snapshot.kind === 'dsl'
    ? JSON.stringify(snapshot.dsl ?? {}, null, 2)
    : (snapshot.code ?? '');
}
