/** UI 操控插件：让 AI 直接驱动前端界面
 *
 * 这些工具全部是「客户端工具」（clientSide: true）——服务端只声明 schema，
 * 不提供 execute。模型调用后本轮暂停，SSE 把 tool-call 推给前端；
 * 前端执行真实 UI 动作（跳转/切页/切换拓扑/选中报告/高亮配置/填表单），
 * 再把 tool-result 回传续跑，模型据此继续对话。
 *
 * 只包含「界面层」动作，不直接改服务端数据；需要改数据的仍走对应业务插件。
 */
import { z } from 'zod';
import type { AiPlugin } from './pluginTypes';

/** 已知页面路径，供模型选择 */
const PAGE_ROUTES = [
  { path: '/', label: '拓扑监控' },
  { path: '/design', label: '拓扑设计' },
  { path: '/efficiency', label: '效率分析' },
  { path: '/test', label: '用例测试' },
  { path: '/test/jobs', label: '任务中心' },
  { path: '/optimize', label: '自动寻优' },
  { path: '/analysis', label: '数据分析' },
] as const;

export const uiPlugin: AiPlugin = {
  id: 'core.ui-control',
  name: '界面操控',
  description: '切换页面、切换拓扑、选中报告、高亮配置项、填写表单',
  source: 'builtin',
  promptHint:
    '你可以直接操控界面：用户说「打开/切到某页」「切换到某个拓扑」「选中某份报告」' +
    '「高亮/定位某个配置」「帮我填好某个配置」时，直接调用对应界面工具，不要只给文字说明。' +
    '用户想「实时看建模过程/可视化分析/动态演示」时，调用 startLiveAnalysis 打开实时建模控制台，' +
    '不要在文字里罗列结果——界面会逐阶段渲染。' +
    `可用页面：${PAGE_ROUTES.map((r) => `${r.label}=${r.path}`).join('、')}。`,
  tools: [
    {
      name: 'navigateTo',
      description:
        `切换页面。可用路径：${PAGE_ROUTES.map((r) => `${r.path}（${r.label}）`).join('、')}`,
      clientSide: true,
      inputSchema: z.object({
        path: z.string().describe('目标页面路径，如 /design、/test/jobs'),
      }),
    },
    {
      name: 'switchTopology',
      description:
        '切换当前拓扑（拓扑监控/设计页生效）。可先用 listTopologies 获取拓扑 ID',
      clientSide: true,
      inputSchema: z.object({
        topologyId: z.string().describe('拓扑 ID'),
      }),
    },
    {
      name: 'selectReport',
      description:
        '在数据分析页选中一份或多份报告（会同步给 AI 作为上下文）。可先用 listReports 获取报告 ID',
      clientSide: true,
      inputSchema: z.object({
        reportIds: z.array(z.string()).describe('报告 ID 列表'),
      }),
    },
    {
      name: 'highlightField',
      description:
        '高亮并滚动定位到页面上的某个配置区域，用于告诉用户「配置在哪」。' +
        'fieldKey 是页面配置区的标识，如 iteration（迭代参数）、monitor（监控命令）、advanced（高级配置）',
      clientSide: true,
      inputSchema: z.object({
        fieldKeys: z.array(z.string()).describe('要高亮的配置区标识列表'),
      }),
    },
    {
      name: 'switchTestTab',
      description: '切换用例测试页的标签页（多标签并行测试时使用）',
      clientSide: true,
      inputSchema: z.object({
        tabId: z.string().optional().describe('目标标签页 ID，缺省切到第一个'),
        tabName: z.string().optional().describe('按名称匹配标签页（tabId 优先）'),
      }),
    },
    {
      name: 'openPanel',
      description: '打开页面上的弹窗/抽屉，如用例包库、报告管理',
      clientSide: true,
      inputSchema: z.object({
        panel: z.enum(['packageLibrary', 'reportManager']).describe('要打开的面板'),
      }),
    },
    {
      name: 'startLiveAnalysis',
      description:
        '在数据分析页启动「AI 实时建模」：会跳转到数据分析页，并逐阶段实时渲染建模过程' +
        '（数据准备→特征编码→模型选择→训练→R²评估→SHAP归因→最优点搜索→参数效应→瀑布分解）。' +
        '用户说「实时分析/动态演示/看着你建模/可视化分析某报告」时使用。',
      clientSide: true,
      inputSchema: z.object({
        reportId: z.string().describe('要分析的测试报告 ID，可先用 listReports 获取'),
        target: z.string().optional().describe('分析目标，默认 score；命名分数用 score:<名称>，监控指标用其 id'),
        direction: z.enum(['max', 'min']).optional().describe('优化方向，默认 max'),
        rank: z.number().int().min(0).max(2).optional().describe('取第几优，默认 0（最优）'),
      }),
    },
  ],
};
