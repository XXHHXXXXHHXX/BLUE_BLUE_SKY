'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  Card,
  Select,
  Space,
  Typography,
  Empty,
  Radio,
  Row,
  Col,
  Button,
  Table,
  Tag,
  Input,
} from 'antd';
import {
  LineChartOutlined,
  DotChartOutlined,
  FilterOutlined,
  FolderOpenOutlined,
} from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import { useTestReportStore, type TestReport } from '../../stores/testReportStore';
import type { TestResult } from '../../stores/testStore';
import ReportPicker from './ReportPicker';

const { Text } = Typography;
const { Option } = Select;

type SeriesType = 'score' | 'monitor' | 'param' | 'computed';

interface SeriesOption {
  key: string;
  label: string;
  type: SeriesType;
  id?: string;
  computed?: ComputedSeriesConfig;
}

interface ComputedSeriesItem {
  seriesKey: string;
  operator?: '+' | '-' | '*' | '/';
}

interface ComputedSeriesConfig {
  name: string;
  items: ComputedSeriesItem[];
}

interface DataPoint {
  x: number;
  y: number;
  iteration: number;
  label: string;
  raw: TestResult;
}

function getSeriesOptions(report?: TestReport): SeriesOption[] {
  if (!report?.results?.length) return [];
  const firstResult = report.results[0];
  const opts: SeriesOption[] = [{ key: 'score', label: '性能分数 (score)', type: 'score' }];

  Object.keys(firstResult.monitorResults || {}).forEach((id) => {
    const name = firstResult.monitorResults?.[id]?.commandName || id;
    opts.push({ key: `monitor:${id}`, label: `监控: ${name}`, type: 'monitor', id });
  });

  const paramNames = new Set<string>();
  report.config.iterationParams?.forEach((p) => paramNames.add(p.name));
  report.results.forEach((r) => {
    Object.keys(r.iterationValues || {}).forEach((k) => paramNames.add(k));
  });
  paramNames.forEach((name) => {
    opts.push({ key: `param:${name}`, label: `参数: ${name}`, type: 'param', id: name });
  });

  return opts;
}

function getSeriesValue(result: TestResult, series?: SeriesOption | null, allOptions?: SeriesOption[]): number | null {
  if (!series) return null;
  if (series.type === 'score') return result.score ?? null;
  if (series.type === 'monitor') {
    const mr = result.monitorResults?.[series.id!];
    return mr ? (mr.averageValue ?? null) : null;
  }
  if (series.type === 'param') {
    const raw = result.iterationValues?.[series.id!];
    if (raw === undefined) return null;
    const n = Number(raw);
    return Number.isNaN(n) ? null : n;
  }
  if (series.type === 'computed' && series.computed && allOptions) {
    return computeSeriesValue(result, series.computed, allOptions);
  }
  return null;
}

function getSeriesValueByKey(result: TestResult, seriesKey: string, options: SeriesOption[]): number | null {
  const series = options.find((s) => s.key === seriesKey);
  return getSeriesValue(result, series || null, options);
}

function computeSeriesValue(
  result: TestResult,
  config: ComputedSeriesConfig,
  allOptions: SeriesOption[]
): number | null {
  if (!config.items.length) return null;
  let value = getSeriesValueByKey(result, config.items[0].seriesKey, allOptions);
  if (value === null || Number.isNaN(value)) return null;
  for (let i = 1; i < config.items.length; i++) {
    const item = config.items[i];
    const next = getSeriesValueByKey(result, item.seriesKey, allOptions);
    if (next === null || Number.isNaN(next)) return null;
    switch (item.operator) {
      case '+':
        value += next;
        break;
      case '-':
        value -= next;
        break;
      case '*':
        value *= next;
        break;
      case '/':
        if (next === 0) return null;
        value /= next;
        break;
      default:
        return null;
    }
  }
  return value;
}

interface CustomXYChartPanelProps {
  externalReports?: TestReport[];
  disableFetch?: boolean;
}

