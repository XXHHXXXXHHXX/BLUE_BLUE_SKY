/** 串口解析表单模板（声明式 DSL，前后端同构）
 *
 * 与代码模板并存：不写代码的人用这套结构化字段描述解析方式，编译后产出与代码模板
 * 完全相同的 `CompiledSerialTemplate`。一段命令输出被解析成「有序采样列表」：
 *
 *   text ──[sample 规则切分采样时刻]──► 采样 × N
 *        ──[anchors 逐行维护上下文变量]──► 取值行可插值出稳定指标 id
 *        ──[metrics 逐条规则取值]──► Record<metricId, number>
 *
 * 四种采样模式：
 *   - raw    ：不解析，原文落日志（自定义命令）
 *   - window ：整段输出算 1 个采样，每条 metric 在全文内取首个/末个匹配
 *   - line   ：每命中一次 sample.pattern 的行算 1 个采样，metric 在该行内取值
 *   - block  ：整段输出算 1 个采样，anchors 逐行更新上下文，metric 逐行取值
 */

import {
  expectRegExpOf,
  type CompiledSerialTemplate,
  type SerialTemplateMeta,
} from './serialTemplateContract';

/** 指标规则上下文要求里可用的变量名格式（`{name}` 插值） */
const VAR_NAME_RE = '[A-Za-z_][A-Za-z0-9_-]*';
/** 用户模板正则长度上限 */
const MAX_PATTERN_LENGTH = 512;

export type SerialSampleMode = 'raw' | 'window' | 'line' | 'block';

export interface SerialSampleRule {
  mode: SerialSampleMode;
  /** line 模式：命中该正则的行视为一次采样 */
  pattern?: string;
  /** line 模式：只保留最后 N 个采样行；0/缺省 = 全部 */
  takeLast?: number;
  /** line 模式：多个采样行按等间隔回溯（ms），最后一行对齐当前时刻 */
  spacingMs?: number;
}

/** 上下文锚点：命中后把命名组写为变量，供后续 metric 的 id/label 插值 */
export interface SerialAnchor {
  /** 嵌套层级，数字越小范围越大；命中某级时清空该级及更深级已设置的变量 */
  level: number;
  pattern: string;
  /** 只取这些命名组；缺省取正则中全部命名组 */
  vars?: string[];
}

/** 指标取值规则：pattern 必须含命名组 value；其余命名组也可用于 id 插值 */
export interface SerialMetricRule {
  /** 指标 id 模板，如 `board`、`s{psocket}.total` */
  id: string;
  /** 指标显示名模板，如 `PS{psocket} 合计`；缺省用 id */
  label?: string;
  pattern: string;
  /** 缺少这些上下文变量时跳过该规则 */
  requireContext?: string[];
  /** window 模式：全文内取第一个/最后一个匹配；缺省 first */
  match?: 'first' | 'last';
}

/** 一致性校验：parts 中各指标（glob）之和应等于 overall（容差 tolerance） */
export interface SerialSumCheck {
  type: 'sum';
  overall: string;
  parts: string;
  tolerance?: number;
}

export interface SerialDslTemplate {
  /** 模板名称 */
  name: string;
  command?: string;
  expect?: string;
  lineEnding?: '\r' | '\n' | '\r\n';
  unit?: string;
  uarts?: number[];
  sample: SerialSampleRule;
  anchors?: SerialAnchor[];
  metrics?: SerialMetricRule[];
  checks?: SerialSumCheck[];
}

export interface SerialDslParseResult extends SerialTemplateParseResultMeta {
  /** 按输出顺序排列的采样；每项为 metricId → 数值 */
  samples: Record<string, number>[];
  hasData: boolean;
  /** 解析过程中的提示（未匹配行统计、id 变量缺失等） */
  warnings: string[];
  /** 一致性校验失败说明 */
  checkFailures: string[];
}

interface SerialTemplateParseResultMeta {
  samples: Record<string, number>[];
  hasData: boolean;
}

