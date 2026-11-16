/** 内置串口解析模板
 *
 * 每套模板同时提供两种形态（解析结果逐值一致）：
 *   - code：TypeScript 代码，沙箱执行（src/server/serialTemplateRuntime.ts）
 *   - dsl ：等价的结构化表单（sample / anchors / metrics / checks）
 *
 * 默认使用 code 形态；用户在编辑器里切到「表单配置」时，从 `alt` 载入等价表单继续编辑。
 */

import {
  DEFAULT_SERIAL_PROMPT,
  type SerialTemplateMeta,
  type SerialTemplateRecord,
  type SerialTemplateSnapshot,
} from './serialTemplateContract';
import type { SerialDslTemplate } from './serialDsl';

export type {
  SerialTemplateMeta,
  SerialTemplateRecord,
  SerialTemplateSnapshot,
} from './serialTemplateContract';

/** 默认提示符（与 py 版 endswith("LiteOS #") 等价） */
export { DEFAULT_SERIAL_PROMPT };

const POWER0_CODE = String.raw`
const meta = {
  name: 'power 0（各电源域功耗）',
  command: 'power 0',
  uarts: [1],
  unit: 'mW',
};

/** 输出结构：Psocket 分段 → power domain 分段 → 各测量项；只取 power（mW） */
function parse(output) {
  const out = {};
  let psocket;
  let domain;

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    let m;

    // 新 socket 段：重置电源域
    if ((m = line.match(/^-+Psocket\s*:\s*(\d+)-*$/i))) {
      psocket = m[1];
      domain = undefined;
      continue;
    }
    // 新电源域段
    if ((m = line.match(/^power domain\s+(\S+)\s*:/i))) {
      domain = m[1];
      continue;
    }
    // socket 合计（先于域内字段判定，并终止当前域）
    if ((m = line.match(/psocket totalPwr\s*=\s*(-?\d+(?:\.\d+)?)\s*mW/i))) {
      if (psocket !== undefined) out['s' + psocket + '.total'] = Number(m[1]);
      domain = undefined;
      continue;
    }
    // 整板合计
    if ((m = line.match(/the board all cpu power consumption is\s*(-?\d+(?:\.\d+)?)\s*mW/i))) {
      out.board = Number(m[1]);
      domain = undefined;
      continue;
    }
    // 域内功耗
    if (domain !== undefined && psocket !== undefined
      && (m = line.match(/^power\s*=\s*(-?\d+(?:\.\d+)?)/i))) {
      out['s' + psocket + '.' + domain] = Number(m[1]);
    }
  }

  // 一致性校验：各 socket 合计之和应等于整板，不符则丢弃本次采样
  const totals = Object.keys(out).filter((key) => key.endsWith('.total'));
  if (out.board !== undefined && totals.length > 0) {
    const sum = totals.reduce((acc, key) => acc + out[key], 0);
    if (Math.abs(sum - out.board) > 1) return [];
  }

  return Object.keys(out).length > 0 ? [out] : [];
}

function label(metric) {
  if (metric === 'board') return '整板合计';
  const m = metric.match(/^s(\d+)\.(.+)$/);
  if (!m) return metric;
  return m[2] === 'total' ? 'PS' + m[1] + ' 合计' : 'PS' + m[1] + ' ' + m[2];
}

return { meta, parse, label };
`;

const POWERCAP_CODE = String.raw`
const meta = {
  name: 'powerCap 3（功耗封顶）',
  command: 'powerCap 3',
  uarts: [3, 4, 8, 9],
  unit: 'mW',
  spacingMs: 1000,
};

/** 每行一次封顶计算结果：power / threshold / delta / core / uncore */
const NUM = '-?\\d+(?:\\.\\d+)?';
const LINE = new RegExp(
  '^power\\s*:\\s*(' + NUM + ')\\s*,\\s*threshold\\s*:\\s*(' + NUM + ')' +
  '\\s*,\\s*delta\\s*:\\s*(' + NUM + ')\\s*,\\s*core\\s*:\\s*(' + NUM + ')' +
  '\\s*,\\s*uncore\\s*:\\s*(' + NUM + ')'
);

function parse(output) {
  const samples = [];
  for (const rawLine of output.split(/\r?\n/)) {
    const m = rawLine.trim().match(LINE);
    if (!m) continue;
    samples.push({ power: Number(m[1]), core: Number(m[4]), uncore: Number(m[5]) });
  }
  return samples;
}

function label(metric) {
  if (metric === 'power') return '功耗';
  if (metric === 'core') return 'core 频率';
  if (metric === 'uncore') return 'uncore 频率';
  return metric;
}

return { meta, parse, label };
`;

