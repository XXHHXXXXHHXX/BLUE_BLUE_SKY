'use client';

import React, { useCallback, useState } from 'react';
import { type NodeProps } from '@xyflow/react';
import NodeIcon from './NodeIcon';
import { Button, message } from 'antd';
import CustomFieldsRenderer from './CustomFieldsRenderer';
import { useNodeFieldConfig } from './useNodeFieldConfig';
import { useBMCSessionStore } from '../../../stores/bmcSessionStore';
import { executeViewCommand } from '../../../services/backendApi';
import { parseCommandValues } from '../../../utils/commandOutput';
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

const CPUNode: React.FC<NodeProps> = (props) => {
  const data = props.data as {
    label?: string;
    customIcon?: string;
    displayAlias?: string;
    customIconUrl?: string;
    nodeType?: string;
    cpuData?: {
      power: number | null;
      temperature?: number | null;
      powerDomains: { name: string; voltage: number; current: number; power: number }[];
      amuEvents: { type: string; timestamp: number; message: string }[];
    };
    apiConfig?: {
      powerDomainCommand?: string;
      powerDomainCommandFields?: { name: string; label: string }[];
    };
  };

  const cpuData = data.cpuData;
  const displayMetrics = (props.data as Record<string, unknown>)?.displayMetrics as Record<string, number | null> | undefined;
  const { hasField, getFieldLabel, orderedFixedFieldKeys } = useNodeFieldConfig(props.data as Record<string, unknown>);

  // 从 cpuData 获取数据（支持 null 值显示为 NA）
  const power = cpuData?.power ?? null;
  const temperature = cpuData?.temperature ?? null;

  const [detailLoading, setDetailLoading] = useState(false);

  // 点击"电源域详情"：若配置了电源域获取命令则执行命令并映射值，否则展示已有数据
  const handleOpenDetail = useCallback(async () => {
    const apiConfig = data.apiConfig;
    const command = (apiConfig?.powerDomainCommand || '').trim();
    const fields = apiConfig?.powerDomainCommandFields || [];

    // 未配置命令或字段：走原有路径展示节点已有 cpuData
    if (!command || fields.length === 0) {
      window.dispatchEvent(
        new CustomEvent('open-cpu-detail', {
          detail: { nodeId: props.id, data: data.cpuData },
        })
      );
      return;
    }

    // 命令模式：需已连接 BMC
    const bmcConfig = useBMCSessionStore.getState().getConnectedConfig();
    if (!bmcConfig) {
      message.warning('未连接 BMC，无法获取电源域数据。请先在监控配置中连接 BMC');
      return;
    }

    setDetailLoading(true);
    try {
      // 自动注入 BMC 连接信息占位符（{ip}/{user}/{password}/{pass}），用户命令可直接使用
      const paramValues: Record<string, string> = {
        ip: bmcConfig.ip || '',
        user: bmcConfig.username || '',
        password: bmcConfig.password || '',
        pass: bmcConfig.password || '',
      };
      const res = await executeViewCommand(bmcConfig, command, paramValues);
      if (!res.success) {
        message.error(res.message || '命令执行失败');
        return;
      }

      const values = parseCommandValues(res.stdout || '', fields.length);
      const powerDomains = fields.map((f, i) => ({
        name: f.label || f.name,
        value: values[i] !== undefined ? values[i] : null,
      }));

      window.dispatchEvent(
        new CustomEvent('open-cpu-detail', {
          detail: {
            nodeId: props.id,
            data: data.cpuData,
            commandMode: true,
            powerDomains,
            commandTime: new Date().toLocaleTimeString(),
          },
        })
      );
    } finally {
      setDetailLoading(false);
    }
  }, [data.apiConfig, data.cpuData, props.id]);

  const tempLevel = getTemperatureLevel(temperature);
  const tempClass = tempLevel === 'critical' 
    ? ' critical-temp' 
    : tempLevel === 'warning' 
    ? ' warning-temp' 
    : '';

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
    <div className={`hardware-node cpu-node${tempClass}`}>
      <div className="node-content">
        <div className="node-icon-area">
          <NodeIcon nodeType="cpu" customIcon={data.customIcon} customIconUrl={data.customIconUrl} />
        </div>
        <div className="node-info">
          <div className="node-header">
            <span>{getNodeDisplayLabel(data as Record<string, unknown>)}</span>
          </div>
          <div className="node-body">
            {orderedFixedFieldKeys.map(renderField)}
            {/* 自定义字段始终显示在「电源域详情」按钮上方，按钮固定在卡片最下方 */}
            <CustomFieldsRenderer data={props.data as Record<string, unknown>} />
            <Button size="small" type="primary" onClick={handleOpenDetail} loading={detailLoading}>
              电源域详情
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CPUNode;
