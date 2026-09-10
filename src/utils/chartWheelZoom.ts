/**
 * 为 ECharts 图表绑定 Y 轴滚轮缩放，始终以曲线数据的中心为缩放中心，
 * 避免缩放后曲线跑出视野。
 *
 * 返回一个 cleanup 函数，用于在组件卸载或图表实例更换时移除监听器，防止内存泄漏。
 */
export function bindYAxisWheelZoom(chart: any): (() => void) | undefined {
  const dom = chart.getDom() as HTMLElement;
  if (!dom) return;

  // 如果同一 DOM 已绑定过，先清理旧监听器，避免旧 chart 实例被闭包引用而无法释放
  if ((dom as any).__yAxisWheelZoomCleanup) {
    (dom as any).__yAxisWheelZoomCleanup();
  }

  function getDataRange() {
    const opt = chart.getOption();
    let yMin = Infinity;
    let yMax = -Infinity;
    opt.series?.forEach((s: any) => {
      if (!s.data) return;
      s.data.forEach((v: number | null | [string, number] | { value?: number }) => {
        let val: number | null = null;
        if (typeof v === 'number') {
          val = v;
        } else if (Array.isArray(v) && v.length >= 2 && typeof v[1] === 'number') {
          val = v[1];
        } else if (v && typeof v === 'object' && 'value' in v && typeof v.value === 'number') {
          val = v.value;
        }
        if (val !== null && !isNaN(val)) {
          yMin = Math.min(yMin, val);
          yMax = Math.max(yMax, val);
        }
      });
    });
    return { yMin, yMax };
  }

  const { yMin, yMax } = getDataRange();
  if (yMin === Infinity || yMax === -Infinity) {
    (dom as any).__yAxisWheelZoomBound = false;
    (dom as any).__yAxisWheelZoomCleanup = undefined;
    return;
  }

  const dataRange = yMax - yMin || 1;
  let currentRange = dataRange * 1.15;

  const handler = (e: WheelEvent) => {
    e.preventDefault();

    const { yMin: dMin, yMax: dMax } = getDataRange();
    if (dMin === Infinity) return;
    const dCenter = (dMin + dMax) / 2;
    const dRange = dMax - dMin || 1;

    const zoomIn = e.deltaY < 0; // 向上滚轮 = 缩小 Y 轴范围（zoom in）
    const factor = zoomIn ? 0.85 : 1.15;
    currentRange *= factor;
    // 限制缩放范围：最小为数据范围的 5%，最大为数据范围的 5 倍
    currentRange = Math.max(dRange * 0.05, Math.min(dRange * 5, currentRange));

    const newMin = dCenter - currentRange / 2;
    const newMax = dCenter + currentRange / 2;

    chart.setOption({ yAxis: { min: newMin, max: newMax } });
  };

  dom.addEventListener('wheel', handler, { passive: false });

  const cleanup = () => {
    dom.removeEventListener('wheel', handler);
    (dom as any).__yAxisWheelZoomBound = false;
    (dom as any).__yAxisWheelZoomCleanup = undefined;
  };

  (dom as any).__yAxisWheelZoomBound = true;
  (dom as any).__yAxisWheelZoomCleanup = cleanup;

  return cleanup;
}
