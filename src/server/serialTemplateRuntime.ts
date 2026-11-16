/** 串口解析模板运行时：在 Node vm 沙箱里执行用户上传的 TypeScript 代码模板
 *
 * 模板契约（见 src/utils/serialCodeTemplates.builtin.ts）：
 *   const meta = { name, command?, uarts?, unit?, observe?, raw?, spacingMs?, expect?, lineEnding? };
 *   function parse(output: string): Record<string, number>[] { ... }
 *   function label(metric: string): string { ... }   // 可选
 *
 * 边界与限制（诚实说明，不假装是硬沙箱）：
 *   - vm 上下文禁用了 codeGeneration（无 eval / new Function），且不注入 require / process /
 *     module / Buffer；用户代码只能做纯字符串与数学运算。
 *   - 每次编译与每次 parse/label 调用都有超时（默认 1s），死循环不会挂住事件循环。
 *   - vm 不是进程级隔离，恶意代码理论上仍可能逃逸；模板来自内部运维人员，不含外部输入。
 *     若需强隔离，应改为独立进程 + --permission。
 */

import vm from 'node:vm';
import * as nodeModule from 'node:module';
import {
  expectRegExpOf,
  type CompiledSerialTemplate,
  type SerialTemplateMeta,
  type SerialTemplateParseResult,
} from '../utils/serialTemplateContract';

/** Node 22.13+ 提供 stripTypeScriptTypes（@types/node 20 尚未声明） */
const stripTypeScriptTypes = (nodeModule as typeof nodeModule & {
  stripTypeScriptTypes?: (code: string, options?: { mode?: 'strip' | 'transform' }) => string;
}).stripTypeScriptTypes;

/** 单次编译/调用超时（ms） */
const EVAL_TIMEOUT_MS = 1000;
/** 模板源码长度上限 */
const MAX_CODE_LENGTH = 100_000;
/** 单次输出解析出的采样点上限（防止模板写错导致内存暴涨） */
const MAX_SAMPLES = 100_000;
const MAX_METRICS_PER_SAMPLE = 1_000;

/** 编译模板代码：剥离类型注解 → 在沙箱内求值 → 校验契约
 *
 * 任何语法错误、契约缺失或运行期异常都以 Error 抛出，消息可直接展示给用户。
 */
export function compileCodeTemplate(code: string): CompiledSerialTemplate {
  if (!code.trim()) throw new Error('模板代码为空');
  if (code.length > MAX_CODE_LENGTH) {
    throw new Error(`模板代码过长（上限 ${MAX_CODE_LENGTH} 字符）`);
  }

  if (!stripTypeScriptTypes) {
    throw new Error('当前 Node 版本不支持 TypeScript 类型剥离（需要 Node ≥ 22.13）');
  }

  let js: string;
  try {
    // 剥离类型后是一段 `(function(){ ... });` 表达式，去掉尾分号再调用
    js = stripTypeScriptTypes(`(function(){\n${code}\n})`, { mode: 'transform' }).replace(/;\s*$/, '');
  } catch (err) {
    throw new Error(`TypeScript 语法错误: ${errorMessage(err)}`);
  }

  const context = vm.createContext(
    { __input: '', __output: null as unknown },
    { codeGeneration: { strings: false, wasm: false } }
  );

  let api: unknown;
  try {
    api = vm.runInContext(`${js}()`, context, {
      timeout: EVAL_TIMEOUT_MS,
      filename: 'serial-template.js',
    });
  } catch (err) {
    throw new Error(`模板执行失败: ${errorMessage(err)}`);
  }

  if (!api || typeof api !== 'object') {
    throw new Error('模板必须 `return { meta, parse, label? }`');
  }

  const candidate = api as { meta?: unknown; parse?: unknown; label?: unknown };
  const meta = normalizeMeta(candidate.meta);
  if (typeof candidate.parse !== 'function') {
    throw new Error('模板缺少 parse(output) 函数');
  }
  if (candidate.label !== undefined && typeof candidate.label !== 'function') {
    throw new Error('模板的 label 必须是函数');
  }

  /** 统一在沙箱内调用模板函数（带超时），避免用户代码直接跑在宿主上下文 */
  const invoke = (fn: unknown, args: unknown[]): unknown => {
    context.__callback = fn;
    context.__args = args;
    vm.runInContext('__output = __callback.apply(undefined, __args)', context, {
      timeout: EVAL_TIMEOUT_MS,
      filename: 'serial-template-invoke.js',
    });
    return context.__output;
  };

  const parseFn = candidate.parse;
  const labelFn = candidate.label;

  // 契约冒烟：空输入时返回非数组就提前暴露（其它异常留给真实输出，不阻塞保存）
  try {
    const probe = invoke(parseFn, ['']);
    if (probe !== undefined && probe !== null && !Array.isArray(probe)) {
      throw new Error('parse() 必须返回采样数组，例如 [{ board: 123 }]');
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('必须返回采样数组')) throw err;
  }

  return {
    meta,
    expectRe: expectRegExpOf(meta),
    parse(output: string): SerialTemplateParseResult {
      let raw: unknown;
      try {
        raw = invoke(parseFn, [output]);
      } catch (err) {
        throw new Error(`parse() 执行失败: ${errorMessage(err)}`);
      }
      const samples = normalizeSamples(raw);
      return { samples, hasData: samples.some((s) => Object.keys(s).length > 0) };
    },
    label(metric: string): string {
      if (!labelFn) return metric;
      try {
        const value = invoke(labelFn, [metric]);
        return typeof value === 'string' && value ? value : metric;
      } catch {
        // 显示名解析失败不应影响采集
        return metric;
      }
    },
  };
}

