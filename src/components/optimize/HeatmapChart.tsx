'use client';

import React from 'react';
import ReactECharts from 'echarts-for-react';
import { Empty, Card } from 'antd';
import { HeatMapOutlined } from '@ant-design/icons';
import { useOptimizeStore } from '../../stores/optimizeStore';

const HeatmapChart: React.FC = () => {
  const { paretoFront } = useOptimizeStore();

  if (paretoFront.length === 0) {
    return (
      <Card size="small" title={<><HeatMapOutlined /> 参数敏感性分析</>} style={{ height: 320 }}>
        <Empty description="暂无数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      </Card>
    );
  }

  // 从帕累托前沿中提取参数名称
  const paramNames = Object.keys(paretoFront[0]?.params || {});
  if (paramNames.length < 2) {
    return (
      <Card size="small" title={<><HeatMapOutlined /> 参数敏感性分析</>} style={{ height: 320 }}>
        <Empty description="需要至少2个输入参数" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      </Card>
    );
  }

  // 计算参数之间的相关性（简化版：基于效率的敏感性热力图）
  const xParam = paramNames[0];
  const yParam = paramNames[1];

  const xValues = paretoFront.map((p) => p.params[xParam]);
  const yValues = paretoFront.map((p) => p.params[yParam]);

  const xMin = Math.min(...xValues);
  const xMax = Math.max(...xValues);
  const yMin = Math.min(...yValues);
  const yMax = Math.max(...yValues);

  const xBins = 10;
  const yBins = 10;

  const heatmapData: [number, number, number][] = [];
  for (let i = 0; i < xBins; i++) {
    for (let j = 0; j < yBins; j++) {
      const xLow = xMin + (i / xBins) * (xMax - xMin);
      const xHigh = xMin + ((i + 1) / xBins) * (xMax - xMin);
      const yLow = yMin + (j / yBins) * (yMax - yMin);
      const yHigh = yMin + ((j + 1) / yBins) * (yMax - yMin);

      const points = paretoFront.filter(
        (p) =>
          p.params[xParam] >= xLow &&
          p.params[xParam] < xHigh &&
          p.params[yParam] >= yLow &&
          p.params[yParam] < yHigh
      );

      const avgEff = points.length > 0
        ? points.reduce((sum, p) => sum + p.efficiency, 0) / points.length
        : 0;

      heatmapData.push([i, j, avgEff]);
    }
  }

  const option = {
    grid: { top: 30, right: 30, bottom: 50, left: 60 },
    tooltip: {
      position: 'top',
      formatter: (params: any) => {
        const xLow = xMin + (params.data[0] / xBins) * (xMax - xMin);
        const xHigh = xMin + ((params.data[0] + 1) / xBins) * (xMax - xMin);
        const yLow = yMin + (params.data[1] / yBins) * (yMax - yMin);
        const yHigh = yMin + ((params.data[1] + 1) / yBins) * (yMax - yMin);
        return `
          <div><strong>${xParam}: ${xLow.toFixed(2)} ~ ${xHigh.toFixed(2)}</strong></div>
          <div><strong>${yParam}: ${yLow.toFixed(2)} ~ ${yHigh.toFixed(2)}</strong></div>
          <div>平均能效: ${params.data[2].toFixed(2)}</div>
        `;
      },
    },
    xAxis: {
      type: 'category',
      name: xParam,
      nameLocation: 'middle',
      nameGap: 30,
      data: Array.from({ length: xBins }, (_, i) =>
        (xMin + ((i + 0.5) / xBins) * (xMax - xMin)).toFixed(2)
      ),
      splitArea: { show: true },
      axisLabel: { fontSize: 10, rotate: 45 },
    },
    yAxis: {
      type: 'category',
      name: yParam,
      nameLocation: 'middle',
      nameGap: 40,
      data: Array.from({ length: yBins }, (_, j) =>
        (yMin + ((j + 0.5) / yBins) * (yMax - yMin)).toFixed(2)
      ),
      splitArea: { show: true },
      axisLabel: { fontSize: 10 },
    },
    visualMap: {
      min: Math.min(...heatmapData.map((d) => d[2])),
      max: Math.max(...heatmapData.map((d) => d[2])),
      calculable: true,
      orient: 'horizontal',
      left: 'center',
      bottom: 0,
      inRange: {
        color: ['#313695', '#4575b4', '#74add1', '#abd9e9', '#e0f3f8', '#fee090', '#fdae61', '#f46d43', '#d73027', '#a50026'],
      },
      itemWidth: 12,
      itemHeight: 80,
      textStyle: { fontSize: 10 },
    },
    series: [
      {
        type: 'heatmap',
        data: heatmapData,
        label: { show: false },
        emphasis: {
          itemStyle: {
            shadowBlur: 10,
            shadowColor: 'rgba(0, 0, 0, 0.5)',
          },
        },
      },
    ],
    animation: true,
  };

  return (
    <Card size="small" title={<><HeatMapOutlined /> 参数敏感性分析（{xParam} vs {yParam}）</>} style={{ height: 320 }}>
      <ReactECharts option={option} style={{ height: 260 }} />
    </Card>
  );
};

export default HeatmapChart;
