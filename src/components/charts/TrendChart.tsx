'use client';

import React from 'react';
import ReactECharts from 'echarts-for-react';
import { bindYAxisWheelZoom } from '../../utils/chartWheelZoom';

interface TrendChartProps {
  title: string;
  data: Array<{ time: string; value: number }>;
  unit?: string;
  color?: string;
}

const TrendChart: React.FC<TrendChartProps> = ({ title, data, unit = '', color = '#5470c6' }) => {
  const option = {
    title: { text: title, textStyle: { fontSize: 14 }, left: 'center' },
    tooltip: {
      trigger: 'axis',
      formatter: (params: unknown) => {
        const p = (params as Array<{ axisValue: string; seriesName: string; value: number }>)[0];
        return `${p.axisValue}<br/>${p.seriesName}: ${p.value}${unit}`;
      },
    },
    grid: { left: 50, right: 20, top: 40, bottom: 30 },
    xAxis: {
      type: 'category',
      data: data.map((d) => d.time),
      boundaryGap: false,
    },
    yAxis: {
      type: 'value',
      axisLabel: { formatter: `{value}${unit}` },
    },
    series: [
      {
        name: title,
        type: 'line',
        smooth: true,
        data: data.map((d) => d.value),
        lineStyle: { color },
        itemStyle: { color },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: color + '80' },
              { offset: 1, color: color + '10' },
            ],
          },
        },
      },
    ],
  };

  return <ReactECharts option={option} style={{ height: 200 }} onChartReady={bindYAxisWheelZoom} />;
};

export default TrendChart;
