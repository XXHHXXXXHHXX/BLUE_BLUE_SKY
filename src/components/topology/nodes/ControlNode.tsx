'use client';

import React from 'react';
import { type NodeProps } from '@xyflow/react';
import NodeIcon from './NodeIcon';
import { getNodeDisplayLabel } from '../../../utils/formatters';
import type { ControlConfig } from '../../../types/topology';

const ControlNode: React.FC<NodeProps> = (props) => {
  const data = props.data as {
    label?: string;
    displayAlias?: string;
    customIcon?: string;
    customIconUrl?: string;
    nodeType?: string;
    controlConfig?: ControlConfig;
  };
  const controlConfig = data.controlConfig || {
    controlShell: '',
    mode: 'range' as const,
    rangeMin: 0,
    rangeMax: 100,
    rangeStep: 1,
    rangeUnit: '%',
    options: [],
  };

  const command = controlConfig.controlShell?.trim();
  const mode = controlConfig.mode;

  const rangeText = mode === 'range'
    ? `${controlConfig.rangeMin ?? 0} ~ ${controlConfig.rangeMax ?? 100}${controlConfig.rangeUnit || ''}`
    : (controlConfig.options?.length
        ? controlConfig.options.map((o) => `${o}${controlConfig.rangeUnit || ''}`).join(' / ')
        : '未配置');

  return (
    <div className="hardware-node control-node">
      <div className="node-content">
        <div className="node-icon-area">
          <NodeIcon
            nodeType="control"
            customIcon={data.customIcon as string | undefined}
            customIconUrl={data.customIconUrl as string | undefined}
          />
        </div>
        <div className="node-info">
          <div className="node-header">
            <span>{getNodeDisplayLabel(data)}</span>
          </div>
          <div className="node-body">
            <div>
              命令：{command ? command.length > 18 ? `${command.slice(0, 18)}…` : command : '未配置'}
            </div>
            <div>
              范围：{rangeText}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ControlNode;
