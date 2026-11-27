/** AI 可视化画布插件：让 AI 在对话中把内容「画」到界面上
 *
 * 全部是客户端工具（clientSide: true）——服务端只声明 schema，不执行。
 * 模型调用后 SSE 把 tool-call 推给前端，前端立即写入 aiCanvasStore，
 * 画布实时渲染；同一 id 重复调用视为更新（用于公式变幻、图表逐步变形）。
 *
 * 这些工具与业务页面无关，任何页面都能用。
 */
import { z } from 'zod';
import type { AiPlugin } from './pluginTypes';

const CHART_TYPES = ['bar', 'line', 'pie', 'scatter', 'radar', 'gauge'] as const;

export const canvasPlugin: AiPlugin = {
  id: 'core.canvas',
  name: '可视化画布',
  description: '把分析结果画到界面上：图表、指标卡、表格、公式、时间线、文本',
  source: 'builtin',
  promptHint:
    '你可以在界面上「画图」给用户看：需要展示数据时用 renderChart（柱/线/饼/散点/雷达/仪表盘），' +
    '展示关键数字用 renderMetrics，展示明细用 renderTable，展示数学公式用 renderFormula，' +
    '展示步骤或过程用 renderTimeline，展示结论文字用 renderMarkdown。' +
    '如果已经调用过 runSmartAnalysis，直接把它的返回结果传给 renderAnalysisResult，一次渲染整套分析视图（推荐）。' +
    '用户说「画出来/可视化/让我看看/展示一下」时，直接调用这些工具，不要只在文字里描述。' +
    '同一个 id 再次调用会更新该块（可用于让图表/公式随分析推进而变幻）；' +
    '开始新话题时先调用 clearCanvas 清空画布。' +
    '公式请用纯文本写法（如 R² = 1 − SS_res / SS_tot、φ_j = Σ w_j x_j），不要用 LaTeX 的 \\frac{} / \\sum_{} 语法。',
  tools: [
    {
      name: 'renderChart',
      description:
        '在画布上渲染一个图表。优先用简单模式：给 chartType + xField + yFields + data（对象数组），' +
        '系统自动生成 ECharts 配置；复杂图表可传 option（完整 ECharts option，优先级最高）。',
      clientSide: true,
      inputSchema: z.object({
        id: z.string().describe('块 ID，重复使用同一 ID 可更新该图表'),
        title: z.string().optional(),
        chartType: z.enum(CHART_TYPES).optional().describe('图表类型，默认 bar'),
        xField: z.string().optional().describe('X 轴字段名（简单模式）'),
        yFields: z.array(z.string()).optional().describe('Y 轴数值字段名列表（简单模式）'),
        data: z.array(z.record(z.string(), z.any())).optional().describe('数据行（简单模式）'),
        option: z.record(z.string(), z.any()).optional().describe('完整 ECharts option（高级模式）'),
        height: z.number().optional().describe('图表高度像素，默认 320'),
        description: z.string().optional(),
      }),
    },
    {
      name: 'renderMetrics',
      description: '在画布上渲染一组关键指标卡（大数字 + 标签）',
      clientSide: true,
      inputSchema: z.object({
        id: z.string(),
        title: z.string().optional(),
        metrics: z
          .array(
            z.object({
              label: z.string(),
              value: z.union([z.string(), z.number()]),
              unit: z.string().optional(),
              delta: z.number().optional().describe('相对变化，正数绿、负数红'),
              color: z.string().optional(),
            }),
          )
          .describe('指标列表'),
      }),
    },
    {
      name: 'renderTable',
      description: '在画布上渲染一个表格',
      clientSide: true,
      inputSchema: z.object({
        id: z.string(),
        title: z.string().optional(),
        columns: z.array(
          z.object({
            key: z.string(),
            title: z.string(),
            align: z.enum(['left', 'center', 'right']).optional(),
          }),
        ),
        rows: z.array(z.record(z.string(), z.any())),
      }),
    },
    {
      name: 'renderFormula',
      description:
        '在画布上渲染一个数学公式（等宽字体 + 说明）。同一 id 再次调用可让公式「变幻」，' +
        '适合展示建模/推导过程。',
      clientSide: true,
      inputSchema: z.object({
        id: z.string(),
        title: z.string().optional(),
        formula: z.string().describe('公式文本，如 R² = 1 − SS_res / SS_tot'),
        description: z.string().optional().describe('公式含义说明'),
      }),
    },
    {
      name: 'renderTimeline',
      description: '在画布上渲染一个过程时间线（步骤/阶段）',
      clientSide: true,
      inputSchema: z.object({
        id: z.string(),
        title: z.string().optional(),
        items: z.array(
          z.object({
            title: z.string(),
            description: z.string().optional(),
            status: z.enum(['done', 'active', 'pending', 'error']).optional(),
            extra: z.string().optional(),
          }),
        ),
      }),
    },
    {
      name: 'renderMarkdown',
      description: '在画布上渲染一段文本/Markdown（结论、说明、报告摘要）',
      clientSide: true,
      inputSchema: z.object({
        id: z.string(),
        title: z.string().optional(),
        content: z.string().describe('Markdown 内容'),
      }),
    },
    {
      name: 'renderAnalysisResult',
      description:
        '把 runSmartAnalysis 的完整返回值一次性渲染成整套视图（核心指标 + 参数影响饼图/柱图 + ' +
        '各参数效应曲线 + 最优参数表 + 分析说明）。调用 runSmartAnalysis 后直接把它返回的 result 传进来即可，' +
        '不要手工拆成多次 renderChart。',
      clientSide: true,
      inputSchema: z.object({
        result: z.record(z.string(), z.any()).describe('runSmartAnalysis 工具返回的完整结果对象'),
        idPrefix: z.string().optional().describe('块 ID 前缀，默认 analysis'),
      }),
    },
    {
      name: 'setCanvasTitle',
      description: '设置画布标题',
      clientSide: true,
      inputSchema: z.object({ title: z.string() }),
    },
    {
      name: 'clearCanvas',
      description: '清空画布（开始新话题或重新分析前调用）',
      clientSide: true,
      inputSchema: z.object({}),
    },
  ],
};
