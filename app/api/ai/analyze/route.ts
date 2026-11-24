import { streamText, tool, isStepCount } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { NextRequest, NextResponse } from 'next/server';
import { buildToolRegistry } from '@/src/server/ai/pluginRegistry';

/** 基础 system prompt；各插件可通过 promptHint 追加能力说明 */
const BASE_SYSTEM_PROMPT =
  '你是蓝天系统的 AI 助手，可以在所有页面协助用户：分析测试报告、查看与设计拓扑、启停监控、编排与查看用例测试任务、联网检索、导出报告。' +
  '请使用中文回答，不要编造数据。如果无法获取数据，请明确说明。' +
  '在思考过程中请简要说明你将使用哪些工具、为什么使用它们，以及你正在做什么。' +
  '当用户需求不明确时，请直接反问用户以澄清需求，而不是猜测。' +
  '涉及会改变系统状态的操作（新建/删除拓扑节点与连线、启停监控、创建/停止测试任务）时，' +
  '必须先把完整方案告知用户并取得明确确认，再调用工具；执行后在回复中说明具体改了什么。' +
  '生成报告后，在回复中提供下载链接，并简要说明报告内容。';

const openai = createOpenAI({
  baseURL: process.env.AI_BASE_URL,
  apiKey: process.env.AI_API_KEY,
});

function sanitizeToolOutput(output: unknown): unknown {
  if (output === null || output === undefined) return output;
  if (typeof output === 'string' || typeof output === 'number' || typeof output === 'boolean') return output;
  if (Array.isArray(output)) {
    const preview = output.slice(0, 50);
    return preview.length === output.length ? output : [...preview, { _note: `共 ${output.length} 项，已截断` }];
  }
  if (typeof output === 'object') {
    const obj = output as Record<string, unknown>;
    const keys = Object.keys(obj);
    const result: Record<string, unknown> = {};
    for (const key of keys.slice(0, 30)) {
      result[key] = sanitizeToolOutput(obj[key]);
    }
    if (keys.length > 30) {
      result._note = `对象共 ${keys.length} 个字段，已截断`;
    }
    return result;
  }
  return String(output);
}

export async function POST(request: NextRequest) {
  try {
    const { messages, clientId } = (await request.json()) as {
      messages: Array<{ role: string; content: string }>;
      clientId?: string;
    };
    const modelName = process.env.AI_MODEL_NAME || 'gpt-4o-mini';

    // 从插件注册中心组装工具表（内置插件 + .data/ai-plugins/*.json）
    const { tools: toolSpecs, promptHints, skipped } = buildToolRegistry();
    if (skipped.length > 0) {
      console.warn('[AI Agent] 部分插件工具被跳过:', skipped);
    }
    // 插件工具的参数 schema 是运行时动态的（zod v4 的 ZodTypeAny / JSON Schema 转换结果），
    // 而 ai SDK 的 tool() 类型签名按固定 schema 推断输入类型，二者无法静态对齐。
    // 这里整体断言为 any，输入校验交给 SDK 运行时完成（schema 仍是真实的 zod 对象）。
    const tools: Record<string, any> = {};
    for (const spec of toolSpecs) {
      // 先把参数对象声明为 any 再传入 tool()：否则 TS 会先按 tool() 的泛型重载
      // 去匹配字面量，动态 schema 推断成 never 后重载全部失败
      const toolOptions: any = {
        description: spec.description,
        inputSchema: spec.inputSchema,
        execute: async (args: Record<string, unknown>) => {
          console.log(`[AI Agent] 工具调用: ${spec.name}`, args);
          try {
            return await spec.execute(args || {}, { clientId });
          } catch (err) {
            const msg = err instanceof Error ? err.message : `${spec.name} 失败`;
            console.error(`[AI Agent] ${spec.name} 错误:`, msg);
            return { error: msg };
          }
        },
      };
      tools[spec.name] = tool(toolOptions);
    }

    const system = [BASE_SYSTEM_PROMPT, ...promptHints].join('\n');

    const result = streamText({
      model: openai.chat(modelName),
      system,
      messages: messages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      stopWhen: isStepCount(5),
      tools,
    });

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (data: unknown) => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        };

        try {
          for await (const part of result.stream) {
            switch (part.type) {
              case 'text-delta':
                send({ type: 'text-delta', text: part.text });
                break;
              case 'tool-call':
                send({
                  type: 'tool-call',
                  toolCall: { toolName: part.toolName, input: part.input, toolCallId: part.toolCallId },
                });
                break;
              case 'tool-result':
                send({
                  type: 'tool-result',
                  toolResult: {
                    toolName: part.toolName,
                    input: part.input,
                    output: sanitizeToolOutput(part.output),
                    toolCallId: part.toolCallId,
                  },
                });
                break;
              case 'tool-error':
                send({
                  type: 'tool-error',
                  toolError: {
                    toolName: part.toolName,
                    input: part.input,
                    error: String(part.error),
                    toolCallId: part.toolCallId,
                  },
                });
                break;
              case 'finish-step':
                send({
                  type: 'step-finish',
                  finishReason: (part as { finishReason?: string }).finishReason,
                });
                break;
              case 'error':
                send({ type: 'error', error: String((part as { error?: unknown }).error) });
                break;
              default:
                // 其他事件如 start/finish/reasoning 等暂不推送
                break;
            }
          }
          send({ type: 'done' });
        } catch (err) {
          send({ type: 'error', error: err instanceof Error ? err.message : '流式处理异常' });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'AI 分析服务异常';
    console.error('[AI Analyze] Error:', msg);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
