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
  getTemperatureLevel,
} from '../../../utils/formatters';

const CardNode: React.FC<NodeProps> = (props) => {
  const data = props.data as {
    label?: string;
    customIcon?: string;
    displayAlias?: string;
    customIconUrl?: string;
    nodeType?: string;
    cardData?: {
      power: number | null;
      temperature?: number | null;
      slotId: string | null;
      cardInputVoltage?: number | null;
      cardInputCurrent?: number | null;
      ocpMainChipTemp?: number | null;
      ocpOpticalMaxTemp?: number | null;
    };
  };
  const card = data.cardData;
  const displayMetrics = (props.data as Record<string, unknown>)?.displayMetrics as Record<string, number | null> | undefined;
  const { hasField, getFieldLabel, orderedVisibleFieldKeys } = useNodeFieldConfig(props.data as Record<string, unknown>);

  const renderField = (fieldKey: string) => {
    switch (fieldKey) {
      case 'slotId':
        return hasField('slotId') ? <div key={fieldKey}>{getFieldLabel('slotId')}: {slotId ?? 'NA'}</div> : null;
      case 'power':
        return hasField('power') ? <div key={fieldKey}>{getFieldLabel('power')}: {formatPower(power)}</div> : null;
      case 'temperature':
        return hasField('temperature') ? (
          <div key={fieldKey}>
            {getFieldLabel('temperature')}:{' '}
            <span style={{ color: temperature !== null ? getTemperatureColor(temperature) : '#999' }}>
              {formatTemperature(temperature)}
            </span>
          </div>
        ) : null;
      case 'cardInputVoltage':
        return <div key={fieldKey}>{getFieldLabel('cardInputVoltage')}: {formatVoltage(cardInputVoltage)}</div>;
      case 'cardInputCurrent':
        return <div key={fieldKey}>{getFieldLabel('cardInputCurrent')}: {formatCurrent(cardInputCurrent)}</div>;
      case 'ocpMainChipTemp':
      case 'ocpOpticalMaxTemp': {
        const value = fieldKey === 'ocpMainChipTemp' ? ocpMainChipTemp : ocpOpticalMaxTemp;
        return (
          <div key={fieldKey}>
            {getFieldLabel(fieldKey)}:{' '}
            <span style={{ color: value !== null ? getTemperatureColor(value) : '#999' }}>
              {formatTemperature(value)}
            </span>
          </div>
        );
      }
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
  const power = card?.power ?? null;
  const temperature = card?.temperature ?? null;
  const slotId = card?.slotId ?? null;
  const cardInputVoltage = card?.cardInputVoltage ?? null;
  const cardInputCurrent = card?.cardInputCurrent ?? null;
  const ocpMainChipTemp = card?.ocpMainChipTemp ?? null;
  const ocpOpticalMaxTemp = card?.ocpOpticalMaxTemp ?? null;

  const tempLevel = getTemperatureLevel(temperature ?? undefined);
  const tempClass = tempLevel === 'critical' 
    ? ' critical-temp' 
    : tempLevel === 'warning' 
    ? ' warning-temp' 
    : '';

  return (
    <div className={`hardware-node load-node${tempClass}`}>
      <div className="node-content">
        <div className="node-icon-area">
          <NodeIcon nodeType="card" customIcon={data.customIcon} customIconUrl={data.customIconUrl} />
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

export default CardNode;
