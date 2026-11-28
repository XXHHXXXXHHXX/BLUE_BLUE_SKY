/** 模型服务 provider
 *
 * 为什么需要自定义 fetch：
 * Node 内置 fetch（undici）默认 headersTimeout = 300s。共享 vLLM 在负载高时
 * 可能排队数分钟才返回响应头，超时后 AI SDK 会按 isRetryable 重试 2 次，
 * 最终抛出 `Cannot connect to API: Headers Timeout Error`。
 * 这里换成长超时的 undici Agent：等响应头最多 10 分钟，流式 body 不设超时。
 */
import { createOpenAI } from '@ai-sdk/openai';
import { Agent, fetch as undiciFetch } from 'undici';

/** 等待模型返回响应头的上限（共享推理服务排队可能很久） */
const HEADERS_TIMEOUT_MS = 10 * 60 * 1000;
/** 建连上限 */
const CONNECT_TIMEOUT_MS = 30 * 1000;

const agent = new Agent({
  headersTimeout: HEADERS_TIMEOUT_MS,
  connectTimeout: CONNECT_TIMEOUT_MS,
  // 流式响应可能持续很久，body 不设超时（由上层 abort 控制）
  bodyTimeout: 0,
});

/** 供 AI SDK 使用的 fetch：强制走长超时 Agent */
const aiFetch = ((input: Parameters<typeof undiciFetch>[0], init?: Parameters<typeof undiciFetch>[1]) =>
  undiciFetch(input, { ...init, dispatcher: agent })) as unknown as typeof globalThis.fetch;

export const aiProvider = createOpenAI({
  baseURL: process.env.AI_BASE_URL,
  apiKey: process.env.AI_API_KEY,
  fetch: aiFetch,
});
