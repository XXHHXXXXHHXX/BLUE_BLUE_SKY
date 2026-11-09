'use client';

import React from 'react';
import { type NodeProps } from '@xyflow/react';
import NodeIcon from './NodeIcon';
import { Badge } from 'antd';
import CustomFieldsRenderer from './CustomFieldsRenderer';
import { useNodeFieldConfig } from './useNodeFieldConfig';
import {
  getTemperatureColor,
  getEfficiencyColor,
  getNodeDisplayLabel,
  getTemperatureLevel,
  formatValueWithUnit,
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
  const { hasField, getFieldLabel, orderedFixedFieldKeys, getFieldUnit } = useNodeFieldConfig(props.data as Record<string, unknown>);
  const fmt = (value: number | string | null | undefined, fieldKey: string) =>
    formatValueWithUnit(value, fieldKey, getFieldUnit(fieldKey));

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
        return <div key={fieldKey}>{getFieldLabel('power')}: {fmt(power, 'power')}</div>;
      case 'temperature':
        return (
          <div key={fieldKey}>
            {getFieldLabel('temperature')}:{' '}
            <span style={{ color: temperature !== null ? getTemperatureColor(temperature) : '#999' }}>
              {fmt(temperature, 'temperature')}
            </span>
          </div>
        );
      case 'diskInputVoltage':
        return <div key={fieldKey}>{getFieldLabel('diskInputVoltage')}: {fmt(diskInputVoltage, 'diskInputVoltage')}</div>;
      case 'diskInputCurrent':
        return <div key={fieldKey}>{getFieldLabel('diskInputCurrent')}: {fmt(diskInputCurrent, 'diskInputCurrent')}</div>;
      case 'nvmeInternalTemp':
      case 'nvmeMaxTemp': {
        const value = fieldKey === 'nvmeInternalTemp' ? nvmeInternalTemp : nvmeMaxTemp;
        return (
          <div key={fieldKey}>
            {getFieldLabel(fieldKey)}:{' '}
            <span style={{ color: value !== null ? getTemperatureColor(value) : '#999' }}>
              {fmt(value, fieldKey)}
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
            {orderedFixedFieldKeys.map(renderField)}
            <CustomFieldsRenderer data={props.data as Record<string, unknown>} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default DiskNode;
