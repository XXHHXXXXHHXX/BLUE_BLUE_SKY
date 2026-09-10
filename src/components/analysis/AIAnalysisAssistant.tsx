'use client';

import React, { useMemo, useRef, useEffect, useState, useCallback } from 'react';
import { Drawer, Input, Button, Space, FloatButton, List, Card, Typography, Tag, Collapse, Alert } from 'antd';
import { RobotOutlined, SendOutlined, EyeOutlined, EyeInvisibleOutlined, FolderOpenOutlined, FileExcelOutlined, FilePptOutlined, PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import { useTestReportStore, type TestReport } from '../../stores/testReportStore';
import ReactMarkdown from 'react-markdown';
import ReportPicker from './ReportPicker';

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
}

interface AIResponse {
  success: boolean;
  response?: string;
  error?: string;
}

type StreamEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'tool-call'; toolCall: { toolName: string; input: unknown; toolCallId?: string } }
  | { type: 'tool-result'; toolResult: { toolName: string; output: unknown; toolCallId?: string } }
  | { type: 'tool-error'; toolError: { toolName: string; error: string; toolCallId?: string } }
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
}

const AIAnalysisAssistant: React.FC<AIAnalysisAssistantProps> = ({
  selectedReportId,
  selectedReportIds: externalSelectedReportIds,
}) => {
  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState<ChatSession[]>(() => [createSession()]);
  const [activeSessionId, setActiveSessionId] = useState<string>(sessions[0].id);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showTrace, setShowTrace] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedReportIds, setSelectedReportIds] = useState<string[]>(
    externalSelectedReportIds ?? (selectedReportId ? [selectedReportId] : [])
  );
  const listRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const { reports, fetchReports } = useTestReportStore();

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

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  useEffect(() => {
    setSelectedReportIds(externalSelectedReportIds ?? (selectedReportId ? [selectedReportId] : []));
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
    setIsLoading(true);

    const controller = new AbortController();
    abortRef.current = controller;

    const updateLastAssistant = (updater: (msg: ChatMessage) => ChatMessage) => {
      setMessages((prev) => {
        const next = [...prev];
        // 找到当前正在流式回复的 assistant 消息（从后往前第一个 loading 的 assistant）
        let idx = -1;
        for (let i = next.length - 1; i >= 0; i--) {
          if (next[i].role === 'assistant' && next[i].loading) {
            idx = i;
            break;
          }
        }
        if (idx !== -1) {
          next[idx] = updater(next[idx]);
        }
        return next;
      });
    };

    const handleStreamEvent = (event: StreamEvent) => {
      switch (event.type) {
        case 'text-delta':
          updateLastAssistant((msg) => ({ ...msg, content: msg.content + event.text }));
          break;
        case 'tool-call':
          updateLastAssistant((msg) => ({
            ...msg,
            toolCalls: [
              ...(msg.toolCalls || []),
              { name: event.toolCall.toolName, args: (event.toolCall.input as Record<string, unknown>) || {} },
            ],
          }));
          break;
        case 'tool-result': {
          const result = event.toolResult.output as { url?: string; fileName?: string; error?: string } | undefined;
          const attachmentType = event.toolResult.toolName === 'generateExcelReport' ? 'excel' : event.toolResult.toolName === 'generatePPTReport' ? 'ppt' : null;
          updateLastAssistant((msg) => ({
            ...msg,
            toolResults: [
              ...(msg.toolResults || []),
              { name: event.toolResult.toolName, result: event.toolResult.output },
            ],
            attachments: attachmentType && result?.url
              ? [...(msg.attachments || []), { type: attachmentType, url: result.url, fileName: result.fileName || '未命名' }]
              : msg.attachments,
          }));
          break;
        }
        case 'tool-error':
          updateLastAssistant((msg) => ({
            ...msg,
            toolResults: [
              ...(msg.toolResults || []),
              { name: event.toolError.toolName, error: event.toolError.error },
            ],
          }));
          break;
        case 'step-finish':
          updateLastAssistant((msg) => ({
            ...msg,
            steps: [
              ...(msg.steps || []),
              { stepCount: (msg.steps?.length || 0) + 1, finishReason: event.finishReason },
            ],
          }));
          break;
        case 'error':
          updateLastAssistant((msg) => ({ ...msg, error: event.error, loading: false }));
          break;
        case 'done':
          updateLastAssistant((msg) => ({ ...msg, loading: false }));
          break;
      }
    };

    try {
      const chatMessages = [...messages, userMessage].map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const selectedReportsContext = selectedReports.length
        ? `\n\n当前用户已选中的报告：\n${selectedReports
            .map(
              (r, idx) =>
                `${idx + 1}. 报告ID: ${r.id}, 名称: ${r.name}, 主机: ${r.config.host}, 样本数: ${r.results.length}`
            )
            .join('\n')}\n请优先基于这些报告回答，如需更详细数据可调用 getReportDetail。`
        : '';

      const bodyMessages = chatMessages.map((m, idx) => {
        if (idx === chatMessages.length - 1 && m.role === 'user') {
          return { ...m, content: m.content + selectedReportsContext };
        }
        return m;
      });

      const res = await fetch('/api/ai/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: bodyMessages }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const data = (await res.json()) as AIResponse;
        throw new Error(data.error || `请求失败 ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) {
        throw new Error('响应流不可用');
      }

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
            const event = JSON.parse(payload) as StreamEvent;
            handleStreamEvent(event);
          } catch (e) {
            console.error('解析 SSE 事件失败:', payload, e);
          }
        }
      }

      // 处理缓冲区中剩余的一行
      if (buffer.startsWith('data: ')) {
        const payload = buffer.slice(6);
        if (payload) {
          try {
            const event = JSON.parse(payload) as StreamEvent;
            handleStreamEvent(event);
          } catch (e) {
            console.error('解析 SSE 事件失败:', payload, e);
          }
        }
      }

      updateLastAssistant((msg) => ({ ...msg, loading: false }));
    } catch (err: unknown) {
      const errorText =
        err instanceof Error && err.name === 'AbortError'
          ? '已取消'
          : err instanceof Error
            ? err.message
            : 'AI 分析失败';
      updateLastAssistant((msg) => ({
        ...msg,
        content: msg.content || `抱歉，${errorText}`,
        loading: false,
        error: errorText,
      }));
    } finally {
      setIsLoading(false);
      abortRef.current = null;
    }
  }, [input, isLoading, messages, selectedReports, setMessages]);

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
    </>
  );
};

export default AIAnalysisAssistant;
