/** 模型输入裁剪：防止会话历史无限增长撑爆上下文窗口
 *
 * 背景：AI 助手会把整段会话历史回传给模型，工具结果（报告列表、拓扑详情、
 * 任务日志等）单条就可能几十万字符，累积后超过模型 512k 上下文直接报
 * `maximum context length` 错误。
 *
 * 策略（从粗到细）：
 * 1. 单条工具结果/超长文本块截断到上限；
 * 2. 按「用户轮次」分组，从最新往前保留，超出 token 预算的旧轮次整轮丢弃；
 * 3. 丢弃后保证首条不是孤立的 tool 消息（否则 OpenAI 兼容接口会报错）。
 */

/** 单条工具结果保留的最大字符数 */
export const MAX_TOOL_RESULT_CHARS = 4000;
/** 单条普通文本消息保留的最大字符数 */
export const MAX_TEXT_CHARS = 20000;
/** 输入 token 预算（模型上限 512k，留足输出与工具 schema 余量） */
export const MAX_INPUT_TOKENS = 180000;
/** 最多保留的消息条数 */
export const MAX_MESSAGES = 120;

type ContentPart = Record<string, unknown>;
type ChatMessage = { role: string; content: unknown };

/** 粗略 token 估算：中英混排约 2 字符 ≈ 1 token */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 2);
}

function partToText(part: ContentPart): string {
  try {
    return JSON.stringify(part);
  } catch {
    return String(part);
  }
}

/** 截断字符串，保留头尾便于模型理解 */
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = Math.floor(max * 0.7);
  const tail = max - head;
  return `${text.slice(0, head)}\n…（已截断 ${text.length - max} 字符）…\n${text.slice(-tail)}`;
}

/** 裁剪单条消息里的超长内容 */
function trimMessageContent(content: unknown): unknown {
  if (typeof content === 'string') {
    return clip(content, MAX_TEXT_CHARS);
  }
  if (!Array.isArray(content)) return content;

  return content.map((raw) => {
    if (!raw || typeof raw !== 'object') return raw;
    const part = raw as ContentPart;
    // 工具结果：output.value 可能是任意结构
    if (part.type === 'tool-result') {
      const output = part.output as ContentPart | undefined;
      if (output && typeof output === 'object' && 'value' in output) {
        const valueText =
          typeof output.value === 'string' ? output.value : partToText(output.value as ContentPart);
        if (valueText.length > MAX_TOOL_RESULT_CHARS) {
          return {
            ...part,
            output: { ...output, value: clip(valueText, MAX_TOOL_RESULT_CHARS) },
          };
        }
      }
      return part;
    }
    // 文本块
    if (part.type === 'text' && typeof part.text === 'string') {
      return { ...part, text: clip(part.text, MAX_TEXT_CHARS) };
    }
    // 工具调用入参一般不大，但防御性截断
    if (part.type === 'tool-call' && part.input !== undefined) {
      const inputText = partToText(part.input as ContentPart);
      if (inputText.length > MAX_TOOL_RESULT_CHARS) {
        return { ...part, input: { _note: clip(inputText, MAX_TOOL_RESULT_CHARS) } };
      }
      return part;
    }
    return part;
  });
}

/** 单条消息的 token 估算 */
function messageTokens(msg: ChatMessage): number {
  if (typeof msg.content === 'string') return estimateTokens(msg.content);
  if (!Array.isArray(msg.content)) return 0;
  let total = 0;
  for (const part of msg.content) {
    total += estimateTokens(partToText(part as ContentPart));
  }
  return total;
}

/** 按用户轮次分组：每轮以 user 消息开头，包含其后的 assistant/tool 消息 */
function groupByTurns(messages: ChatMessage[]): ChatMessage[][] {
  const turns: ChatMessage[][] = [];
  for (const msg of messages) {
    if (msg.role === 'user' || turns.length === 0) {
      turns.push([msg]);
    } else {
      turns[turns.length - 1].push(msg);
    }
  }
  return turns;
}

/** 从轮次开头裁掉孤立的 tool 消息 / 无配对结果的 tool-call */
function dropDanglingPrefix(turn: ChatMessage[]): ChatMessage[] {
  let start = 0;
  while (start < turn.length && turn[start].role === 'tool') start++;
  return turn.slice(start);
}

