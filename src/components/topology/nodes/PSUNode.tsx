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
  formatEfficiency,
  formatTemperature,
  formatRPM,
  getEfficiencyColor,
  getTemperatureColor,
  getNodeDisplayLabel,
  getTemperatureLevel,
  getEfficiencyLevel,
} from '../../../utils/formatters';

const PSUNode: React.FC<NodeProps> = (props) => {
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

  const sourceData = data.sourceData;
  const displayMetrics = (props.data as Record<string, unknown>)?.displayMetrics as Record<string, number | null> | undefined;
  const { hasField, getFieldLabel, orderedVisibleFieldKeys } = useNodeFieldConfig(props.data as Record<string, unknown>);

  // 从 sourceData 获取数据（支持 null 值显示为 NA）
  const inputVoltage = sourceData?.inputVoltage ?? null;
  const outputVoltage = sourceData?.outputVoltage ?? null;
  const inputCurrent = sourceData?.inputCurrent ?? sourceData?.current ?? null;
  const outputCurrent = sourceData?.outputCurrent ?? sourceData?.current ?? null;
  const inputPower = sourceData?.inputPower ?? null;
  const outputPower = sourceData?.outputPower ?? null;
  const efficiency = sourceData?.efficiency ?? null;
  const temperature = sourceData?.temperature ?? null;

  const tempLevel = getTemperatureLevel(temperature ?? undefined);
  const effLevel = getEfficiencyLevel(efficiency ?? undefined);
  
  const tempClass = tempLevel === 'critical' 
    ? ' critical-temp' 
    : tempLevel === 'warning' 
    ? ' warning-temp' 
    : '';
  
  const effClass = effLevel === 'critical' 
    ? ' critical-efficiency' 
    : effLevel === 'warning' 
    ? ' warning-efficiency' 
    : '';

  const renderField = (fieldKey: string) => {
    switch (fieldKey) {
      case 'inputVoltage':
        return <div key={fieldKey}>{getFieldLabel('inputVoltage')}: {formatVoltage(inputVoltage)}</div>;
      case 'inputCurrent':
        return <div key={fieldKey}>{getFieldLabel('inputCurrent')}: {formatCurrent(inputCurrent)}</div>;
      case 'inputPower':
        return <div key={fieldKey}>{getFieldLabel('inputPower')}: {formatPower(inputPower)}</div>;
      case 'outputVoltage':
        return <div key={fieldKey}>{getFieldLabel('outputVoltage')}: {formatVoltage(outputVoltage)}</div>;
      case 'outputCurrent':
        return <div key={fieldKey}>{getFieldLabel('outputCurrent')}: {formatCurrent(outputCurrent)}</div>;
      case 'outputPower':
        return <div key={fieldKey}>{getFieldLabel('outputPower')}: {formatPower(outputPower)}</div>;
      case 'efficiency':
        return (
          <div key={fieldKey}>
            {getFieldLabel('efficiency')}:{' '}
            <span style={{ color: efficiency !== null ? getEfficiencyColor(efficiency) : '#999' }}>
              {formatEfficiency(efficiency)}
            </span>
          </div>
        );
      case 'temperature':
        return (
          <div key={fieldKey}>
            {getFieldLabel('temperature')}:{' '}
            <span style={{ color: temperature !== null ? getTemperatureColor(temperature) : '#999' }}>
              {formatTemperature(temperature)}
            </span>
          </div>
        );
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

  return (
    <div className={`hardware-node source-node${tempClass}${effClass}`}>
      <div className="node-content">
        <div className="node-icon-area">
          <NodeIcon nodeType="psu" customIcon={data.customIcon} customIconUrl={data.customIconUrl} />
        </div>
        <div className="node-info">
          <div className="node-header">
            <span>{getNodeDisplayLabel(data as Record<string, unknown>)}</span>
          </div>
          <div className="node-body">
            {orderedVisibleFieldKeys.map(renderField)}
            {hasField('efficiency') && efficiency !== null && (
              <div className="efficiency-bar">
                <div
                  style={{
                    width: `${Math.min(100, Math.max(0, efficiency))}%`,
                    height: '100%',
                    backgroundColor: getEfficiencyColor(efficiency),
                    borderRadius: 2,
                    transition: 'width 0.3s',
                  }}
                />
              </div>
            )}
            <CustomFieldsRenderer data={props.data as Record<string, unknown>} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default PSUNode;
