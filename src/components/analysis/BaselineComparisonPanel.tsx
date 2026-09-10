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
  Table,
  Tooltip,
  Descriptions,
  Badge,
  InputNumber,
  Switch,
} from 'antd';
import {
  ExperimentOutlined,
  CheckCircleOutlined,
  InfoCircleOutlined,
  RiseOutlined,
  FallOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import { useTestReportStore, type TestReport } from '../../stores/testReportStore';

const { Text, Paragraph } = Typography;
const { Option } = Select;

interface BaselineComparisonResult {
  paramName: string;
  baselineValue: string | number;
  optimalValue: string | number;
  baselineTarget: number;
  optimalTarget: number;
  absoluteDiff: number;
  percentDiff: number;
  isImprovement: boolean;
  matchedSamples: number;
  matchedData: Array<{
    value: string | number;
    target: number;
    iteration: number;
    iterationLabel?: string;
    reportName: string;
    reportId: string;
  }>;
  // 指定值对比（动态计算）
  specifiedValue?: string | number;
  specifiedTarget?: number;
  specifiedDiff?: number;
  specifiedPercentDiff?: number;
  specifiedIsImprovement?: boolean;
}

interface ComparisonConfig {
  baselineReportId: string;
  baselineIteration: number;
  targetMetric: string;
  direction: 'max' | 'min';
  compareReportIds: string[];
  tolerance: number;
  useTolerance: boolean;
}

const BaselineComparisonPanel: React.FC = () => {
  const { reports, fetchReports } = useTestReportStore();

  const [config, setConfig] = useState<ComparisonConfig>({
    baselineReportId: '',
    baselineIteration: -1,
    targetMetric: 'score',
    direction: 'max',
    compareReportIds: [],
    tolerance: 0.01,
    useTolerance: false,
  });

  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<BaselineComparisonResult[]>([]);
  const [error, setError] = useState('');
  const [specifiedValues, setSpecifiedValues] = useState<Record<string, string | number>>({});

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  const allReports = useMemo(() => {
    return [...reports].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }, [reports]);

  const baselineReport = useMemo(() => {
    return allReports.find((r) => r.id === config.baselineReportId);
  }, [allReports, config.baselineReportId]);

  const baselineResult = useMemo(() => {
    if (!baselineReport) return null;
    return baselineReport.results.find((r) => r.iteration === config.baselineIteration);
  }, [baselineReport, config.baselineIteration]);

  const targetOptions = useMemo(() => {
    const opts = [{ label: '性能分数 (score)', value: 'score' }];
    if (baselineReport?.results?.length) {
      const firstResult = baselineReport.results[0];
      const monitorIds = firstResult?.monitorResults ? Object.keys(firstResult.monitorResults) : [];
      monitorIds.forEach((id) => {
        const name = firstResult.monitorResults?.[id]?.commandName || id;
        opts.push({ label: `监控: ${name}`, value: id });
      });
    } else {
      // 如果没有基线报告，遍历所有报告找监控项
      allReports.forEach((report) => {
        if (report.results?.length) {
          const firstResult = report.results[0];
          const monitorIds = firstResult?.monitorResults ? Object.keys(firstResult.monitorResults) : [];
          monitorIds.forEach((id) => {
            const name = firstResult.monitorResults?.[id]?.commandName || id;
            if (!opts.find((o) => o.value === id)) {
              opts.push({ label: `监控: ${name}`, value: id });
            }
          });
        }
      });
    }
    return opts;
  }, [baselineReport, allReports]);

  const iterationOptions = useMemo(() => {
    if (!baselineReport) return [];
    return baselineReport.results.map((r) => ({
      label: r.iterationLabel || `迭代 ${r.iteration}`,
      value: r.iteration,
      targetValue: getTargetValue(r, config.targetMetric),
    }));
  }, [baselineReport, config.targetMetric]);

  const paramNames = useMemo(() => {
    if (!baselineReport) return [];
    const params = baselineReport.config.iterationParams?.map((p) => p.name) || [];
    if (params.length === 0 && baselineReport.results.length > 0) {
      const keys = new Set<string>();
      baselineReport.results.forEach((r) => {
        if (r.iterationValues) Object.keys(r.iterationValues).forEach((k) => keys.add(k));
      });
      return Array.from(keys);
    }
    return params;
  }, [baselineReport]);

  function getTargetValue(result: any, target: string): number {
    if (target === 'score') return result.score ?? 0;
    const mr = result.monitorResults;
    if (mr && mr[target]) return mr[target].averageValue ?? 0;
    return 0;
  }

  function normalizeValue(v: string | number | undefined): number {
    if (v === undefined || v === null) return 0;
    const n = Number(v);
    return isNaN(n) ? 0 : n;
  }

  function valuesMatch(
    val1: string | number | undefined,
    val2: string | number | undefined,
    tolerance: number
  ): boolean {
    const n1 = normalizeValue(val1);
    const n2 = normalizeValue(val2);
    if (config.useTolerance) {
      return Math.abs(n1 - n2) <= tolerance;
    }
    return String(val1).trim() === String(val2).trim();
  }

  function handleAnalyze() {
    if (!baselineReport || !baselineResult) return;
    setLoading(true);
    setError('');
    setResults([]);

    try {
      const baselineParams = baselineResult.iterationValues || {};
      const baselineTarget = getTargetValue(baselineResult, config.targetMetric);

      // 收集对比数据
      const compareReports = config.compareReportIds.length > 0
        ? allReports.filter((r) => config.compareReportIds.includes(r.id))
        : [baselineReport];

      const allData: Array<{
        result: any;
        report: TestReport;
      }> = [];
      compareReports.forEach((report) => {
        report.results.forEach((result) => {
          allData.push({ result, report });
        });
      });

      const analysisResults: BaselineComparisonResult[] = [];

      for (const paramName of paramNames) {
        const baselineValue = baselineParams[paramName] ?? '-';

        // 筛选：其他参数与基线相同，当前参数可以不同
        const matched = allData.filter(({ result }) => {
          const iv = result.iterationValues || {};
          for (const otherParam of paramNames) {
            if (otherParam === paramName) continue;
            if (!valuesMatch(iv[otherParam], baselineParams[otherParam], config.tolerance)) {
              return false;
            }
          }
          return true;
        });

        if (matched.length === 0) {
          analysisResults.push({
            paramName,
            baselineValue,
            optimalValue: '-',
            baselineTarget,
            optimalTarget: baselineTarget,
            absoluteDiff: 0,
            percentDiff: 0,
            isImprovement: false,
            matchedSamples: 0,
            matchedData: [],
          });
          continue;
        }

        // 按目标值排序找最优
        const sorted = [...matched].sort((a, b) => {
          const ta = getTargetValue(a.result, config.targetMetric);
          const tb = getTargetValue(b.result, config.targetMetric);
          return config.direction === 'max' ? tb - ta : ta - tb;
        });

        const best = sorted[0];
        const optimalTarget = getTargetValue(best.result, config.targetMetric);
        const optimalValue = best.result.iterationValues?.[paramName] ?? '-';
        const absoluteDiff = optimalTarget - baselineTarget;
        const percentDiff = baselineTarget !== 0 ? (absoluteDiff / Math.abs(baselineTarget)) * 100 : 0;
        const isImprovement = config.direction === 'max' ? absoluteDiff > 0 : absoluteDiff < 0;

        analysisResults.push({
          paramName,
          baselineValue,
          optimalValue,
          baselineTarget,
          optimalTarget,
          absoluteDiff,
          percentDiff,
          isImprovement,
          matchedSamples: matched.length,
          matchedData: matched.map(({ result, report }) => ({
            value: result.iterationValues?.[paramName] ?? '-',
            target: getTargetValue(result, config.targetMetric),
            iteration: result.iteration,
            iterationLabel: result.iterationLabel,
            reportName: report.name,
            reportId: report.id,
          })),
        });
      }

      setResults(analysisResults);
      setSpecifiedValues({});
    } catch (err) {
      setError(err instanceof Error ? err.message : '分析异常');
    } finally {
      setLoading(false);
    }
  }

  const isAnalyzeDisabled = !baselineReport || !baselineResult;

  // 计算指定值对比结果
  function computeSpecifiedComparison(
    paramName: string,
    value: string | number,
    result: BaselineComparisonResult
  ): Partial<BaselineComparisonResult> {
    if (!value && value !== 0) return {};
    const targetVal = normalizeValue(value);

    // 在匹配数据中查找最接近的数据点
    let closest = null;
    let minDiff = Infinity;

    for (const d of result.matchedData) {
      const dv = normalizeValue(d.value);
      const diff = Math.abs(dv - targetVal);
      if (diff < minDiff) {
        minDiff = diff;
        closest = d;
      }
      // 精确匹配优先
      if (diff === 0) break;
    }

    if (!closest) return {};

    const specifiedTarget = closest.target;
    const absoluteDiff = specifiedTarget - result.baselineTarget;
    const percentDiff = result.baselineTarget !== 0 ? (absoluteDiff / Math.abs(result.baselineTarget)) * 100 : 0;
    const isImprovement = config.direction === 'max' ? absoluteDiff > 0 : absoluteDiff < 0;

    return {
      specifiedValue: closest.value,
      specifiedTarget,
      specifiedDiff: absoluteDiff,
      specifiedPercentDiff: percentDiff,
      specifiedIsImprovement: isImprovement,
    };
  }

  function updateSpecifiedValue(paramName: string, value: string | number) {
    setSpecifiedValues((prev) => ({ ...prev, [paramName]: value }));
    setResults((prev) =>
      prev.map((r) => {
        if (r.paramName !== paramName) return r;
        const computed = computeSpecifiedComparison(paramName, value, r);
        return { ...r, ...computed };
      })
    );
  }

  // 图表配置
  const comparisonBarOption = useMemo(() => {
    if (!results.length) return null;
    const categories = results.map((r) => r.paramName);
    const diffs = results.map((r) => ({
      value: parseFloat(r.absoluteDiff.toFixed(4)),
      itemStyle: {
        color: r.isImprovement ? '#52c41a' : r.absoluteDiff < 0 ? '#ff4d4f' : '#8c8c8c',
      },
    }));

    return {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: any[]) => {
          const idx = params[0].dataIndex;
          const r = results[idx];
          return `${r.paramName}<br/>
            基线值: ${r.baselineValue}<br/>
            基线目标: ${r.baselineTarget.toFixed(2)}<br/>
            最优值: ${r.optimalValue}<br/>
            最优目标: ${r.optimalTarget.toFixed(2)}<br/>
            差异: ${r.absoluteDiff > 0 ? '+' : ''}${r.absoluteDiff.toFixed(4)} (${r.percentDiff.toFixed(2)}%)`;
        },
      },
      grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
      xAxis: {
        type: 'category',
        data: categories,
      },
      yAxis: {
        type: 'value',
        name: '目标差异',
        axisLabel: {
          formatter: (v: number) => (v > 0 ? `+${v}` : `${v}`),
        },
      },
      series: [
        {
          type: 'bar',
          data: diffs,
          barWidth: '50%',
          label: {
            show: true,
            position: 'top',
            formatter: (p: any) => {
              const r = results[p.dataIndex];
              return `${r.absoluteDiff > 0 ? '+' : ''}${r.absoluteDiff.toFixed(2)}`;
            },
          },
        },
      ],
    };
  }, [results]);

  const comparisonScatterOption = useMemo(() => {
    if (!results.length) return null;

    const series: any[] = [];
    results.forEach((r, idx) => {
      if (r.matchedData.length === 0) return;
      series.push({
        name: r.paramName,
        type: 'scatter',
        data: r.matchedData.map((d) => [normalizeValue(d.value), d.target]),
        symbolSize: 10,
        emphasis: {
          focus: 'series',
        },
      });
    });

    return {
      tooltip: {
        trigger: 'item',
        formatter: (params: any) => {
          return `${params.seriesName}<br/>
            参数值: ${params.data[0]}<br/>
            目标值: ${params.data[1].toFixed(2)}`;
        },
      },
      legend: {
        data: results.filter((r) => r.matchedData.length > 0).map((r) => r.paramName),
        bottom: 0,
      },
      grid: { left: '3%', right: '4%', bottom: '10%', containLabel: true },
      xAxis: {
        type: 'value',
        name: '参数值',
        scale: true,
      },
      yAxis: {
        type: 'value',
        name: '目标值',
        scale: true,
      },
      series,
    };
  }, [results]);

  const columns = [
    {
      title: '参数',
      dataIndex: 'paramName',
      key: 'paramName',
      render: (v: string) => <Text strong>{v}</Text>,
    },
    {
      title: '基线值',
      dataIndex: 'baselineValue',
      key: 'baselineValue',
    },
    {
      title: '最优值',
      dataIndex: 'optimalValue',
      key: 'optimalValue',
      render: (v: string | number, record: BaselineComparisonResult) => (
        <Text strong style={{ color: record.matchedSamples > 0 ? '#1890ff' : '#8c8c8c' }}>
          {v}
        </Text>
      ),
    },
    {
      title: '指定值',
      key: 'specifiedValue',
      render: (_: any, record: BaselineComparisonResult) => (
        <InputNumber
          size="small"
          style={{ width: 90 }}
          placeholder="输入值"
          value={specifiedValues[record.paramName]}
          onChange={(val) => updateSpecifiedValue(record.paramName, val ?? '')}
          disabled={record.matchedSamples === 0}
        />
      ),
    },
    {
      title: '基线目标',
      dataIndex: 'baselineTarget',
      key: 'baselineTarget',
      render: (v: number) => v.toFixed(4),
    },
    {
      title: '最优目标',
      dataIndex: 'optimalTarget',
      key: 'optimalTarget',
      render: (v: number, record: BaselineComparisonResult) => (
        <Text strong style={{ color: record.matchedSamples > 0 ? '#1890ff' : '#8c8c8c' }}>
          {v.toFixed(4)}
        </Text>
      ),
    },
    {
      title: '指定目标',
      key: 'specifiedTarget',
      render: (_: any, record: BaselineComparisonResult) => (
        <Text
          strong
          style={{ color: record.specifiedTarget !== undefined ? '#fa8c16' : '#8c8c8c' }}
        >
          {record.specifiedTarget !== undefined ? record.specifiedTarget.toFixed(4) : '-'}
        </Text>
      ),
    },
    {
      title: '最优差异',
      dataIndex: 'absoluteDiff',
      key: 'absoluteDiff',
      render: (v: number, record: BaselineComparisonResult) => (
        <Space>
          {record.isImprovement ? (
            <RiseOutlined style={{ color: '#52c41a' }} />
          ) : v < 0 ? (
            <FallOutlined style={{ color: '#ff4d4f' }} />
          ) : (
            <SyncOutlined style={{ color: '#8c8c8c' }} />
          )}
          <Text
            strong
            style={{
              color: record.isImprovement ? '#52c41a' : v < 0 ? '#ff4d4f' : '#8c8c8c',
            }}
          >
            {v > 0 ? '+' : ''}{v.toFixed(4)}
          </Text>
        </Space>
      ),
    },
    {
      title: '指定差异',
      key: 'specifiedDiff',
      render: (_: any, record: BaselineComparisonResult) => {
        if (record.specifiedDiff === undefined) return <Text type="secondary">-</Text>;
        const v = record.specifiedDiff;
        return (
          <Space>
            {record.specifiedIsImprovement ? (
              <RiseOutlined style={{ color: '#52c41a' }} />
            ) : v < 0 ? (
              <FallOutlined style={{ color: '#ff4d4f' }} />
            ) : (
              <SyncOutlined style={{ color: '#8c8c8c' }} />
            )}
            <Text
              strong
              style={{
                color: record.specifiedIsImprovement ? '#52c41a' : v < 0 ? '#ff4d4f' : '#8c8c8c',
              }}
            >
              {v > 0 ? '+' : ''}{v.toFixed(4)}
            </Text>
          </Space>
        );
      },
    },
    {
      title: '最优变化',
      dataIndex: 'percentDiff',
      key: 'percentDiff',
      render: (v: number, record: BaselineComparisonResult) => (
        <Text
          strong
          style={{
            color: record.isImprovement ? '#52c41a' : v < 0 ? '#ff4d4f' : '#8c8c8c',
          }}
        >
          {v > 0 ? '+' : ''}{v.toFixed(2)}%
        </Text>
      ),
    },
    {
      title: '指定变化',
      key: 'specifiedPercentDiff',
      render: (_: any, record: BaselineComparisonResult) => {
        if (record.specifiedPercentDiff === undefined) return <Text type="secondary">-</Text>;
        const v = record.specifiedPercentDiff;
        return (
          <Text
            strong
            style={{
              color: record.specifiedIsImprovement ? '#52c41a' : v < 0 ? '#ff4d4f' : '#8c8c8c',
            }}
          >
            {v > 0 ? '+' : ''}{v.toFixed(2)}%
          </Text>
        );
      },
    },
    {
      title: '匹配样本',
      dataIndex: 'matchedSamples',
      key: 'matchedSamples',
      render: (v: number) => (
        <Badge
          count={v}
          style={{ backgroundColor: v > 0 ? '#1890ff' : '#d9d9d9' }}
          showZero
        />
      ),
    },
  ];

  return (
    <div>
      {/* 配置区 */}
      <Card title="基线对比配置" style={{ marginBottom: 16 }}>
        <Row gutter={[16, 16]}>
          <Col xs={24} sm={12} md={8}>
            <div style={{ marginBottom: 8 }}>
              <Text strong>选择基线报告</Text>
            </div>
            <Select
              showSearch
              placeholder="请选择基线报告"
              style={{ width: '100%' }}
              value={config.baselineReportId || undefined}
              onChange={(val) =>
                setConfig((prev) => ({
                  ...prev,
                  baselineReportId: val,
                  baselineIteration: -1,
                }))
              }
              optionFilterProp="label"
            >
              {allReports.map((r) => (
                <Option key={r.id} value={r.id} label={r.name}>
                  <Space>
                    <Badge color="blue" />
                    {r.name}
                    <Tag style={{ fontSize: 12, lineHeight: '18px', padding: '0 4px' }}>
                      {r.results.length} 条数据
                    </Tag>
                  </Space>
                </Option>
              ))}
            </Select>
          </Col>

          <Col xs={24} sm={12} md={6}>
            <div style={{ marginBottom: 8 }}>
              <Text strong>基线迭代点</Text>
            </div>
            <Select
              showSearch
              placeholder="选择迭代点"
              style={{ width: '100%' }}
              value={config.baselineIteration >= 0 ? config.baselineIteration : undefined}
              onChange={(val) =>
                setConfig((prev) => ({ ...prev, baselineIteration: val }))
              }
              disabled={!baselineReport}
              optionFilterProp="label"
              labelRender={(item) => {
                const fullLabel = iterationOptions.find((o) => o.value === item.value)?.label ?? String(item.label);
                return (
                  <Tooltip title={fullLabel} placement="topLeft">
                    <span>{item.label}</span>
                  </Tooltip>
                );
              }}
            >
              {iterationOptions.map((opt) => (
                <Option key={opt.value} value={opt.value} label={opt.label} title={opt.label}>
                  <Space>
                    {opt.label}
                    <Tag style={{ fontSize: 12, lineHeight: '18px', padding: '0 4px' }}>目标: {opt.targetValue.toFixed(2)}</Tag>
                  </Space>
                </Option>
              ))}
            </Select>
          </Col>

          <Col xs={24} sm={12} md={5}>
            <div style={{ marginBottom: 8 }}>
              <Text strong>分析目标</Text>
            </div>
            <Select
              style={{ width: '100%' }}
              value={config.targetMetric}
              onChange={(val) => setConfig((prev) => ({ ...prev, targetMetric: val }))}
              options={targetOptions}
            />
          </Col>

          <Col xs={24} sm={12} md={5}>
            <div style={{ marginBottom: 8 }}>
              <Text strong>优化方向</Text>
            </div>
            <Select
              style={{ width: '100%' }}
              value={config.direction}
              onChange={(val) => setConfig((prev) => ({ ...prev, direction: val }))}
              options={[
                { label: '寻找最大', value: 'max' },
                { label: '寻找最小', value: 'min' },
              ]}
            />
          </Col>
        </Row>

        <Row gutter={[16, 16]} style={{ marginTop: 8 }}>
          <Col xs={24} sm={12} md={8}>
            <div style={{ marginBottom: 8 }}>
              <Text strong>对比报告（可多选，默认使用基线报告自身）</Text>
            </div>
            <Select
              mode="multiple"
              showSearch
              placeholder="选择要对比的报告"
              style={{ width: '100%' }}
              value={config.compareReportIds}
              onChange={(vals) =>
                setConfig((prev) => ({ ...prev, compareReportIds: vals }))
              }
              optionFilterProp="label"
            >
              {allReports
                .filter((r) => r.id !== config.baselineReportId)
                .map((r) => (
                  <Option key={r.id} value={r.id} label={r.name}>
                    <Space>
                      <Badge color="green" />
                      {r.name}
                      <Tag style={{ fontSize: 12, lineHeight: '18px', padding: '0 4px' }}>{r.results.length} 条</Tag>
                    </Space>
                  </Option>
                ))}
            </Select>
          </Col>

          <Col xs={24} sm={12} md={8}>
            <div style={{ marginBottom: 8 }}>
              <Text strong>匹配容差</Text>
              <Tooltip title="开启后，其他参数值在容差范围内即视为匹配。用于处理浮点数精度问题">
                <InfoCircleOutlined style={{ marginLeft: 4, color: '#8c8c8c' }} />
              </Tooltip>
            </div>
            <Space>
              <Switch
                checked={config.useTolerance}
                onChange={(checked) =>
                  setConfig((prev) => ({ ...prev, useTolerance: checked }))
                }
              />
              <InputNumber
                min={0}
                step={0.01}
                value={config.tolerance}
                onChange={(val) =>
                  setConfig((prev) => ({ ...prev, tolerance: val ?? 0 }))
                }
                disabled={!config.useTolerance}
                style={{ width: 100 }}
              />
              <Text type="secondary">{config.useTolerance ? '启用' : '精确匹配'}</Text>
            </Space>
          </Col>

          <Col xs={24} sm={24} md={8}>
            <div style={{ marginBottom: 8 }}>
              <Text style={{ opacity: 0 }}>占位</Text>
            </div>
            <Button
              type="primary"
              icon={<ExperimentOutlined />}
              loading={loading}
              disabled={isAnalyzeDisabled}
              onClick={handleAnalyze}
              size="large"
            >
              启动基线对比分析
            </Button>
          </Col>
        </Row>

        {baselineResult && (
          <div style={{ marginTop: 12 }}>
            <Alert
              message="基线信息"
              description={
                <Space direction="vertical" size={0} style={{ width: '100%' }}>
                  <Space wrap>
                    <Tag icon={<CheckCircleOutlined />} color="blue">
                      {baselineReport?.name}
                    </Tag>
                    <Tag>迭代: {baselineResult.iterationLabel || baselineResult.iteration}</Tag>
                    <Tag>目标值: {getTargetValue(baselineResult, config.targetMetric).toFixed(4)}</Tag>
                  </Space>
                  <Space wrap style={{ marginTop: 4 }}>
                    {Object.entries(baselineResult.iterationValues || {}).map(([k, v]) => (
                      <Tag key={k} color="cyan">
                        {k} = {v}
                      </Tag>
                    ))}
                  </Space>
                </Space>
              }
              type="info"
              showIcon
            />
          </div>
        )}
      </Card>

      {error && (
        <Alert message={error} type="error" showIcon style={{ marginBottom: 16 }} />
      )}

      {loading && (
        <Card style={{ textAlign: 'center', padding: 40 }}>
          <Spin size="large" />
          <Paragraph style={{ marginTop: 16 }}>正在进行基线对比分析，请稍候…</Paragraph>
        </Card>
      )}

      {results.length > 0 && !loading && (
        <>
          {/* 统计概览 */}
          <Row gutter={16} style={{ marginBottom: 16 }}>
            <Col xs={12} sm={6}>
              <Card>
                <Statistic
                  title="分析参数数"
                  value={results.length}
                />
              </Card>
            </Col>
            <Col xs={12} sm={6}>
              <Card>
                <Statistic
                  title="有匹配的参数"
                  value={results.filter((r) => r.matchedSamples > 0).length}
                  valueStyle={{ color: '#1890ff' }}
                />
              </Card>
            </Col>
            <Col xs={12} sm={6}>
              <Card>
                <Statistic
                  title="整体提升参数"
                  value={results.filter((r) => r.isImprovement).length}
                  valueStyle={{ color: '#52c41a' }}
                />
              </Card>
            </Col>
            <Col xs={12} sm={6}>
              <Card>
                <Statistic
                  title="整体降低参数"
                  value={results.filter((r) => !r.isImprovement && r.absoluteDiff < 0).length}
                  valueStyle={{ color: '#ff4d4f' }}
                />
              </Card>
            </Col>
          </Row>

          {/* 差异柱状图 */}
          <Card title="各参数最优值 vs 基线差异" style={{ marginBottom: 16 }}>
            {comparisonBarOption ? (
              <ReactECharts option={comparisonBarOption} style={{ height: 360 }} />
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无数据" />
            )}
          </Card>

          {/* 散点图 */}
          <Card title="各参数取值与目标值分布" style={{ marginBottom: 16 }}>
            {comparisonScatterOption ? (
              <ReactECharts option={comparisonScatterOption} style={{ height: 400 }} />
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无数据" />
            )}
          </Card>

          {/* 详细表格 */}
          <Card title="基线对比分析明细" style={{ marginBottom: 16 }}>
            <Table
              dataSource={results}
              columns={columns}
              rowKey="paramName"
              pagination={false}
              expandable={{
                expandedRowRender: (record: BaselineComparisonResult) => (
                  <div style={{ padding: '8px 0' }}>
                    <Text strong>匹配数据点：</Text>
                    <Table
                      size="small"
                      dataSource={record.matchedData}
                      pagination={{ pageSize: 5, hideOnSinglePage: true }}
                      columns={[
                        { title: '报告', dataIndex: 'reportName', key: 'reportName' },
                        { title: '迭代', dataIndex: 'iteration', key: 'iteration' },
                        { title: `${record.paramName}值`, dataIndex: 'value', key: 'value' },
                        {
                          title: '目标值',
                          dataIndex: 'target',
                          key: 'target',
                          render: (v: number) => v.toFixed(4),
                        },
                      ]}
                      rowKey={(r: any) => `${r.reportId}-${r.iteration}`}
                    />
                  </div>
                ),
              }}
            />
          </Card>
        </>
      )}

      {!results.length && !loading && !error && (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="选择基线报告和迭代点，点击「启动基线对比分析」开始"
          style={{ marginTop: 40 }}
        />
      )}
    </div>
  );
};

export default BaselineComparisonPanel;
