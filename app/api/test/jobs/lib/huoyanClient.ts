/** 火眼自动化平台（FE Runner）服务端客户端
 *
 * 只做 HTTP 调用与协议细节，不涉及蓝天任务状态。
 * 线上契约见 http://141.61.5.137:7000/openapi.json：
 *  - 写操作必须带 Idempotency-Key
 *  - 队列编辑是「整体替换 + 不可变前缀」：追加一项也要回传全部旧项（含 item_id）
 *  - 提交分 prepare / commit 两阶段，commit 只回传 preparation_id
 */
import crypto from 'crypto';
import {
  HUOYAN_DEFAULT_BASE_URL,
  type HuoyanArgument,
  type HuoyanBinding,
  type HuoyanDefinition,
  type HuoyanQueue,
  type HuoyanQueueItem,
  type HuoyanRunResult,
  type HuoyanTarget,
} from '../../../../../src/types/huoyan';

export interface HuoyanClientOptions {
  baseUrl?: string;
  clientId?: string;
}

export class HuoyanError extends Error {
  status?: number;
  code?: string;
  details?: unknown;

  constructor(message: string, status?: number, code?: string, details?: unknown) {
    super(message);
    this.name = 'HuoyanError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function resolveBaseUrl(baseUrl?: string): string {
  return (baseUrl || process.env.FE_RUNNER_BASE || HUOYAN_DEFAULT_BASE_URL).replace(/\/+$/, '');
}

function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

/** 统一的请求封装：非 2xx 抛出 HuoyanError（带服务端 code/message） */
async function request<T>(
  options: HuoyanClientOptions,
  method: string,
  path: string,
  body?: unknown,
  opts: { idempotent?: boolean; timeoutMs?: number } = {},
): Promise<T> {
  const baseUrl = resolveBaseUrl(options.baseUrl);
  const headers: Record<string, string> = {
    'X-Fe-Runner-Client-ID': options.clientId || 'blue-sky',
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.idempotent) headers['Idempotency-Key'] = newIdempotencyKey();

  const controller = new AbortController();
  const timeoutMs = opts.timeoutMs ?? 120000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
      cache: 'no-store',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new HuoyanError(`无法连接火眼平台 ${baseUrl}: ${msg}`);
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!res.ok) {
    const envelope = (data || {}) as { code?: string; message?: string; details?: unknown };
    throw new HuoyanError(
      envelope.message || `火眼平台请求失败: HTTP ${res.status}`,
      res.status,
      envelope.code,
      envelope.details ?? data,
    );
  }
  return data as T;
}

/** 获取用例目录（benchmark/suite/plugin 定义与参数 schema） */
export async function fetchCatalog(options: HuoyanClientOptions): Promise<HuoyanDefinition[]> {
  const data = await request<{ definitions?: HuoyanDefinition[] }>(
    options,
    'GET',
    '/api/v1/catalog',
    undefined,
    { timeoutMs: 60000 },
  );
  return data.definitions || [];
}

/** 获取目标机列表 */
export async function fetchTargets(options: HuoyanClientOptions): Promise<HuoyanTarget[]> {
  return request<HuoyanTarget[]>(options, 'GET', '/api/v1/targets', undefined, { timeoutMs: 60000 });
}

/** 获取队列列表（一页取足够多条，蓝天只用 bluesky-queue-000~004） */
export async function fetchQueues(options: HuoyanClientOptions): Promise<HuoyanQueue[]> {
  const data = await request<{ items?: HuoyanQueue[] }>(
    options,
    'GET',
    '/api/v1/queues?page=1&page_size=200',
    undefined,
    { timeoutMs: 60000 },
  );
  return data.items || [];
}

/** 获取单个队列（不带 active_only，编辑必须用未过滤快照） */
export async function fetchQueue(options: HuoyanClientOptions, queueId: string): Promise<HuoyanQueue> {
  return request<HuoyanQueue>(
    options,
    'GET',
    `/api/v1/queues/${encodeURIComponent(queueId)}`,
    undefined,
    { timeoutMs: 60000 },
  );
}

/** 获取一次运行的结果 */
export async function fetchRun(options: HuoyanClientOptions, runId: string): Promise<HuoyanRunResult> {
  return request<HuoyanRunResult>(
    options,
    'GET',
    `/api/v1/runs/${encodeURIComponent(runId)}`,
    undefined,
    { timeoutMs: 60000 },
  );
}

