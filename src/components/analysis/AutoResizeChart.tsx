'use client';

/** 自适应容器尺寸的 ECharts 封装
 *
 * echarts-for-react 只在窗口 resize 时重绘，容器自身尺寸变化（网格布局重排、
 * 图表被拆分/合并后重新挂载、抽屉展开等）不会触发 resize。
 * 容器初始宽度为 0 时 ECharts 会按 0 宽度初始化，坐标轴会挤成一条线。
 * 这里用 ResizeObserver 监听容器，尺寸变化后主动 resize。
 */
import React, { useEffect, useRef } from 'react';
import ReactECharts from 'echarts-for-react';

/** echarts 实例的最小接口（避免依赖 echarts-for-react 未导出的类型） */
interface ResizableECharts {
  resize: () => void;
  isDisposed?: () => boolean;
}

interface AutoResizeChartProps {
  option: any;
  height?: number | string;
  notMerge?: boolean;
  style?: React.CSSProperties;
}

const AutoResizeChart: React.FC<AutoResizeChartProps> = ({
  option,
  height = 620,
  notMerge = true,
  style,
}) => {
  // echarts-for-react 的 ref 类型未稳定导出，这里只用到 getEchartsInstance
  const chartRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;

    const resize = () => {
      const instance = chartRef.current?.getEchartsInstance() as ResizableECharts | undefined;
      if (!instance || instance.isDisposed?.()) return;
      try {
        instance.resize();
      } catch {
        // 实例尚未就绪时忽略
      }
    };

    const observer = new ResizeObserver(() => {
      // 尺寸变化可能发生在同一帧内多次，放到下一帧统一处理
      window.requestAnimationFrame(resize);
    });
    observer.observe(container);
    // 挂载后先对齐一次，修复初始宽度为 0 的情况
    window.requestAnimationFrame(resize);

    return () => observer.disconnect();
  }, []);

  // option 变化后也补一次 resize，避免切换数据后坐标系未重算
  useEffect(() => {
    const instance = chartRef.current?.getEchartsInstance() as ResizableECharts | undefined;
    if (!instance || instance.isDisposed?.()) return;
    window.requestAnimationFrame(() => {
      try {
        instance.resize();
      } catch {
        // ignore
      }
    });
  }, [option]);

  return (
    <div ref={containerRef} style={{ width: '100%', ...style }}>
      <ReactECharts ref={chartRef} option={option} style={{ height, width: '100%' }} notMerge={notMerge} />
    </div>
  );
};

export default AutoResizeChart;
