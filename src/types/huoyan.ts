/** 火眼自动化平台（FE Runner）对接类型 - 前后端共用 */

/** 火眼平台默认服务地址 */
export const HUOYAN_DEFAULT_BASE_URL = 'http://141.61.5.137:7000';

/** 蓝天系统独占的火眼队列 */
export const HUOYAN_QUEUE_IDS = [
  'bluesky-queue-000',
  'bluesky-queue-001',
  'bluesky-queue-002',
  'bluesky-queue-003',
  'bluesky-queue-004',
] as const;

export interface HuoyanArgument {
  name: string;
  value: string | number | boolean | Array<string | number | boolean | null> | null;
}

export interface HuoyanBinding {
  role: string;
  target_name: string;
}

/** 任务配置中的火眼执行参数 */
export interface HuoyanJobConfig {
  /** 火眼平台地址，缺省使用 HUOYAN_DEFAULT_BASE_URL */
  baseUrl?: string;
  /** 目标队列 ID（bluesky-queue-000 ~ 004） */
  queueId: string;
  /** 用例定义 ID（来自 /api/v1/catalog） */
  definitionId: string;
  /** 用例显示名（仅用于日志/结果标签） */
  definitionName?: string;
  /** 用例参数 */
  arguments: HuoyanArgument[];
  /** 角色绑定（如 target -> 137） */
  bindings: HuoyanBinding[];
  /** 手动超时时间（小时），缺省 12 小时；超时后按失败处理并尝试取消火眼运行 */
  timeoutHours?: number;
}

/** 火眼任务默认超时（小时） */
export const HUOYAN_DEFAULT_TIMEOUT_HOURS = 12;

/** 解析火眼超时（小时）为毫秒；非法/未设置时回退默认 12 小时 */
export function resolveHuoyanTimeoutMs(timeoutHours?: number | null): number {
  const hours =
    typeof timeoutHours === 'number' && Number.isFinite(timeoutHours) && timeoutHours > 0
      ? timeoutHours
      : HUOYAN_DEFAULT_TIMEOUT_HOURS;
  return hours * 60 * 60 * 1000;
}

/** 火眼任务运行态（服务端回写） */
export interface HuoyanRunState {
  queueId: string;
  itemId?: string;
  runId?: string;
  itemStatus?: string;
  runStatus?: string;
  metrics?: Record<string, number>;
  error?: string;
  updatedAt?: string;
}

/** 火眼目录中的参数定义 */
export interface HuoyanParameterSchema {
  name: string;
  type_name: string;
  required: boolean;
  default?: unknown;
  has_default?: boolean;
  description?: string | null;
  choices?: Array<string | number | boolean | null> | null;
  collection_kind?: 'list' | 'ordered_set' | null;
  scalar_types?: string[];
}

/** 火眼目录中的用例/套件/插件定义 */
export interface HuoyanDefinition {
  definition_id: string;
  kind: 'benchmark' | 'suite' | 'plugin';
  name: string;
  description?: string;
  category?: string | null;
  roles: string[];
  parameters: HuoyanParameterSchema[];
  presets?: Array<{ name: string; description?: string; parameters?: HuoyanParameterSchema[] }>;
}

export interface HuoyanTarget {
  name: string;
  model?: string;
  connectivity?: string;
  activity?: string;
}

export interface HuoyanQueueItem {
  item_id: string;
  position: number;
  status: string;
  run_id?: string | null;
  comment?: string;
  spec?: {
    definition?: { definition_id?: string; name?: string };
    arguments?: HuoyanArgument[];
    bindings?: HuoyanBinding[];
    plugins?: unknown[];
  };
}

export interface HuoyanQueue {
  queue_id: string;
  name: string;
  revision: number;
  status: string;
  remark?: string;
  scheduled_for?: string | null;
  items: HuoyanQueueItem[];
}

export interface HuoyanRunResult {
  run_id: string;
  spec_id?: string;
  status: string;
  metrics?: Record<string, number>;
  error?: string | null;
  failures?: Array<{ phase?: string; owner?: string; message?: string }>;
}
