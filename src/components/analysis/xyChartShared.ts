/** 自定义 XY 图 - 配置与计算逻辑（单图与合并图共用）
 *
 * 把「配置 → 数据点/序列/趋势线」的计算从组件里抽出来，
 * 这样合并图表可以把多份配置的序列叠加到同一个坐标系里对比。
 */
import type { TestReport } from '../../stores/testReportStore';
import type { TestResult } from '../../stores/testStore';
import { collectScoreNames } from '../../utils/scoreParsing';

export type SeriesType = 'score' | 'namedScore' | 'monitor' | 'param' | 'computed';
export type TrendType = 'linear' | 'poly' | 'exp';
export type XYChartType = 'scatter' | 'line';

export interface SeriesOption {
  key: string;
  label: string;
  type: SeriesType;
  id?: string;
  computed?: ComputedSeriesConfig;
}

export interface ComputedSeriesItem {
  seriesKey: string;
  operator?: '+' | '-' | '*' | '/';
}

export interface ComputedSeriesConfig {
  name: string;
  items: ComputedSeriesItem[];
}

export interface DataPoint {
  x: number;
  y: number;
  iteration: number;
  label: string;
  raw: TestResult;
}

/** 单张 XY 图表的完整配置 */
export interface XYChartConfig {
  reportId: string;
  xSeriesKey: string;
  ySeriesKey: string;
  yComputedMode: boolean;
  yComputedConfig: ComputedSeriesConfig;
  groupByKey: string;
  chartType: XYChartType;
  selectedIterations: string[];
  showTrendline: boolean;
  hideScatter: boolean;
  trendType: TrendType;
  polyOrder: number;
}

export function createDefaultXYChartConfig(): XYChartConfig {
  return {
    reportId: '',
    xSeriesKey: '',
    ySeriesKey: '',
    yComputedMode: false,
    yComputedConfig: { name: '', items: [] },
    groupByKey: '',
    chartType: 'scatter',
    selectedIterations: [],
    showTrendline: false,
    hideScatter: false,
    trendType: 'linear',
    polyOrder: 2,
  };
}

/** 最小二乘拟合。points 需已按 x 升序；返回采样点坐标数组与公式描述 */
export function fitTrendline(
  points: DataPoint[],
  type: TrendType,
  polyOrder: number
): { coords: [number, number][]; formula: string } | null {
  const n = points.length;
  if (n < 2) return null;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);

  const solveLeastSquares = (degree: number): number[] | null => {
    if (n < degree + 1) return null;
    const m = degree + 1;
    const A: number[][] = Array.from({ length: m }, () => new Array(m + 1).fill(0));
    for (let i = 0; i < m; i++) {
      for (let j = 0; j < m; j++) {
        A[i][j] = xs.reduce((s, x) => s + Math.pow(x, i + j), 0);
      }
      A[i][m] = xs.reduce((s, x, k) => s + Math.pow(x, i) * ys[k], 0);
    }
    for (let col = 0; col < m; col++) {
      let piv = col;
      for (let r = col + 1; r < m; r++) {
        if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
      }
      if (Math.abs(A[piv][col]) < 1e-12) return null;
      [A[col], A[piv]] = [A[piv], A[col]];
      for (let r = col + 1; r < m; r++) {
        const f = A[r][col] / A[col][col];
        for (let c = col; c <= m; c++) A[r][c] -= f * A[col][c];
      }
    }
    const coeffs = new Array(m).fill(0);
    for (let r = m - 1; r >= 0; r--) {
      let s = A[r][m];
      for (let c = r + 1; c < m; c++) s -= A[r][c] * coeffs[c];
      coeffs[r] = s / A[r][r];
    }
    return coeffs;
  };

  const sampleX = (x0: number, x1: number): number[] => {
    const step = (x1 - x0) / 40 || 1;
    const out: number[] = [];
    for (let i = 0; i <= 40; i++) out.push(x0 + i * step);
    return out;
  };

  if (type === 'linear') {
    const coeffs = solveLeastSquares(1);
    if (!coeffs) return null;
    const a = coeffs[0];
    const b = coeffs[1];
    return {
      coords: sampleX(xs[0], xs[n - 1]).map((x) => [x, a + b * x]),
      formula: `y = ${b >= 0 ? '+' : '-'} ${Math.abs(b).toExponential(2)}x ${a >= 0 ? '+' : '-'} ${Math.abs(a).toExponential(2)}`,
    };
  }

  if (type === 'poly') {
    const order = Math.min(polyOrder, n - 1);
    if (order < 1) return null;
    const coeffs = solveLeastSquares(order);
    if (!coeffs) return null;
    const evalPoly = (x: number) => coeffs.reduce((s, c, i) => s + c * Math.pow(x, i), 0);
    return {
      coords: sampleX(xs[0], xs[n - 1]).map((x) => [x, evalPoly(x)]),
      formula: `多项式拟合(次数 ${order})`,
    };
  }

  const pos = points.filter((p) => p.y > 0);
  if (pos.length < 2) return null;
  const lxs = pos.map((p) => p.x);
  const lys = pos.map((p) => Math.log(p.y));
  const m = lxs.length;
  const sx = lxs.reduce((s, v) => s + v, 0);
  const sy = lys.reduce((s, v) => s + v, 0);
  const sxx = lxs.reduce((s, v) => s + v * v, 0);
  const sxy = lxs.reduce((s, v, i) => s + v * lys[i], 0);
  const denom = m * sxx - sx * sx;
  if (Math.abs(denom) < 1e-12) return null;
  const b = (m * sxy - sx * sy) / denom;
  const a = Math.exp((sy - b * sx) / m);
  return {
    coords: sampleX(lxs[0], lxs[m - 1]).map((x) => [x, a * Math.exp(b * x)]),
    formula: `y = ${a.toExponential(2)} · e^(${b >= 0 ? '+' : '-'}${Math.abs(b).toExponential(2)}x)`,
  };
}

