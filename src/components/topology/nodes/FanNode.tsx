'use client';

import React, { useCallback } from 'react';
import { type NodeProps } from '@xyflow/react';
import NodeIcon from './NodeIcon';
import InteractiveZone from './InteractiveZone';
import CustomFieldsRenderer from './CustomFieldsRenderer';
import { useNodeFieldConfig } from './useNodeFieldConfig';
import {
  formatPower,
  formatRPM,
  formatCurrent,
  formatVoltage,
  formatEfficiency,
  formatTemperature,
  getTemperatureColor,
  getEfficiencyColor,
  getNodeDisplayLabel,
  getTemperatureLevel,
} from '../../../utils/formatters';

const FanNode: React.FC<NodeProps> = (props) => {
  const data = props.data as {
    label?: string;
    customIcon?: string;
    displayAlias?: string;
    customIconUrl?: string;
    nodeType?: string;
    controlRange?: { min: number; max: number };
    fanData?: {
      power: number | null;
      rpm: number | null;
      speedPercent: number | null;
      temperature?: number | null;
      fanInputVoltage?: number | null;
      fanInputCurrent?: number | null;
    };
    onSpeedChange?: (speed: number) => void;
  };

  const fanData = data.fanData;
  const displayMetrics = (props.data as Record<string, unknown>)?.displayMetrics as Record<string, number | null> | undefined;
  const range = data.controlRange ?? { min: 0, max: 100 };
  const { hasField, getFieldLabel, orderedVisibleFieldKeys } = useNodeFieldConfig(props.data as Record<string, unknown>);

  // 从 fanData 获取数据（支持 null 值显示为 NA）
  const power = fanData?.power ?? null;
  const rpm = fanData?.rpm ?? null;
  const speedPercent = fanData?.speedPercent ?? null;
  const temperature = fanData?.temperature ?? null;
  const fanInputVoltage = fanData?.fanInputVoltage ?? null;
  const fanInputCurrent = fanData?.fanInputCurrent ?? null;

  const tempLevel = getTemperatureLevel(temperature ?? undefined);
  const tempClass = tempLevel === 'critical' 
    ? ' critical-temp' 
    : tempLevel === 'warning' 
    ? ' warning-temp' 
    : '';

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      data.onSpeedChange?.(Number(e.target.value));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.onSpeedChange, data],
  );

  const renderField = (fieldKey: string) => {
    switch (fieldKey) {
      case 'power':
        return <div key={fieldKey}>{getFieldLabel('power')}: {formatPower(power)}</div>;
      case 'fanInputVoltage':
        return <div key={fieldKey}>{getFieldLabel('fanInputVoltage')}: {formatVoltage(fanInputVoltage)}</div>;
      case 'fanInputCurrent':
        return <div key={fieldKey}>{getFieldLabel('fanInputCurrent')}: {formatCurrent(fanInputCurrent)}</div>;
      case 'rpm':
        return <div key={fieldKey}>{getFieldLabel('rpm')}: {formatRPM(rpm)}</div>;
      case 'speedPercent':
        return <div key={fieldKey}>{getFieldLabel('speedPercent')}: {speedPercent !== null && !Number.isNaN(speedPercent) ? `${speedPercent.toFixed(0)}%` : 'NA'}</div>;
      case 'temperature':
        return (
          <div key={fieldKey}>
            {getFieldLabel('temperature')}:{' '}
            <span style={{ color: temperature !== null ? getTemperatureColor(temperature) : '#999' }}>
              {formatTemperature(temperature)}
            </span>
          </div>
        );
      case 'fanSpeedControl':
        return (
          <InteractiveZone key={fieldKey}>
            <span style={{ fontSize: 11, color: '#666' }}>{getFieldLabel('fanSpeedControl')}: {speedPercent !== null && !Number.isNaN(speedPercent) ? `${speedPercent.toFixed(0)}%` : 'NA'}</span>
            <input
              type="range"
              min={range.min}
              max={range.max}
              step={1}
              value={speedPercent ?? 0}
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
    <div className={`hardware-node fan-node${tempClass}`}>
      <div className="node-content">
        <div className="node-icon-area">
          <NodeIcon nodeType="fan" customIcon={data.customIcon} customIconUrl={data.customIconUrl} />
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

export default FanNode;
