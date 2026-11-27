'use client';

import React, { useMemo, useRef, useEffect, useState, useCallback } from 'react';
import { Drawer, Input, Button, Space, FloatButton, List, Card, Typography, Tag, Collapse, Alert, Tooltip } from 'antd';
import { RobotOutlined, SendOutlined, EyeOutlined, EyeInvisibleOutlined, FolderOpenOutlined, FileExcelOutlined, FilePptOutlined, PlusOutlined, DeleteOutlined, ApiOutlined } from '@ant-design/icons';
import { useTestReportStore, type TestReport } from '../../stores/testReportStore';
import ReactMarkdown from 'react-markdown';
import ReportPicker from './ReportPicker';
import AIPluginPanel from './AIPluginPanel';
import { getClientId } from '../../utils/clientId';
import { useAiContextStore } from '../../stores/aiContextStore';
import { useRouter } from 'next/navigation';
import { executeUiAction } from '../../utils/aiUiActions';
import { trimMessagesForModel } from '../../server/ai/messageTrim';

const { Text } = Typography;
const { Panel } = Collapse;

type MessageRole = 'user' | 'assistant';

interface ToolCallInfo {
  name: string;
  args?: Record<string, unknown>;
}

interface ToolResultInfo {
  name: string;
  result?: unknown;
  found?: boolean;
  success?: boolean;
  count?: number;
  error?: string;
}

interface StepInfo {
  stepCount: number;
  finishReason?: string;
  text?: string;
  toolCalls?: ToolCallInfo[];
  toolResults?: { name: string }[];
}

interface LogEntry {
  type: string;
  step?: number;
  detail: unknown;
}

interface Attachment {
  type: 'excel' | 'ppt';
  url: string;
  fileName: string;
}

/** 待用户确认的写操作 */
interface PendingApproval {
  approvalId: string;
  toolCallId: string;
  toolName: string;
  input: unknown;
  reason?: string;
}

/** 回传给模型的内容块（assistant 的 tool-call / tool-approval-request） */
type RawContentPart =
  | { type: 'text'; text: string }
  | { type: 'tool-call'; toolCallId: string; toolName: string; input: unknown }
  | { type: 'tool-approval-request'; approvalId: string; toolCallId: string };

interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  loading?: boolean;
  toolCalls?: ToolCallInfo[];
  toolResults?: ToolResultInfo[];
  steps?: StepInfo[];
  logs?: LogEntry[];
  attachments?: Attachment[];
  error?: string;
  /** 本轮发给模型的消息（审批续跑时作为历史前缀） */
  apiMessages?: Array<{ role: string; content: unknown }>;
  /** 本轮 assistant 产生的内容块（审批续跑时回传） */
  rawParts?: RawContentPart[];
  /** 等待用户确认的写操作 */
  pendingApprovals?: PendingApproval[];
}

interface AIResponse {
  success: boolean;
  response?: string;
  error?: string;
}

type StreamEvent =
  | { type: 'text-delta'; text: string }
  | {
      type: 'tool-call';
      toolCall: { toolName: string; input: unknown; toolCallId?: string; clientSide?: boolean };
    }
  | { type: 'tool-result'; toolResult: { toolName: string; output: unknown; toolCallId?: string } }
  | { type: 'tool-error'; toolError: { toolName: string; error: string; toolCallId?: string } }
  | {
      type: 'tool-approval-request';
      approval: {
        approvalId: string;
        toolCallId: string;
        toolName?: string;
        input?: unknown;
        reason?: string;
        isAutomatic?: boolean;
      };
    }
  | { type: 'step-finish'; finishReason?: string }
  | { type: 'error'; error: string }
  | { type: 'done' };

interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

/** 恢复单条消息：清理流式态，并校验待审批是否仍可续跑
 *
 * 续跑需要 apiMessages + rawParts（含 tool-call 与 approval-request）。
 * 缺任一项时该审批无法回传，降级为提示文案，避免用户点了「允许」却报错。
 */
function restoreMessage(m: ChatMessage): ChatMessage {
  const restored: ChatMessage = { ...m, loading: false };
  const pending = restored.pendingApprovals;
  if (!pending || pending.length === 0) return restored;

  const hasToolCall = (restored.rawParts || []).some((p) => p.type === 'tool-call');
  const hasRequest = (restored.rawParts || []).some((p) => p.type === 'tool-approval-request');
  const resumable = hasToolCall && hasRequest && (restored.apiMessages?.length ?? 0) > 0;
  if (resumable) return restored;

  const names = pending.map((p) => p.toolName).join('、');
  const notice = `（上次会话中断，未完成的确认已失效：${names}。如需执行请重新发起请求。）`;
  return {
    ...restored,
    pendingApprovals: [],
    content: restored.content ? `${restored.content}\n\n${notice}` : notice,
  };
}

