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
    const value = data.length ? Number(data[0][yf[0]] ?? 0) : 0;
    return {
      series: [
        {
          type: 'gauge',
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
        const data = Array.isArray(args.data) ? (args.data as Array<Record<string, unknown>>) : [];
        const yFields = Array.isArray(args.yFields) ? (args.yFields as string[]).map(String) : [];
        if (data.length === 0) {
          return { ok: false, message: 'renderChart 需要 data（或直接提供 option）' };
        }
        echartsOption = buildSimpleChartOption(
          chartType,
          typeof args.xField === 'string' ? args.xField : undefined,
          yFields,
          data,
        );
      }
      upsert('chart', { echartsOption });
      return { ok: true, message: `已渲染图表 ${id}`, detail: { id } };
    }

    case 'renderMetrics': {
      const metrics = Array.isArray(args.metrics) ? args.metrics : [];
      if (metrics.length === 0) return { ok: false, message: 'renderMetrics 需要 metrics' };
      upsert('metrics', { metrics });
      return { ok: true, message: `已渲染指标卡 ${id}`, detail: { id } };
    }

    case 'renderTable': {
      const columns = Array.isArray(args.columns) ? args.columns : [];
      const rows = Array.isArray(args.rows) ? args.rows : [];
      if (columns.length === 0) return { ok: false, message: 'renderTable 需要 columns' };
      upsert('table', { columns, rows });
      return { ok: true, message: `已渲染表格 ${id}`, detail: { id } };
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
      const items = Array.isArray(args.items) ? args.items : [];
      if (items.length === 0) return { ok: false, message: 'renderTimeline 需要 items' };
      upsert('timeline', { items });
      return { ok: true, message: `已渲染时间线 ${id}`, detail: { id } };
    }

    case 'renderMarkdown': {
      const content = typeof args.content === 'string' ? args.content : '';
      if (!content) return { ok: false, message: 'renderMarkdown 需要 content' };
      upsert('markdown', { content });
      return { ok: true, message: `已渲染文本 ${id}`, detail: { id } };
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
