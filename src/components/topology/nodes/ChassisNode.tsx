'use client';

import React from 'react';
import { type NodeProps } from '@xyflow/react';
import NodeIcon from './NodeIcon';
import { getNodeDisplayLabel } from '../../../utils/formatters';

const ChassisNode: React.FC<NodeProps> = (props) => {
  const data = props.data as { label?: string; customIcon?: string; displayAlias?: string; customIconUrl?: string; nodeType?: string };

  return (
    <div className="hardware-node">
      <div className="node-content">
        <div className="node-icon-area">
          <NodeIcon nodeType="chassis" customIcon={data.customIcon} customIconUrl={data.customIconUrl} />
        </div>
        <div className="node-info">
          <div className="node-header">
            <span>{getNodeDisplayLabel(data as Record<string, unknown>)}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChassisNode;