/** 只把有限数值保留为采样点，过滤 NaN/Infinity/字符串键等异常数据 */
function normalizeSamples(raw: unknown): Record<string, number>[] {
  if (!Array.isArray(raw)) {
    if (raw === undefined || raw === null) return [];
    throw new Error('parse() 必须返回采样数组，例如 [{ board: 123 }]');
  }
  if (raw.length > MAX_SAMPLES) {
    throw new Error(`parse() 返回的采样过多（${raw.length} > ${MAX_SAMPLES}）`);
  }

  const samples: Record<string, number>[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const sample: Record<string, number> = {};
    let count = 0;
    for (const [key, value] of Object.entries(entry as Record<string, unknown>)) {
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      sample[key] = value;
      if (++count > MAX_METRICS_PER_SAMPLE) break;
    }
    samples.push(sample);
  }
  return samples;
}

function normalizeMeta(raw: unknown): SerialTemplateMeta {
  if (!raw || typeof raw !== 'object') {
    throw new Error('模板必须导出 meta 对象（含 name）');
  }
  const source = raw as Record<string, unknown>;
  const name = typeof source.name === 'string' ? source.name.trim() : '';
  if (!name) throw new Error('meta.name 不能为空');

  const meta: SerialTemplateMeta = { name };
  if (typeof source.command === 'string') meta.command = source.command;
  if (typeof source.expect === 'string' && source.expect) meta.expect = source.expect;
  if (source.lineEnding === '\r' || source.lineEnding === '\n' || source.lineEnding === '\r\n') {
    meta.lineEnding = source.lineEnding;
  }
  if (typeof source.unit === 'string' && source.unit) meta.unit = source.unit;
  if (Array.isArray(source.uarts)) {
    meta.uarts = source.uarts.filter((id): id is number => typeof id === 'number' && Number.isInteger(id));
  }
  if (typeof source.observe === 'boolean') meta.observe = source.observe;
  if (typeof source.raw === 'boolean') meta.raw = source.raw;
  if (typeof source.spacingMs === 'number' && Number.isFinite(source.spacingMs) && source.spacingMs >= 0) {
    meta.spacingMs = source.spacingMs;
  }
  return meta;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    // vm 超时错误信息很明确，直接透传
    if (err.message.includes('Script execution timed out')) return '执行超时（超过 1 秒）';
    return err.message;
  }
  return String(err);
}
