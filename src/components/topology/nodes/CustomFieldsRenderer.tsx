'use client';

import React from 'react';
import { useNodeFieldConfig } from './useNodeFieldConfig';

/** 格式化自定义字段数值 */
function formatCustomValue(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return 'NA';
  return typeof value === 'number' ? value.toFixed(2) : String(value);
}

/**
 * 渲染自定义字段（不在 FIXED_FIELD_DEFS 中的字段）
 * 值从 data.displayMetrics[fieldKey] 读取
 * 样式保持和固定字段一致：纯文本 div，不使用 data-row/data-label/data-value class
 */
const CustomFieldsRenderer: React.FC<{
  data: Record<string, unknown>;
}> = ({ data }) => {
  const { fieldMappings, isCustomField, getFieldLabel } = useNodeFieldConfig(data);
  const displayMetrics = data.displayMetrics as Record<string, number | null> | undefined;

  const customMappings = fieldMappings.filter((m) => isCustomField(m.fieldKey));
  if (customMappings.length === 0) return null;

  return (
    <>
      {customMappings.map((m) => {
        const value = displayMetrics?.[m.fieldKey];
        return (
          <div key={m.fieldKey}>
            {getFieldLabel(m.fieldKey)}: {formatCustomValue(value)}
          </div>
        );
      })}
    </>
  );
};

export default CustomFieldsRenderer;