const OBSERVE_CODE = String.raw`
const meta = {
  name: 'AP 只读观察（窗口最后一个数值）',
  command: '',
  uarts: [0],
  unit: 'mW',
  observe: true,
};

/** 只读流没有提示符，按窗口聚合后取最后一个数值 */
function parse(output) {
  const nums = output.match(/-?\d+(?:\.\d+)?/g);
  if (!nums || nums.length === 0) return [];
  const value = Number(nums[nums.length - 1]);
  return Number.isFinite(value) ? [{ board: value }] : [];
}

function label(metric) {
  return metric === 'board' ? '整板合计' : metric;
}

return { meta, parse, label };
`;

const RAW_CODE = String.raw`
const meta = {
  name: '自定义命令（仅记录日志）',
  command: '',
  unit: 'mW',
  raw: true,
};

/** 不解析：原始输出按时间戳写入 serial-<id>.log */
function parse() {
  return [];
}

return { meta, parse };
`;


/** power 0 的表单等价形态（与 POWER0_CODE 逐值一致，含 socket 求和校验） */
const POWER0_DSL: SerialDslTemplate = {
  name: 'power 0（各电源域功耗）',
  command: 'power 0',
  uarts: [1],
  unit: 'mW',
  sample: { mode: 'block' },
  anchors: [
    { level: 1, pattern: '^-+Psocket\\s*:\\s*(?<psocket>\\d+)-*$' },
    { level: 2, pattern: '^power domain\\s+(?<domain>\\S+)\\s*:' },
    // socket 合计行与整板合计行终止当前电源域段
    { level: 2, pattern: 'psocket totalPwr\\s*=\\s*-?\\d+(?:\\.\\d+)?\\s*mW' },
    { level: 2, pattern: 'the board all cpu power consumption is' },
  ],
  metrics: [
    {
      id: 'board',
      label: '整板合计',
      pattern: 'the board all cpu power consumption is\\s*(?<value>-?\\d+(?:\\.\\d+)?)\\s*mW',
    },
    {
      id: 's{psocket}.total',
      label: 'PS{psocket} 合计',
      pattern: 'psocket totalPwr\\s*=\\s*(?<value>-?\\d+(?:\\.\\d+)?)\\s*mW',
      requireContext: ['psocket'],
    },
    {
      id: 's{psocket}.{domain}',
      label: 'PS{psocket} {domain}',
      pattern: '^power\\s*=\\s*.*?(?<value>-?\\d+(?:\\.\\d+)?)',
      requireContext: ['psocket', 'domain'],
    },
  ],
  checks: [{ type: 'sum', overall: 'board', parts: 's*.total', tolerance: 1 }],
};

/** powerCap 的表单等价形态（每行一次采样） */
const POWERCAP_DSL: SerialDslTemplate = {
  name: 'powerCap 3（功耗封顶）',
  command: 'powerCap 3',
  uarts: [3, 4, 8, 9],
  unit: 'mW',
  sample: {
    mode: 'line',
    // 整行结构必须完整匹配，避免半截输出产生伪采样
    pattern: '^power\\s*:\\s*-?\\d+(?:\\.\\d+)?\\s*,\\s*threshold\\s*:\\s*-?\\d+(?:\\.\\d+)?\\s*,\\s*delta\\s*:\\s*-?\\d+(?:\\.\\d+)?\\s*,\\s*core\\s*:\\s*-?\\d+(?:\\.\\d+)?\\s*,\\s*uncore\\s*:\\s*-?\\d+(?:\\.\\d+)?',
    takeLast: 0,
    spacingMs: 1000,
  },
  metrics: [
    { id: 'power', label: '功耗', pattern: '^power\\s*:\\s*(?<value>-?\\d+(?:\\.\\d+)?)' },
    { id: 'core', label: 'core 频率', pattern: '(?<![A-Za-z_])core\\s*:\\s*(?<value>-?\\d+(?:\\.\\d+)?)' },
    { id: 'uncore', label: 'uncore 频率', pattern: '(?<![A-Za-z_])uncore\\s*:\\s*(?<value>-?\\d+(?:\\.\\d+)?)' },
  ],
};

/** 只读观察的表单等价形态（窗口内最后一个数值） */
const OBSERVE_DSL: SerialDslTemplate = {
  name: 'AP 只读观察（窗口最后一个数值）',
  command: '',
  uarts: [0],
  unit: 'mW',
  sample: { mode: 'window' },
  metrics: [{ id: 'board', label: '整板合计', pattern: '(?<value>-?\\d+(?:\\.\\d+)?)', match: 'last' }],
};

/** raw 的表单等价形态 */
const RAW_DSL: SerialDslTemplate = {
  name: '自定义命令（仅记录日志）',
  command: '',
  unit: 'mW',
  sample: { mode: 'raw' },
  metrics: [],
};

function dslSnapshot(dsl: SerialDslTemplate, meta: SerialTemplateMeta): SerialTemplateSnapshot {
  return { kind: 'dsl', name: dsl.name, dsl, meta };
}