export interface CompiledSerialDsl extends CompiledSerialTemplate {
  /** 表单模板额外诊断信息（试解析展示用） */
  parseDetailed(output: string): SerialDslParseResult;
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** `{name}` 插值；任一变量缺失返回 undefined（调用方跳过该采样点） */
export function interpolateTemplate(
  template: string,
  vars: Record<string, string | undefined>
): string | undefined {
  let missing = false;
  const out = template.replace(new RegExp(`\\{(${VAR_NAME_RE})\\}`, 'g'), (_, name: string) => {
    const value = vars[name];
    if (value === undefined) {
      missing = true;
      return '';
    }
    return value;
  });
  return missing ? undefined : out;
}

function namedGroupsOf(pattern: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of pattern.matchAll(/\(\?<([^>]+)>/g)) out[m[1]] = m[1];
  return out;
}

/** 校验表单模板，返回错误列表；空数组表示可用 */
export function validateSerialDsl(template: SerialDslTemplate): string[] {
  const errors: string[] = [];
  const check = (pattern: unknown, label: string) => {
    if (typeof pattern !== 'string' || !pattern) {
      errors.push(`${label}不能为空`);
      return;
    }
    if (pattern.length > MAX_PATTERN_LENGTH) {
      errors.push(`${label}过长（上限 ${MAX_PATTERN_LENGTH} 字符）`);
      return;
    }
    try {
      new RegExp(pattern);
    } catch (err) {
      errors.push(`${label} 正则无效: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  if (!template || typeof template !== 'object') return ['模板不能为空'];
  if (!template.name?.trim()) errors.push('模板名称不能为空');

  const sample = template.sample;
  if (!sample || !['raw', 'window', 'line', 'block'].includes(sample.mode)) {
    errors.push('采样模式必须为 raw / window / line / block');
    return errors;
  }

  if (template.expect) check(template.expect, '提示符');
  if (sample.mode === 'line') check(sample.pattern, '采样行');
  // block/line 需要下发命令；window 为只读观察；raw 允许留空
  if ((sample.mode === 'block' || sample.mode === 'line') && !template.command?.trim()) {
    errors.push('采样命令不能为空');
  }

  const anchorVars = new Set<string>();
  for (const [i, anchor] of (template.anchors ?? []).entries()) {
    check(anchor.pattern, `锚点 ${i + 1}`);
    if (!Number.isInteger(anchor.level) || anchor.level < 1) {
      errors.push(`锚点 ${i + 1} 的层级必须是 ≥1 的整数`);
    }
    if (typeof anchor.pattern !== 'string') continue;
    for (const name of Object.keys(namedGroupsOf(anchor.pattern))) anchorVars.add(name);
  }

  const metrics = template.metrics ?? [];
  if (sample.mode !== 'raw' && metrics.length === 0) {
    errors.push('至少需要一条指标规则');
  }
  for (const [i, metric] of metrics.entries()) {
    const label = `指标 ${metric.id || i + 1}`;
    if (!metric.id?.trim()) errors.push(`指标 ${i + 1} 的 id 不能为空`);
    check(metric.pattern, label);
    let metricVars: Record<string, string> = {};
    if (typeof metric.pattern === 'string') {
      try {
        const re = new RegExp(metric.pattern);
        if (!re.source.includes('(?<value>')) {
          errors.push(`${label} 正则必须包含命名组 (?<value>...)`);
        }
        metricVars = namedGroupsOf(metric.pattern);
      } catch {
        /* 已报错 */
      }
    }
    for (const [, name] of (metric.id ?? '').matchAll(new RegExp(`\\{(${VAR_NAME_RE})\\}`, 'g'))) {
      if (!anchorVars.has(name) && !(name in metricVars) && !metric.requireContext?.includes(name)) {
        errors.push(`${label} 的 id 使用了未定义的变量 {${name}}（需由锚点、正则命名组或 requireContext 提供）`);
      }
    }
  }

  for (const [i, rule] of (template.checks ?? []).entries()) {
    if (rule.type !== 'sum') errors.push(`校验 ${i + 1} 类型不支持: ${String(rule.type)}`);
    if (!rule.overall?.trim()) errors.push(`校验 ${i + 1} 缺少 overall`);
    if (!rule.parts?.trim()) errors.push(`校验 ${i + 1} 缺少 parts`);
  }

  return errors;
}

/** 表单模板 → 元信息（供 UI 与采集配置使用） */
export function dslMeta(template: SerialDslTemplate): SerialTemplateMeta {
  return {
    name: template.name,
    command: template.command ?? '',
    expect: template.expect,
    lineEnding: template.lineEnding,
    unit: template.unit,
    uarts: template.uarts,
    observe: template.sample.mode === 'window',
    raw: template.sample.mode === 'raw',
    spacingMs: template.sample.spacingMs,
  };
}

/** 编译表单模板；调用前应先通过 validateSerialDsl */
export function compileSerialDsl(template: SerialDslTemplate): CompiledSerialDsl {
  const errors = validateSerialDsl(template);
  if (errors.length > 0) throw new Error(`表单模板无效: ${errors.join('；')}`);

  const meta = dslMeta(template);
  const sampleRe = template.sample.pattern ? new RegExp(template.sample.pattern) : null;
  const anchors = (template.anchors ?? []).map((a) => ({
    level: a.level,
    re: new RegExp(a.pattern),
    vars: a.vars && a.vars.length > 0 ? a.vars : null,
  }));
  const metrics = (template.metrics ?? []).map((rule) => ({
    rule,
    re: new RegExp(rule.pattern),
    globalRe: new RegExp(rule.pattern, 'g'),
  }));
  const checks = template.checks ?? [];

  const parseDetailed = (output: string): SerialDslParseResult => {
    const mode = template.sample.mode;
    if (mode === 'raw') {
      return { samples: [], hasData: false, warnings: [], checkFailures: [] };
    }

    const lines = (output || '').split(/\r?\n/);
    const warnings: string[] = [];
    let samples: Record<string, number>[] = [];

    if (mode === 'window') {
      const sample: Record<string, number> = {};
      for (const { rule, globalRe } of metrics) {
        const matches = [...output.matchAll(globalRe)];
        if (matches.length === 0) continue;
        const m = rule.match === 'last' ? matches[matches.length - 1] : matches[0];
        const value = Number(m.groups?.value);
        if (!Number.isFinite(value)) continue;
        const id = interpolateTemplate(rule.id, m.groups ?? {});
        if (!id) {
          warnings.push(`指标 ${rule.id} 的 id 变量缺失，已跳过`);
          continue;
        }
        sample[id] = value;
      }
      samples = [sample];
    } else if (mode === 'line') {
      const rows = lines.filter((line) => sampleRe!.test(line));
      const take = template.sample.takeLast ?? 0;
      const picked = take > 0 ? rows.slice(-take) : rows;
      let emptyRows = 0;
      for (const row of picked) {
        const sample: Record<string, number> = {};
        for (const { rule, re } of metrics) {
          const m = row.match(re);
          if (!m) continue;
          const value = Number(m.groups?.value);
          if (!Number.isFinite(value)) continue;
          const id = interpolateTemplate(rule.id, m.groups ?? {});
          if (!id) continue;
          sample[id] = value;
        }
        if (Object.keys(sample).length === 0) emptyRows++;
        else samples.push(sample);
      }
      if (emptyRows > 0) warnings.push(`${emptyRows} 个采样行未匹配到任何指标`);
    } else {
      const sample: Record<string, number> = {};
      const ctx: Record<string, string> = {};
      const ctxLevel: Record<string, number> = {};
      let unmatched = 0;
      const skippedIds = new Set<string>();

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;

        // 1) 锚点：命中即替换同级/更深级变量（同一行只取第一个命中的锚点）
        let matched = false;
        for (const anchor of anchors) {
          const m = line.match(anchor.re);
          if (!m) continue;
          matched = true;
          for (const [name, level] of Object.entries(ctxLevel)) {
            if (level >= anchor.level) {
              delete ctx[name];
              delete ctxLevel[name];
            }
          }
          const groups = m.groups ?? {};
          const names = anchor.vars ?? Object.keys(groups);
          for (const name of names) {
            const value = groups[name];
            if (value === undefined) continue;
            ctx[name] = value;
            ctxLevel[name] = anchor.level;
          }
          break;
        }

        // 2) 指标：逐条规则在该行取值
        for (const { rule, re } of metrics) {
          if (rule.requireContext?.some((name) => ctx[name] === undefined)) continue;
          const m = line.match(re);
          if (!m) continue;
          const value = Number(m.groups?.value);
          if (!Number.isFinite(value)) continue;
          const id = interpolateTemplate(rule.id, { ...ctx, ...(m.groups ?? {}) });
          if (!id) {
            if (!skippedIds.has(rule.id)) {
              skippedIds.add(rule.id);
              warnings.push(`指标 ${rule.id} 的 id 变量缺失，已跳过`);
            }
            continue;
          }
          sample[id] = value;
          matched = true;
        }
        if (!matched) unmatched++;
      }

      samples = [sample];
      if (unmatched > 0) warnings.push(`${unmatched} 行未匹配任何规则`);
    }

    const checkFailures = runChecks(samples, checks);
    const hasData = samples.some((s) => Object.keys(s).length > 0);
    if (!hasData) samples = [];

    return { samples, hasData, warnings, checkFailures };
  };

  return {
    meta,
    expectRe: expectRegExpOf(meta),
    parse(output: string): SerialTemplateParseResultMeta {
      const { samples, hasData } = parseDetailed(output);
      return { samples, hasData };
    },
    label(metric: string): string {
      return resolveDslMetricLabel(metrics.map((m) => m.rule), metric);
    },
    parseDetailed,
  };
}

/** 指标 id → 显示名：用 id 模板反向匹配出插值变量，再套到 label 模板 */
export function resolveDslMetricLabel(rules: SerialMetricRule[], metricId: string): string {
  for (const rule of rules) {
    if (rule.id === metricId) return rule.label || rule.id;
    const vars: string[] = [];
    let source = '';
    let cursor = 0;
    const re = new RegExp(`\\{(${VAR_NAME_RE})\\}`, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(rule.id)) !== null) {
      source += escapeRegExp(rule.id.slice(cursor, m.index));
      source += '(.+?)';
      vars.push(m[1]);
      cursor = m.index + m[0].length;
    }
    if (vars.length === 0) continue;
    source += escapeRegExp(rule.id.slice(cursor));
    const match = new RegExp(`^${source}$`).exec(metricId);
    if (!match) continue;
    const values: Record<string, string> = {};
    vars.forEach((name, i) => { values[name] = match[i + 1]; });
    const label = rule.label ? interpolateTemplate(rule.label, values) : undefined;
    return label ?? metricId;
  }
  return metricId;
}

function runChecks(samples: Record<string, number>[], checks: SerialSumCheck[]): string[] {
  const failures: string[] = [];
  if (checks.length === 0) return failures;
  const sample = samples[0];
  if (!sample) return failures;
  for (const rule of checks) {
    if (rule.type !== 'sum') continue;
    const overall = sample[rule.overall];
    if (overall === undefined) continue;
    const partsRe = new RegExp(`^${escapeRegExp(rule.parts).replace(/\\\*/g, '.*')}$`);
    const parts = Object.entries(sample).filter(([id]) => partsRe.test(id));
    if (parts.length === 0) continue;
    const sum = parts.reduce((acc, [, v]) => acc + v, 0);
    const tolerance = rule.tolerance ?? 1;
    if (Math.abs(sum - overall) > tolerance) {
      failures.push(
        `一致性校验失败：${rule.overall} ${overall} ≠ ${parts.map(([id, v]) => `${id} ${v}`).join(' + ')}（合计 ${sum}）`
      );
    }
  }
  return failures;
}
