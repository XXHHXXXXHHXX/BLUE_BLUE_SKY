'use client';

/** AI 实时建模控制台
 *
 * 通过 /api/analysis/stream 接收 Python 引擎逐阶段推送的建模事件，
 * 把「数据准备 → 特征编码 → 模型选择 → 训练 → 评估 → 归因 → 搜索 → 优化 → 效应 → 分解」
 * 实时渲染成时间轴 + 公式卡 + 动态图表，让人看懂 AI 每一步在做什么。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Row,
  Space,
  Statistic,
  Tag,
  Timeline,
  Tooltip,
  Typography,
} from 'antd';
import {
  ApiOutlined,
  CheckCircleOutlined,
  ExperimentOutlined,
  FunctionOutlined,
  LoadingOutlined,
  ReloadOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import {
  buildEffectLineOption,
  buildImpactBarOption,
  buildImpactPieOption,
  buildWaterfallOption,
  type AnalysisResult,
  type FeatureImportanceItem,
  type ParameterEffect,
  type WaterfallData,
} from '../../utils/analysisCharts';

const { Text, Paragraph, Title } = Typography;

export interface ModelingStep {
  stepId: string;
  title: string;
  narration: string;
  formula: string;
  payload: Record<string, unknown>;
  /** 收到该步骤的时间戳（用于展示耗时节奏） */
  at: number;
}

export interface LiveAnalysisParams {
  reportId: string;
  report?: unknown;
  target: string;
  direction: 'max' | 'min';
  rank: number;
}

interface LiveModelingConsoleProps {
  /** 外部触发一次分析（值变化即启动） */
  runToken?: number;
  params: LiveAnalysisParams | null;
  /** 收到完整结果时回调 */
  onComplete?: (result: AnalysisResult) => void;
}

const STEP_ICON: Record<string, React.ReactNode> = {
  data_ready: <ApiOutlined />,
  encoding: <FunctionOutlined />,
  model_select: <ExperimentOutlined />,
  train: <ThunderboltOutlined />,
  evaluate: <CheckCircleOutlined />,
  importance: <FunctionOutlined />,
  search_space: <ApiOutlined />,
  optimize: <ThunderboltOutlined />,
  effects: <FunctionOutlined />,
  waterfall: <FunctionOutlined />,
  complete: <CheckCircleOutlined />,
};

/** 公式卡：等宽字体 + 渐变底，突出「数学建模」的观感 */
const FormulaCard: React.FC<{ formula?: string }> = ({ formula }) => {
  if (!formula) return null;
  return (
    <div
      style={{
        marginTop: 8,
        padding: '10px 14px',
        borderRadius: 8,
        background: 'linear-gradient(135deg, rgba(24,144,255,0.08), rgba(114,46,209,0.08))',
        border: '1px solid rgba(24,144,255,0.25)',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        fontSize: 13,
        lineHeight: 1.7,
        color: '#1d39c4',
        wordBreak: 'break-word',
        whiteSpace: 'pre-wrap',
      }}
    >
      {formula}
    </div>
  );
};

