'use client';

import React from 'react';
import { type NodeProps } from '@xyflow/react';
import NodeIcon from './NodeIcon';
import { useNodeFieldConfig } from './useNodeFieldConfig';
import {
  formatPower,
  formatTemperature,
  formatVoltage,
  formatCurrent,
  formatEfficiency,
  formatRPM,
  getTemperatureColor,
  getEfficiencyColor,
  getNodeDisplayLabel,
} from '../../../utils/formatters';

/** 根据字段 key 格式化数值 */
function formatFieldValue(fieldKey: string, value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return 'NA';
  if (fieldKey.includes('Voltage')) return formatVoltage(value);
  if (fieldKey.includes('Current')) return formatCurrent(value);
  if (fieldKey.includes('Power') || fieldKey === 'power') return formatPower(value);
  if (fieldKey === 'temperature') return formatTemperature(value);
  if (fieldKey === 'efficiency') return formatEfficiency(value);
  if (fieldKey === 'rpm') return formatRPM(value);
  if (fieldKey === 'speedPercent') return `${value.toFixed(1)}%`;
  return typeof value === 'number' ? value.toFixed(2) : String(value);
}

/** 获取字段值的显示颜色 */
function getFieldValueColor(fieldKey: string, value: number | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (fieldKey === 'temperature') return getTemperatureColor(value);
  if (fieldKey === 'efficiency') return getEfficiencyColor(value);
  return undefined;
}

const CustomNode: React.FC<NodeProps> = (props) => {
  const data = props.data as {
    label?: string;
    customIcon?: string;
    displayAlias?: string;
    customIconUrl?: string;
    nodeType?: string;
    displayMetrics?: Record<string, number | null>;
    apiConfig?: {
      fieldMappings?: { fieldKey: string; bmcField: string }[];
      customFieldDefs?: { fieldKey: string; label: string }[];
    };
  };

  const displayMetrics = data.displayMetrics || {};
  const { fieldMappings, getFieldLabel } = useNodeFieldConfig(props.data as Record<string, unknown>);

  // 获取可见的字段映射列表
  const visibleMappings = fieldMappings.length > 0
    ? fieldMappings
    : (data.apiConfig?.fieldMappings || []);

  return (
    <div className="hardware-node custom-node">
      <div className="node-content">
        <div className="node-icon-area">
          <NodeIcon nodeType="custom" customIcon={data.customIcon} customIconUrl={data.customIconUrl} />
        </div>
        <div className="node-info">
          <div className="node-header">
            <span>{getNodeDisplayLabel(data as Record<string, unknown>)}</span>
          </div>
          <div className="node-body">
            {visibleMappings.map((mapping) => {
              const value = displayMetrics[mapping.fieldKey];
              const label = getFieldLabel(mapping.fieldKey);
              const color = getFieldValueColor(mapping.fieldKey, value);
              return (
                <div key={mapping.fieldKey}>
                  {label}:{' '}
                  {color ? (
                    <span style={{ color }}>{formatFieldValue(mapping.fieldKey, value)}</span>
                  ) : (
                    formatFieldValue(mapping.fieldKey, value)
                  )}
                </div>
              );
            })}
            {visibleMappings.length === 0 && (
              <div style={{ color: '#8c8c8c', fontSize: 12 }}>暂无字段，请双击编辑添加</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default CustomNode;