export function getSeriesOptions(report?: TestReport): SeriesOption[] {
  if (!report?.results?.length) return [];
  const firstResult = report.results[0];
  const opts: SeriesOption[] = [{ key: 'score', label: '性能分数 (score)', type: 'score' }];

  collectScoreNames(report.results).forEach((name) => {
    opts.push({ key: `score:${name}`, label: `分数: ${name}`, type: 'namedScore', id: name });
  });

  Object.keys(firstResult.monitorResults || {}).forEach((id) => {
    const name = firstResult.monitorResults?.[id]?.commandName || id;
    opts.push({ key: `monitor:${id}`, label: `监控: ${name}`, type: 'monitor', id });
  });

  const paramNames = new Set<string>();
  report.config.iterationParams?.forEach((p) => paramNames.add(p.name));
  report.results.forEach((r) => {
    Object.keys(r.iterationValues || {}).forEach((k) => paramNames.add(k));
  });
  paramNames.forEach((name) => {
    opts.push({ key: `param:${name}`, label: `参数: ${name}`, type: 'param', id: name });
  });

  return opts;
}

export function getSeriesValue(
  result: TestResult,
  series?: SeriesOption | null,
  allOptions?: SeriesOption[]
): number | null {
  if (!series) return null;
  if (series.type === 'score') return result.score ?? null;
  if (series.type === 'namedScore') return result.scores?.[series.id!] ?? null;
  if (series.type === 'monitor') {
    const mr = result.monitorResults?.[series.id!];
    return mr ? (mr.averageValue ?? null) : null;
  }
  if (series.type === 'param') {
    const raw = result.iterationValues?.[series.id!];
    if (raw === undefined) return null;
    const n = Number(raw);
    return Number.isNaN(n) ? null : n;
  }
  if (series.type === 'computed' && series.computed && allOptions) {
    return computeSeriesValue(result, series.computed, allOptions);
  }
  return null;
}

export function getSeriesValueByKey(
  result: TestResult,
  seriesKey: string,
  options: SeriesOption[]
): number | null {
  const series = options.find((s) => s.key === seriesKey);
  return getSeriesValue(result, series || null, options);
}

export function computeSeriesValue(
  result: TestResult,
  config: ComputedSeriesConfig,
  allOptions: SeriesOption[]
): number | null {
  if (!config.items.length) return null;
  let value = getSeriesValueByKey(result, config.items[0].seriesKey, allOptions);
  if (value === null || Number.isNaN(value)) return null;
  for (let i = 1; i < config.items.length; i++) {
    const item = config.items[i];
    const next = getSeriesValueByKey(result, item.seriesKey, allOptions);
    if (next === null || Number.isNaN(next)) return null;
    switch (item.operator) {
      case '+':
        value += next;
        break;
      case '-':
        value -= next;
        break;
      case '*':
        value *= next;
        break;
      case '/':
        if (next === 0) return null;
        value /= next;
        break;
      default:
        return null;
    }
  }
  return value;
}

