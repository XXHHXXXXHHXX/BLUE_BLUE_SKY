'use client';

import React from 'react';
import ReactECharts from 'echarts-for-react';

interface PowerDomain {
  name: string;
  voltage: number;
  current: number;
  power: number;
}

interface PowerDomainPieProps {
  domains: PowerDomain[];
}

const PALETTE = ['#5470c6', '#6a5acd', '#7b68ee', '#4169e1', '#836fff', '#6495ed', '#5f9ea0', '#4682b4'];

const PowerDomainPie: React.FC<PowerDomainPieProps> = ({ domains }) => {
  const option = {
    title: { text: '电源域功耗分布', left: 'center' },
    tooltip: {
      trigger: 'item',
      formatter: '{b}: {c}W ({d}%)',
    },
    legend: { bottom: 0, type: 'scroll' },
    color: PALETTE,
    series: [
      {
        type: 'pie',
        radius: ['30%', '60%'],
        center: ['50%', '45%'],
        data: domains.map((d) => ({ name: d.name, value: d.power })),
        emphasis: {
          itemStyle: { shadowBlur: 10, shadowOffsetX: 0, shadowColor: 'rgba(0,0,0,0.3)' },
        },
        label: { formatter: '{b}\n{d}%' },
      },
    ],
  };

  return <ReactECharts option={option} style={{ height: 300 }} />;
};

export default PowerDomainPie;
