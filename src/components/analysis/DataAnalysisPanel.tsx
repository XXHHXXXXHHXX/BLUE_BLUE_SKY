'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Card,
  Select,
  Button,
  Space,
  Typography,
  Tag,
  Alert,
  Spin,
  Row,
  Col,
  Statistic,
  Empty,
  Tabs,
  Tooltip,
  Descriptions,
  Badge,
} from 'antd';
import {
  BarChartOutlined,
  LineChartOutlined,
  PieChartOutlined,
  BulbOutlined,
  ExperimentOutlined,
  CheckCircleOutlined,
  AimOutlined,
  InfoCircleOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import { useTestReportStore, type TestReport } from '../../stores/testReportStore';
import { collectScoreNames } from '../../utils/scoreParsing';
import BaselineComparisonPanel from './BaselineComparisonPanel';
import MultiXYChartPanel from './MultiXYChartPanel';
import LiveModelingConsole from './LiveModelingConsole';
import { useAiContextStore } from '../../stores/aiContextStore';
import {
  buildEffectLineOption,
  buildImpactBarOption,
  buildImpactPieOption,
  buildWaterfallOption,
  type AnalysisResult,
} from '../../utils/analysisCharts';

const { Title, Text, Paragraph } = Typography;
const { Option } = Select;

const DataAnalysisPanel: React.FC = () => {
  const { reports, fetchReports } = useTestReportStore();
  const [selectedReportId, setSelectedReportId] = useState<string>('');
  const [selectedTarget, setSelectedTarget] = useState<string>('score');
  const [direction, setDirection] = useState<string>('max');
  const [rank, setRank] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string>('');
  /** 当前激活的页签；AI 助手可请求切到实时建模页 */
  const [activeTab, setActiveTab] = useState('smart');
  /** 实时建模启动令牌：递增即触发一次流式分析 */
  const [runToken, setRunToken] = useState(0);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  // 把当前选中的报告同步给全局 AI 助手，作为对话上下文；离开页面时清空避免残留
  const setContextReportIds = useAiContextStore((s) => s.setSelectedReportIds);
  useEffect(() => {
    setContextReportIds(selectedReportId ? [selectedReportId] : []);
  }, [selectedReportId, setContextReportIds]);
  useEffect(() => () => setContextReportIds([]), [setContextReportIds]);

  const allReports = useMemo(() => {
    return [...reports].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }, [reports]);

  const selectedReport = useMemo(() => {
    return allReports.find((r) => r.id === selectedReportId);
  }, [allReports, selectedReportId]);

  // AI 助手可通过 aiContextStore 请求「在数据分析页启动实时建模」
  const liveRequest = useAiContextStore((s) => s.liveAnalysisRequest);
  const consumeLiveRequest = useAiContextStore((s) => s.consumeLiveAnalysisRequest);
  /** 待启动标记：报告数据可能尚未加载完成，等 selectedReport 就绪后再触发 */
  const pendingLiveRef = useRef(false);

  const startLiveAnalysis = useCallback(() => {
    if (!selectedReport) return;
    setActiveTab('live');
    setRunToken((t) => t + 1);
  }, [selectedReport]);

  // 消费 AI 发起的实时建模请求：先同步筛选条件，等报告就绪后启动
  useEffect(() => {
    if (!liveRequest) return;
    if (liveRequest.reportId && liveRequest.reportId !== selectedReportId) {
      setSelectedReportId(liveRequest.reportId);
    }
    if (liveRequest.target) setSelectedTarget(liveRequest.target);
    if (liveRequest.direction) setDirection(liveRequest.direction);
    if (typeof liveRequest.rank === 'number') setRank(liveRequest.rank);
    setActiveTab('live');
    pendingLiveRef.current = true;
    consumeLiveRequest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveRequest]);

  // 报告就绪后真正触发一次流式分析
  useEffect(() => {
    if (!pendingLiveRef.current) return;
    if (!selectedReport) return;
    pendingLiveRef.current = false;
    setRunToken((t) => t + 1);
  }, [selectedReport]);

  const targetOptions = useMemo(() => {
    const opts = [{ label: '性能分数 (score)', value: 'score' }];
    if (selectedReport?.results?.length) {
      // 命名多分数：每个分数名作为独立分析目标
      collectScoreNames(selectedReport.results).forEach((name) => {
        opts.push({ label: `分数: ${name}`, value: `score:${name}` });
      });
      const firstResult = selectedReport.results[0];
      const monitorIds = firstResult?.monitorResults ? Object.keys(firstResult.monitorResults) : [];
      monitorIds.forEach((id) => {
        const name = firstResult.monitorResults?.[id]?.commandName || id;
        opts.push({ label: `监控: ${name}`, value: id });
      });
    }
    return opts;
  }, [selectedReport]);

  const handleAnalyze = async () => {
    if (!selectedReport) return;
    setActiveTab('smart');
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const res = await fetch('/api/analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ report: selectedReport, target: selectedTarget, direction, rank }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.message || '分析失败');
      } else {
        setResult(data.data as AnalysisResult);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '请求异常');
    } finally {
      setLoading(false);
    }
  };

  // ========== 图表配置（与实时建模控制台共用同一套构造器） ==========
  const impactPieOption = useMemo(
    () => buildImpactPieOption(result?.feature_importance),
    [result],
  );
  const impactBarOption = useMemo(
    () => buildImpactBarOption(result?.feature_importance),
    [result],
  );
  const effectLineOption = buildEffectLineOption;
  const waterfallOption = useMemo(
    () => buildWaterfallOption(result?.waterfall_data),
    [result],
  );

  return (
    <div style={{ padding: 16, maxWidth: 1400, margin: '0 auto' }}>
      <Title level={4} style={{ marginBottom: 16 }}>
        <BarChartOutlined /> 数据分析中心
      </Title>

      {/* 配置区：两个页签共用，切换页签不丢失选择 */}
      <Card title="分析配置" style={{ marginBottom: 16 }}>
        <Row gutter={16} align="middle">
          <Col xs={24} sm={12} md={8}>
            <div style={{ marginBottom: 8 }}>
              <Text strong>选择测试报告</Text>
            </div>
            <Select
              showSearch
              placeholder="请选择一份报告"
              style={{ width: '100%' }}
              value={selectedReportId || undefined}
              onChange={setSelectedReportId}
              optionFilterProp="label"
            >
              {allReports.map((r) => (
                <Option key={r.id} value={r.id} label={r.name}>
                  <Space>
                    <Badge color="blue" />
                    {r.name}
                    <Tag style={{ fontSize: 12, lineHeight: '18px', padding: '0 4px' }}>{r.results.length} 条数据</Tag>
                  </Space>
                </Option>
              ))}
            </Select>
          </Col>
          <Col xs={24} sm={8} md={5}>
            <div style={{ marginBottom: 8 }}>
              <Text strong>分析目标</Text>
            </div>
            <Select
              style={{ width: '100%' }}
              value={selectedTarget}
              onChange={setSelectedTarget}
              options={targetOptions}
            />
          </Col>
          <Col xs={24} sm={8} md={4}>
            <div style={{ marginBottom: 8 }}>
              <Text strong>优化方向</Text>
            </div>
            <Select
              style={{ width: '100%' }}
              value={direction}
              onChange={setDirection}
              options={[
                { label: '寻找最大', value: 'max' },
                { label: '寻找最小', value: 'min' },
              ]}
            />
          </Col>
          <Col xs={24} sm={8} md={4}>
            <div style={{ marginBottom: 8 }}>
              <Text strong>排名</Text>
            </div>
            <Select
              style={{ width: '100%' }}
              value={rank}
              onChange={setRank}
              options={[
                { label: '最优', value: 0 },
                { label: '次优', value: 1 },
                { label: '次次优', value: 2 },
              ]}
            />
          </Col>
          <Col xs={24} sm={24} md={7}>
            <div style={{ marginBottom: 8 }}>
              <Text style={{ opacity: 0 }}>占位</Text>
            </div>
            <Space wrap>
              <Button
                type="primary"
                icon={<ExperimentOutlined />}
                loading={loading}
                disabled={!selectedReport}
                onClick={handleAnalyze}
                size="large"
              >
                启动智能分析
              </Button>
              <Button
                icon={<ThunderboltOutlined />}
                disabled={!selectedReport}
                onClick={startLiveAnalysis}
                size="large"
              >
                AI 实时建模
              </Button>
            </Space>
          </Col>
        </Row>

        {selectedReport && (
          <div style={{ marginTop: 12 }}>
            <Space wrap>
              <Tag icon={<CheckCircleOutlined />} color="blue">
                {selectedReport.name}
              </Tag>
              <Tag>主机: {selectedReport.config.host}</Tag>
              <Tag>样本数: {selectedReport.results.length}</Tag>
              <Tag>
                参数:{' '}
                {selectedReport.config.iterationParams?.map((p) => p.name).join(', ') || '-'}
              </Tag>
            </Space>
          </div>
        )}
      </Card>

      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          {
            key: 'live',
            label: (
              <Space>
                <ThunderboltOutlined />
                AI 实时建模
              </Space>
            ),
            children: (
              <>
                <LiveModelingConsole
                  runToken={runToken}
                  params={
                    selectedReport
                      ? {
                          reportId: selectedReport.id,
                          target: selectedTarget,
                          direction: direction === 'min' ? 'min' : 'max',
                          rank,
                        }
                      : null
                  }
                  onComplete={(r) => setResult(r)}
                />
              </>
            ),
          },
          {
            key: 'smart',
            label: (
              <Space>
                <ExperimentOutlined />
                智能分析
              </Space>
            ),
            children: (
              <>
      {error && (
        <Alert message={error} type="error" showIcon style={{ marginBottom: 16 }} />
      )}

      {loading && (
        <Card style={{ textAlign: 'center', padding: 40 }}>
          <Spin size="large" />
          <Paragraph style={{ marginTop: 16 }}>正在调用 XGBoost + SHAP 分析引擎，请稍候…</Paragraph>
        </Card>
      )}

      {result && !loading && (
        <>
          {/* 算法说明 */}
          <Alert
            message="分析算法说明"
            description={
              <Space direction="vertical" size={0}>
                <Text>{result.algorithm_note}</Text>
                <Text type="secondary">{result.optimization_note}</Text>
              </Space>
            }
            type="info"
            showIcon
            icon={<BulbOutlined />}
            style={{ marginBottom: 16 }}
          />

          {/* 核心指标 */}
          <Row gutter={16} style={{ marginBottom: 16 }}>
            <Col xs={12} sm={6}>
              <Card>
                <Statistic
                  title="模型类型"
                  value={result.model_type === 'xgboost' ? 'XGBoost' : '多项式回归'}
                />
              </Card>
            </Col>
            <Col xs={12} sm={6}>
              <Card>
                <Statistic
                  title="拟合度 R²"
                  value={result.model_r2}
                  precision={3}
                  valueStyle={{ color: result.model_r2 >= 0.8 ? '#52c41a' : '#faad14' }}
                  suffix={result.model_r2 >= 0.8 ? '优' : result.model_r2 >= 0.5 ? '良' : '一般'}
                />
              </Card>
            </Col>
            <Col xs={12} sm={6}>
              <Card>
                <Statistic title="样本量" value={result.samples} />
              </Card>
            </Col>
            <Col xs={12} sm={6}>
              <Card>
                <Statistic title="特征数" value={result.features.length} />
              </Card>
            </Col>
          </Row>

          {/* 最优点推断 */}
          <Row gutter={16} style={{ marginBottom: 16 }}>
            <Col xs={24} md={12}>
              <Card
                title={
                  <Space>
                    <AimOutlined style={{ color: '#1890ff' }} />
                    <span>
                      模型推断
                      {result.direction === 'min' ? '最小' : '最大'}
                      {result.rank === 0 ? '点' : result.rank === 1 ? '次点' : '次次点'}
                    </span>
                  </Space>
                }
                extra={
                  <Tag color="blue">
                    预测值: {result.optimal_point.predicted_score}
                  </Tag>
                }
              >
                <Descriptions column={1} size="small" bordered>
                  {Object.entries(result.optimal_point.values).map(([k, v]) => (
                    <Descriptions.Item key={k} label={k}>
                      <Text strong style={{ color: '#1890ff', fontSize: 16 }}>{v}</Text>
                    </Descriptions.Item>
                  ))}
                </Descriptions>
                {result.top3_inferred.length > 1 && (
                  <div style={{ marginTop: 12 }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>前3推断点：</Text>
                    <Space wrap style={{ marginTop: 4 }}>
                      {result.top3_inferred.map((pt) => (
                        <Tag
                          key={pt.rank}
                          color={pt.rank === result.rank ? 'blue' : 'default'}
                          style={{ fontSize: 12 }}
                        >
                          {pt.rank === 0 ? '最优' : pt.rank === 1 ? '次优' : '次次优'}: {pt.predicted_score}
                        </Tag>
                      ))}
                    </Space>
                  </div>
                )}
              </Card>
            </Col>
            <Col xs={24} md={12}>
              <Card
                title={
                  <Space>
                    <CheckCircleOutlined style={{ color: '#52c41a' }} />
                    <span>历史实际{result.direction === 'min' ? '最小' : '最大'}点</span>
                  </Space>
                }
                extra={
                  <Tag color="green">
                    实际值: {result.actual_best.actual_score}
                  </Tag>
                }
              >
                <Descriptions column={1} size="small" bordered>
                  {Object.entries(result.actual_best.values).map(([k, v]) => (
                    <Descriptions.Item key={k} label={k}>
                      <Text strong style={{ color: '#52c41a', fontSize: 16 }}>{v}</Text>
                    </Descriptions.Item>
                  ))}
                </Descriptions>
                {result.top3_actual.length > 1 && (
                  <div style={{ marginTop: 12 }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>前3实际点：</Text>
                    <Space wrap style={{ marginTop: 4 }}>
                      {result.top3_actual.map((pt) => (
                        <Tag
                          key={pt.rank}
                          color={pt.rank === 0 ? 'green' : 'default'}
                          style={{ fontSize: 12 }}
                        >
                          {pt.rank === 0 ? '最优' : pt.rank === 1 ? '次优' : '次次优'}: {pt.actual_score}
                        </Tag>
                      ))}
                    </Space>
                  </div>
                )}
              </Card>
            </Col>
          </Row>

          {/* 影响比重与 SHAP */}
          <Row gutter={16} style={{ marginBottom: 16 }}>
            <Col xs={24} md={12}>
              <Card title="参数影响比重 (SHAP)">
                {impactPieOption ? (
                  <ReactECharts option={impactPieOption} style={{ height: 320 }} />
                ) : (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无数据" />
                )}
              </Card>
            </Col>
            <Col xs={24} md={12}>
              <Card title="SHAP 重要性排序">
                {impactBarOption ? (
                  <ReactECharts option={impactBarOption} style={{ height: 320 }} />
                ) : (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无数据" />
                )}
              </Card>
            </Col>
          </Row>

          {/* 参数影响曲线 */}
          <Card title="各参数影响曲线" style={{ marginBottom: 16 }}>
            {result.parameter_effects.length > 0 ? (
              <Tabs
                items={result.parameter_effects.map((pe) => ({
                  key: pe.feature,
                  label: pe.feature,
                  children: (
                    <ReactECharts
                      option={effectLineOption(pe.feature, pe.data)}
                      style={{ height: 360 }}
                    />
                  ),
                }))}
              />
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无参数影响数据" />
            )}
          </Card>

          {/* SHAP 瀑布图 */}
          {waterfallOption && (
            <Card
              title={
                <Space>
                  <InfoCircleOutlined />
                  <span>
                    SHAP 瀑布图（
                    {result.direction === 'min' ? '最小' : '最大'}
                    {result.rank === 0 ? '点' : result.rank === 1 ? '次点' : '次次点'}
                    解释）
                  </span>
                  <Tooltip title="展示每个参数对最优点预测分数的正负贡献">
                    <InfoCircleOutlined style={{ color: '#8c8c8c' }} />
                  </Tooltip>
                </Space>
              }
              style={{ marginBottom: 16 }}
            >
              <ReactECharts option={waterfallOption} style={{ height: 400 }} />
              <Paragraph type="secondary" style={{ marginTop: 8 }}>
                从基础值（训练集平均）出发，绿色柱表示该参数使分数提升，红色柱表示使分数下降，最终到达预测值。
              </Paragraph>
            </Card>
          )}

          {/* 详细数据表 */}
          <Card title="特征重要性明细">
            <Row gutter={[16, 16]}>
              {result.feature_importance.map((item) => (
                <Col xs={24} sm={12} md={8} key={item.feature}>
                  <Card size="small" title={item.feature}>
                    <Space direction="vertical" style={{ width: '100%' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <Text type="secondary">影响比重</Text>
                        <Text strong>{item.impact_ratio}%</Text>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <Text type="secondary">SHAP 重要性</Text>
                        <Text>{item.shap_importance}</Text>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <Text type="secondary">XGBoost 重要性</Text>
                        <Text>{item.xgb_importance}</Text>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <Text type="secondary">Pearson 相关</Text>
                        <Text style={{ color: item.correlation > 0 ? '#52c41a' : '#ff4d4f' }}>
                          {item.correlation > 0 ? '+' : ''}
                          {item.correlation}
                        </Text>
                      </div>
                    </Space>
                  </Card>
                </Col>
              ))}
            </Row>
          </Card>
        </>
      )}

      {!result && !loading && !error && (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="选择一份测试报告并点击「启动智能分析」开始"
          style={{ marginTop: 40 }}
        />
      )}
              </>
            ),
          },
          {
            key: 'baseline',
            label: (
              <Space>
                <AimOutlined />
                基线对比分析
              </Space>
            ),
            children: <BaselineComparisonPanel />,
          },
          {
            key: 'xy',
            label: (
              <Space>
                <LineChartOutlined />
                自定义 XY 图
              </Space>
            ),
            children: <MultiXYChartPanel />,
          },
        ]}
      />
    </div>
  );
};

export default DataAnalysisPanel;
