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
} from '../../../utils/formatters';

const ThermometerNode: React.FC<NodeProps> = (props) => {
  const data = props.data as {
    label?: string;
    customIcon?: string;
    displayAlias?: string;
    customIconUrl?: string;
    nodeType?: string;
    thermometerData?: {
      temperature: number | null;
      temperatureStatus: string | null;
    };
  };

  const thermometerData = data.thermometerData;
  const displayMetrics = (props.data as Record<string, unknown>)?.displayMetrics as Record<string, number | null> | undefined;
  const { hasField, getFieldLabel, orderedVisibleFieldKeys } = useNodeFieldConfig(props.data as Record<string, unknown>);
  const temperature = thermometerData?.temperature ?? null;
  const temperatureStatus = thermometerData?.temperatureStatus ?? null;

  // 根据温度决定闪烁动画类名
  let tempFlashClass = '';
  if (temperature !== null) {
    if (temperature < 20) {
      tempFlashClass = ' thermometer-cold';
    } else if (temperature < 60) {
      tempFlashClass = ' thermometer-normal';
    } else if (temperature < 80) {
      tempFlashClass = ' thermometer-warm';
    } else {
      tempFlashClass = ' thermometer-hot';
    }
  }

  const renderField = (fieldKey: string) => {
    switch (fieldKey) {
      case 'temperature':
        return (
          <div key={fieldKey} className="data-row">
            <span className="data-label">{getFieldLabel('temperature')}:</span>
            <span className="data-value" style={{ color: temperature !== null ? getTemperatureColor(temperature) : '#999' }}>
              {formatTemperature(temperature)}
            </span>
          </div>
        );
      case 'temperatureStatus':
        return (
          <div key={fieldKey} className="data-row">
            <span className="data-label">{getFieldLabel('temperatureStatus')}:</span>
            <span className="data-value">{temperatureStatus ?? 'NA'}</span>
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
    <div className={`hardware-node thermometer-node${tempFlashClass}`}>
      <div className="node-content">
        <div className="node-icon-area">
          <NodeIcon nodeType="thermometer" customIcon={data.customIcon} customIconUrl={data.customIconUrl} />
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

export default ThermometerNode;
