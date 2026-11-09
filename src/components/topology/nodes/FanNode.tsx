'use client';

import React from 'react';
import { type NodeProps } from '@xyflow/react';
import NodeIcon from './NodeIcon';
import CustomFieldsRenderer from './CustomFieldsRenderer';
import { useNodeFieldConfig } from './useNodeFieldConfig';
import {
  getTemperatureColor,
  getEfficiencyColor,
  getNodeDisplayLabel,
  getTemperatureLevel,
  formatValueWithUnit,
} from '../../../utils/formatters';

const FanNode: React.FC<NodeProps> = (props) => {
  const data = props.data as {
    label?: string;
    customIcon?: string;
    displayAlias?: string;
    customIconUrl?: string;
    nodeType?: string;
    fanData?: {
      power: number | null;
      rpm: number | null;
      speedPercent: number | null;
      temperature?: number | null;
      fanInputVoltage?: number | null;
      fanInputCurrent?: number | null;
    };
  };

  const fanData = data.fanData;
  const displayMetrics = (props.data as Record<string, unknown>)?.displayMetrics as Record<string, number | null> | undefined;
  const { hasField, getFieldLabel, orderedFixedFieldKeys, getFieldUnit } = useNodeFieldConfig(props.data as Record<string, unknown>);
  const fmt = (value: number | string | null | undefined, fieldKey: string) =>
    formatValueWithUnit(value, fieldKey, getFieldUnit(fieldKey));

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

  const renderField = (fieldKey: string) => {
    switch (fieldKey) {
      case 'power':
        return <div key={fieldKey}>{getFieldLabel('power')}: {fmt(power, 'power')}</div>;
      case 'fanInputVoltage':
        return <div key={fieldKey}>{getFieldLabel('fanInputVoltage')}: {fmt(fanInputVoltage, 'fanInputVoltage')}</div>;
      case 'fanInputCurrent':
        return <div key={fieldKey}>{getFieldLabel('fanInputCurrent')}: {fmt(fanInputCurrent, 'fanInputCurrent')}</div>;
      case 'rpm':
        return <div key={fieldKey}>{getFieldLabel('rpm')}: {fmt(rpm, 'rpm')}</div>;
      case 'speedPercent':
        return <div key={fieldKey}>{getFieldLabel('speedPercent')}: {fmt(speedPercent, 'speedPercent')}</div>;
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
            {orderedFixedFieldKeys.map(renderField)}
            <CustomFieldsRenderer data={props.data as Record<string, unknown>} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default FanNode;
