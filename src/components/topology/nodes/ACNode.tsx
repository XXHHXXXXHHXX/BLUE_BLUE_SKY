'use client';

import React from 'react';
import { type NodeProps } from '@xyflow/react';
import NodeIcon from './NodeIcon';
import CustomFieldsRenderer from './CustomFieldsRenderer';
import { useNodeFieldConfig } from './useNodeFieldConfig';
import {
  formatVoltage,
  formatCurrent,
  formatPower,
  formatTemperature,
  formatEfficiency,
  formatRPM,
  getTemperatureColor,
  getEfficiencyColor,
  getNodeDisplayLabel,
  getEfficiencyLevel,
} from '../../../utils/formatters';

const ACNode: React.FC<NodeProps> = (props) => {
  const data = props.data as {
    label?: string;
    customIcon?: string;
    displayAlias?: string;
    customIconUrl?: string;
    nodeType?: string;
    sourceData?: {
      inputVoltage: number | null;
      outputVoltage: number | null;
      current: number | null;
      inputCurrent: number | null;
      outputCurrent: number | null;
      inputPower: number | null;
      outputPower: number | null;
      efficiency: number | null;
      temperature?: number | null;
    };
  };
  const s = data.sourceData;
  const displayMetrics = (props.data as Record<string, unknown>)?.displayMetrics as Record<string, number | null> | undefined;
  const { hasField, getFieldLabel, orderedVisibleFieldKeys } = useNodeFieldConfig(props.data as Record<string, unknown>);

  const renderField = (fieldKey: string) => {
    switch (fieldKey) {
      case 'outputVoltage':
        return hasField('outputVoltage') ? <div key={fieldKey}>{getFieldLabel('outputVoltage')}: {formatVoltage(outputVoltage)}</div> : null;
      case 'current':
        return hasField('current') ? <div key={fieldKey}>{getFieldLabel('current')}: {formatCurrent(current)}</div> : null;
      case 'outputPower':
        return hasField('outputPower') ? <div key={fieldKey}>{getFieldLabel('outputPower')}: {formatPower(outputPower)}</div> : null;
      default: {
        const value = displayMetrics?.[fieldKey] ?? null;
        if (value === null || value === undefined || Number.isNaN(value)) {
          return <div key={fieldKey}>{getFieldLabel(fieldKey)}: NA</div>;
        }
        if (fieldKey.includes('Voltage')) {
          return <div key={fieldKey}>{getFieldLabel(fieldKey)}: {formatVoltage(Number(value))}</div>;
        }
        if (fieldKey.includes('Current')) {
          return <div key={fieldKey}>{getFieldLabel(fieldKey)}: {formatCurrent(Number(value))}</div>;
        }
        if (fieldKey.includes('Power') || fieldKey === 'power') {
          return <div key={fieldKey}>{getFieldLabel(fieldKey)}: {formatPower(Number(value))}</div>;
        }
        if (fieldKey === 'temperature') {
          return (
            <div key={fieldKey}>
              {getFieldLabel(fieldKey)}:{' '}
              <span style={{ color: getTemperatureColor(Number(value)) }}>
                {formatTemperature(Number(value))}
              </span>
            </div>
          );
        }
        if (fieldKey === 'efficiency') {
          return (
            <div key={fieldKey}>
              {getFieldLabel(fieldKey)}:{' '}
              <span style={{ color: getEfficiencyColor(Number(value)) }}>
                {formatEfficiency(Number(value))}
              </span>
            </div>
          );
        }
        if (fieldKey === 'rpm') {
          return <div key={fieldKey}>{getFieldLabel(fieldKey)}: {formatRPM(Number(value))}</div>;
        }
        if (fieldKey === 'speedPercent') {
          return <div key={fieldKey}>{getFieldLabel(fieldKey)}: {`${Number(value).toFixed(1)}%`}</div>;
        }
        return <div key={fieldKey}>{getFieldLabel(fieldKey)}: {typeof value === 'number' ? value.toFixed(2) : String(value)}</div>;
      }
    }
  };

  // 处理 null 值
  const inputVoltage = s?.inputVoltage ?? null;
  const outputVoltage = s?.outputVoltage ?? null;
  const current = s?.current ?? null;
  const inputPower = s?.inputPower ?? null;
  const outputPower = s?.outputPower ?? null;
  const efficiency = s?.efficiency ?? null;

  const effLevel = getEfficiencyLevel(efficiency ?? undefined);
  const effClass = effLevel === 'critical' 
    ? ' critical-efficiency' 
    : effLevel === 'warning' 
    ? ' warning-efficiency' 
    : '';

  return (
    <div className={`hardware-node source-node${effClass}`}>
      <div className="node-content">
        <div className="node-icon-area">
          <NodeIcon nodeType="ac" customIcon={data.customIcon} customIconUrl={data.customIconUrl} />
        </div>
        <div className="node-info">
          <div className="node-header">
            <span>{getNodeDisplayLabel(data as Record<string, unknown>)}</span>
          </div>
          <div className="node-body">
            {orderedVisibleFieldKeys.map(renderField)}
            <CustomFieldsRenderer data={props.data as Record<string, unknown>} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default ACNode;
