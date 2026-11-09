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
  const { hasField, getFieldLabel, orderedFixedFieldKeys, getFieldUnit } = useNodeFieldConfig(props.data as Record<string, unknown>);
  const fmt = (value: number | string | null | undefined, fieldKey: string) =>
    formatValueWithUnit(value, fieldKey, getFieldUnit(fieldKey));

  const renderField = (fieldKey: string) => {
    switch (fieldKey) {
      case 'slotId':
        return hasField('slotId') ? <div key={fieldKey}>{getFieldLabel('slotId')}: {slotId ?? 'NA'}</div> : null;
      case 'power':
        return hasField('power') ? <div key={fieldKey}>{getFieldLabel('power')}: {fmt(power, 'power')}</div> : null;
      case 'temperature':
        return hasField('temperature') ? (
          <div key={fieldKey}>
            {getFieldLabel('temperature')}:{' '}
            <span style={{ color: temperature !== null ? getTemperatureColor(temperature) : '#999' }}>
              {fmt(temperature, 'temperature')}
            </span>
          </div>
        ) : null;
      case 'cardInputVoltage':
        return <div key={fieldKey}>{getFieldLabel('cardInputVoltage')}: {fmt(cardInputVoltage, 'cardInputVoltage')}</div>;
      case 'cardInputCurrent':
        return <div key={fieldKey}>{getFieldLabel('cardInputCurrent')}: {fmt(cardInputCurrent, 'cardInputCurrent')}</div>;
      case 'ocpMainChipTemp':
      case 'ocpOpticalMaxTemp': {
        const value = fieldKey === 'ocpMainChipTemp' ? ocpMainChipTemp : ocpOpticalMaxTemp;
        return (
          <div key={fieldKey}>
            {getFieldLabel(fieldKey)}:{' '}
            <span style={{ color: value !== null ? getTemperatureColor(value) : '#999' }}>
              {fmt(value, fieldKey)}
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
            {orderedFixedFieldKeys.map(renderField)}
            <CustomFieldsRenderer data={props.data as Record<string, unknown>} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default CardNode;
