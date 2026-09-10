'use client';

import React from 'react';
import ReactECharts from 'echarts-for-react';
import { Empty, Card } from 'antd';
import { RiseOutlined } from '@ant-design/icons';
import { useOptimizeStore } from '../../stores/optimizeStore';

const ConvergenceChart: React.FC = () => {
  const { convergenceHistory } = useOptimizeStore();

  if (convergenceHistory.length === 0) {
    return (
      <Card size="small" title={<><RiseOutlined /> 收敛曲线</>} style={{ height: 320 }}>
        <Empty description="暂无寻优数据，启动寻优后查看收敛过程" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      </Card>
    );
  }

  const option = {
    grid: { top: 40, right: 60, bottom: 30, left: 50 },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'cross' },
    },
    legend: {
      data: ['最优适应度', '平均适应度', '种群多样性'],
      top: 8,
      textStyle: { fontSize: 11 },
    },
    xAxis: {
      type: 'value',
      name: '迭代次数',
      nameTextStyle: { fontSize: 11 },
      splitLine: { show: false },
    },
    yAxis: [
      {
        type: 'value',
        name: '适应度',
        nameTextStyle: { fontSize: 11 },
        splitLine: { lineStyle: { type: 'dashed' } },
      },
      {
        type: 'value',
        name: '多样性',
        nameTextStyle: { fontSize: 11 },
        splitLine: { show: false },
        max: 1,
      },
    ],
    series: [
      {
        name: '最优适应度',
        type: 'line',
        data: convergenceHistory.map((p) => [p.iteration, p.bestFitness]),
        smooth: true,
        symbol: 'none',
        lineStyle: { width: 2, color: '#1890ff' },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(24,144,255,0.3)' },
              { offset: 1, color: 'rgba(24,144,255,0.05)' },
            ],
          },
        },
      },
      {
        name: '平均适应度',
        type: 'line',
        data: convergenceHistory.map((p) => [p.iteration, p.avgFitness]),
        smooth: true,
        symbol: 'none',
        lineStyle: { width: 1.5, color: '#52c41a', type: 'dashed' },
      },
      {
        name: '种群多样性',
        type: 'line',
        yAxisIndex: 1,
        data: convergenceHistory.map((p) => [p.iteration, p.diversity]),
        smooth: true,
        symbol: 'none',
        lineStyle: { width: 1.5, color: '#faad14' },
      },
    ],
    animation: true,
    animationDuration: 300,
  };

  return (
    <Card size="small" title={<><RiseOutlined /> 收敛曲线</>} style={{ height: 320 }}>
      <ReactECharts option={option} style={{ height: 260 }} />
    </Card>
  );
};

export default ConvergenceChart;
