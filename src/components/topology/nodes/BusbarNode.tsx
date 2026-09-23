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
  getNodeDisplayLabel,
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
  const { hasField, getFieldLabel, orderedVisibleFieldKeys } = useNodeFieldConfig(props.data as Record<string, unknown>);

  const busbarVoltage = s?.busbarVoltage ?? null;
  const busbarCurrent = s?.busbarCurrent ?? null;
  const busbarPower = s?.busbarPower ?? null;

  const renderField = (fieldKey: string) => {
    switch (fieldKey) {
      case 'busbarVoltage':
        return <div key={fieldKey}>{getFieldLabel('busbarVoltage')}: {formatVoltage(busbarVoltage)}</div>;
      case 'busbarCurrent':
        return <div key={fieldKey}>{getFieldLabel('busbarCurrent')}: {formatCurrent(busbarCurrent)}</div>;
      case 'busbarPower':
        return <div key={fieldKey}>{getFieldLabel('busbarPower')}: {formatPower(busbarPower)}</div>;
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
        return <div key={fieldKey}>{getFieldLabel(fieldKey)}: {typeof value === 'number' ? value.toFixed(2) : String(value)}</div>;
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
            {orderedVisibleFieldKeys.map(renderField)}
            {hasField('busbarPower') && busbarPower !== null && (
              <div className="efficiency-bar">
                <div
                  style={{
                    width: `${Math.min(100, Math.max(0, busbarPower))}%`,
                    height: '100%',
                    backgroundColor: '#1890ff',
                    borderRadius: 2,
                    transition: 'width 0.3s',
                  }}
                />
              </div>
            )}
            <CustomFieldsRenderer data={props.data as Record<string, unknown>} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default BusbarNode;