export interface XYChartComputed {
  points: DataPoint[];
  seriesData: any[];
  trendSeries: any[];
  xLabel: string;
  yLabel: string;
  /** 配置是否完整（选了报告 + X/Y 轴） */
  ready: boolean;
}

/** 按配置计算一张 XY 图的数据点、序列与趋势线 */
export function computeXYChart(config: XYChartConfig, report?: TestReport): XYChartComputed {
  const empty: XYChartComputed = {
    points: [],
    seriesData: [],
    trendSeries: [],
    xLabel: 'X',
    yLabel: 'Y',
    ready: false,
  };
  if (!report) return empty;

  const seriesOptions = getSeriesOptions(report);
  const xSeries = seriesOptions.find((s) => s.key === config.xSeriesKey);
  const ySeries =
    config.yComputedMode && config.yComputedConfig.items.length > 0
      ? {
          key: 'computed',
          label: config.yComputedConfig.name || '组合值',
          type: 'computed' as const,
          computed: config.yComputedConfig,
        }
      : seriesOptions.find((s) => s.key === config.ySeriesKey);

  if (!xSeries || !ySeries) return empty;

  const groupBy = config.groupByKey ? seriesOptions.find((s) => s.key === config.groupByKey) : undefined;
  const filtered = config.selectedIterations.length
    ? report.results.filter((r) => config.selectedIterations.includes(String(r.iteration)))
    : report.results;

  const pts: DataPoint[] = filtered
    .map((r) => {
      const x = getSeriesValue(r, xSeries, seriesOptions);
      const y = getSeriesValue(r, ySeries, seriesOptions);
      if (x === null || y === null || Number.isNaN(x) || Number.isNaN(y)) return null;
      return {
        x,
        y,
        iteration: r.iteration,
        label: r.iterationLabel || `${r.iteration}`,
        raw: r,
      };
    })
    .filter((p): p is DataPoint => p !== null);

  if (config.chartType === 'line') {
    pts.sort((a, b) => a.x - b.x);
  }

  const fitEnabled = config.chartType === 'scatter' && config.showTrendline;
  let hideDots = fitEnabled && config.hideScatter;

  const trendSeries: any[] = [];
  if (fitEnabled) {
    const addTrend = (name: string, groupPts: DataPoint[]) => {
      const sorted = [...groupPts].sort((a, b) => a.x - b.x);
      const fit = fitTrendline(sorted, config.trendType, config.polyOrder);
      if (!fit) return;
      trendSeries.push({
        name: hideDots ? name : `${name} 拟合`,
        type: 'line',
        data: fit.coords,
        symbol: 'none',
        lineStyle: { width: 2.5 },
        tooltip: {
          formatter: () => `${name}<br/>拟合曲线<br/>${fit.formula}`,
        },
      });
    };
    if (groupBy) {
      const groups = new Map<string, DataPoint[]>();
      pts.forEach((p) => {
        const gv = getSeriesValue(p.raw, groupBy, seriesOptions);
        const key = gv === null ? '未分组' : String(gv);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(p);
      });
      Array.from(groups.entries()).forEach(([name, groupPts]) => addTrend(name, groupPts));
    } else {
      addTrend(`${ySeries.label} vs ${xSeries.label}`, pts);
    }
  }

  if (hideDots && trendSeries.length === 0) {
    hideDots = false;
  }

  let sdata: any[] = [];
  if (!hideDots) {
    if (groupBy) {
      const groups = new Map<string, DataPoint[]>();
      pts.forEach((p) => {
        const gv = getSeriesValue(p.raw, groupBy, seriesOptions);
        const key = gv === null ? '未分组' : String(gv);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(p);
      });
      sdata = Array.from(groups.entries()).map(([name, groupPts]) => ({
        name,
        type: config.chartType,
        data: groupPts.map((p) => [p.x, p.y, p.iteration, p.label]),
        symbolSize: config.chartType === 'scatter' ? 10 : 6,
        smooth: config.chartType !== 'scatter',
      }));
    } else {
      sdata = [
        {
          name: `${ySeries.label} vs ${xSeries.label}`,
          type: config.chartType,
          data: pts.map((p) => [p.x, p.y, p.iteration, p.label]),
          symbolSize: config.chartType === 'scatter' ? 10 : 6,
          smooth: config.chartType !== 'scatter',
        },
      ];
    }
  }

  return {
    points: pts,
    seriesData: sdata,
    trendSeries,
    xLabel: xSeries.label,
    yLabel: ySeries.label,
    ready: true,
  };
}

