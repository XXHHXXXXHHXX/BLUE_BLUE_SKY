/** AI 可视化画布执行器
 *
 * 服务端把画布类工具声明为客户端工具，模型调用后由前端立即执行：
 * 写入 aiCanvasStore，画布实时渲染。返回结构化结果回传给模型。
 */
import { useAiCanvasStore, type CanvasBlockType } from '../stores/aiCanvasStore';

export interface CanvasActionResult {
  ok: boolean;
  message: string;
  detail?: unknown;
}

/** 画布类工具名（用于在流式事件中识别并即时执行） */
export const CANVAS_TOOL_NAMES = new Set([
  'renderChart',
  'renderMetrics',
  'renderTable',
  'renderFormula',
  'renderTimeline',
  'renderMarkdown',
  'renderAnalysisResult',
  'setCanvasTitle',
  'clearCanvas',
]);

export function isCanvasTool(name: string): boolean {
  return CANVAS_TOOL_NAMES.has(name);
}

type ChartType = 'bar' | 'line' | 'pie' | 'scatter' | 'radar' | 'gauge';

/** LaTeX 命令 → 可读符号（画布用等宽字体展示，不渲染 LaTeX） */
const LATEX_SYMBOLS: Record<string, string> = {
  phi: 'φ', varphi: 'φ', lambda: 'λ', alpha: 'α', beta: 'β', gamma: 'γ',
  mu: 'μ', sigma: 'σ', theta: 'θ', omega: 'ω', delta: 'δ', epsilon: 'ε',
  sum: 'Σ', prod: '∏', int: '∫',
  in: '∈', notin: '∉', subseteq: '⊆', subset: '⊂', cup: '∪', cap: '∩',
  setminus: '∖', emptyset: '∅',
  le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠',
  times: '×', cdot: '·', div: '÷', pm: '±', approx: '≈', sim: '∼',
  to: '→', rightarrow: '→', leftarrow: '←', infty: '∞',
  quad: '  ', qquad: '    ', ',': ' ', ';': ' ', ':': ' ', '!': '',
  left: '', right: '', big: '', Big: '', displaystyle: '',
};

/** 读取 `{...}`（支持嵌套），返回 [内容, 结束位置] */
function readGroup(s: string, i: number): [string, number] {
  if (s[i] !== '{') return ['', i];
  let depth = 0;
  const start = i + 1;
  for (let j = i; j < s.length; j++) {
    if (s[j] === '{') depth++;
    else if (s[j] === '}') {
      depth--;
      if (depth === 0) return [s.slice(start, j), j + 1];
    }
  }
  return [s.slice(start), s.length];
}

/** 下标/上标：单字符直接跟，多字符加花括号避免歧义（Σ_{i=1}^{n}） */
function wrapScript(content: string): string {
  const t = content.trim();
  return t.length <= 1 ? t : `{${t}}`;
}