/**
 * 清理不成对的工具调用/结果。
 *
 * ai SDK 在请求前会校验：assistant 的每个 tool-call 必须有对应 tool-result，
 * 否则抛 AI_MissingToolResultsError。裁剪（按条数/按轮次）可能把配对拆散，
 * 这里统一兜底：
 * - 丢弃没有结果的 tool-call（正在等待审批的除外，它由 approval-request 关联）
 * - 丢弃没有对应 tool-call 的 tool-result
 * - 丢弃清空后的 tool 消息
 */
function sanitizeToolPairs(messages: ChatMessage[]): ChatMessage[] {
  const callIds = new Set<string>();
  const approvalCallIds = new Set<string>();
  const resultIds = new Set<string>();

  for (const msg of messages) {
    if (!Array.isArray(msg.content)) continue;
    for (const raw of msg.content) {
      if (!raw || typeof raw !== 'object') continue;
      const part = raw as ContentPart;
      const id = typeof part.toolCallId === 'string' ? part.toolCallId : '';
      if (!id) continue;
      if (msg.role === 'assistant') {
        if (part.type === 'tool-call') callIds.add(id);
        if (part.type === 'tool-approval-request') approvalCallIds.add(id);
      } else if (msg.role === 'tool' && part.type === 'tool-result') {
        resultIds.add(id);
      }
    }
  }

  return messages
    .map((msg) => {
      if (!Array.isArray(msg.content)) return msg;
      const filtered = msg.content.filter((raw) => {
        if (!raw || typeof raw !== 'object') return true;
        const part = raw as ContentPart;
        const id = typeof part.toolCallId === 'string' ? part.toolCallId : '';
        if (!id) return true;
        if (msg.role === 'assistant' && part.type === 'tool-call') {
          return resultIds.has(id) || approvalCallIds.has(id);
        }
        if (msg.role === 'assistant' && part.type === 'tool-approval-request') {
          return callIds.has(id);
        }
        if (msg.role === 'tool' && part.type === 'tool-result') {
          return callIds.has(id);
        }
        return true;
      });
      return { ...msg, content: filtered };
    })
    .filter((msg) => {
      if (msg.role === 'tool') return Array.isArray(msg.content) && msg.content.length > 0;
      // 清理后变空的 assistant 内容块会被 OpenAI 兼容接口判为非法消息，直接丢弃
      if (msg.role === 'assistant' && Array.isArray(msg.content)) return msg.content.length > 0;
      return true;
    });
}

/**
 * 裁剪发给模型的消息历史。
 *
 * 返回裁剪后的数组，保证：
 * - 单条工具结果不超过 MAX_TOOL_RESULT_CHARS；
 * - 总 token 不超过 MAX_INPUT_TOKENS；
 * - 首条不是孤立 tool 消息。
 */
export function trimMessagesForModel(messages: ChatMessage[]): {
  messages: ChatMessage[];
  trimmed: boolean;
  droppedTurns: number;
} {
  // 1. 先做单条内容截断
  const clipped = messages.map((m) => ({ ...m, content: trimMessageContent(m.content) }));

  // 2. 条数上限
  let working = clipped;
  if (working.length > MAX_MESSAGES) {
    working = working.slice(-MAX_MESSAGES);
  }

  // 3. 按轮次从后往前累加 token
  const turns = groupByTurns(working);
  const kept: ChatMessage[][] = [];
  let total = 0;
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i];
    const turnTokens = turn.reduce((acc, m) => acc + messageTokens(m), 0);
    // 始终保留最新一轮，即使它本身超预算（至少让模型看到当前问题）
    if (kept.length > 0 && total + turnTokens > MAX_INPUT_TOKENS) break;
    kept.unshift(turn);
    total += turnTokens;
  }

  const keptTurns = kept.length > 0 ? kept : [turns[turns.length - 1] || []];
  let result = keptTurns.flat();
  // 4. 防止首条是孤立 tool 消息
  result = dropDanglingPrefix(result);
  // 5. 清理因裁剪而失配的 tool-call / tool-result（否则 SDK 报 MissingToolResults）
  result = sanitizeToolPairs(result);
  if (result.length === 0 && working.length > 0) {
    result = sanitizeToolPairs(working.slice(-1));
  }

  return {
    messages: result,
    trimmed: result.length !== messages.length || total > MAX_INPUT_TOKENS,
    droppedTurns: turns.length - keptTurns.length,
  };
}
