'use client';

import React from 'react';
import { type NodeProps } from '@xyflow/react';
import NodeIcon from './NodeIcon';
import { Badge } from 'antd';
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
  getTemperatureLevel,
} from '../../../utils/formatters';

const statusMap: Record<string, { status: 'success' | 'warning' | 'error'; text: string }> = {
  normal: { status: 'success', text: '正常' },
  warning: { status: 'warning', text: '警告' },
  error: { status: 'error', text: '错误' },
};

const DiskNode: React.FC<NodeProps> = (props) => {
  const data = props.data as {
    label?: string;
    customIcon?: string;
    displayAlias?: string;
    customIconUrl?: string;
    nodeType?: string;
    diskData?: {
      power: number | null;
      temperature?: number | null;
      status: 'normal' | 'warning' | 'error' | null;
      diskInputVoltage?: number | null;
      diskInputCurrent?: number | null;
      nvmeInternalTemp?: number | null;
      nvmeMaxTemp?: number | null;
    };
  };
  const disk = data.diskData;
  const displayMetrics = (props.data as Record<string, unknown>)?.displayMetrics as Record<string, number | null> | undefined;
  const { hasField, getFieldLabel, orderedVisibleFieldKeys } = useNodeFieldConfig(props.data as Record<string, unknown>);
  
  // 处理 null 值
  const power = disk?.power ?? null;
  const temperature = disk?.temperature ?? null;
  const status = disk?.status ?? null;
  const diskInputVoltage = disk?.diskInputVoltage ?? null;
  const diskInputCurrent = disk?.diskInputCurrent ?? null;
  const nvmeInternalTemp = disk?.nvmeInternalTemp ?? null;
  const nvmeMaxTemp = disk?.nvmeMaxTemp ?? null;
  const st = status ? (statusMap[status] ?? statusMap.normal) : null;

  const tempLevel = getTemperatureLevel(temperature ?? undefined);
  const tempClass = tempLevel === 'critical' 
    ? ' critical-temp' 
    : tempLevel === 'warning' 
    ? ' warning-temp' 
    : '';
  const statusClass = status === 'error' ? ' critical-status' : status === 'warning' ? ' warning-status' : '';

  const renderField = (fieldKey: string) => {
    switch (fieldKey) {
      case 'power':
        return <div key={fieldKey}>{getFieldLabel('power')}: {formatPower(power)}</div>;
      case 'temperature':
        return (
          <div key={fieldKey}>
            {getFieldLabel('temperature')}:{' '}
            <span style={{ color: temperature !== null ? getTemperatureColor(temperature) : '#999' }}>
              {formatTemperature(temperature)}
            </span>
          </div>
        );
      case 'diskInputVoltage':
        return <div key={fieldKey}>{getFieldLabel('diskInputVoltage')}: {formatVoltage(diskInputVoltage)}</div>;
      case 'diskInputCurrent':
        return <div key={fieldKey}>{getFieldLabel('diskInputCurrent')}: {formatCurrent(diskInputCurrent)}</div>;
      case 'nvmeInternalTemp':
      case 'nvmeMaxTemp': {
        const value = fieldKey === 'nvmeInternalTemp' ? nvmeInternalTemp : nvmeMaxTemp;
        return (
          <div key={fieldKey}>
            {getFieldLabel(fieldKey)}:{' '}
            <span style={{ color: value !== null ? getTemperatureColor(value) : '#999' }}>
              {formatTemperature(value)}
            </span>
          </div>
        );
      }
      case 'status':
        return (
          <div key={fieldKey}>
            {getFieldLabel('status')}: {st ? <Badge status={st.status} text={st.text} /> : 'NA'}
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
    <div className={`hardware-node load-node${tempClass}${statusClass}`}>
      <div className="node-content">
        <div className="node-icon-area">
          <NodeIcon nodeType="disk" customIcon={data.customIcon} customIconUrl={data.customIconUrl} />
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

export default DiskNode;
