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

const SensorNode: React.FC<NodeProps> = (props) => {
  const data = props.data as {
    label?: string;
    customIcon?: string;
    displayAlias?: string;
    customIconUrl?: string;
    nodeType?: string;
    sensorData?: {
      temperature: number | null;
      location: string | null;
    };
  };
  const sensor = data.sensorData;
  const displayMetrics = (props.data as Record<string, unknown>)?.displayMetrics as Record<string, number | null> | undefined;
  const { hasField, getFieldLabel, orderedFixedFieldKeys, getFieldUnit } = useNodeFieldConfig(props.data as Record<string, unknown>);
  const fmt = (value: number | string | null | undefined, fieldKey: string) =>
    formatValueWithUnit(value, fieldKey, getFieldUnit(fieldKey));

  const renderField = (fieldKey: string) => {
    switch (fieldKey) {
      case 'location':
        return hasField('location') ? <div key={fieldKey}>{getFieldLabel('location')}: {location ?? 'NA'}</div> : null;
      case 'temperature':
        return hasField('temperature') ? (
          <div key={fieldKey}>
            {getFieldLabel('temperature')}:{' '}
            <span style={{ color: temperature !== null ? getTemperatureColor(temperature) : '#999' }}>
              {fmt(temperature, 'temperature')}
            </span>
          </div>
        ) : null;
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
  
  // 处理 null 值
  const temperature = sensor?.temperature ?? null;
  const location = sensor?.location ?? null;

  const tempLevel = getTemperatureLevel(temperature ?? undefined);
  const tempClass = tempLevel === 'critical' 
    ? ' critical-temp' 
    : tempLevel === 'warning' 
    ? ' warning-temp' 
    : '';

  return (
    <div className={`hardware-node sensor-node${tempClass}`}>
      <div className="node-content">
        <div className="node-icon-area">
          <NodeIcon nodeType="sensor" customIcon={data.customIcon} customIconUrl={data.customIconUrl} />
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

export default SensorNode;
