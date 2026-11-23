/**
 * AI 分析助手会话的服务端存储
 *
 * 结构：`.data/ai-sessions.json` → `{ [clientId]: AiChatSession[] }`
 * 按浏览器 clientId 隔离（无登录体系下的归属方案），同一浏览器刷新/换设备
 * （换浏览器则 clientId 不同）后可恢复历史会话。
 *
 * 写入采用「整文件原子写」：会话数量与单条消息量都受上限约束，
 * 文件规模可控（见 MAX_SESSIONS / MAX_MESSAGES）。
 */
import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), '.data');
const SESSIONS_FILE = path.join(DATA_DIR, 'ai-sessions.json');

/** 每个 clientId 最多保留的会话数（超出丢弃最旧的） */
const MAX_SESSIONS = 50;
/** 单个会话最多保留的消息数（超出丢弃最早的） */
const MAX_MESSAGES = 200;

export interface AiChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: Array<{ name: string; args?: Record<string, unknown> }>;
  toolResults?: Array<{ name: string; result?: unknown; error?: string }>;
  steps?: Array<{ stepCount: number; finishReason?: string }>;
  logs?: unknown[];
  attachments?: Array<{ type: 'excel' | 'ppt'; url: string; fileName: string }>;
  error?: string;
}

export interface AiChatSession {
  id: string;
  title: string;
  messages: AiChatMessage[];
  createdAt: number;
  updatedAt: number;
}

type SessionMap = Record<string, AiChatSession[]>;

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadAll(): SessionMap {
  try {
    if (!fs.existsSync(SESSIONS_FILE)) return {};
    const raw = fs.readFileSync(SESSIONS_FILE, 'utf-8');
    if (!raw.trim()) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as SessionMap) : {};
  } catch (err) {
    console.error('[AI Sessions] 读取失败:', err);
    return {};
  }
}

function saveAll(map: SessionMap) {
  ensureDir();
  // 原子写：先写临时文件再 rename，避免写到一半留下损坏文件
  const tmp = `${SESSIONS_FILE}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(map));
  fs.renameSync(tmp, SESSIONS_FILE);
}

/** 规整单个会话：剔除流式态标记、限制消息条数 */
function normalizeSession(input: AiChatSession): AiChatSession {
  const messages = Array.isArray(input.messages) ? input.messages : [];
  const trimmed = messages.length > MAX_MESSAGES ? messages.slice(-MAX_MESSAGES) : messages;
  return {
    id: String(input.id),
    title: typeof input.title === 'string' && input.title ? input.title : '新会话',
    messages: trimmed.map((m) => {
      // loading 是前端流式渲染态，不落库
      const { ...rest } = m as AiChatMessage & { loading?: boolean };
      delete (rest as { loading?: boolean }).loading;
      return rest;
    }),
    createdAt: Number(input.createdAt) || Date.now(),
    updatedAt: Number(input.updatedAt) || Date.now(),
  };
}

/** 读取某个 clientId 的会话列表（按更新时间倒序） */
export function loadSessions(clientId: string): AiChatSession[] {
  if (!clientId) return [];
  const all = loadAll();
  const list = Array.isArray(all[clientId]) ? all[clientId] : [];
  return [...list].sort((a, b) => b.updatedAt - a.updatedAt);
}

/** 新增或更新单个会话 */
export function upsertSession(clientId: string, session: AiChatSession): AiChatSession[] {
  if (!clientId || !session?.id) return loadSessions(clientId);
  const all = loadAll();
  const list = Array.isArray(all[clientId]) ? [...all[clientId]] : [];
  const normalized = normalizeSession(session);
  const idx = list.findIndex((s) => s.id === normalized.id);
  if (idx === -1) {
    list.push(normalized);
  } else {
    list[idx] = normalized;
  }
  // 超出上限时丢弃最旧的
  const trimmed =
    list.length > MAX_SESSIONS
      ? [...list].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_SESSIONS)
      : list;
  all[clientId] = trimmed;
  saveAll(all);
  return [...trimmed].sort((a, b) => b.updatedAt - a.updatedAt);
}

/** 删除单个会话 */
export function deleteSession(clientId: string, sessionId: string): AiChatSession[] {
  if (!clientId || !sessionId) return loadSessions(clientId);
  const all = loadAll();
  const list = Array.isArray(all[clientId]) ? all[clientId] : [];
  all[clientId] = list.filter((s) => s.id !== sessionId);
  saveAll(all);
  return [...all[clientId]].sort((a, b) => b.updatedAt - a.updatedAt);
}