function createSession(): ChatSession {
  return {
    id: `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: '新会话',
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

interface AIAnalysisAssistantProps {
  selectedReportId?: string;
  selectedReportIds?: string[];
  /** 当前页面路径，仅用于在提示中说明所处页面 */
  pageContext?: string;
}

const AIAnalysisAssistant: React.FC<AIAnalysisAssistantProps> = ({
  selectedReportId,
  selectedReportIds: externalSelectedReportIds,
  pageContext,
}) => {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState<ChatSession[]>(() => [createSession()]);
  const [activeSessionId, setActiveSessionId] = useState<string>(sessions[0].id);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showTrace, setShowTrace] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pluginPanelOpen, setPluginPanelOpen] = useState(false);
  /** bypass 模式：跳过写操作确认，权限完全交给 AI（保存在本浏览器） */
  const [bypass, setBypass] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem('blue_sky_ai_bypass') === '1';
  });
  const [selectedReportIds, setSelectedReportIds] = useState<string[]>(
    externalSelectedReportIds ?? (selectedReportId ? [selectedReportId] : [])
  );
  const listRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  /** 服务端会话持久化：浏览器 clientId + 保存防抖定时器 */
  const clientIdRef = useRef<string>('');
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 待保存的会话（防抖被冲刷时使用最新值，避免闭包过期） */
  const pendingSaveRef = useRef<ChatSession | null>(null);
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const { reports, fetchReports } = useTestReportStore();
  /** 页面写入的选中报告（全局挂载后不再由 props 传递） */
  const contextReportIds = useAiContextStore((s) => s.selectedReportIds);
  /** 页面写入的当前拓扑（拓扑监控/设计页） */
  const contextTopologyId = useAiContextStore((s) => s.selectedTopologyId);

  // 页面选中报告变化时同步到本地选择（用户也可在抽屉内自行改选）
  useEffect(() => {
    if (contextReportIds.length > 0) {
      setSelectedReportIds(contextReportIds);
    }
  }, [contextReportIds]);

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) || sessions[0] || createSession(),
    [sessions, activeSessionId]
  );
  const messages = useMemo(() => activeSession?.messages || [], [activeSession]);

  const setMessages = useCallback(
    (updater: React.SetStateAction<ChatMessage[]>) => {
      setSessions((prev) => {
        const idx = prev.findIndex((s) => s.id === activeSessionId);
        if (idx === -1) return prev;
        const next = [...prev];
        const currentMessages = next[idx].messages;
        const newMessages = typeof updater === 'function' ? (updater as (prev: ChatMessage[]) => ChatMessage[])(currentMessages) : updater;
        let title = next[idx].title;
        if (title === '新会话') {
          const firstUser = newMessages.find((m) => m.role === 'user');
          if (firstUser?.content) {
            title = firstUser.content.slice(0, 20) + (firstUser.content.length > 20 ? '…' : '');
          }
        }
        next[idx] = { ...next[idx], messages: newMessages, title, updatedAt: Date.now() };
        return next;
      });
    },
    [activeSessionId]
  );

  useEffect(() => {
    if (open) {
      fetchReports();
    }
  }, [open, fetchReports]);

  /** 首次打开抽屉时从服务端拉取该浏览器的历史会话 */
  useEffect(() => {
    if (!open || sessionsLoaded) return;
    const clientId = getClientId();
    clientIdRef.current = clientId;
    if (!clientId) {
      setSessionsLoaded(true);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/ai/sessions', {
          headers: { 'x-client-id': clientId },
        });
        const data = (await res.json()) as { success?: boolean; sessions?: ChatSession[] };
        if (cancelled) return;
        if (data.success && Array.isArray(data.sessions) && data.sessions.length > 0) {
          const restored = data.sessions.map((s) => ({
            ...s,
            // 流式态不落库，恢复时统一置为已完成
            messages: (s.messages || []).map((m) => restoreMessage(m)),
          }));
          setSessions(restored);
          setActiveSessionId(restored[0].id);
        }
      } catch (err) {
        console.error('加载 AI 会话失败:', err);
      } finally {
        if (!cancelled) setSessionsLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, sessionsLoaded]);

  /** 立即把会话写入服务端（供防抖到期、审批出现、页面隐藏时调用） */
  const flushSave = useCallback((session: ChatSession | null) => {
    if (!session) return;
    const clientId = clientIdRef.current || getClientId();
    if (!clientId) return;
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    pendingSaveRef.current = null;
    // 流式中的 loading 标记不落库；
    // apiMessages/rawParts 仅用于「待审批续跑」，没有待审批的消息不落库，
    // 否则每条 assistant 都存一份完整历史，会话体积按 O(n²) 膨胀。
    const payload = {
      ...session,
      messages: session.messages.map((m) => {
        const copy = { ...m };
        delete copy.loading;
        if (!copy.pendingApprovals || copy.pendingApprovals.length === 0) {
          delete copy.apiMessages;
          delete copy.rawParts;
        }
        return copy;
      }),
    };
    fetch('/api/ai/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-client-id': clientId },
      body: JSON.stringify({ session: payload }),
      // 页面正在卸载时也要尽量送达
      keepalive: true,
    }).catch((err) => console.error('保存 AI 会话失败:', err));
  }, []);

  /** 会话变化后防抖保存当前会话到服务端 */
  useEffect(() => {
    if (!sessionsLoaded) return;
    const clientId = clientIdRef.current || getClientId();
    if (!clientId) return;
    const session = sessions.find((s) => s.id === activeSessionId);
    if (!session) return;
    // 全新的空会话不落库，避免服务端堆积空壳
    if (session.messages.length === 0 && session.title === '新会话') return;
    pendingSaveRef.current = session;
    // 有待确认的审批时立即保存：刷新后仍能继续处理，不能被防抖吞掉
    const hasPendingApproval = session.messages.some(
      (m) => (m.pendingApprovals?.length ?? 0) > 0,
    );
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    if (hasPendingApproval) {
      flushSave(session);
      return;
    }
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      flushSave(pendingSaveRef.current);
    }, 800);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [sessions, activeSessionId, sessionsLoaded, flushSave]);

  /** 页面隐藏/卸载前冲刷未保存的会话，避免审批卡片丢失 */
  useEffect(() => {
    const handleFlush = () => {
      if (pendingSaveRef.current) flushSave(pendingSaveRef.current);
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') handleFlush();
    };
    window.addEventListener('pagehide', handleFlush);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('pagehide', handleFlush);
      document.removeEventListener('visibilitychange', handleVisibility);
      handleFlush();
    };
  }, [flushSave]);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  // bypass 开关持久化到本浏览器
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('blue_sky_ai_bypass', bypass ? '1' : '0');
  }, [bypass]);

  useEffect(() => {
    // 仅在显式传入 props 时覆盖；全局挂载下选择由 aiContextStore 驱动
    if (externalSelectedReportIds || selectedReportId) {
      setSelectedReportIds(externalSelectedReportIds ?? (selectedReportId ? [selectedReportId] : []));
    }
  }, [externalSelectedReportIds, selectedReportId]);

  const selectedReports = useMemo(
    () => selectedReportIds.map((id) => reports.find((r) => r.id === id)).filter(Boolean) as TestReport[],
    [selectedReportIds, reports]
  );

  const handleNewSession = useCallback(() => {
    if (activeSession && activeSession.messages.length === 0 && activeSession.title === '新会话') {
      return;
    }
    const newSession = createSession();
    setSessions((prev) => [...prev, newSession]);
    setActiveSessionId(newSession.id);
  }, [activeSession]);

  const handleSwitchSession = useCallback(
    (id: string) => {
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
      setIsLoading(false);
      setActiveSessionId(id);
    },
    []
  );

  const handleDeleteSession = useCallback(
    (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      const clientId = clientIdRef.current || getClientId();
      if (clientId) {
        fetch(`/api/ai/sessions?clientId=${encodeURIComponent(clientId)}&sessionId=${encodeURIComponent(id)}`, {
          method: 'DELETE',
        }).catch((err) => console.error('删除 AI 会话失败:', err));
      }
      setSessions((prev) => {
        let next = prev.filter((s) => s.id !== id);
        if (next.length === 0) {
          const empty = createSession();
          next = [empty];
          setActiveSessionId(empty.id);
        } else if (activeSessionId === id) {
          setActiveSessionId(next[0].id);
        }
        return next;
      });
    },
    [activeSessionId]
  );

  const selectedReportsHint = useMemo(() => {
    if (selectedReports.length === 0) return '';
    if (selectedReports.length === 1) return `当前选中报告: ${selectedReports[0].name}`;
    return `当前选中 ${selectedReports.length} 份报告: ${selectedReports.map((r) => r.name).join('、')}`;
  }, [selectedReports]);

  /** runStream 自身引用（用于客户端工具执行后递归续跑） */
  const runStreamRef = useRef<
    ((messages: Array<{ role: string; content: unknown }>, assistantId: string, depth?: number) => Promise<void>) | null
  >(null);
  /** 客户端工具续跑最大轮数，防止模型反复调界面工具导致无限递归 */
  const MAX_UI_CONTINUATIONS = 3;

  /** 发起一次流式对话；requestMessages 是完整的模型消息历史 */
  const runStream = useCallback(
    async (requestMessages: Array<{ role: string; content: unknown }>, assistantId: string, depth = 0) => {
      setIsLoading(true);
      const controller = new AbortController();
      abortRef.current = controller;

      /** 本轮出现的客户端工具调用（流结束后由前端执行并续跑） */
      const clientCalls: Array<{ toolCallId: string; toolName: string; input: unknown }> = [];
      /** 本轮 assistant 内容块（本地累积，避免异步读 state 拿到旧值） */
      const localParts: RawContentPart[] = [];

      const updateAssistant = (updater: (msg: ChatMessage) => ChatMessage) => {
        setMessages((prev) => {
          const next = [...prev];
          const idx = next.findIndex((m) => m.id === assistantId);
          if (idx !== -1) next[idx] = updater(next[idx]);
          return next;
        });
      };

      const handleStreamEvent = (event: StreamEvent) => {
        switch (event.type) {
          case 'text-delta':
            localParts.push({ type: 'text', text: event.text });
            updateAssistant((msg) => ({
              ...msg,
              content: msg.content + event.text,
              rawParts: [...(msg.rawParts || []), { type: 'text', text: event.text }],
            }));
            break;
          case 'tool-call':
            if (event.toolCall.clientSide && event.toolCall.toolCallId) {
              clientCalls.push({
                toolCallId: event.toolCall.toolCallId,
                toolName: event.toolCall.toolName,
                input: event.toolCall.input,
              });
            }
            localParts.push({
              type: 'tool-call',
              toolCallId: event.toolCall.toolCallId || '',
              toolName: event.toolCall.toolName,
              input: event.toolCall.input,
            });
            updateAssistant((msg) => ({
              ...msg,
              toolCalls: [
                ...(msg.toolCalls || []),
                { name: event.toolCall.toolName, args: (event.toolCall.input as Record<string, unknown>) || {} },
              ],
              rawParts: [
                ...(msg.rawParts || []),
                {
                  type: 'tool-call',
                  toolCallId: event.toolCall.toolCallId || '',
                  toolName: event.toolCall.toolName,
                  input: event.toolCall.input,
                },
              ],
            }));
            break;
          case 'tool-approval-request':
            updateAssistant((msg) => ({
              ...msg,
              rawParts: [
                ...(msg.rawParts || []),
                {
                  type: 'tool-approval-request',
                  approvalId: event.approval.approvalId,
                  toolCallId: event.approval.toolCallId,
                },
              ],
              pendingApprovals: [
                ...(msg.pendingApprovals || []),
                {
                  approvalId: event.approval.approvalId,
                  toolCallId: event.approval.toolCallId,
                  toolName: event.approval.toolName || '未知工具',
                  input: event.approval.input,
                  reason: event.approval.reason,
                },
              ],
            }));
            break;
          case 'tool-result': {
            const result = event.toolResult.output as { url?: string; fileName?: string; error?: string } | undefined;
            const attachmentType =
              event.toolResult.toolName === 'generateExcelReport'
                ? 'excel'
                : event.toolResult.toolName === 'generatePPTReport'
                  ? 'ppt'
                  : null;
            updateAssistant((msg) => ({
              ...msg,
              toolResults: [
                ...(msg.toolResults || []),
                { name: event.toolResult.toolName, result: event.toolResult.output },
              ],
              attachments:
                attachmentType && result?.url
                  ? [...(msg.attachments || []), { type: attachmentType, url: result.url, fileName: result.fileName || '未命名' }]
                  : msg.attachments,
            }));
            break;
          }
          case 'tool-error':
            updateAssistant((msg) => ({
              ...msg,
              toolResults: [
                ...(msg.toolResults || []),
                { name: event.toolError.toolName, error: event.toolError.error },
              ],
            }));
            break;
          case 'step-finish':
            updateAssistant((msg) => ({
              ...msg,
              steps: [
                ...(msg.steps || []),
                { stepCount: (msg.steps?.length || 0) + 1, finishReason: event.finishReason },
              ],
            }));
            break;
          case 'error':
            updateAssistant((msg) => ({ ...msg, error: event.error, loading: false }));
            break;
          case 'done':
            updateAssistant((msg) => ({ ...msg, loading: false }));
            break;
        }
      };

      try {
        const res = await fetch('/api/ai/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: requestMessages,
            clientId: clientIdRef.current || getClientId(),
            bypass,
          }),
          signal: controller.signal,
        });

        if (!res.ok) {
          const data = (await res.json()) as AIResponse;
          throw new Error(data.error || `请求失败 ${res.status}`);
        }

        const reader = res.body?.getReader();
        if (!reader) throw new Error('响应流不可用');

        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const payload = line.slice(6);
            if (!payload) continue;
            try {
              handleStreamEvent(JSON.parse(payload) as StreamEvent);
            } catch (e) {
              console.error('解析 SSE 事件失败:', payload, e);
            }
          }
        }

        if (buffer.startsWith('data: ')) {
          const payload = buffer.slice(6);
          if (payload) {
            try {
              handleStreamEvent(JSON.parse(payload) as StreamEvent);
            } catch (e) {
              console.error('解析 SSE 事件失败:', payload, e);
            }
          }
        }

        updateAssistant((msg) => ({ ...msg, loading: false }));

        // 本轮有客户端工具调用：前端执行真实 UI 动作，再把结果回传续跑
        if (clientCalls.length > 0 && depth >= MAX_UI_CONTINUATIONS) {
          updateAssistant((msg) => ({
            ...msg,
            error: '界面操作次数过多已停止，请确认需求后重新提问',
          }));
        } else if (clientCalls.length > 0) {
          const rawParts = localParts;
          const results: Array<{ toolCallId: string; toolName: string; output: unknown }> = [];
          for (const call of clientCalls) {
            let output: unknown;
            try {
              output = await executeUiAction(
                call.toolName,
                (call.input as Record<string, unknown>) || {},
                {
                  navigate: (path) => router.push(path),
                  pathname: pageContext || (typeof window !== 'undefined' ? window.location.pathname : '/'),
                  openPanel: (panel) => {
                    // 通过 aiContextStore 广播，由 AppLayout 打开对应弹窗
                    useAiContextStore.getState().requestOpenPanel(panel);
                  },
                },
              );
            } catch (e) {
              output = { ok: false, message: e instanceof Error ? e.message : '界面操作失败' };
            }
            results.push({ toolCallId: call.toolCallId, toolName: call.toolName, output });
          }

          // 拼装续跑消息：历史 + assistant(含 tool-call) + tool(tool-result)
          const followUp = [
            ...requestMessages,
            { role: 'assistant', content: rawParts },
            {
              role: 'tool',
              content: results.map((r) => ({
                type: 'tool-result',
                toolCallId: r.toolCallId,
                toolName: r.toolName,
                output: { type: 'json', value: r.output },
              })),
            },
          ];
          const nextId = `a-${Date.now()}`;
          setMessages((prev) => [
            // 上一轮已处理完，清掉它的续跑快照，避免历史重复存储
            ...prev.map((m) => {
              if (m.id === assistantId) {
                const copy = { ...m };
                delete copy.apiMessages;
                delete copy.rawParts;
                return copy;
              }
              return m;
            }),
            { id: nextId, role: 'assistant', content: '', loading: true, apiMessages: followUp },
          ]);
          await runStreamRef.current?.(followUp, nextId, depth + 1);
        }
      } catch (err: unknown) {
        const errorText =
          err instanceof Error && err.name === 'AbortError'
            ? '已取消'
            : err instanceof Error
              ? err.message
              : 'AI 分析失败';
        updateAssistant((msg) => ({
          ...msg,
          content: msg.content || `抱歉，${errorText}`,
          loading: false,
          error: errorText,
        }));
      } finally {
        setIsLoading(false);
        abortRef.current = null;
      }
    },
    [bypass, setMessages, router, pageContext],
  );

  // 供递归续跑与读取最新会话使用
  runStreamRef.current = runStream;

  const handleSend = useCallback(async () => {
    if (!input.trim() || isLoading) return;

    const userText = input.trim();
    const userMessage: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: userText,
    };
    const assistantId = `a-${Date.now()}`;
    const assistantMessage: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      loading: true,
    };

    setMessages((prev) => [...prev, userMessage, assistantMessage]);
    setInput('');

    const selectedReportsContext = selectedReports.length
      ? `\n\n当前用户已选中的报告：\n${selectedReports
          .map(
            (r, idx) =>
              `${idx + 1}. 报告ID: ${r.id}, 名称: ${r.name}, 主机: ${r.config.host}, 样本数: ${r.results.length}`
          )
          .join('\n')}\n请优先基于这些报告回答，如需更详细数据可调用 getReportDetail。`
      : '';

    const pageContextHint = [
      pageContext ? `当前页面：${pageContext}` : '',
      contextTopologyId ? `当前拓扑ID：${contextTopologyId}` : '',
    ]
      .filter(Boolean)
      .join('；');
    const contextHint = pageContextHint ? `\n\n（${pageContextHint}）` : '';

    // 普通轮次只回传文本历史：工具调用/结果块若单独回传而缺少配对的 tool 消息，
    // 会被 OpenAI 兼容接口判为非法历史。审批续跑时由 handleApproval 单独拼装完整历史。
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    const requestMessages = [
      ...history,
      { role: 'user', content: userText + selectedReportsContext + contextHint },
    ];
    // 前端先裁一次，避免把巨型历史发给服务端（服务端还会再裁一次兜底）
    const trimmedRequest = trimMessagesForModel(requestMessages).messages;

    // 记录本轮请求，审批续跑时作为历史前缀；
    // 同时清掉其他消息上的 apiMessages/rawParts（无待审批时不再需要），
    // 否则每条 assistant 都留一份完整历史，内存按 O(n²) 增长。
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id === assistantId) return { ...m, apiMessages: trimmedRequest };
        if (m.pendingApprovals && m.pendingApprovals.length > 0) return m;
        if (!m.apiMessages && !m.rawParts) return m;
        const copy = { ...m };
        delete copy.apiMessages;
        delete copy.rawParts;
        return copy;
      }),
    );

    await runStream(trimmedRequest, assistantId);
  }, [input, isLoading, messages, selectedReports, setMessages, runStream, pageContext, contextTopologyId]);

  /** 用户对写操作给出确认/拒绝后，把审批结果回传给模型继续 */
  const handleApproval = useCallback(
    async (messageId: string, approved: boolean) => {
      if (isLoading) return;
      const target = messages.find((m) => m.id === messageId);
      if (!target || !target.pendingApprovals || target.pendingApprovals.length === 0) return;

      const approvalResponses = target.pendingApprovals.map((a) => ({
        type: 'tool-approval-response' as const,
        approvalId: a.approvalId,
        approved,
      }));
      // 合并连续的文本增量，避免回传几百个单字 text 块
      const assistantContent: RawContentPart[] = [];
      for (const part of target.rawParts || []) {
        if (part.type === 'text') {
          const last = assistantContent[assistantContent.length - 1];
          if (last && last.type === 'text') last.text += part.text;
          else assistantContent.push({ ...part });
        } else {
          assistantContent.push(part);
        }
      }
      const trimmedContent = assistantContent.filter(
        (p) => p.type !== 'text' || p.text.trim().length > 0,
      );
      const requestMessages = [
        ...(target.apiMessages || []),
        { role: 'assistant', content: trimmedContent },
        { role: 'tool', content: approvalResponses },
      ];
      const trimmedRequest = trimMessagesForModel(requestMessages).messages;

      // 清掉待确认状态，避免重复点击
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, pendingApprovals: [] } : m)),
      );

      const assistantId = `a-${Date.now()}`;
      setMessages((prev) => [
        ...prev,
        { id: assistantId, role: 'assistant', content: '', loading: true, apiMessages: trimmedRequest },
      ]);

      await runStream(trimmedRequest, assistantId);
    },
    [isLoading, messages, runStream, setMessages],
  );

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleSend();
  };

  const quickQuestions = [
    '最近哪份报告分数最高？',
    '所有报告的主机分布是怎样的？',
    '当前选中报告有哪些监控指标？',
    '对当前选中报告调用智能分析',
    '生成当前选中报告的 Excel 分析',
    '生成当前选中报告的 PPT 汇报',
  ];

  const handleQuickQuestion = (q: string) => {
    let final = q;
    if (selectedReports.length > 0 && (q.includes('当前选中') || q.includes('它'))) {
      const ids = selectedReports.map((r) => r.id).join(', ');
      final = `${q}（报告ID: ${ids}）`;
    }
    setInput(final);
  };

  const renderTrace = (msg: ChatMessage) => {
    if (!showTrace || (!msg.toolCalls?.length && !msg.steps?.length && !msg.logs?.length)) return null;

    const items = [];
    if (msg.toolCalls?.length) {
      items.push(
        <div key="tool-calls" style={{ marginBottom: 8 }}>
          <Text strong>工具调用：</Text>
          <div>
            {msg.toolCalls.map((tc, idx) => (
              <Tag key={idx} color="blue" style={{ marginBottom: 4 }}>
                {tc.name}
              </Tag>
            ))}
          </div>
        </div>
      );
    }
    if (msg.toolResults?.length) {
      items.push(
        <div key="tool-results" style={{ marginBottom: 8 }}>
          <Text strong>工具结果：</Text>
          <div>
            {msg.toolResults.map((tr, idx) => (
              <Tag key={idx} color={tr.error ? 'red' : 'green'} style={{ marginBottom: 4 }}>
                {tr.name} {tr.error ? `失败: ${tr.error}` : tr.success ? '成功' : '完成'}
              </Tag>
            ))}
          </div>
        </div>
      );
    }
    if (msg.steps?.length) {
      items.push(
        <div key="steps" style={{ marginBottom: 8 }}>
          <Text strong>执行步骤：</Text>
          <Collapse size="small" ghost>
            {msg.steps.map((step) => (
              <Panel
                header={`步骤 ${step.stepCount} (${step.finishReason || 'unknown'})`}
                key={step.stepCount}
              >
                <div style={{ fontSize: 12 }}>
                  {step.text && <div style={{ marginBottom: 4 }}>生成文本：{step.text}</div>}
                  {step.toolCalls?.map((tc, idx) => (
                    <div key={idx} style={{ marginBottom: 4 }}>
                      调用：{tc.name}
                      {tc.args && <pre style={{ margin: 0, fontSize: 11 }}>{JSON.stringify(tc.args, null, 2)}</pre>}
                    </div>
                  ))}
                </div>
              </Panel>
            ))}
          </Collapse>
        </div>
      );
    }
    if (msg.logs?.length) {
      items.push(
        <div key="logs">
          <Text strong>后端日志：</Text>
          <pre style={{ fontSize: 11, maxHeight: 160, overflow: 'auto', background: '#f5f5f5', padding: 8, borderRadius: 4 }}>
            {JSON.stringify(msg.logs, null, 2)}
          </pre>
        </div>
      );
    }

    return <div style={{ marginTop: 12, padding: 12, background: '#fafafa', borderRadius: 8 }}>{items}</div>;
  };

  const renderMessage = (msg: ChatMessage) => {
    const isUser = msg.role === 'user';
    const isThinking = !isUser && msg.loading;
    const lastToolCall = msg.toolCalls?.[msg.toolCalls.length - 1]?.name;
    const lastStep = msg.steps?.[msg.steps.length - 1];
    return (
      <List.Item style={{ justifyContent: isUser ? 'flex-end' : 'flex-start', border: 'none', padding: '8px 0' }}>
        <Card
          size="small"
          style={{
            maxWidth: '90%',
            width: '100%',
            background: isUser ? '#e6f7ff' : '#f6ffed',
            border: 'none',
            borderRadius: 12,
          }}
          styles={{ body: { padding: '10px 14px' } }}
        >
          <div className="ai-markdown" style={{ lineHeight: 1.6 }}>
            {msg.content ? (
              <ReactMarkdown
                components={{
                  p: ({ children }) => <p style={{ marginBottom: 8, marginTop: 0 }}>{children}</p>,
                  pre: ({ children }) => (
                    <pre
                      style={{
                        background: '#f5f5f5',
                        padding: 8,
                        borderRadius: 4,
                        overflow: 'auto',
                        fontSize: 12,
                        marginBottom: 8,
                      }}
                    >
                      {children}
                    </pre>
                  ),
                  code: ({ children }) => (
                    <code
                      style={{
                        background: '#f5f5f5',
                        padding: '2px 4px',
                        borderRadius: 3,
                        fontSize: 12,
                      }}
                    >
                      {children}
                    </code>
                  ),
                  ul: ({ children }) => <ul style={{ paddingLeft: 20, marginBottom: 8, marginTop: 0 }}>{children}</ul>,
                  ol: ({ children }) => <ol style={{ paddingLeft: 20, marginBottom: 8, marginTop: 0 }}>{children}</ol>,
                  li: ({ children }) => <li style={{ marginBottom: 4 }}>{children}</li>,
                  h1: ({ children }) => <h1 style={{ fontSize: 18, marginBottom: 8, marginTop: 0 }}>{children}</h1>,
                  h2: ({ children }) => <h2 style={{ fontSize: 16, marginBottom: 8, marginTop: 0 }}>{children}</h2>,
                  h3: ({ children }) => <h3 style={{ fontSize: 14, marginBottom: 8, marginTop: 0 }}>{children}</h3>,
                  h4: ({ children }) => <h4 style={{ fontSize: 13, marginBottom: 8, marginTop: 0 }}>{children}</h4>,
                  table: ({ children }) => (
                    <table style={{ borderCollapse: 'collapse', width: '100%', marginBottom: 8, fontSize: 12 }}>
                      {children}
                    </table>
                  ),
                  th: ({ children }) => (
                    <th style={{ border: '1px solid #d9d9d9', padding: 4, background: '#f5f5f5', textAlign: 'left' }}>
                      {children}
                    </th>
                  ),
                  td: ({ children }) => <td style={{ border: '1px solid #d9d9d9', padding: 4 }}>{children}</td>,
                  a: ({ children, href }) => (
                    <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: '#1890ff' }}>
                      {children}
                    </a>
                  ),
                  blockquote: ({ children }) => (
                    <blockquote
                      style={{
                        borderLeft: '4px solid #d9d9d9',
                        paddingLeft: 12,
                        margin: '0 0 8px 0',
                        color: '#595959',
                      }}
                    >
                      {children}
                    </blockquote>
                  ),
                  hr: () => <hr style={{ border: 'none', borderTop: '1px solid #f0f0f0', margin: '8px 0' }} />,
                }}
              >
                {msg.content}
              </ReactMarkdown>
            ) : (
              (isThinking ? '正在思考…' : '')
            )}
          </div>
          {msg.error && (
            <Alert message={msg.error} type="error" showIcon style={{ marginTop: 8 }} />
          )}
          {msg.pendingApprovals && msg.pendingApprovals.length > 0 && (
            <div
              style={{
                marginTop: 8,
                padding: 10,
                border: '1px solid #ffd591',
                background: '#fffbe6',
                borderRadius: 6,
              }}
            >
              <Text strong style={{ fontSize: 13 }}>以下操作会改变系统状态，是否执行？</Text>
              {msg.pendingApprovals.map((a, idx) => (
                <div key={a.approvalId} style={{ marginTop: 8, fontSize: 12 }}>
                  <Tag color="orange">{a.toolName}</Tag>
                  <span style={{ color: '#8c8c8c' }}>{a.reason || '需要确认'}</span>
                  <pre
                    style={{
                      background: '#f5f5f5',
                      padding: 6,
                      borderRadius: 4,
                      margin: '6px 0 0',
                      maxHeight: 160,
                      overflow: 'auto',
                      fontSize: 11,
                    }}
                  >
                    {JSON.stringify(a.input, null, 2)}
                  </pre>
                  {idx === msg.pendingApprovals!.length - 1 && (
                    <Space style={{ marginTop: 8 }}>
                      <Button
                        type="primary"
                        size="small"
                        disabled={isLoading}
                        onClick={() => handleApproval(msg.id, true)}
                      >
                        允许执行
                      </Button>
                      <Button size="small" disabled={isLoading} onClick={() => handleApproval(msg.id, false)}>
                        拒绝
                      </Button>
                    </Space>
                  )}
                </div>
              ))}
            </div>
          )}
          {isThinking && (
            <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                AI 正在运行
              </Text>
              {lastToolCall && (
                <Tag color="blue" style={{ margin: 0 }}>
                  {lastToolCall}
                </Tag>
              )}
              {lastStep && (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  步骤 {lastStep.stepCount}
                </Text>
              )}
            </div>
          )}
          {msg.attachments && msg.attachments.length > 0 && (
            <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {msg.attachments.map((att, idx) => (
                <Button
                  key={idx}
                  size="small"
                  icon={att.type === 'excel' ? <FileExcelOutlined /> : <FilePptOutlined />}
                  href={att.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  download={att.fileName}
                >
                  下载 {att.type === 'excel' ? 'Excel' : 'PPT'}
                </Button>
              ))}
            </div>
          )}
          {!isUser && renderTrace(msg)}
        </Card>
      </List.Item>
    );
  };

  return (
    <>
      <FloatButton
        icon={<RobotOutlined />}
        type="primary"
        onClick={() => setOpen(true)}
        tooltip="AI 分析助手"
        style={{ right: 24, bottom: 24 }}
      />
      <Drawer
        title={
          <Space>
            <RobotOutlined />
            <span>AI 分析助手</span>
          </Space>
        }
        placement="right"
        width={560}
        open={open}
        onClose={() => {
          if (abortRef.current) {
            abortRef.current.abort();
          }
          setOpen(false);
        }}
        styles={{ body: { padding: 0, display: 'flex', flexDirection: 'row', height: '100%' } }}
      >
        <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
          <div
            style={{
              width: 150,
              borderRight: '1px solid #f0f0f0',
              padding: 12,
              display: 'flex',
              flexDirection: 'column',
              background: '#fafafa',
              flexShrink: 0,
            }}
          >
            <Button
              type="primary"
              size="small"
              icon={<PlusOutlined />}
              onClick={handleNewSession}
              style={{ marginBottom: 12 }}
            >
              新建会话
            </Button>
            <div style={{ flex: 1, overflow: 'auto' }}>
              {sessions.map((s) => (
                <div
                  key={s.id}
                  onClick={() => handleSwitchSession(s.id)}
                  style={{
                    padding: '8px 10px',
                    borderRadius: 6,
                    cursor: 'pointer',
                    marginBottom: 6,
                    background: s.id === activeSessionId ? '#e6f7ff' : 'transparent',
                    border: s.id === activeSessionId ? '1px solid #1890ff' : '1px solid transparent',
                    fontSize: 12,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 4,
                  }}
                  title={s.title}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                    {s.title}
                  </span>
                  {sessions.length > 1 && (
                    <DeleteOutlined
                      onClick={(e) => handleDeleteSession(s.id, e)}
                      style={{ color: '#ff4d4f', flexShrink: 0, padding: 2 }}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 16, overflow: 'hidden', minWidth: 0 }}>
            <div ref={listRef} style={{ flex: 1, overflow: 'auto', marginBottom: 16, paddingRight: 4 }}>
              {messages.length === 0 && (
                <div style={{ textAlign: 'center', color: '#8c8c8c', marginTop: 40 }}>
                  <RobotOutlined style={{ fontSize: 32, marginBottom: 12 }} />
                  <div>你可以问我关于报告数据的任何问题</div>
                  {selectedReportsHint && <div style={{ marginTop: 8, fontSize: 12 }}>{selectedReportsHint}</div>}
                  {selectedReports.length === 0 && (
                    <div style={{ marginTop: 16 }}>
                      <Button size="small" icon={<FolderOpenOutlined />} onClick={() => setPickerOpen(true)}>
                        从报告管理中选择报告
                      </Button>
                    </div>
                  )}
                </div>
              )}
              <List dataSource={messages} renderItem={renderMessage} />
            </div>

            <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                快捷问题
              </Text>
              <Space>
                {selectedReports.length > 0 && (
                  <Button size="small" icon={<FolderOpenOutlined />} onClick={() => setPickerOpen(true)}>
                    选择报告 ({selectedReports.length})
                  </Button>
                )}
                <Button
                  size="small"
                  icon={showTrace ? <EyeInvisibleOutlined /> : <EyeOutlined />}
                  onClick={() => setShowTrace(!showTrace)}
                >
                  {showTrace ? '隐藏交互过程' : '显示交互过程'}
                </Button>
                <Button
                  size="small"
                  icon={<ApiOutlined />}
                  onClick={() => setPluginPanelOpen(true)}
                >
                  插件
                </Button>
                <Tooltip
                  title={
                    bypass
                      ? '已开启：AI 执行写操作（改拓扑/启停监控/创建或停止任务）不再询问，直接执行'
                      : '开启后 AI 可自行执行所有写操作，不再逐条确认'
                  }
                >
                  <Tag
                    color={bypass ? 'red' : 'default'}
                    style={{ cursor: 'pointer', margin: 0 }}
                    onClick={() => setBypass((v) => !v)}
                  >
                    bypass {bypass ? '已开启' : '关闭'}
                  </Tag>
                </Tooltip>
              </Space>
            </div>

            <Space wrap size="small" style={{ marginBottom: 12 }}>
              {quickQuestions.map((q) => (
                <Button key={q} size="small" onClick={() => handleQuickQuestion(q)}>
                  {q}
                </Button>
              ))}
            </Space>

            {selectedReports.length > 0 && (
              <div style={{ marginBottom: 12, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                <Text type="secondary" style={{ fontSize: 12 }}>已选报告:</Text>
                {selectedReports.map((r) => (
                  <Tag
                    key={r.id}
                    color="blue"
                    closable
                    onClose={() => setSelectedReportIds((prev) => prev.filter((id) => id !== r.id))}
                    style={{ fontSize: 12 }}
                  >
                    {r.name}
                  </Tag>
                ))}
              </div>
            )}

            <form onSubmit={onSubmit} style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <Input.TextArea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="输入你的问题，例如：帮我找出分数最高的报告"
                autoSize={{ minRows: 1, maxRows: 4 }}
                style={{ flex: 1 }}
                onPressEnter={(e) => {
                  if (!e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
              />
              <Button type="primary" htmlType="submit" icon={<SendOutlined />} loading={isLoading} />
            </form>

            <ReportPicker
              open={pickerOpen}
              title="选择报告（支持多选）"
              mode="multiple"
              selectedIds={selectedReportIds}
              maxCount={10}
              onConfirm={(selected) => {
                setSelectedReportIds(selected.map((r) => r.id));
                setPickerOpen(false);
              }}
              onCancel={() => setPickerOpen(false)}
            />
          </div>
        </div>
      </Drawer>

      <AIPluginPanel open={pluginPanelOpen} onClose={() => setPluginPanelOpen(false)} />
    </>
  );
};

export default AIAnalysisAssistant;
