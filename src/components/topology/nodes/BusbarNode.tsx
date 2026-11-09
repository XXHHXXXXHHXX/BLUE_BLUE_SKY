'use client';

import React from 'react';
import { type NodeProps } from '@xyflow/react';
import NodeIcon from './NodeIcon';
import CustomFieldsRenderer from './CustomFieldsRenderer';
import { useNodeFieldConfig } from './useNodeFieldConfig';
import {
  getNodeDisplayLabel,
  formatValueWithUnit,
} from '../../../utils/formatters';

const BusbarNode: React.FC<NodeProps> = (props) => {
  const data = props.data as {
    label?: string;
    customIcon?: string;
    displayAlias?: string;
    customIconUrl?: string;
    nodeType?: string;
    sourceData?: {
      busbarVoltage: number | null;
      busbarCurrent: number | null;
      busbarPower: number | null;
    };
  };
  const s = data.sourceData;
  const displayMetrics = (props.data as Record<string, unknown>)?.displayMetrics as Record<string, number | null> | undefined;
  const { getFieldLabel, orderedFixedFieldKeys, getFieldUnit } = useNodeFieldConfig(props.data as Record<string, unknown>);
  const fmt = (value: number | string | null | undefined, fieldKey: string) =>
    formatValueWithUnit(value, fieldKey, getFieldUnit(fieldKey));

  const busbarVoltage = s?.busbarVoltage ?? null;
  const busbarCurrent = s?.busbarCurrent ?? null;
  const busbarPower = s?.busbarPower ?? null;

  const renderField = (fieldKey: string) => {
    switch (fieldKey) {
      case 'busbarVoltage':
        return <div key={fieldKey}>{getFieldLabel('busbarVoltage')}: {fmt(busbarVoltage, 'busbarVoltage')}</div>;
      case 'busbarCurrent':
        return <div key={fieldKey}>{getFieldLabel('busbarCurrent')}: {fmt(busbarCurrent, 'busbarCurrent')}</div>;
      case 'busbarPower':
        return <div key={fieldKey}>{getFieldLabel('busbarPower')}: {fmt(busbarPower, 'busbarPower')}</div>;
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
        return <div key={fieldKey}>{getFieldLabel(fieldKey)}: {fmt(value, fieldKey)}</div>;
      }
    }
  };

  return (
    <div className="hardware-node source-node">
      <div className="node-content">
        <div className="node-icon-area">
          <NodeIcon nodeType="busbar" customIcon={data.customIcon} customIconUrl={data.customIconUrl} />
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

export default BusbarNode;
