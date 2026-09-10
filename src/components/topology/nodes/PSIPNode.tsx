'use client';

import React, { useCallback } from 'react';
import { type NodeProps } from '@xyflow/react';
import NodeIcon from './NodeIcon';
import InteractiveZone from './InteractiveZone';
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

const PSIPNode: React.FC<NodeProps> = (props) => {
  const data = props.data as {
    label?: string;
    customIcon?: string;
    displayAlias?: string;
    customIconUrl?: string;
    nodeType?: string;
    controlRange?: { min: number; max: number };
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
    onVoltageChange?: (voltage: number) => void;
  };
  const s = data.sourceData;
  const displayMetrics = (props.data as Record<string, unknown>)?.displayMetrics as Record<string, number | null> | undefined;
  const range = data.controlRange ?? { min: 0.5, max: 1.5 };
  const { getFieldLabel, orderedVisibleFieldKeys } = useNodeFieldConfig(props.data as Record<string, unknown>);
  
  // 处理 null 值
  const inputVoltage = s?.inputVoltage ?? null;
  const outputVoltage = s?.outputVoltage ?? null;
  const inputCurrent = s?.inputCurrent ?? s?.current ?? null;
  const outputCurrent = s?.outputCurrent ?? s?.current ?? null;
  const inputPower = s?.inputPower ?? null;
  const outputPower = s?.outputPower ?? null;
  const efficiency = s?.efficiency ?? null;
  const temperature = s?.temperature ?? null;

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      data.onVoltageChange?.(Number(e.target.value));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.onVoltageChange, data],
  );

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
      case 'psipOutputVoltageControl':
        return (
          <InteractiveZone key={fieldKey}>
            <span style={{ fontSize: 11, color: '#666' }}>{getFieldLabel('psipOutputVoltageControl')}: {outputVoltage !== null && !Number.isNaN(outputVoltage) ? `${outputVoltage.toFixed(2)}V` : 'NA'}</span>
            <input
              type="range"
              min={range.min}
              max={range.max}
              step={0.01}
              value={outputVoltage ?? 0}
              onChange={handleChange}
              style={{ width: '100%', cursor: 'pointer' }}
            />
          </InteractiveZone>
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
          <NodeIcon nodeType="psip" customIcon={data.customIcon} customIconUrl={data.customIconUrl} />
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

export default PSIPNode;
