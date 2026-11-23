/** JSON Schema → zod 的极简转换
 *
 * 声明式插件用 JSON Schema 描述参数（LLM 工具调用标准格式），
 * 这里只覆盖常用子集：object/properties/required、string/number/integer/boolean、
 * array/items、enum、description、default。
 * 遇到不支持的类型退化为 z.any()，保证插件仍可加载。
 */
import { z } from 'zod';

export interface JsonSchemaNode {
  type?: string | string[];
  description?: string;
  properties?: Record<string, JsonSchemaNode>;
  required?: string[];
  items?: JsonSchemaNode;
  enum?: unknown[];
  default?: unknown;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
}

function applyMeta<T extends z.ZodTypeAny>(schema: T, node: JsonSchemaNode): T {
  let out = schema;
  if (node.description) out = out.describe(node.description) as T;
  return out;
}

/** 把 JSON Schema 节点转成 zod schema */
export function jsonSchemaToZod(node: JsonSchemaNode | undefined): z.ZodTypeAny {
  if (!node || typeof node !== 'object') return z.any();

  if (Array.isArray(node.enum) && node.enum.length > 0) {
    const values = node.enum.filter((v): v is string => typeof v === 'string');
    if (values.length === node.enum.length) {
      return applyMeta(z.enum(values as [string, ...string[]]), node);
    }
    // 非字符串枚举：用 union of literals
    const literals = node.enum.map((v) => z.literal(v as string | number | boolean));
    const union = literals.length === 1 ? literals[0] : z.union(literals as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]);
    return applyMeta(union, node);
  }

  const type = Array.isArray(node.type) ? node.type.find((t) => t !== 'null') : node.type;

  switch (type) {
    case 'object': {
      const props = node.properties || {};
      const required = new Set(node.required || []);
      const shape: Record<string, z.ZodTypeAny> = {};
      for (const [key, child] of Object.entries(props)) {
        const childSchema = jsonSchemaToZod(child);
        shape[key] = required.has(key) ? childSchema : childSchema.optional();
      }
      return applyMeta(z.object(shape), node);
    }
    case 'array': {
      let arr = z.array(jsonSchemaToZod(node.items));
      if (typeof node.minItems === 'number') arr = arr.min(node.minItems);
      if (typeof node.maxItems === 'number') arr = arr.max(node.maxItems);
      return applyMeta(arr, node);
    }
    case 'integer': {
      let num = z.number().int();
      if (typeof node.minimum === 'number') num = num.min(node.minimum);
      if (typeof node.maximum === 'number') num = num.max(node.maximum);
      return applyMeta(num, node);
    }
    case 'number': {
      let num = z.number();
      if (typeof node.minimum === 'number') num = num.min(node.minimum);
      if (typeof node.maximum === 'number') num = num.max(node.maximum);
      return applyMeta(num, node);
    }
    case 'boolean':
      return applyMeta(z.boolean(), node);
    case 'string': {
      let str = z.string();
      if (typeof node.minLength === 'number') str = str.min(node.minLength);
      if (typeof node.maxLength === 'number') str = str.max(node.maxLength);
      return applyMeta(str, node);
    }
    default:
      return applyMeta(z.any(), node);
  }
}