/** 单图 ECharts option */
export function buildXYChartOption(computed: XYChartComputed, config: XYChartConfig): any | null {
  if (!computed.ready || computed.points.length === 0) return null;
  const hasLegend = !!config.groupByKey || config.showTrendline;
  return {
    title: {
      text: `${computed.yLabel} vs ${computed.xLabel}`,
      left: 'center',
      top: 8,
      textStyle: { fontSize: 14 },
    },
    tooltip: {
      trigger: 'item',
      formatter: (params: any) => {
        if (params.seriesType === 'line' && typeof params.data === 'string') {
          return params.data;
        }
        const [x, y, iteration, label] = params.data || [];
        return `迭代 ${iteration}<br/>${label}<br/>${computed.xLabel}: ${x}<br/>${computed.yLabel}: ${y}`;
      },
    },
    grid: { left: '8%', right: '8%', bottom: '12%', top: '18%' },
    legend: hasLegend ? { bottom: 0, type: 'scroll' } : undefined,
    xAxis: {
      type: 'value',
      name: computed.xLabel,
      scale: true,
      nameLocation: 'middle',
      nameGap: 30,
    },
    yAxis: {
      type: 'value',
      name: computed.yLabel,
      scale: true,
      nameLocation: 'middle',
      nameGap: 45,
    },
    dataZoom: [{ type: 'inside' }, { type: 'slider', bottom: hasLegend ? 30 : 10 }],
    series: [...computed.seriesData, ...computed.trendSeries],
  };
}

/** 合并图 ECharts option：把多张图表的序列叠加到同一坐标系，按图表名前缀区分 */
export function buildMergedXYChartOption(
  members: Array<{ title: string; computed: XYChartComputed; config: XYChartConfig }>
): any | null {
  const usable = members.filter((m) => m.computed.ready && m.computed.points.length > 0);
  if (usable.length === 0) return null;

  const PALETTE = ['#1890ff', '#52c41a', '#fa8c16', '#eb2f96', '#722ed1', '#13c2c2'];
  const series: any[] = [];
  usable.forEach((member, memberIndex) => {
    const prefix = `[${member.title}]`;
    // 同一成员用同一基色，不同成员换色，叠加后仍能区分来自哪张图表
    const color = PALETTE[memberIndex % PALETTE.length];
    member.computed.seriesData.forEach((s) => {
      series.push({
        ...s,
        name: s.name.startsWith(prefix) ? s.name : `${prefix} ${s.name}`,
        itemStyle: { ...(s.itemStyle || {}), color },
        lineStyle: { ...(s.lineStyle || {}), color },
      });
    });
    member.computed.trendSeries.forEach((s) => {
      series.push({
        ...s,
        name: s.name.startsWith(prefix) ? s.name : `${prefix} ${s.name}`,
        lineStyle: { ...(s.lineStyle || {}), color, type: 'dashed' },
      });
    });
  });

  const xLabels = Array.from(new Set(usable.map((m) => m.computed.xLabel)));
  const yLabels = Array.from(new Set(usable.map((m) => m.computed.yLabel)));

  return {
    title: {
      text: `合并图表（${usable.map((m) => m.title).join(' / ')}）`,
      left: 'center',
      top: 8,
      textStyle: { fontSize: 14 },
    },
    tooltip: {
      trigger: 'item',
      formatter: (params: any) => {
        if (params.seriesType === 'line' && typeof params.data === 'string') {
          return `${params.seriesName}<br/>${params.data}`;
        }
        const [x, y, iteration, label] = params.data || [];
        return `${params.seriesName}<br/>迭代 ${iteration}<br/>${label}<br/>X: ${x}<br/>Y: ${y}`;
      },
    },
    grid: { left: '8%', right: '8%', bottom: '14%', top: '18%' },
    legend: { bottom: 0, type: 'scroll' },
    xAxis: {
      type: 'value',
      name: xLabels.join(' / '),
      scale: true,
      nameLocation: 'middle',
      nameGap: 30,
    },
    yAxis: {
      type: 'value',
      name: yLabels.join(' / '),
      scale: true,
      nameLocation: 'middle',
      nameGap: 45,
    },
    dataZoom: [{ type: 'inside' }, { type: 'slider', bottom: 30 }],
    series,
  };
}
