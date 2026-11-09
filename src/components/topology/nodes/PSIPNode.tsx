'use client';

import React from 'react';
import { type NodeProps } from '@xyflow/react';
import NodeIcon from './NodeIcon';
import CustomFieldsRenderer from './CustomFieldsRenderer';
import { useNodeFieldConfig } from './useNodeFieldConfig';
import {
  getEfficiencyColor,
  getTemperatureColor,
  getNodeDisplayLabel,
  getTemperatureLevel,
  getEfficiencyLevel,
  formatValueWithUnit,
} from '../../../utils/formatters';

const PSIPNode: React.FC<NodeProps> = (props) => {
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
  const { getFieldLabel, orderedFixedFieldKeys, getFieldUnit } = useNodeFieldConfig(props.data as Record<string, unknown>);
  const fmt = (value: number | string | null | undefined, fieldKey: string) =>
    formatValueWithUnit(value, fieldKey, getFieldUnit(fieldKey));
  
  // 处理 null 值
  const inputVoltage = s?.inputVoltage ?? null;
  const outputVoltage = s?.outputVoltage ?? null;
  const inputCurrent = s?.inputCurrent ?? s?.current ?? null;
  const outputCurrent = s?.outputCurrent ?? s?.current ?? null;
  const inputPower = s?.inputPower ?? null;
  const outputPower = s?.outputPower ?? null;
  const efficiency = s?.efficiency ?? null;
  const temperature = s?.temperature ?? null;

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
        return <div key={fieldKey}>{getFieldLabel('inputVoltage')}: {fmt(inputVoltage, 'inputVoltage')}</div>;
      case 'inputCurrent':
        return <div key={fieldKey}>{getFieldLabel('inputCurrent')}: {fmt(inputCurrent, 'inputCurrent')}</div>;
      case 'inputPower':
        return <div key={fieldKey}>{getFieldLabel('inputPower')}: {fmt(inputPower, 'inputPower')}</div>;
      case 'outputVoltage':
        return <div key={fieldKey}>{getFieldLabel('outputVoltage')}: {fmt(outputVoltage, 'outputVoltage')}</div>;
      case 'outputCurrent':
        return <div key={fieldKey}>{getFieldLabel('outputCurrent')}: {fmt(outputCurrent, 'outputCurrent')}</div>;
      case 'outputPower':
        return <div key={fieldKey}>{getFieldLabel('outputPower')}: {fmt(outputPower, 'outputPower')}</div>;
      case 'efficiency':
        return (
          <div key={fieldKey}>
            {getFieldLabel('efficiency')}:{' '}
            <span style={{ color: efficiency !== null ? getEfficiencyColor(efficiency) : '#999' }}>
              {fmt(efficiency, 'efficiency')}
            </span>
          </div>
        );
      case 'temperature':
        return (
          <div key={fieldKey}>
            {getFieldLabel('temperature')}:{' '}
            <span style={{ color: temperature !== null ? getTemperatureColor(temperature) : '#999' }}>
              {fmt(temperature, 'temperature')}
            </span>
          </div>
        );
      default: {
        const value = displayMetrics?.[fieldKey] ?? null;
        if (value === null || value === undefined || Number.isNaN(value)) {
          return <div key={fieldKey}>{getFieldLabel(fieldKey)}: NA</div>;
        }
        if (fieldKey.includes('Voltage')) {
          return <div key={fieldKey}>{getFieldLabel(fieldKey)}: {fmt(Number(value), fieldKey)}</div>;
        }
        if (fieldKey.includes('Current')) {
          return <div key={fieldKey}>{getFieldLabel(fieldKey)}: {fmt(Number(value), fieldKey)}</div>;
        }
        if (fieldKey.includes('Power') || fieldKey === 'power') {
          return <div key={fieldKey}>{getFieldLabel(fieldKey)}: {fmt(Number(value), fieldKey)}</div>;
        }
        if (fieldKey === 'temperature') {
          return (
            <div key={fieldKey}>
              {getFieldLabel(fieldKey)}:{' '}
              <span style={{ color: getTemperatureColor(Number(value)) }}>
                {fmt(Number(value), fieldKey)}
              </span>
            </div>
          );
        }
        if (fieldKey === 'efficiency') {
          return (
            <div key={fieldKey}>
              {getFieldLabel(fieldKey)}:{' '}
              <span style={{ color: getEfficiencyColor(Number(value)) }}>
                {fmt(Number(value), fieldKey)}
              </span>
            </div>
          );
        }
        if (fieldKey === 'rpm') {
          return <div key={fieldKey}>{getFieldLabel(fieldKey)}: {fmt(Number(value), fieldKey)}</div>;
        }
        if (fieldKey === 'speedPercent') {
          return <div key={fieldKey}>{getFieldLabel(fieldKey)}: {fmt(Number(value), fieldKey)}</div>;
        }
        return <div key={fieldKey}>{getFieldLabel(fieldKey)}: {fmt(value, fieldKey)}</div>;
      }
    }
  };

  return (
    <div className={`hardware-node source-node${tempClass}${effClass}`}>
      <div className="node-content">
        <div className="node-icon-area">
          <NodeIcon nodeType="psip" customIcon={data.customIcon} customIconUrl={data.customIconUrl} />
        </div>
        <div className="node-info">
          <div className="node-header">
            <span>{getNodeDisplayLabel(data as Record<string, unknown>)}</span>
          </div>
          <div className="node-body">
            {orderedFixedFieldKeys.map(renderField)}
            <CustomFieldsRenderer data={props.data as Record<string, unknown>} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default PSIPNode;
