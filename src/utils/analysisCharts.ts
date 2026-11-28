/** 数据分析结果类型与 ECharts 配置构造器
 *
 * 抽成独立模块，供智能分析结果页与 AI 画布（renderAnalysisResult）共用，
 * 避免两处图表配置各写一份后逐渐漂移。
 */

export interface RankPoint {
  rank: number;
  /** 参数取值：数值参数为 number，字符串枚举参数为原始字符串 */
  values: Record<string, number | string>;
  predicted_score?: number;
  actual_score?: number;
}

export interface FeatureImportanceItem {
  feature: string;
  shap_importance: number;
  xgb_importance: number;
  correlation: number;
  impact_ratio: number;
}

export interface ParameterEffect {
  feature: string;
  data: Array<{ x: number | string; shap: number; actual_y: number }>;
}

export interface WaterfallData {
  base_value: number;
  features: Array<{ feature: string; value: number | string; shap: number }>;
  final_prediction: number;
}

export interface AnalysisResult {
  success: boolean;
  model_type: string;
  model_r2: number;
  samples: number;
  features: string[];
  target: string;
  direction: string;
  rank: number;
  optimal_point: RankPoint;
  top3_inferred: RankPoint[];
  actual_best: RankPoint;
  top3_actual: RankPoint[];
  feature_importance: FeatureImportanceItem[];
  parameter_effects: ParameterEffect[];
  waterfall_data: WaterfallData | null;
  algorithm_note: string;
  optimization_note: string;
}

/** 参数影响比重（饼图） */
export function buildImpactPieOption(items: FeatureImportanceItem[] | undefined) {
  if (!items?.length) return null;
  return {
    tooltip: { trigger: 'item', formatter: '{b}: {c}% ({d}%)' },
    legend: { bottom: 0 },
    series: [
      {
        type: 'pie',
        radius: ['40%', '70%'],
        avoidLabelOverlap: true,
        itemStyle: { borderRadius: 8, borderColor: '#fff', borderWidth: 2 },
        label: { show: true, formatter: '{b}\n{d}%' },
        data: items.map((item) => ({ name: item.feature, value: item.impact_ratio })),
        animationDuration: 900,
        animationEasing: 'cubicOut',
      },
    ],
  };
}

/** SHAP 重要性排序（柱图） */
export function buildImpactBarOption(items: FeatureImportanceItem[] | undefined) {
  if (!items?.length) return null;
  const names = items.map((i) => i.feature);
  const shapVals = items.map((i) => i.shap_importance);
  return {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
    xAxis: { type: 'category', data: names },
    yAxis: { type: 'value', name: 'SHAP 重要性' },
    series: [
      {
        type: 'bar',
        data: shapVals,
        itemStyle: {
          color: {
            type: 'linear',
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: '#1890ff' },
              { offset: 1, color: '#69c0ff' },
            ],
          },
          borderRadius: [4, 4, 0, 0],
        },
        barWidth: '50%',
        animationDuration: 900,
        animationEasing: 'cubicOut',
      },
    ],
  };
}

/** 单参数影响曲线（双轴折线） */
export function buildEffectLineOption(
  feature: string,
  data: Array<{ x: number | string; shap: number; actual_y: number }>,
) {
  return {
    tooltip: { trigger: 'axis' },
    grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
    xAxis: { type: 'category', name: feature, data: data.map((d) => d.x) },
    yAxis: [
      { type: 'value', name: '实际表现', position: 'left' },
      { type: 'value', name: 'SHAP 值', position: 'right' },
    ],
    series: [
      {
        name: '实际表现',
        type: 'line',
        data: data.map((d) => d.actual_y),
        smooth: true,
        symbol: 'circle',
        lineStyle: { color: '#52c41a', width: 2 },
        itemStyle: { color: '#52c41a' },
        animationDuration: 900,
      },
      {
        name: 'SHAP 值',
        type: 'line',
        yAxisIndex: 1,
        data: data.map((d) => d.shap),
        smooth: true,
        symbol: 'diamond',
        lineStyle: { color: '#fa8c16', width: 2 },
        itemStyle: { color: '#fa8c16' },
        animationDuration: 900,
      },
    ],
  };
}

/** SHAP 瀑布图（invisible 堆叠实现） */
export function buildWaterfallOption(data: WaterfallData | null | undefined) {
  if (!data) return null;
  const { base_value, features, final_prediction } = data;
  const categories = ['基础值', ...features.map((f) => f.feature), '预测值'];
  const values = features.map((f) => f.shap);
  const cumulative = [base_value];
  let sum = base_value;
  for (const v of values) {
    sum += v;
    cumulative.push(sum);
  }
  cumulative.push(final_prediction);

  const invisible = [0];
  for (let i = 0; i < values.length; i++) {
    const prev = cumulative[i];
    const curr = values[i];
    invisible.push(curr >= 0 ? prev : prev + curr);
  }
  invisible.push(0);

  const barValues = [
    base_value,
    ...values.map((v) => Math.abs(v)),
    final_prediction - cumulative[cumulative.length - 2],
  ];

  return {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: (params: Array<{ dataIndex: number }>) => {
        const idx = params[0].dataIndex;
        if (idx === 0) return `基础值: ${base_value.toFixed(2)}`;
        if (idx === categories.length - 1) return `最终预测: ${final_prediction.toFixed(2)}`;
        const f = features[idx - 1];
        return `${f.feature}=${f.value}<br/>SHAP: ${f.shap > 0 ? '+' : ''}${f.shap.toFixed(2)}`;
      },
    },
    grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
    xAxis: { type: 'category', data: categories },
    yAxis: { type: 'value' },
    series: [
      {
        type: 'bar',
        stack: 'total',
        itemStyle: { borderColor: 'transparent', color: 'transparent' },
        emphasis: { itemStyle: { borderColor: 'transparent', color: 'transparent' } },
        data: invisible,
      },
      {
        type: 'bar',
        stack: 'total',
        data: barValues.map((v, i) => ({
          value: v,
          itemStyle: {
            color:
              i === 0
                ? '#8c8c8c'
                : i === categories.length - 1
                  ? '#1890ff'
                  : barValues[i] >= 0
                    ? '#52c41a'
                    : '#ff4d4f',
          },
        })),
        label: {
          show: true,
          position: 'top',
          formatter: (p: { dataIndex: number }) => {
            if (p.dataIndex === 0) return base_value.toFixed(1);
            if (p.dataIndex === categories.length - 1) return final_prediction.toFixed(1);
            const val = values[p.dataIndex - 1];
            return (val > 0 ? '+' : '') + val.toFixed(1);
          },
        },
        animationDuration: 900,
      },
    ],
  };
}
