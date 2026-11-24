/** AI 插件协议
 *
 * 一个「插件」是若干工具的集合，按插件维度整体启停。
 * - builtin：代码内置（报告查询、智能分析、联网、导出等）
 * - declarative：`.data/ai-plugins/*.json` 声明式 HTTP 工具，无需改代码即可扩展
 */
import type { z } from 'zod';

export type PluginSource = 'builtin' | 'declarative';

/** 工具执行上下文 */
export interface AiToolContext {
  /** 发起请求的浏览器 clientId（用于归属隔离） */
  clientId?: string;
}

/** 单个工具定义（与 ai 包的 tool() 解耦，便于单测） */
export interface AiToolSpec {
  name: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  execute: (args: Record<string, unknown>, ctx: AiToolContext) => Promise<unknown>;
  /** 会改变系统状态的写操作：默认需用户确认后才执行（bypass 模式下自动放行） */
  requiresApproval?: boolean;
}

export interface AiPlugin {
  id: string;
  name: string;
  description: string;
  source: PluginSource;
  /** declarative 插件的来源文件名 */
  file?: string;
  tools: AiToolSpec[];
  /** 追加到 system prompt 的说明（可选） */
  promptHint?: string;
}

/** 插件在管理接口里的展示形态（不含执行函数） */
export interface AiPluginSummary {
  id: string;
  name: string;
  description: string;
  source: PluginSource;
  file?: string;
  enabled: boolean;
  toolNames: string[];
  promptHint?: string;
  /** declarative 插件加载失败时的错误信息 */
  error?: string;
}