/** 请求取消一次运行 */
export async function cancelRun(options: HuoyanClientOptions, runId: string): Promise<void> {
  await request(
    options,
    'POST',
    `/api/v1/runs/${encodeURIComponent(runId)}/cancel`,
    undefined,
    { idempotent: true, timeoutMs: 60000 },
  );
}

/** 跳过队列中的某一项（未给 itemId 时跳过当前正在跑的那项）
 *
 * 用于用例还在排队/预检、尚未产生 run_id 时中止：此时没有 run 可取消，
 * 只能把队列项标记为 skipped，否则它稍后仍会被平台执行。
 * 注意不要用 /queues/{id}/cancel —— 那会把整个共享队列的排队项都取消。
 */
export async function skipQueueItem(
  options: HuoyanClientOptions,
  queueId: string,
  itemId?: string,
): Promise<void> {
  await request(
    options,
    'POST',
    `/api/v1/queues/${encodeURIComponent(queueId)}/skip`,
    { item_id: itemId || null },
    { idempotent: true, timeoutMs: 60000 },
  );
}

interface QueueCandidateItem {
  item_id?: string | null;
  definition_id: string;
  arguments: HuoyanArgument[];
  bindings: HuoyanBinding[];
  plugins: unknown[];
  comment?: string;
}

/** 把队列快照里的旧条目原样反投影为提交形状（不可变前缀要求逐字段一致） */
function toCandidateItem(item: HuoyanQueueItem): QueueCandidateItem {
  const spec = item.spec || {};
  return {
    item_id: item.item_id,
    definition_id: spec.definition?.definition_id || '',
    arguments: spec.arguments || [],
    bindings: spec.bindings || [],
    plugins: (spec as { plugins?: unknown[] }).plugins || [],
    comment: item.comment || '',
  };
}

export interface AppendQueueItemResult {
  queue: HuoyanQueue;
  itemId: string;
  warnings: Array<{ code: string; message: string }>;
}

/** 往指定队列追加一个用例：prepare → commit（必要时 resume） */
export async function appendQueueItem(
  options: HuoyanClientOptions,
  queueId: string,
  item: {
    definitionId: string;
    arguments: HuoyanArgument[];
    bindings: HuoyanBinding[];
    comment?: string;
  },
): Promise<AppendQueueItemResult> {
  const queue = await fetchQueue(options, queueId);

  const candidate = {
    name: queue.name,
    remark: queue.remark || '',
    scheduled_for: queue.scheduled_for ?? null,
    paused: queue.status === 'paused',
    items: [
      ...queue.items.map(toCandidateItem),
      {
        definition_id: item.definitionId,
        arguments: item.arguments,
        bindings: item.bindings,
        plugins: [],
        comment: item.comment || '',
      },
    ],
  };

  const prepared = await request<{
    preparation_id: string;
    prepared_change: {
      item_ids: string[];
      warnings?: Array<{ code: string; message: string }>;
      warning_digest?: string;
    };
  }>(
    options,
    'POST',
    `/api/v1/queues/${encodeURIComponent(queueId)}/prepare`,
    { candidate, expected_revision: queue.revision, queue_id: queueId },
    { timeoutMs: 300000 },
  );

  const warnings = prepared.prepared_change.warnings || [];
  const committed = await request<HuoyanQueue>(
    options,
    'POST',
    '/api/v1/queues/commit',
    {
      preparation_id: prepared.preparation_id,
      accepted_warning_digest: warnings.length > 0 ? prepared.prepared_change.warning_digest : null,
    },
    { idempotent: true, timeoutMs: 300000 },
  );

  const itemId = prepared.prepared_change.item_ids[prepared.prepared_change.item_ids.length - 1];

  // 队列处于 paused/failed/cancelled/missed 时需要 resume 才会开跑
  if (['paused', 'failed', 'cancelled', 'missed'].includes(committed.status)) {
    await request(
      options,
      'POST',
      `/api/v1/queues/${encodeURIComponent(queueId)}/resume`,
      undefined,
      { idempotent: true, timeoutMs: 60000 },
    );
  }

  return { queue: committed, itemId, warnings };
}