const CustomXYChartPanel: React.FC<CustomXYChartPanelProps> = ({
  externalReports,
  disableFetch = false,
}) => {
  const { reports, fetchReports } = useTestReportStore();
  const [selectedReportId, setSelectedReportId] = useState<string>('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [xSeriesKey, setXSeriesKey] = useState<string>('');
  const [ySeriesKey, setYSeriesKey] = useState<string>('');
  const [yComputedMode, setYComputedMode] = useState(false);
  const [yComputedConfig, setYComputedConfig] = useState<ComputedSeriesConfig>({ name: '', items: [] });
  const [groupByKey, setGroupByKey] = useState<string>('');
  const [chartType, setChartType] = useState<'scatter' | 'line'>('scatter');
  const [selectedIterations, setSelectedIterations] = useState<string[]>([]);

  useEffect(() => {
    if (!disableFetch) {
      fetchReports();
    }
  }, [disableFetch, fetchReports]);

  const allReports = useMemo(() => {
    const source = externalReports ?? reports;
    return [...source].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [externalReports, reports]);

  const selectedReport = useMemo(
    () => allReports.find((r) => r.id === selectedReportId),
    [allReports, selectedReportId]
  );

  const seriesOptions = useMemo(() => getSeriesOptions(selectedReport), [selectedReport]);

  const xSeries = useMemo(
    () => seriesOptions.find((s) => s.key === xSeriesKey),
    [seriesOptions, xSeriesKey]
  );
  const ySeries = useMemo(() => {
    if (yComputedMode && yComputedConfig.items.length > 0) {
      return {
        key: 'computed',
        label: yComputedConfig.name || '组合值',
        type: 'computed' as const,
        computed: yComputedConfig,
      };
    }
    return seriesOptions.find((s) => s.key === ySeriesKey);
  }, [seriesOptions, ySeriesKey, yComputedMode, yComputedConfig]);
  const groupBy = useMemo(
    () => (groupByKey ? seriesOptions.find((s) => s.key === groupByKey) : undefined),
    [seriesOptions, groupByKey]
  );

  const iterationOptions = useMemo(() => {
    if (!selectedReport) return [];
    return selectedReport.results.map((r) => ({
      value: String(r.iteration),
      label: `迭代 ${r.iteration}${r.iterationLabel ? ` (${r.iterationLabel})` : ''}`,
    }));
  }, [selectedReport]);

  const { points, seriesData } = useMemo(() => {
    if (!selectedReport || !xSeries || !ySeries) {
      return { points: [], seriesData: [] as any[] };
    }
    const filtered = selectedIterations.length
      ? selectedReport.results.filter((r) => selectedIterations.includes(String(r.iteration)))
      : selectedReport.results;

    const pts: DataPoint[] = filtered
      .map((r) => {
        const x = getSeriesValue(r, xSeries, seriesOptions);
        const y = getSeriesValue(r, ySeries, seriesOptions);
        if (x === null || y === null || Number.isNaN(x) || Number.isNaN(y)) return null;
        return {
          x,
          y,
          iteration: r.iteration,
          label: r.iterationLabel || `${r.iteration}`,
          raw: r,
        };
      })
      .filter((p): p is DataPoint => p !== null);

    if (chartType === 'line') {
      pts.sort((a, b) => a.x - b.x);
    }

    let sdata: any[] = [];
    if (groupBy) {
      const groups = new Map<string, DataPoint[]>();
      pts.forEach((p) => {
        const gv = getSeriesValue(p.raw, groupBy, seriesOptions);
        const key = gv === null ? '未分组' : String(gv);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(p);
      });
      sdata = Array.from(groups.entries()).map(([name, groupPts]) => ({
        name,
        type: chartType,
        data: groupPts.map((p) => [p.x, p.y, p.iteration, p.label]),
        symbolSize: chartType === 'scatter' ? 10 : 6,
        smooth: true,
      }));
    } else {
      sdata = [
        {
          name: `${ySeries.label} vs ${xSeries.label}`,
          type: chartType,
          data: pts.map((p) => [p.x, p.y, p.iteration, p.label]),
          symbolSize: chartType === 'scatter' ? 10 : 6,
          smooth: true,
        },
      ];
    }

    return { points: pts, seriesData: sdata };
  }, [selectedReport, xSeries, ySeries, groupBy, chartType, selectedIterations, seriesOptions]);

  const chartOption = useMemo(() => {
    if (!xSeries || !ySeries || points.length === 0) return null;
    return {
      title: {
        text: `${ySeries.label} vs ${xSeries.label}`,
        left: 'center',
        top: 8,
        textStyle: { fontSize: 14 },
      },
      tooltip: {
        trigger: 'item',
        formatter: (params: any) => {
          const [x, y, iteration, label] = params.data || [];
          return `迭代 ${iteration}<br/>${label}<br/>${xSeries.label}: ${x}<br/>${ySeries.label}: ${y}`;
        },
      },
      grid: { left: '8%', right: '8%', bottom: '12%', top: '18%' },
      legend: groupBy ? { bottom: 0, type: 'scroll' } : undefined,
      xAxis: {
        type: 'value',
        name: xSeries.label,
        scale: true,
        nameLocation: 'middle',
        nameGap: 30,
      },
      yAxis: {
        type: 'value',
        name: ySeries.label,
        scale: true,
        nameLocation: 'middle',
        nameGap: 45,
      },
      dataZoom: [{ type: 'inside' }, { type: 'slider', bottom: groupBy ? 30 : 10 }],
      series: seriesData,
    };
  }, [xSeries, ySeries, points, seriesData, groupBy]);

  const tableColumns = useMemo(() => {
    return [
      { title: '迭代', dataIndex: 'iteration', width: 80 },
      { title: '迭代参数', dataIndex: 'label', ellipsis: true },
      { title: xSeries?.label || 'X', dataIndex: 'x' },
      { title: ySeries?.label || 'Y', dataIndex: 'y' },
      {
        title: '分组',
        dataIndex: 'group',
        render: (v: string) => (v ? <Tag>{v}</Tag> : '-'),
      },
    ];
  }, [xSeries, ySeries]);

  const tableData = useMemo(() => {
    return points.map((p) => ({
      key: p.iteration,
      iteration: p.iteration,
      label: p.label,
      x: p.x,
      y: p.y,
      group: groupBy ? String(getSeriesValue(p.raw, groupBy, seriesOptions) ?? '未分组') : '',
    }));
  }, [points, groupBy, seriesOptions]);

  return (
    <div>
      <Row gutter={16}>
        <Col xs={24} lg={7}>
          <Card title="图表配置" size="small">
            <Space direction="vertical" style={{ width: '100%' }}>
              <div>
                <Text type="secondary" style={{ fontSize: 12 }}>选择报告</Text>
                <Space.Compact style={{ width: '100%' }}>
                  <Select
                    style={{ flex: 1 }}
                    placeholder="选择一份测试报告"
                    value={selectedReportId || undefined}
                    onChange={(value) => {
                      setSelectedReportId(value);
                      setXSeriesKey('');
                      setYSeriesKey('');
                      setYComputedMode(false);
                      setYComputedConfig({ name: '', items: [] });
                      setGroupByKey('');
                      const report = allReports.find((r) => r.id === value);
                      setSelectedIterations(report ? report.results.map((r) => String(r.iteration)) : []);
                    }}
                    allowClear
                  >
                    {allReports.map((r) => (
                      <Option key={r.id} value={r.id}>
                        <Space>
                          <span>{r.name}</span>
                          {r.stageName && <Tag color="purple">{r.stageName}</Tag>}
                        </Space>
                      </Option>
                    ))}
                  </Select>
                  <Button
                    icon={<FolderOpenOutlined />}
                    title="从报告管理中选择"
                    onClick={() => setPickerOpen(true)}
                  />
                </Space.Compact>
                <ReportPicker
                  open={pickerOpen}
                  title="从报告管理中选择报告"
                  mode="single"
                  selectedIds={selectedReportId ? [selectedReportId] : []}
                  onConfirm={(selected) => {
                    const report = selected[0];
                    if (report) {
                      setSelectedReportId(report.id);
                      setXSeriesKey('');
                      setYSeriesKey('');
                      setYComputedMode(false);
                      setYComputedConfig({ name: '', items: [] });
                      setGroupByKey('');
                      setSelectedIterations(report.results.map((r) => String(r.iteration)));
                    }
                    setPickerOpen(false);
                  }}
                  onCancel={() => setPickerOpen(false)}
                />
              </div>

              <div>
                <Text type="secondary" style={{ fontSize: 12 }}>X 轴数据</Text>
                <Select
                  style={{ width: '100%' }}
                  placeholder="选择 X 轴数据系列"
                  value={xSeriesKey || undefined}
                  onChange={setXSeriesKey}
                  allowClear
                  disabled={!selectedReport}
                >
                  {seriesOptions.map((s) => (
                    <Option key={s.key} value={s.key}>
                      {s.label}
                    </Option>
                  ))}
                </Select>
              </div>

              <div>
                <Text type="secondary" style={{ fontSize: 12 }}>Y 轴数据</Text>
                <Select
                  style={{ width: '100%' }}
                  placeholder="选择 Y 轴数据系列"
                  value={yComputedMode ? 'computed' : ySeriesKey || undefined}
                  onChange={(value) => {
                    if (value === 'computed') {
                      setYComputedMode(true);
                      setYSeriesKey('');
                      if (!yComputedConfig.name) {
                        setYComputedConfig((prev) => ({
                          ...prev,
                          name: '组合值',
                          items: prev.items.length ? prev.items : [{ seriesKey: seriesOptions[0]?.key || '' }],
                        }));
                      }
                    } else {
                      setYComputedMode(false);
                      setYSeriesKey(value);
                    }
                  }}
                  allowClear
                  disabled={!selectedReport}
                >
                  {seriesOptions.map((s) => (
                    <Option key={s.key} value={s.key}>
                      {s.label}
                    </Option>
                  ))}
                  <Option key="computed" value="computed">
                    组合计算（自定义）
                  </Option>
                </Select>

                {yComputedMode && (
                  <div
                    style={{
                      marginTop: 12,
                      padding: 12,
                      background: '#fafafa',
                      border: '1px solid #f0f0f0',
                      borderRadius: 6,
                    }}
                  >
                    <Space direction="vertical" style={{ width: '100%' }} size="small">
                      <div>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          组合名称
                        </Text>
                        <Input
                          size="small"
                          placeholder="如：功耗比、总功耗"
                          value={yComputedConfig.name}
                          onChange={(e) =>
                            setYComputedConfig((prev) => ({ ...prev, name: e.target.value }))
                          }
                          style={{ marginTop: 4 }}
                        />
                      </div>

                      {yComputedConfig.items.map((item, index) => (
                        <Space key={index} style={{ width: '100%' }} align="center">
                          {index > 0 && (
                            <Select
                              size="small"
                              value={item.operator || '+'}
                              onChange={(value) => {
                                setYComputedConfig((prev) => {
                                  const items = [...prev.items];
                                  items[index] = { ...items[index], operator: value };
                                  return { ...prev, items };
                                });
                              }}
                              options={[
                                { label: '＋', value: '+' },
                                { label: '－', value: '-' },
                                { label: '×', value: '*' },
                                { label: '÷', value: '/' },
                              ]}
                              style={{ width: 60 }}
                            />
                          )}
                          <Select
                            size="small"
                            style={{ flex: 1 }}
                            placeholder="选择数据项"
                            value={item.seriesKey || undefined}
                            onChange={(value) => {
                              setYComputedConfig((prev) => {
                                const items = [...prev.items];
                                items[index] = { ...items[index], seriesKey: value };
                                return { ...prev, items };
                              });
                            }}
                          >
                            {seriesOptions.map((s) => (
                              <Option key={s.key} value={s.key}>
                                {s.label}
                              </Option>
                            ))}
                          </Select>
                          <Button
                            size="small"
                            danger
                            onClick={() => {
                              setYComputedConfig((prev) => ({
                                ...prev,
                                items: prev.items.filter((_, i) => i !== index),
                              }));
                            }}
                          >
                            删除
                          </Button>
                        </Space>
                      ))}

                      <Button
                        size="small"
                        type="dashed"
                        style={{ width: '100%' }}
                        onClick={() => {
                          setYComputedConfig((prev) => ({
                            ...prev,
                            items: [...prev.items, { seriesKey: '', operator: '+' }],
                          }));
                        }}
                      >
                        添加数据项
                      </Button>

                      {yComputedConfig.items.length > 1 && (
                        <Text type="secondary" style={{ fontSize: 11 }}>
                          计算顺序为从左到右依次运算。
                        </Text>
                      )}
                    </Space>
                  </div>
                )}
              </div>

              <div>
                <Text type="secondary" style={{ fontSize: 12 }}>分组维度（可选）</Text>
                <Select
                  style={{ width: '100%' }}
                  placeholder="选择分组维度，同一组显示为一条曲线/一种颜色"
                  value={groupByKey || undefined}
                  onChange={setGroupByKey}
                  allowClear
                  disabled={!selectedReport}
                >
                  {seriesOptions.map((s) => (
                    <Option key={s.key} value={s.key}>
                      {s.label}
                    </Option>
                  ))}
                </Select>
              </div>

              <div>
                <Text type="secondary" style={{ fontSize: 12 }}>图表类型</Text>
                <Radio.Group
                  value={chartType}
                  onChange={(e) => setChartType(e.target.value)}
                  buttonStyle="solid"
                >
                  <Radio.Button value="scatter">
                    <Space>
                      <DotChartOutlined />
                      散点图
                    </Space>
                  </Radio.Button>
                  <Radio.Button value="line">
                    <Space>
                      <LineChartOutlined />
                      折线图
                    </Space>
                  </Radio.Button>
                </Radio.Group>
              </div>

              <div>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  <Space>
                    <FilterOutlined />
                    选择迭代组合
                  </Space>
                </Text>
                <Select
                  mode="multiple"
                  style={{ width: '100%' }}
                  placeholder="选择要在图上显示的迭代"
                  value={selectedIterations}
                  onChange={setSelectedIterations}
                  options={iterationOptions}
                  disabled={!selectedReport}
                  maxTagCount={3}
                  allowClear
                />
                <Space style={{ marginTop: 8 }}>
                  <Button
                    size="small"
                    onClick={() =>
                      setSelectedIterations(selectedReport?.results.map((r) => String(r.iteration)) || [])
                    }
                    disabled={!selectedReport}
                  >
                    全选
                  </Button>
                  <Button size="small" onClick={() => setSelectedIterations([])} disabled={!selectedReport}>
                    清空
                  </Button>
                </Space>
              </div>
            </Space>
          </Card>
        </Col>

        <Col xs={24} lg={17}>
          <Card title="XY 关系图" size="small" style={{ height: '100%' }}>
            {chartOption ? (
              <ReactECharts option={chartOption} style={{ height: 520 }} notMerge />
            ) : (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  !selectedReport
                    ? '请先选择一份测试报告'
                    : !xSeries || !ySeries
                    ? '请选择 X 轴和 Y 轴数据系列'
                    : yComputedMode && yComputedConfig.items.some((it) => !it.seriesKey)
                    ? '请完成 Y 轴组合计算配置'
                    : '所选迭代没有有效数据点'
                }
                style={{ marginTop: 80 }}
              />
            )}
          </Card>
        </Col>
      </Row>

      {points.length > 0 && (
        <Card title="数据明细" size="small" style={{ marginTop: 16 }}>
          <Table
            columns={tableColumns}
            dataSource={tableData}
            size="small"
            pagination={{ pageSize: 10, showSizeChanger: true }}
          />
        </Card>
      )}
    </div>
  );
};

export default CustomXYChartPanel;