/** 把模型可能给出的 LaTeX 片段转成可读纯文本 */
export function normalizeFormula(raw: string): string {
  let out = '';
  let i = 0;
  const s = raw;

  while (i < s.length) {
    const ch = s[i];

    if (ch === '\\') {
      // 转义字符 \{ \} \\ 等
      if (/[{}%$&#_]/.test(s[i + 1] || '')) {
        out += s[i + 1];
        i += 2;
        continue;
      }
      const m = /^[a-zA-Z]+/.exec(s.slice(i + 1));
      const cmd = m ? m[0] : '';
      i += 1 + cmd.length;

      if (cmd === 'frac') {
        while (s[i] === ' ') i++;
        const [a, ni] = readGroup(s, i);
        i = ni;
        while (s[i] === ' ') i++;
        const [b, ni2] = readGroup(s, i);
        i = ni2;
        out += `(${normalizeFormula(a)}) / (${normalizeFormula(b)})`;
        continue;
      }
      if (cmd === 'sqrt') {
        while (s[i] === ' ') i++;
        const [a, ni] = readGroup(s, i);
        i = ni;
        out += `√(${normalizeFormula(a)})`;
        continue;
      }
      if (cmd === 'hat' || cmd === 'bar' || cmd === 'tilde') {
        while (s[i] === ' ') i++;
        const [a, ni] = readGroup(s, i);
        i = ni;
        const mark = cmd === 'hat' ? '\u0302' : cmd === 'bar' ? '\u0304' : '\u0303';
        out += normalizeFormula(a) + mark;
        continue;
      }
      if (cmd === 'text' || cmd === 'mathrm' || cmd === 'operatorname') {
        while (s[i] === ' ') i++;
        const [a, ni] = readGroup(s, i);
        i = ni;
        out += a;
        continue;
      }
      if (cmd === 'sum' || cmd === 'prod' || cmd === 'int') {
        out += LATEX_SYMBOLS[cmd];
        // 吸收紧随的 _{} 与 ^{}（顺序可能颠倒）
        for (let k = 0; k < 2; k++) {
          while (s[i] === ' ') i++;
          if (s[i] === '_' || s[i] === '^') {
            const mark = s[i];
            i++;
            while (s[i] === ' ') i++;
            if (s[i] === '{') {
              const [a, ni] = readGroup(s, i);
              i = ni;
              out += mark + wrapScript(normalizeFormula(a));
            } else if (i < s.length) {
              out += mark + s[i];
              i++;
            }
          }
        }
        continue;
      }
      if (cmd && LATEX_SYMBOLS[cmd] !== undefined) {
        out += LATEX_SYMBOLS[cmd];
        continue;
      }
      // 未知命令：丢弃命令本身，保留后续内容
      continue;
    }

    if (ch === '{') {
      const [a, ni] = readGroup(s, i);
      i = ni;
      out += normalizeFormula(a);
      continue;
    }
    if (ch === '}') {
      i++;
      continue;
    }
    if (ch === '_' || ch === '^') {
      i++;
      while (s[i] === ' ') i++;
      if (s[i] === '{') {
        const [a, ni] = readGroup(s, i);
        i = ni;
        out += ch + wrapScript(normalizeFormula(a));
      } else if (i < s.length) {
        out += ch + s[i];
        i++;
      }
      continue;
    }
    out += ch;
    i++;
  }

  return out.replace(/\s{2,}/g, ' ').trim();
}

const PALETTE = ['#1890ff', '#52c41a', '#fa8c16', '#722ed1', '#eb2f96', '#13c2c2', '#faad14', '#2f54eb'];

/** 简单模式 → ECharts option */
function buildSimpleChartOption(
  chartType: ChartType,
  xField: string | undefined,
  yFields: string[],
  data: Array<Record<string, unknown>>,
): Record<string, unknown> {
  const yf = yFields.length ? yFields : [];
  const xData = data.map((d) => (xField ? d[xField] : ''));

  if (chartType === 'pie') {
    const valueField = yf[0];
    const nameField = xField;
    return {
      tooltip: { trigger: 'item' },
      legend: { bottom: 0 },
      series: [
        {
          type: 'pie',
          radius: ['38%', '68%'],
          itemStyle: { borderRadius: 6, borderColor: '#fff', borderWidth: 2 },
          label: { formatter: '{b}: {c} ({d}%)' },
          data: data.map((d, i) => ({
            name: nameField ? String(d[nameField]) : String(i),
            value: valueField ? Number(d[valueField]) : 0,
          })),
        },
      ],
      color: PALETTE,
    };
  }

  if (chartType === 'scatter') {
    const xKey = xField || yf[0];
    const yKey = yf[0] || xField;
    return {
      tooltip: { trigger: 'item' },
      grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
      xAxis: { type: 'value', name: xKey },
      yAxis: { type: 'value', name: yKey },
      series: [
        {
          type: 'scatter',
          symbolSize: 10,
          data: data.map((d) => [Number(d[xKey as string] ?? 0), Number(d[yKey as string] ?? 0)]),
          itemStyle: { color: PALETTE[0] },
        },
      ],
    };
  }

  if (chartType === 'radar') {
    const indicators = data.map((d, i) => ({
      name: xField ? String(d[xField]) : String(i),
      max: Math.max(...yf.map((f) => Number(d[f] ?? 0)), 1) * 1.2,
    }));
    return {
      tooltip: {},
      radar: { indicator: indicators },
      series: [
        {
          type: 'radar',
          data: yf.map((f, idx) => ({
            name: f,
            value: data.map((d) => Number(d[f] ?? 0)),
            itemStyle: { color: PALETTE[idx % PALETTE.length] },
          })),
        },
      ],
    };
  }

  if (chartType === 'gauge') {
    const raw = data.length ? Number(data[0][yf[0]] ?? 0) : 0;
    const value = Number.isFinite(raw) ? raw : 0;
    // 量程取数据最大值与 100 中较大者，避免数值超出 0~100 时指针越界
    const max = Math.max(100, Math.ceil(Math.abs(value) * 1.2));
    return {
      series: [
        {
          type: 'gauge',
          min: 0,
          max,
          progress: { show: true },
          detail: { valueAnimation: true, formatter: '{value}' },
          data: [{ value, name: yf[0] || '数值' }],
        },
      ],
    };
  }

  // bar / line
  const isLine = chartType === 'line';
  return {
    tooltip: { trigger: 'axis' },
    legend: yf.length > 1 ? { bottom: 0 } : undefined,
    grid: { left: '3%', right: '4%', bottom: yf.length > 1 ? '10%' : '3%', containLabel: true },
    xAxis: { type: 'category', data: xData },
    yAxis: { type: 'value' },
    series: yf.map((f, idx) => ({
      name: f,
      type: isLine ? 'line' : 'bar',
      smooth: isLine,
      data: data.map((d) => Number(d[f] ?? 0)),
      itemStyle: { color: PALETTE[idx % PALETTE.length], borderRadius: isLine ? 0 : [4, 4, 0, 0] },
      barWidth: yf.length > 1 ? undefined : '50%',
    })),
  };
}

/** 单块数据上限：防止模型一次性传入上万行导致浏览器卡死 */
const MAX_CHART_POINTS = 2000;
const MAX_TABLE_ROWS = 500;
const MAX_METRICS = 24;
const MAX_TIMELINE_ITEMS = 60;
const MAX_TEXT_CHARS = 20000;

/** 执行一个画布工具；未知工具返回 ok:false */
export function executeCanvasAction(
  toolName: string,
  args: Record<string, unknown>,
): CanvasActionResult {
  const store = useAiCanvasStore.getState();
  const id = typeof args.id === 'string' && args.id ? args.id : `blk-${Date.now()}`;

  const upsert = (
    type: CanvasBlockType,
    extra: Record<string, unknown>,
  ) => {
    store.upsertBlock({
      id,
      type,
      title: typeof args.title === 'string' ? args.title : undefined,
      description: typeof args.description === 'string' ? args.description : undefined,
      ...extra,
    } as Parameters<typeof store.upsertBlock>[0]);
  };

  switch (toolName) {
    case 'renderChart': {
      const option = args.option as Record<string, unknown> | undefined;
      let echartsOption = option;
      if (!echartsOption) {
        const chartType = (typeof args.chartType === 'string' ? args.chartType : 'bar') as ChartType;
        let data = Array.isArray(args.data) ? (args.data as Array<Record<string, unknown>>) : [];
        if (data.length === 0) {
          return { ok: false, message: 'renderChart 需要 data（或直接提供 option）' };
        }
        if (data.length > MAX_CHART_POINTS) {
          data = data.slice(0, MAX_CHART_POINTS);
        }
        const xField = typeof args.xField === 'string' ? args.xField : undefined;
        let yFields = Array.isArray(args.yFields) ? (args.yFields as string[]).map(String) : [];
        // 模型常漏传 yFields：自动推断数值字段（排除 xField）
        if (yFields.length === 0) {
          const keys = Object.keys(data[0] || {});
          yFields = keys.filter(
            (k) => k !== xField && data.some((row) => typeof row[k] === 'number' || (row[k] !== '' && row[k] != null && !isNaN(Number(row[k])))),
          );
          if (yFields.length === 0) {
            return {
              ok: false,
              message: `无法从数据中推断数值字段，请显式提供 yFields。可用字段：${keys.join('、') || '无'}`,
            };
          }
        }
        echartsOption = buildSimpleChartOption(chartType, xField, yFields, data);
      }
      const height = typeof args.height === 'number' ? Math.min(800, Math.max(180, args.height)) : undefined;
      upsert('chart', { echartsOption, chartHeight: height });
      return { ok: true, message: `已渲染图表 ${id}`, detail: { id } };
    }

    case 'renderMetrics': {
      const metrics = Array.isArray(args.metrics) ? args.metrics.slice(0, MAX_METRICS) : [];
      if (metrics.length === 0) return { ok: false, message: 'renderMetrics 需要 metrics' };
      upsert('metrics', { metrics });
      return { ok: true, message: `已渲染指标卡 ${id}`, detail: { id } };
    }

    case 'renderTable': {
      const columns = Array.isArray(args.columns) ? args.columns : [];
      const allRows = Array.isArray(args.rows) ? args.rows : [];
      if (columns.length === 0) return { ok: false, message: 'renderTable 需要 columns' };
      const rows = allRows.slice(0, MAX_TABLE_ROWS);
      upsert('table', { columns, rows });
      return {
        ok: true,
        message:
          allRows.length > MAX_TABLE_ROWS
            ? `已渲染表格 ${id}（共 ${allRows.length} 行，仅展示前 ${MAX_TABLE_ROWS} 行）`
            : `已渲染表格 ${id}`,
        detail: { id, totalRows: allRows.length },
      };
    }

    case 'renderFormula': {
      const raw = typeof args.formula === 'string' ? args.formula : '';
      if (!raw) return { ok: false, message: 'renderFormula 需要 formula' };
      const formula = normalizeFormula(raw);
      const description =
        typeof args.description === 'string' ? normalizeFormula(args.description) : undefined;
      upsert('formula', { formula, description });
      return { ok: true, message: `已渲染公式 ${id}`, detail: { id } };
    }

    case 'renderTimeline': {
      const items = Array.isArray(args.items) ? args.items.slice(0, MAX_TIMELINE_ITEMS) : [];
      if (items.length === 0) return { ok: false, message: 'renderTimeline 需要 items' };
      upsert('timeline', { items });
      return { ok: true, message: `已渲染时间线 ${id}`, detail: { id } };
    }

    case 'renderMarkdown': {
      let content = typeof args.content === 'string' ? args.content : '';
      if (!content) return { ok: false, message: 'renderMarkdown 需要 content' };
      if (content.length > MAX_TEXT_CHARS) {
        content = `${content.slice(0, MAX_TEXT_CHARS)}\n\n…（内容过长，已截断）`;
      }
      upsert('markdown', { content });
      return { ok: true, message: `已渲染文本 ${id}`, detail: { id } };
    }

    case 'renderAnalysisResult': {
      // 一次调用把 runSmartAnalysis 的完整结果铺到画布（省去模型手工组装 7 次调用）
      const result = args.result as Record<string, unknown> | undefined;
      if (!result || typeof result !== 'object') {
        return { ok: false, message: 'renderAnalysisResult 需要 result（runSmartAnalysis 的返回值）' };
      }
      if (result.error) {
        return { ok: false, message: `分析结果含错误：${String(result.error)}` };
      }
      const prefix = typeof args.idPrefix === 'string' && args.idPrefix ? args.idPrefix : 'analysis';
      const created: string[] = [];
      const push = (
        suffix: string,
        type: CanvasBlockType,
        title: string,
        extra: Record<string, unknown>,
      ) => {
        const blockId = `${prefix}-${suffix}`;
        store.upsertBlock({
          id: blockId,
          type,
          title,
          ...extra,
        } as Parameters<typeof store.upsertBlock>[0]);
        created.push(blockId);
      };

      const r2 = typeof result.model_r2 === 'number' ? result.model_r2 : undefined;
      const modelType = result.model_type === 'xgboost' ? 'XGBoost' : '多项式回归';
      const opt = result.optimal_point as
        | { values?: Record<string, number | string>; predicted_score?: number }
        | undefined;
      const actual = result.actual_best as
        | { values?: Record<string, number | string>; actual_score?: number }
        | undefined;

      // 1. 核心指标
      const metrics: Array<{ label: string; value: string | number; unit?: string; color?: string }> = [
        { label: '模型', value: modelType },
      ];
      if (typeof r2 === 'number') {
        metrics.push({
          label: '拟合度 R²',
          value: r2,
          color: r2 >= 0.8 ? '#52c41a' : r2 >= 0.5 ? '#faad14' : '#ff4d4f',
        });
      }
      if (typeof result.samples === 'number') metrics.push({ label: '样本量', value: result.samples, unit: '条' });
      if (Array.isArray(result.features)) metrics.push({ label: '特征数', value: result.features.length, unit: '个' });
      if (typeof opt?.predicted_score === 'number') {
        metrics.push({ label: '最优预测值', value: opt.predicted_score, color: '#1890ff' });
      }
      if (typeof actual?.actual_score === 'number') {
        metrics.push({ label: '历史最佳实测', value: actual.actual_score, color: '#52c41a' });
      }
      push('metrics', 'metrics', '核心指标', { metrics });

      // 2. 参数影响比重（饼图）
      const importance = Array.isArray(result.feature_importance)
        ? (result.feature_importance as Array<{ feature: string; impact_ratio: number }>)
        : [];
      if (importance.length > 0) {
        push('impact-pie', 'chart', '参数影响比重', {
          echartsOption: {
            tooltip: { trigger: 'item', formatter: '{b}: {c}% ({d}%)' },
            legend: { bottom: 0 },
            series: [
              {
                type: 'pie',
                radius: ['40%', '70%'],
                itemStyle: { borderRadius: 8, borderColor: '#fff', borderWidth: 2 },
                label: { formatter: '{b}\n{d}%' },
                data: importance.map((i) => ({ name: i.feature, value: i.impact_ratio })),
              },
            ],
            color: PALETTE,
          },
        });
        push('impact-bar', 'chart', '参数重要性排序', {
          echartsOption: {
            tooltip: { trigger: 'axis' },
            grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
            xAxis: { type: 'category', data: importance.map((i) => i.feature) },
            yAxis: { type: 'value' },
            series: [
              {
                type: 'bar',
                barWidth: '50%',
                itemStyle: { color: PALETTE[0], borderRadius: [4, 4, 0, 0] },
                data: importance.map((i) => i.impact_ratio),
              },
            ],
          },
        });
      }

      // 3. 参数效应曲线
      const effects = Array.isArray(result.parameter_effects)
        ? (result.parameter_effects as Array<{
            feature: string;
            data: Array<{ x: number | string; shap: number; actual_y: number }>;
          }>)
        : [];
      for (const pe of effects.slice(0, 6)) {
        push(`effect-${pe.feature}`, 'chart', `${pe.feature} 影响曲线`, {
          echartsOption: {
            tooltip: { trigger: 'axis' },
            grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
            xAxis: { type: 'category', data: pe.data.map((d) => d.x) },
            yAxis: [
              { type: 'value', name: '实际表现' },
              { type: 'value', name: 'SHAP' },
            ],
            series: [
              { name: '实际表现', type: 'line', smooth: true, data: pe.data.map((d) => d.actual_y) },
              { name: 'SHAP', type: 'line', smooth: true, yAxisIndex: 1, data: pe.data.map((d) => d.shap) },
            ],
          },
        });
      }

      // 4. 最优参数组合表
      const optValues = opt?.values || {};
      if (Object.keys(optValues).length > 0) {
        push('optimal', 'table', '最优参数组合', {
          columns: [
            { key: 'param', title: '参数' },
            { key: 'value', title: '推荐值' },
          ],
          rows: Object.entries(optValues).map(([k, v]) => ({ param: k, value: String(v) })),
        });
      }

      // 5. 分析说明
      const notes = [result.algorithm_note, result.optimization_note].filter(
        (n): n is string => typeof n === 'string' && n.length > 0,
      );
      if (notes.length > 0) {
        push('notes', 'markdown', '分析说明', { content: notes.join('\n\n') });
      }

      return {
        ok: true,
        message: `已把分析结果渲染为 ${created.length} 个视图`,
        detail: { blocks: created },
      };
    }

    case 'setCanvasTitle': {
      const title = typeof args.title === 'string' ? args.title : '';
      store.setTitle(title);
      return { ok: true, message: `画布标题已设为「${title}」` };
    }

    case 'clearCanvas': {
      store.clear();
      return { ok: true, message: '画布已清空' };
    }

    default:
      return { ok: false, message: `未知画布动作：${toolName}` };
  }
}
