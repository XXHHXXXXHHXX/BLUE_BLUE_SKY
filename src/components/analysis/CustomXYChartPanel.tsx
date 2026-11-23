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
  Checkbox,
} from 'antd';
import {
  LineChartOutlined,
  DotChartOutlined,
  FilterOutlined,
  FolderOpenOutlined,
} from '@ant-design/icons';
import { useTestReportStore, type TestReport } from '../../stores/testReportStore';
import ReportPicker from './ReportPicker';
import AutoResizeChart from './AutoResizeChart';
import {
  buildXYChartOption,
  computeXYChart,
  createDefaultXYChartConfig,
  getSeriesOptions,
  getSeriesValue,
  type XYChartConfig,
} from './xyChartShared';

const { Text } = Typography;
const { Option } = Select;

interface CustomXYChartPanelProps {
  externalReports?: TestReport[];
  disableFetch?: boolean;
  /** 受控配置：传入后不再使用内部状态（合并图表复用同一套配置） */
  config?: XYChartConfig;
  onConfigChange?: (config: XYChartConfig) => void;
}

const CustomXYChartPanel: React.FC<CustomXYChartPanelProps> = ({
  externalReports,
  disableFetch = false,
  config: controlledConfig,
  onConfigChange,
}) => {
  const { reports, fetchReports } = useTestReportStore();
  const [innerConfig, setInnerConfig] = useState<XYChartConfig>(createDefaultXYChartConfig);
  const [pickerOpen, setPickerOpen] = useState(false);

  const isControlled = controlledConfig !== undefined;
  const config = isControlled ? controlledConfig! : innerConfig;
  const updateConfig = (patch: Partial<XYChartConfig>) => {
    const next = { ...config, ...patch };
    if (isControlled) onConfigChange?.(next);
    else setInnerConfig(next);
  };

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
    () => allReports.find((r) => r.id === config.reportId),
    [allReports, config.reportId]
  );

  const seriesOptions = useMemo(() => getSeriesOptions(selectedReport), [selectedReport]);

  const iterationOptions = useMemo(() => {
    if (!selectedReport) return [];
    return selectedReport.results.map((r) => ({
      value: String(r.iteration),
      label: `迭代 ${r.iteration}${r.iterationLabel ? ` (${r.iterationLabel})` : ''}`,
    }));
  }, [selectedReport]);

  const computed = useMemo(() => computeXYChart(config, selectedReport), [config, selectedReport]);
  const chartOption = useMemo(() => buildXYChartOption(computed, config), [computed, config]);

  const selectReport = (reportId: string) => {
    const report = allReports.find((r) => r.id === reportId);
    updateConfig({
      reportId,
      xSeriesKey: '',
      ySeriesKey: '',
      yComputedMode: false,
      yComputedConfig: { name: '', items: [] },
      groupByKey: '',
      selectedIterations: report ? report.results.map((r) => String(r.iteration)) : [],
    });
  };

  const tableColumns = useMemo(() => {
    return [
      { title: '迭代', dataIndex: 'iteration', width: 80 },
      { title: '迭代参数', dataIndex: 'label', ellipsis: true },
      { title: computed.xLabel || 'X', dataIndex: 'x' },
      { title: computed.yLabel || 'Y', dataIndex: 'y' },
      {
        title: '分组',
        dataIndex: 'group',
        render: (v: string) => (v ? <Tag>{v}</Tag> : '-'),
      },
    ];
  }, [computed.xLabel, computed.yLabel]);

  const tableData = useMemo(() => {
    const groupBy = config.groupByKey ? seriesOptions.find((s) => s.key === config.groupByKey) : undefined;
    return computed.points.map((p) => ({
      key: p.iteration,
      iteration: p.iteration,
      label: p.label,
      x: p.x,
      y: p.y,
      group: groupBy ? String(getSeriesValue(p.raw, groupBy, seriesOptions) ?? '未分组') : '',
    }));
  }, [computed.points, config.groupByKey, seriesOptions]);

  return (
    <div>
      <Row gutter={16}>
        <Col xs={24} lg={8}>
          <Card
            title="图表配置"
            size="small"
            styles={{ body: { maxHeight: 620, overflowY: 'auto' } }}
          >
            <Space direction="vertical" style={{ width: '100%' }}>
              <div>
                <Text type="secondary" style={{ fontSize: 12 }}>选择报告</Text>
                <Space.Compact style={{ width: '100%' }}>
                  <Select
                    style={{ flex: 1 }}
                    placeholder="选择一份测试报告"
                    value={config.reportId || undefined}
                    onChange={selectReport}
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
                  selectedIds={config.reportId ? [config.reportId] : []}
                  onConfirm={(selected) => {
                    const report = selected[0];
                    if (report) {
                      selectReport(report.id);
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
                  value={config.xSeriesKey || undefined}
                  onChange={(v) => updateConfig({ xSeriesKey: v })}
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
                  value={config.yComputedMode ? 'computed' : config.ySeriesKey || undefined}
                  onChange={(value) => {
                    if (value === 'computed') {
                      updateConfig({
                        yComputedMode: true,
                        ySeriesKey: '',
                        yComputedConfig: config.yComputedConfig.name
                          ? config.yComputedConfig
                          : {
                              ...config.yComputedConfig,
                              name: '组合值',
                              items: config.yComputedConfig.items.length
                                ? config.yComputedConfig.items
                                : [{ seriesKey: seriesOptions[0]?.key || '' }],
                            },
                      });
                    } else {
                      updateConfig({ yComputedMode: false, ySeriesKey: value });
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

                {config.yComputedMode && (
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
                          value={config.yComputedConfig.name}
                          onChange={(e) =>
                            updateConfig({
                              yComputedConfig: { ...config.yComputedConfig, name: e.target.value },
                            })
                          }
                          style={{ marginTop: 4 }}
                        />
                      </div>

                      {config.yComputedConfig.items.map((item, index) => (
                        <Space key={index} style={{ width: '100%' }} align="center">
                          {index > 0 && (
                            <Select
                              size="small"
                              value={item.operator || '+'}
                              onChange={(value) => {
                                const items = [...config.yComputedConfig.items];
                                items[index] = { ...items[index], operator: value };
                                updateConfig({ yComputedConfig: { ...config.yComputedConfig, items } });
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
                              const items = [...config.yComputedConfig.items];
                              items[index] = { ...items[index], seriesKey: value };
                              updateConfig({ yComputedConfig: { ...config.yComputedConfig, items } });
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
                              updateConfig({
                                yComputedConfig: {
                                  ...config.yComputedConfig,
                                  items: config.yComputedConfig.items.filter((_, i) => i !== index),
                                },
                              });
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
                          updateConfig({
                            yComputedConfig: {
                              ...config.yComputedConfig,
                              items: [...config.yComputedConfig.items, { seriesKey: '', operator: '+' }],
                            },
                          });
                        }}
                      >
                        添加数据项
                      </Button>

                      {config.yComputedConfig.items.length > 1 && (
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
                  value={config.groupByKey || undefined}
                  onChange={(v) => updateConfig({ groupByKey: v })}
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
                  value={config.chartType}
                  onChange={(e) => updateConfig({ chartType: e.target.value })}
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

              {config.chartType === 'scatter' && (
                <div
                  style={{
                    padding: 10,
                    background: '#f6ffed',
                    border: '1px solid #b7eb8f',
                    borderRadius: 6,
                  }}
                >
                  <Space direction="vertical" style={{ width: '100%' }} size="small">
                    <div>
                      <Checkbox
                        checked={config.showTrendline}
                        onChange={(e) => updateConfig({ showTrendline: e.target.checked })}
                      >
                        显示拟合趋势线
                      </Checkbox>
                    </div>
                    {config.showTrendline && (
                      <>
                        <Space size="small" align="center">
                          <Text type="secondary" style={{ fontSize: 12 }}>拟合方式</Text>
                          <Select
                            size="small"
                            style={{ width: 120 }}
                            value={config.trendType}
                            onChange={(v) => updateConfig({ trendType: v })}
                            options={[
                              { label: '线性', value: 'linear' },
                              { label: '多项式', value: 'poly' },
                              { label: '指数', value: 'exp' },
                            ]}
                          />
                          {config.trendType === 'poly' && (
                            <Select
                              size="small"
                              style={{ width: 100 }}
                              value={config.polyOrder}
                              onChange={(v) => updateConfig({ polyOrder: v })}
                              options={[2, 3, 4, 5].map((o) => ({
                                label: `${o} 次多项式`,
                                value: o,
                              }))}
                            />
                          )}
                        </Space>
                        <div>
                          <Checkbox
                            checked={config.hideScatter}
                            onChange={(e) => updateConfig({ hideScatter: e.target.checked })}
                          >
                            隐藏散点，只显示拟合趋势线
                          </Checkbox>
                        </div>
                        <Text type="secondary" style={{ fontSize: 11 }}>
                          拟合基于当前选中迭代的数据点，hover 拟合线可查看拟合公式。
                        </Text>
                      </>
                    )}
                  </Space>
                </div>
              )}

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
                  value={config.selectedIterations}
                  onChange={(v) => updateConfig({ selectedIterations: v })}
                  options={iterationOptions}
                  disabled={!selectedReport}
                  maxTagCount={3}
                  allowClear
                />
                <Space style={{ marginTop: 8 }}>
                  <Button
                    size="small"
                    onClick={() =>
                      updateConfig({
                        selectedIterations: selectedReport?.results.map((r) => String(r.iteration)) || [],
                      })
                    }
                    disabled={!selectedReport}
                  >
                    全选
                  </Button>
                  <Button
                    size="small"
                    onClick={() => updateConfig({ selectedIterations: [] })}
                    disabled={!selectedReport}
                  >
                    清空
                  </Button>
                </Space>
              </div>
            </Space>
          </Card>
        </Col>

        <Col xs={24} lg={16}>
          <Card title="XY 关系图" size="small" style={{ height: '100%' }}>
            {chartOption ? (
              <AutoResizeChart option={chartOption} height={620} />
            ) : (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  !selectedReport
                    ? '请先选择一份测试报告'
                    : !computed.ready
                    ? '请选择 X 轴和 Y 轴数据系列'
                    : config.yComputedMode && config.yComputedConfig.items.some((it) => !it.seriesKey)
                    ? '请完成 Y 轴组合计算配置'
                    : '所选迭代没有有效数据点'
                }
                style={{ marginTop: 80 }}
              />
            )}
          </Card>
        </Col>
      </Row>

      {computed.points.length > 0 && (
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