const LiveModelingConsole: React.FC<LiveModelingConsoleProps> = ({ runToken, params, onComplete }) => {
  const [steps, setSteps] = useState<ModelingStep[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const start = useCallback(async (p: LiveAnalysisParams) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setError('');
    setSteps([]);
    setResult(null);

    try {
      const res = await fetch('/api/analysis/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reportId: p.reportId,
          report: p.report,
          target: p.target,
          direction: p.direction,
          rank: p.rank,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || `请求失败 ${res.status}`);
      }
      const reader = res.body?.getReader();
      if (!reader) throw new Error('响应流不可用');

      const decoder = new TextDecoder();
      let buffer = '';
      let finalResult: AnalysisResult | null = null;

      const handleEvent = (event: {
        type: string;
        stepId?: string;
        title?: string;
        narration?: string;
        formula?: string;
        payload?: Record<string, unknown>;
        message?: string;
      }) => {
        if (event.type === 'error') {
          setError(event.message || '分析失败');
          return;
        }
        if (event.type !== 'step' || !event.stepId) return;
        if (event.stepId === 'complete') {
          const r = event.payload?.result as AnalysisResult | undefined;
          if (r) {
            finalResult = r;
            setResult(r);
            onCompleteRef.current?.(r);
          }
          return;
        }
        const stepId = event.stepId as string;
        setSteps((prev) => [
          ...prev,
          {
            stepId,
            title: event.title || stepId,
            narration: event.narration || '',
            formula: event.formula || '',
            payload: event.payload || {},
            at: Date.now(),
          },
        ]);
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();
          if (!payload) continue;
          try {
            handleEvent(JSON.parse(payload));
          } catch {
            /* 忽略坏行 */
          }
        }
      }
      if (buffer.startsWith('data: ')) {
        const payload = buffer.slice(6).trim();
        if (payload) {
          try {
            handleEvent(JSON.parse(payload));
          } catch {
            /* ignore */
          }
        }
      }
      if (!finalResult && !controller.signal.aborted) {
        setError((prev) => prev || '分析未返回最终结果');
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : '分析失败');
    } finally {
      setRunning(false);
    }
  }, []);

  // runToken 变化即启动（由父组件或 AI 助手触发）
  useEffect(() => {
    if (!runToken || !params) return;
    void start(params);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runToken]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // ===== 从已到达的步骤中提取可视化数据（渐进式渲染） =====
  const featureImportance = useMemo<FeatureImportanceItem[] | undefined>(() => {
    for (let i = steps.length - 1; i >= 0; i--) {
      const p = steps[i].payload;
      if (Array.isArray(p.featureImportance)) return p.featureImportance as FeatureImportanceItem[];
    }
    return result?.feature_importance;
  }, [steps, result]);

  const parameterEffects = useMemo<ParameterEffect[] | undefined>(() => {
    for (let i = steps.length - 1; i >= 0; i--) {
      const p = steps[i].payload;
      if (Array.isArray(p.parameterEffects)) return p.parameterEffects as ParameterEffect[];
    }
    return result?.parameter_effects;
  }, [steps, result]);

  const waterfallData = useMemo<WaterfallData | null | undefined>(() => {
    for (let i = steps.length - 1; i >= 0; i--) {
      const p = steps[i].payload;
      if (p.waterfallData) return p.waterfallData as WaterfallData;
    }
    return result?.waterfall_data;
  }, [steps, result]);

  const r2 = useMemo(() => {
    for (let i = steps.length - 1; i >= 0; i--) {
      const v = steps[i].payload.r2;
      if (typeof v === 'number') return v;
    }
    return result?.model_r2;
  }, [steps, result]);

  const modelType = useMemo(() => {
    for (let i = steps.length - 1; i >= 0; i--) {
      const v = steps[i].payload.modelType;
      if (typeof v === 'string') return v;
    }
    return result?.model_type;
  }, [steps, result]);

  const optimalPoint = useMemo(() => {
    for (let i = steps.length - 1; i >= 0; i--) {
      const v = steps[i].payload.optimalPoint as
        | { values: Record<string, number | string>; predicted_score?: number }
        | undefined;
      if (v) return v;
    }
    return result?.optimal_point;
  }, [steps, result]);

  const pieOption = useMemo(() => buildImpactPieOption(featureImportance), [featureImportance]);
  const barOption = useMemo(() => buildImpactBarOption(featureImportance), [featureImportance]);
  const waterfallOption = useMemo(() => buildWaterfallOption(waterfallData), [waterfallData]);

  const hasAnything = steps.length > 0 || running || !!result || !!error;

  return (
    <div>
      {!hasAnything && (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="选择报告后点击「启动 AI 实时建模」，AI 每一步建模操作都会在这里实时渲染"
          style={{ marginTop: 40 }}
        />
      )}

      {hasAnything && (
        <Row gutter={16}>
          {/* 左：建模时间轴 */}
          <Col xs={24} lg={9}>
            <Card
              title={
                <Space>
                  <ExperimentOutlined style={{ color: '#722ed1' }} />
                  <span>AI 建模流程</span>
                  {running && <Tag color="processing" icon={<LoadingOutlined />}>进行中</Tag>}
                  {!running && result && <Tag color="success">已完成</Tag>}
                </Space>
              }
              extra={
                params && (
                  <Tooltip title="重新运行">
                    <Button
                      size="small"
                      icon={<ReloadOutlined />}
                      disabled={running}
                      onClick={() => void start(params)}
                    />
                  </Tooltip>
                )
              }
              style={{ marginBottom: 16 }}
              styles={{ body: { maxHeight: 760, overflowY: 'auto' } }}
            >
              {steps.length === 0 && running && (
                <Space direction="vertical" style={{ width: '100%', textAlign: 'center', padding: 24 }}>
                  <LoadingOutlined style={{ fontSize: 28, color: '#722ed1' }} />
                  <Text type="secondary">正在启动分析引擎…</Text>
                </Space>
              )}
              <Timeline
                items={steps.map((s, idx) => ({
                  color: '#722ed1',
                  dot: STEP_ICON[s.stepId] || <ApiOutlined />,
                  children: (
                    <div>
                      <Space size={6} style={{ marginBottom: 2 }}>
                        <Text strong>{s.title}</Text>
                        <Tag color="purple" style={{ fontSize: 11, lineHeight: '16px', padding: '0 4px' }}>
                          第 {idx + 1} 步
                        </Tag>
                      </Space>
                      <Paragraph type="secondary" style={{ marginBottom: 0, fontSize: 13 }}>
                        {s.narration}
                      </Paragraph>
                      <FormulaCard formula={s.formula} />
                    </div>
                  ),
                }))}
              />
              {running && steps.length > 0 && (
                <Space style={{ color: '#722ed1' }}>
                  <LoadingOutlined />
                  <Text type="secondary">下一步计算中…</Text>
                </Space>
              )}
            </Card>
          </Col>

          {/* 右：实时可视化 */}
          <Col xs={24} lg={15}>
            {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}

            {/* 核心指标随步骤实时刷新 */}
            <Row gutter={12} style={{ marginBottom: 16 }}>
              <Col span={8}>
                <Card size="small">
                  <Statistic
                    title="模型"
                    value={modelType === 'xgboost' ? 'XGBoost' : modelType === 'polynomial_regression' ? '多项式回归' : '—'}
                    valueStyle={{ fontSize: 18 }}
                  />
                </Card>
              </Col>
              <Col span={8}>
                <Card size="small">
                  <Statistic
                    title="拟合度 R²"
                    value={typeof r2 === 'number' ? r2 : undefined}
                    precision={3}
                    valueStyle={{
                      fontSize: 18,
                      color: typeof r2 === 'number' ? (r2 >= 0.8 ? '#52c41a' : r2 >= 0.5 ? '#faad14' : '#ff4d4f') : undefined,
                    }}
                  />
                </Card>
              </Col>
              <Col span={8}>
                <Card size="small">
                  <Statistic
                    title="最优预测值"
                    value={optimalPoint?.predicted_score ?? undefined}
                    precision={2}
                    valueStyle={{ fontSize: 18, color: '#1890ff' }}
                  />
                </Card>
              </Col>
            </Row>

            {/* 重要性（到 importance 步骤后出现） */}
            {(pieOption || barOption) && (
              <Row gutter={12} style={{ marginBottom: 16 }}>
                <Col xs={24} md={12}>
                  <Card size="small" title="参数影响比重">
                    {pieOption ? <ReactECharts option={pieOption} style={{ height: 260 }} notMerge /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />}
                  </Card>
                </Col>
                <Col xs={24} md={12}>
                  <Card size="small" title="SHAP 重要性排序">
                    {barOption ? <ReactECharts option={barOption} style={{ height: 260 }} notMerge /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />}
                  </Card>
                </Col>
              </Row>
            )}

            {/* 参数效应曲线（到 effects 步骤后出现） */}
            {parameterEffects && parameterEffects.length > 0 && (
              <Card size="small" title="参数效应曲线" style={{ marginBottom: 16 }}>
                <Row gutter={[12, 12]}>
                  {parameterEffects.map((pe) => (
                    <Col xs={24} md={12} key={pe.feature}>
                      <Card size="small" title={pe.feature} styles={{ body: { padding: 8 } }}>
                        <ReactECharts
                          option={buildEffectLineOption(pe.feature, pe.data)}
                          style={{ height: 220 }}
                          notMerge
                        />
                      </Card>
                    </Col>
                  ))}
                </Row>
              </Card>
            )}

            {/* 瀑布图（到 waterfall 步骤后出现） */}
            {waterfallOption && (
              <Card size="small" title="SHAP 分解（最优点解释）" style={{ marginBottom: 16 }}>
                <ReactECharts option={waterfallOption} style={{ height: 320 }} notMerge />
              </Card>
            )}

            {/* 最优点（到 optimize 步骤后出现） */}
            {optimalPoint && Object.keys(optimalPoint.values || {}).length > 0 && (
              <Card size="small" title="最优参数组合">
                <Space wrap>
                  {Object.entries(optimalPoint.values).map(([k, v]) => (
                    <Tag key={k} color="blue" style={{ fontSize: 13, padding: '2px 8px' }}>
                      {k} = {v}
                    </Tag>
                  ))}
                </Space>
              </Card>
            )}

            {!pieOption && !parameterEffects && !waterfallOption && !optimalPoint && !error && (
              <Card>
                <Space direction="vertical" style={{ width: '100%', textAlign: 'center', padding: 32 }}>
                  <Title level={5} style={{ margin: 0 }}>
                    <ThunderboltOutlined style={{ color: '#722ed1' }} /> 等待建模数据…
                  </Title>
                  <Text type="secondary">图表会随着 AI 完成每个建模阶段自动出现并动画生长</Text>
                </Space>
              </Card>
            )}
          </Col>
        </Row>
      )}
    </div>
  );
};

export default LiveModelingConsole;