function snapshot(code: string, meta: SerialTemplateMeta): SerialTemplateSnapshot {
  return { kind: 'code', name: meta.name, code: code.trim(), meta };
}

export const BUILTIN_SERIAL_TEMPLATES: SerialTemplateRecord[] = [
  {
    id: 'builtin:power0',
    builtin: true,
    template: snapshot(POWER0_CODE, {
      name: 'power 0（各电源域功耗）',
      command: 'power 0',
      uarts: [1],
      unit: 'mW',
    }),
    alt: dslSnapshot(POWER0_DSL, {
      name: 'power 0（各电源域功耗）',
      command: 'power 0',
      uarts: [1],
      unit: 'mW',
    }),
  },
  {
    id: 'builtin:powercap',
    builtin: true,
    template: snapshot(POWERCAP_CODE, {
      name: 'powerCap 3（功耗封顶）',
      command: 'powerCap 3',
      uarts: [3, 4, 8, 9],
      unit: 'mW',
      spacingMs: 1000,
    }),
    alt: dslSnapshot(POWERCAP_DSL, {
      name: 'powerCap 3（功耗封顶）',
      command: 'powerCap 3',
      uarts: [3, 4, 8, 9],
      unit: 'mW',
      spacingMs: 1000,
    }),
  },
  {
    id: 'builtin:observe',
    builtin: true,
    template: snapshot(OBSERVE_CODE, {
      name: 'AP 只读观察（窗口最后一个数值）',
      command: '',
      uarts: [0],
      unit: 'mW',
      observe: true,
    }),
    alt: dslSnapshot(OBSERVE_DSL, {
      name: 'AP 只读观察（窗口最后一个数值）',
      command: '',
      uarts: [0],
      unit: 'mW',
      observe: true,
    }),
  },
  {
    id: 'builtin:raw',
    builtin: true,
    template: snapshot(RAW_CODE, {
      name: '自定义命令（仅记录日志）',
      command: '',
      unit: 'mW',
      raw: true,
    }),
    alt: dslSnapshot(RAW_DSL, {
      name: '自定义命令（仅记录日志）',
      command: '',
      unit: 'mW',
      raw: true,
    }),
  },
];

export const DEFAULT_SERIAL_TEMPLATE_ID = 'builtin:power0';

export function findBuiltinSerialTemplate(id: string | undefined): SerialTemplateRecord | undefined {
  if (!id) return undefined;
  return BUILTIN_SERIAL_TEMPLATES.find((t) => t.id === id);
}

/** 取模板的指定形态：优先返回请求的 kind，缺失时回落到主形态 */
export function templateSnapshotVariant(
  record: SerialTemplateRecord,
  kind: 'code' | 'dsl'
): SerialTemplateSnapshot {
  if (record.template.kind === kind) return record.template;
  if (record.alt?.kind === kind) return record.alt;
  return record.template;
}

/** 旧配置的 kind 字段 → 内置模板 ID（兼容迁移） */
export function legacyKindToTemplateId(kind: string | undefined): string | undefined {
  switch (kind) {
    case 'power0': return 'builtin:power0';
    case 'powerCap': return 'builtin:powercap';
    case 'custom': return 'builtin:raw';
    default: return undefined;
  }
}

/** 全部可用模板（内置 + 用户），供 UI 下拉选择 */
export function serialTemplateOptions(
  userTemplates: SerialTemplateRecord[] = []
): SerialTemplateRecord[] {
  return [...BUILTIN_SERIAL_TEMPLATES, ...userTemplates];
}

/** 按 id 找到模板记录（内置 + 用户） */
export function findSerialTemplateRecord(
  id: string | undefined,
  userTemplates: SerialTemplateRecord[] = []
): SerialTemplateRecord | undefined {
  return serialTemplateOptions(userTemplates).find((t) => t.id === id);
}

/** 记录中是否存在指定形态（用于编辑器模式切换的可用性判断） */
export function hasTemplateVariant(record: SerialTemplateRecord, kind: 'code' | 'dsl'): boolean {
  return record.template.kind === kind || record.alt?.kind === kind;
}

/** 解析配置引用的模板快照：内联 > 库引用 > 旧 kind > 内置默认 */
export function templateSnapshotOf(
  config: { template?: SerialTemplateSnapshot; templateId?: string; kind?: string } | undefined,
  userTemplates: SerialTemplateRecord[] = []
): SerialTemplateSnapshot | undefined {
  if (config?.template) return config.template;

  const id = config?.templateId ?? legacyKindToTemplateId(config?.kind);
  if (id) {
    const record = serialTemplateOptions(userTemplates).find((t) => t.id === id);
    if (record) return record.template;
  }

  return findBuiltinSerialTemplate(DEFAULT_SERIAL_TEMPLATE_ID)?.template;
}
