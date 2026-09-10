'use client';

import React, { useEffect, useMemo, useState } from 'react';
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
} from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import { useTestReportStore, type TestReport } from '../../stores/testReportStore';
import BaselineComparisonPanel from './BaselineComparisonPanel';
import MultiXYChartPanel from './MultiXYChartPanel';
import AIAnalysisAssistant from './AIAnalysisAssistant';

const { Title, Text, Paragraph } = Typography;
const { Option } = Select;

interface RankPoint {
  rank: number;
  values: Record<string, number>;
  predicted_score?: number;
  actual_score?: number;
}

interface AnalysisResult {
  success: boolean;
  model_type: string;
  model_r2: number;
  samples: number;
  features: string[];
  target: string;
  direction: string;
  rank: number;
  optimal_point: RankPoint;
  top3_inferred: RankPoint[];
  actual_best: RankPoint;
  top3_actual: RankPoint[];
  feature_importance: Array<{
    feature: string;
    shap_importance: number;
    xgb_importance: number;
    correlation: number;
    impact_ratio: number;
  }>;
  parameter_effects: Array<{
    feature: string;
    data: Array<{ x: number; shap: number; actual_y: number }>;
  }>;
  waterfall_data: {
    base_value: number;
    features: Array<{ feature: string; value: number; shap: number }>;
    final_prediction: number;
  } | null;
  algorithm_note: string;
  optimization_note: string;
}

const DataAnalysisPanel: React.FC = () => {
  const { reports, fetchReports } = useTestReportStore();
  const [selectedReportId, setSelectedReportId] = useState<string>('');
  const [selectedTarget, setSelectedTarget] = useState<string>('score');
  const [direction, setDirection] = useState<string>('max');
  const [rank, setRank] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  const allReports = useMemo(() => {
    return [...reports].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }, [reports]);

  const selectedReport = useMemo(() => {
    return allReports.find((r) => r.id === selectedReportId);
  }, [allReports, selectedReportId]);

  const targetOptions = useMemo(() => {
    const opts = [{ label: '性能分数 (score)', value: 'score' }];
    if (selectedReport?.results?.length) {
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

  // ========== 图表配置 ==========
  const impactPieOption = useMemo(() => {
    if (!result?.feature_importance?.length) return null;
    return {
      tooltip: { trigger: 'item', formatter: '{b}: {c}% ({d}%)' },
      legend: { bottom: 0 },
      series: [
        {
          type: 'pie',
          radius: ['40%', '70%'],
          avoidLabelOverlap: true,
          itemStyle: { borderRadius: 8, borderColor: '#fff', borderWidth: 2 },
          label: { show: true, formatter: '{b}\n{d}%' },
          data: result.feature_importance.map((item) => ({
            name: item.feature,
            value: item.impact_ratio,
          })),
        },
      ],
    };
  }, [result]);

  const impactBarOption = useMemo(() => {
    if (!result?.feature_importance?.length) return null;
    const names = result.feature_importance.map((i) => i.feature);
    const shapVals = result.feature_importance.map((i) => i.shap_importance);
    return {
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
      xAxis: { type: 'category', data: names },
      yAxis: { type: 'value', name: 'SHAP 重要性' },
      series: [
        {
          type: 'bar',
          data: shapVals,
          itemStyle: {
            color: {
              type: 'linear',
              x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: '#1890ff' },
                { offset: 1, color: '#69c0ff' },
              ],
            },
            borderRadius: [4, 4, 0, 0],
          },
          barWidth: '50%',
        },
      ],
    };
  }, [result]);

  const effectLineOption = (feature: string, data: Array<{ x: number; shap: number; actual_y: number }>) => {
    return {
      tooltip: { trigger: 'axis' },
      grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
      xAxis: { type: 'category', name: feature, data: data.map((d) => d.x) },
      yAxis: [
        { type: 'value', name: '实际表现', position: 'left' },
        { type: 'value', name: 'SHAP 值', position: 'right' },
      ],
      series: [
        {
          name: '实际表现',
          type: 'line',
          data: data.map((d) => d.actual_y),
          smooth: true,
          symbol: 'circle',
          lineStyle: { color: '#52c41a', width: 2 },
          itemStyle: { color: '#52c41a' },
        },
        {
          name: 'SHAP 值',
          type: 'line',
          yAxisIndex: 1,
          data: data.map((d) => d.shap),
          smooth: true,
          symbol: 'diamond',
          lineStyle: { color: '#fa8c16', width: 2 },
          itemStyle: { color: '#fa8c16' },
        },
      ],
    };
  };

  const waterfallOption = useMemo(() => {
    if (!result?.waterfall_data) return null;
    const { base_value, features, final_prediction } = result.waterfall_data;
    const categories = ['基础值', ...features.map((f) => f.feature), '预测值'];
    const values = features.map((f) => f.shap);
    const cumulative = [base_value];
    let sum = base_value;
    for (const v of values) {
      sum += v;
      cumulative.push(sum);
    }
    cumulative.push(final_prediction);

    const invisible = [0];
    for (let i = 0; i < values.length; i++) {
      const prev = cumulative[i];
      const curr = values[i];
      invisible.push(curr >= 0 ? prev : prev + curr);
    }
    invisible.push(0);

    const barValues = [base_value, ...values.map((v) => Math.abs(v)), final_prediction - cumulative[cumulative.length - 2]];

    return {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: any[]) => {
          const idx = params[0].dataIndex;
          if (idx === 0) return `基础值: ${base_value.toFixed(2)}`;
          if (idx === categories.length - 1) return `最终预测: ${final_prediction.toFixed(2)}`;
          const f = features[idx - 1];
          return `${f.feature}=${f.value}<br/>SHAP: ${f.shap > 0 ? '+' : ''}${f.shap.toFixed(2)}`;
        },
      },
      grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
      xAxis: { type: 'category', data: categories },
      yAxis: { type: 'value' },
      series: [
        {
          type: 'bar',
          stack: 'total',
          itemStyle: { borderColor: 'transparent', color: 'transparent' },
          emphasis: { itemStyle: { borderColor: 'transparent', color: 'transparent' } },
          data: invisible,
        },
        {
          type: 'bar',
          stack: 'total',
          data: barValues.map((v, i) => ({
            value: v,
            itemStyle: {
              color:
                i === 0
                  ? '#8c8c8c'
                  : i === categories.length - 1
                  ? '#1890ff'
                  : barValues[i] >= 0
                  ? '#52c41a'
                  : '#ff4d4f',
            },
          })),
          label: {
            show: true,
            position: 'top',
            formatter: (p: any) => {
              if (p.dataIndex === 0) return base_value.toFixed(1);
              if (p.dataIndex === categories.length - 1) return final_prediction.toFixed(1);
              const val = values[p.dataIndex - 1];
              return (val > 0 ? '+' : '') + val.toFixed(1);
            },
          },
        },
      ],
    };
  }, [result]);

  return (
    <div style={{ padding: 16, maxWidth: 1400, margin: '0 auto' }}>
      <Title level={4} style={{ marginBottom: 16 }}>
        <BarChartOutlined /> 数据分析中心
      </Title>

      <Tabs
        defaultActiveKey="smart"
        items={[
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
      {/* 配置区 */}
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
          <Col xs={24} sm={24} md={4}>
            <div style={{ marginBottom: 8 }}>
              <Text style={{ opacity: 0 }}>占位</Text>
            </div>
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
      <AIAnalysisAssistant selectedReportId={selectedReportId} />
    </div>
  );
};

export default DataAnalysisPanel;
