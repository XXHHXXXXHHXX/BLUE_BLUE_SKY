/** 串口解析模板编译入口：两种模板形态 → 统一 `CompiledSerialTemplate`
 *
 *   - code：用户上传的 TypeScript（默认方式），在 Node vm 沙箱里执行
 *   - dsl ：表单模板（结构化字段），由 src/utils/serialDsl.ts 解释执行
 *
 * 采集器与试解析只调用这里，不关心模板形态。
 */

import { compileCodeTemplate } from './serialTemplateRuntime';
import { compileSerialDsl } from '../utils/serialDsl';
import {
  expectRegExpOf,
  type CompiledSerialTemplate,
  type SerialTemplateMeta,
  type SerialTemplateSnapshot,
} from '../utils/serialTemplateContract';
import { dslMeta, type SerialDslTemplate } from '../utils/serialDsl';

export { compileCodeTemplate };
export type { CompiledSerialTemplate } from '../utils/serialTemplateContract';

/** 表单模板的详细解析（含 warnings / checkFailures，供试解析展示） */
export interface SerialTemplateTestOutcome {
  meta: SerialTemplateMeta;
  hasData: boolean;
  samples: Record<string, number>[];
  metrics: Array<{ id: string; label: string }>;
  warnings: string[];
  checkFailures: string[];
}

/** 编译快照；形态由 snapshot.kind 决定 */
export function compileTemplateSnapshot(snapshot: SerialTemplateSnapshot): CompiledSerialTemplate {
  if (snapshot.kind === 'dsl') {
    if (!snapshot.dsl) throw new Error('表单模板缺少定义内容');
    return compileSerialDsl(snapshot.dsl);
  }
  if (!snapshot.code) throw new Error('代码模板缺少代码内容');
  return compileCodeTemplate(snapshot.code);
}

/** 校验模板并提取元信息（保存/试解析共用）
 *
 * 代码模板：沙箱编译一次，能立刻反馈语法/契约错误并拿到 meta；
 * 表单模板：结构校验 + 元信息映射。
 */
export function buildTemplateSnapshot(
  kind: 'code' | 'dsl',
  payload: { code?: string; dsl?: SerialDslTemplate },
  nameOverride?: string
): SerialTemplateSnapshot {
  if (kind === 'dsl') {
    if (!payload.dsl) throw new Error('表单模板内容为空');
    const dsl: SerialDslTemplate = { ...payload.dsl };
    if (nameOverride?.trim()) dsl.name = nameOverride.trim();
    const compiled = compileSerialDsl(dsl);
    return { kind: 'dsl', name: compiled.meta.name, dsl, meta: compiled.meta };
  }

  const code = payload.code ?? '';
  const compiled = compileCodeTemplate(code);
  const meta: SerialTemplateMeta = { ...compiled.meta };
  if (nameOverride?.trim()) meta.name = nameOverride.trim();
  return { kind: 'code', name: meta.name, code: code.trim(), meta };
}

/** 试解析一次输出，返回 UI 需要的完整诊断 */
export function testTemplate(
  snapshot: SerialTemplateSnapshot,
  sample: string
): SerialTemplateTestOutcome {
  if (snapshot.kind === 'dsl') {
    const detailed = compileSerialDsl(snapshot.dsl!);
    const result = detailed.parseDetailed(sample);
    return {
      meta: detailed.meta,
      hasData: result.hasData,
      samples: result.samples,
      metrics: [...new Set(result.samples.flatMap((s) => Object.keys(s)))]
        .map((id) => ({ id, label: detailed.label(id) })),
      warnings: result.warnings,
      checkFailures: result.checkFailures,
    };
  }

  const compiled = compileTemplateSnapshot(snapshot);
  const result = compiled.parse(sample);
  return {
    meta: compiled.meta,
    hasData: result.hasData,
    samples: result.samples,
    metrics: [...new Set(result.samples.flatMap((s) => Object.keys(s)))]
      .map((id) => ({ id, label: compiled.label(id) })),
    warnings: [],
    checkFailures: [],
  };
}

/** 快照 → 提示符正则（等价于编译结果里的 expectRe，供轻量校验使用） */
export function snapshotExpectRe(snapshot: SerialTemplateSnapshot): RegExp {
  return expectRegExpOf(snapshot.meta);
}

/** 表单模板元信息（保存前预览用，避免完整编译） */
export function dslSnapshotMeta(dsl: SerialDslTemplate): SerialTemplateMeta {
  return dslMeta(dsl);
}
