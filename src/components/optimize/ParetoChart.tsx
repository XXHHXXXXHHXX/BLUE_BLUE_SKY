'use client';

import React from 'react';
import ReactECharts from 'echarts-for-react';
import { Empty, Card } from 'antd';
import { DotChartOutlined } from '@ant-design/icons';
import { useOptimizeStore } from '../../stores/optimizeStore';

const ParetoChart: React.FC = () => {
  const { paretoFront, selectedParetoIndex, setSelectedParetoIndex } = useOptimizeStore();

  if (paretoFront.length === 0) {
    return (
      <Card size="small" title={<><DotChartOutlined /> 帕累托前沿</>} style={{ height: 320 }}>
        <Empty description="暂无帕累托数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      </Card>
    );
  }

  const data = paretoFront.map((p, idx) => ({
    value: [p.power, p.performance, p.efficiency],
    params: p.params,
    idx,
    itemStyle: {
      color: idx === selectedParetoIndex ? '#ff4d4f' : '#1890ff',
      borderColor: idx === selectedParetoIndex ? '#ff4d4f' : 'transparent',
      borderWidth: idx === selectedParetoIndex ? 3 : 0,
      shadowBlur: idx === selectedParetoIndex ? 10 : 0,
      shadowColor: '#ff4d4f',
    },
  }));

  const option = {
    grid: { top: 40, right: 40, bottom: 40, left: 50 },
    tooltip: {
      trigger: 'item',
      formatter: (params: any) => {
        const p = params.data;
        return `
          <div style="font-weight:bold;margin-bottom:4px">方案 #${p.idx + 1}</div>
          <div>功耗: ${p.value[0].toFixed(2)} W</div>
          <div>性能: ${p.value[1].toFixed(2)} 分</div>
          <div>能效比: ${p.value[2].toFixed(2)} 分/W</div>
        `;
      },
    },
    xAxis: {
      type: 'value',
      name: '功耗 (W)',
      nameTextStyle: { fontSize: 11 },
      splitLine: { lineStyle: { type: 'dashed' } },
    },
    yAxis: {
      type: 'value',
      name: '性能 (分)',
      nameTextStyle: { fontSize: 11 },
      splitLine: { lineStyle: { type: 'dashed' } },
    },
    visualMap: {
      show: true,
      dimension: 2,
      min: Math.min(...paretoFront.map((p) => p.efficiency)),
      max: Math.max(...paretoFront.map((p) => p.efficiency)),
      inRange: {
        color: ['#bae7ff', '#1890ff', '#096dd9'],
      },
      text: ['高能效', '低能效'],
      calculable: true,
      orient: 'horizontal',
      bottom: 0,
      left: 'center',
      itemWidth: 12,
      itemHeight: 80,
      textStyle: { fontSize: 10 },
    },
    series: [
      {
        type: 'scatter',
        symbolSize: (val: number[]) => Math.sqrt(val[2]) * 4 + 6,
        data,
        emphasis: {
          itemStyle: {
            borderColor: '#ff4d4f',
            borderWidth: 3,
          },
        },
      },
    ],
    animation: true,
  };

  return (
    <Card size="small" title={<><DotChartOutlined /> 帕累托前沿（功耗-性能权衡）</>} style={{ height: 320 }}>
      <ReactECharts
        option={option}
        style={{ height: 260 }}
        onEvents={{
          click: (params: any) => {
            if (params?.data?.idx !== undefined) {
              setSelectedParetoIndex(params.data.idx);
            }
          },
        }}
      />
    </Card>
  );
};

export default ParetoChart;
