'use client';

import { useMemo } from 'react';
import { FIXED_FIELD_DEFS } from '../../../types/topology';
import type { ApiConfig } from '../../../types/topology';

/**
 * 节点字段配置 Hook
 * 根据节点的 apiConfig.fieldMappings + apiConfig.customFieldDefs 决定显示哪些字段、使用什么标签
 */
export function useNodeFieldConfig(data: Record<string, unknown>) {
  const nodeType = data.nodeType as string | undefined;
  const apiConfig = data.apiConfig as ApiConfig | undefined;
  const fieldMappings = apiConfig?.fieldMappings || [];
  const customFieldDefs = apiConfig?.customFieldDefs || [];

  // 合并固定字段定义和自定义字段定义
  const allFieldDefs = useMemo(() => {
    const fixed = FIXED_FIELD_DEFS[nodeType || ''] || [];
    return [...fixed, ...customFieldDefs];
  }, [nodeType, customFieldDefs]);

  // 当没有字段映射时，显示所有固定字段（兼容旧数据）
  const visibleFieldKeys = useMemo(() => {
    if (fieldMappings.length > 0) {
      return new Set(fieldMappings.map((m) => m.fieldKey));
    }
    // 回退：显示所有固定字段
    const fixedDefs = FIXED_FIELD_DEFS[nodeType || ''] || [];
    return new Set(fixedDefs.map((d) => d.fieldKey));
  }, [fieldMappings, nodeType]);

  // 按 fieldMappings 顺序排列的可见字段 key 列表
  const orderedVisibleFieldKeys = useMemo(() => {
    if (fieldMappings.length > 0) {
      return fieldMappings.map((m) => m.fieldKey).filter((key) => visibleFieldKeys.has(key));
    }
    const fixedDefs = FIXED_FIELD_DEFS[nodeType || ''] || [];
    return fixedDefs.map((d) => d.fieldKey);
  }, [fieldMappings, visibleFieldKeys, nodeType]);

  /** 判断某个字段是否可见 */
  const hasField = (fieldKey: string): boolean => {
    return visibleFieldKeys.has(fieldKey);
  };

  /** 获取字段的显示标签：优先使用 fieldMapping 中的 label 覆盖，再查固定/自定义字段定义，最后回退 fieldKey */
  const getFieldLabel = (fieldKey: string): string => {
    const mapping = fieldMappings.find((m) => m.fieldKey === fieldKey);
    if (mapping?.label) return mapping.label;
    const def = allFieldDefs.find((d) => d.fieldKey === fieldKey);
    return def?.label || fieldKey;
  };

  /** 判断是否为自定义字段（不在 FIXED_FIELD_DEFS 中） */
  const isCustomField = (fieldKey: string): boolean => {
    const fixed = FIXED_FIELD_DEFS[nodeType || ''] || [];
    return !fixed.some((d) => d.fieldKey === fieldKey);
  };

  return {
    visibleFieldKeys,
    orderedVisibleFieldKeys,
    hasField,
    getFieldLabel,
    isCustomField,
    fieldMappings,
    customFieldDefs,
    nodeType,
    allFieldDefs,
  };
}
