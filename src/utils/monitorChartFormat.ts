interface TooltipContext {
  iteration?: number;
  iterationLabel?: string;
  power?: number;
  score?: number;
}

export function getScrollLegend(data: string[]) {
  return {
    data,
    type: 'scroll' as const,
    bottom: 0,
    textStyle: { fontSize: 11 },
  };
}

export const tooltipBase = {
  trigger: 'axis',
  confine: true,
  extraCssText: 'max-width: 80vw;',
} as const;

export function formatAxisTooltip(
  params: any[],
  getContext: (dataIndex: number) => TooltipContext | undefined,
  headerExtra?: (ctx: TooltipContext | undefined) => string
) {
  if (!params.length) return '';
  const ctx = getContext(params[0].dataIndex);
  let html = `迭代: ${ctx?.iteration ?? '-'}<br/>参数: ${ctx?.iterationLabel || ''}<br/>`;
  if (headerExtra) html += headerExtra(ctx);
  const cols = params.length > 10 ? 3 : params.length > 5 ? 2 : 1;
  html += `<div style="max-height:240px;overflow-y:auto;display:grid;grid-template-columns:repeat(${cols},1fr);gap:4px 24px;align-content:start;padding-right:8px;">`;
  params.forEach((p) => {
    const val = p.value !== undefined && p.value !== null ? Number(p.value).toFixed(4) : '-';
    html += `<div style="white-space:nowrap;">${p.marker} ${p.seriesName}: ${val}</div>`;
  });
  html += '</div>';
  return html;
}
