'use client';

import React from 'react';
import { type NodeProps } from '@xyflow/react';
import NodeIcon from './NodeIcon';
import { formatPower, getLossColor, getNodeDisplayLabel } from '../../../utils/formatters';
import type { AggregatorStats } from '../../../services/lossCalculation';

/**
 * 链路聚合器节点
 *
 * 多个上游模块的输出功耗连入本节点时求和，多个下游模块的输入功耗连出本节点时求和，
 * 卡片上显示「上游输出 − 下游输入」的整体链路损耗。
 * 统计值由画布在渲染时通过 data._aggregatorStats 注入（见 lossCalculation.calculateAggregatorStats）。
 */
const AggregatorNode: React.FC<NodeProps> = (props) => {
  const data = props.data as {
    label?: string;
    displayAlias?: string;
    customIcon?: string;
    customIconUrl?: string;
    nodeType?: string;
    _aggregatorStats?: AggregatorStats;
  };

  const stats = data._aggregatorStats;
  const upstreamPower = stats?.upstreamPower ?? 0;
  const downstreamPower = stats?.downstreamPower ?? 0;
  const loss = stats?.loss ?? 0;
  const lossPercent = stats?.lossPercent ?? 0;
  const upstreamCount = stats?.upstreamCount ?? 0;
  const downstreamCount = stats?.downstreamCount ?? 0;

  // 上游、下游都有连线时链路才完整，才展示损耗结论
  const complete = upstreamCount > 0 && downstreamCount > 0;
  const lossColor = complete ? getLossColor(lossPercent) : '#8c8c8c';

  return (
    <div className="hardware-node aggregator-node">
      <div className="node-content">
        <div className="node-icon-area">
          <NodeIcon
            nodeType="aggregator"
            customIcon={data.customIcon as string | undefined}
            customIconUrl={data.customIconUrl as string | undefined}
          />
        </div>
        <div className="node-info">
          <div className="node-header">
            <span>{getNodeDisplayLabel(data as Record<string, unknown>)}</span>
          </div>
          <div className="node-body">
            <div>上游输出合计（{upstreamCount} 路）: {formatPower(upstreamPower)}</div>
            <div>下游输入合计（{downstreamCount} 路）: {formatPower(downstreamPower)}</div>
            <div style={{ fontWeight: 600, color: lossColor }}>
              整体链路损耗: {complete ? `${formatPower(loss)} (${lossPercent.toFixed(1)}%)` : '待连线'}
            </div>
            {!complete && (
              <div style={{ fontSize: 11, color: '#8c8c8c' }}>
                需同时连接上游与下游模块
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AggregatorNode;
