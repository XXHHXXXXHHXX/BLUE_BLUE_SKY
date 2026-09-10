'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { Space, Tabs, Table, Tooltip, Button, Modal, Tag, Divider, Spin, Empty, InputNumber, Popover, Row, Col, message, Collapse } from 'antd';
import { DesktopOutlined, LineChartOutlined, FileTextOutlined } from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import { bindYAxisWheelZoom } from '../../utils/chartWheelZoom';
import { getScrollLegend, tooltipBase, formatAxisTooltip } from '../../utils/monitorChartFormat';
import useMaximizableModal from '../../hooks/useMaximizableModal';
import { useTestJobStore, type JobResult, type JobConfig } from '../../stores/testJobStore';

interface JobResultDisplayProps {
  results: JobResult[];
  config: JobConfig;
  jobId?: string;
  onAverageRangeApplied?: () => void;
}

const COLORS = ['#52c41a', '#1890ff', '#fa8c16', '#f5222d', '#722ed1', '#13c2c2', '#eb2f96', '#fa541c'];

interface IterationDetailChartProps {
  commandName: string;
  dataPoints: Array<{ timestamp: string; value: number; raw: string }>;
}

const IterationDetailChart = React.memo(function IterationDetailChart({
  commandName,
  dataPoints,
}: IterationDetailChartProps) {
  const option = useMemo(() => {
    return {
      title: { text: `${commandName} - 采样点趋势`, left: 'center', textStyle: { fontSize: 14 } },
      tooltip: {
        trigger: 'axis',
        formatter: (params: any[]) => {
          const p = params[0];
          const dp = dataPoints[p.dataIndex];
          return `采样序号: ${p.dataIndex + 1}<br/>时间: ${new Date(dp.timestamp).toLocaleTimeString()}<br/>值: ${dp.value}`;
        },
      },
      grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
      xAxis: {
        type: 'category',
        name: '采样序号',
        data: dataPoints.map((_, i) => i + 1),
      },
      yAxis: { type: 'value', name: '监控值' },
      series: [
        {
          name: commandName,
          type: 'line',
          data: dataPoints.map((dp) => dp.value),
          smooth: true,
          symbol: 'circle',
          symbolSize: 6,
          lineStyle: { width: 2, color: '#1890ff' },
          itemStyle: { color: '#1890ff' },
        },
      ],
    };
  }, [commandName, dataPoints]);

  return <ReactECharts option={option} style={{ height: 400 }} onChartReady={bindYAxisWheelZoom} />;
});

export default function JobResultDisplay({ results, config, jobId, onAverageRangeApplied }: JobResultDisplayProps) {
  const { updateJobCustomAvgRanges } = useTestJobStore();
  const [monitorDetailModal, setMonitorDetailModal] = useState<{
    open: boolean;
    commandId: string;
    commandName: string;
    iteration: number;
    power: number;
    iterationLabel?: string;
    avgStart?: number;
    avgEnd?: number;
    stageId?: string;
  } | null>(null);

  const [monitorDetailData, setMonitorDetailData] = useState<{
    dataPoints: Array<{ timestamp: string; value: number; raw: string }>;
    total: number;
    loading: boolean;
    offset: number;
    pageSize: number;
  }>({
    dataPoints: [],
    total: 0,
    loading: false,
    offset: 0,
    pageSize: 100,
  });

  const detailModal = useMaximizableModal({ minWidth: 1100, minPageSize: 100, maxPageSize: 200 });

  const [customAvgRange, setCustomAvgRange] = useState<Record<string, { avgStart?: number; avgEnd?: number }>>({});

  const calculateCustomAvg = (dataPoints: Array<{ value: number }>, avgStart?: number, avgEnd?: number): number => {
    if (!dataPoints || dataPoints.length === 0) return 0;
    const start = avgStart !== undefined ? Math.max(0, avgStart - 1) : 0;
    const end = avgEnd !== undefined ? Math.min(dataPoints.length, avgEnd) : dataPoints.length;
    if (start >= end) return 0;
    const subset = dataPoints.slice(start, end);
    const validValues = subset.map(p => p.value).filter(v => !isNaN(v));
    return validValues.length > 0 ? validValues.reduce((a, b) => a + b, 0) / validValues.length : 0;
  };

  // 弹窗打开或翻页时按需加载采样点
  useEffect(() => {
    if (!monitorDetailModal?.open || !jobId) return;

    const fetchData = async () => {
      setMonitorDetailData((prev) => ({ ...prev, loading: true }));
      try {
        const params = new URLSearchParams({
          iteration: String(monitorDetailModal.iteration),
          commandId: monitorDetailModal.commandId,
          offset: String(monitorDetailData.offset),
          limit: String(monitorDetailData.pageSize),
        });
        if (monitorDetailModal.stageId) {
          params.set('stageId', monitorDetailModal.stageId);
        }
        const res = await fetch(`/api/test/jobs/${jobId}/monitor-data?${params.toString()}`);
        const json = await res.json();
        if (json.success) {
          setMonitorDetailData((prev) => ({
            ...prev,
            dataPoints: json.data.dataPoints,
            total: json.data.total,
            loading: false,
          }));
        } else {
          setMonitorDetailData((prev) => ({ ...prev, loading: false }));
        }
      } catch (err) {
        console.error('加载监控采样点失败:', err);
        setMonitorDetailData((prev) => ({ ...prev, loading: false }));
      }
    };

    fetchData();
  }, [monitorDetailModal, jobId, monitorDetailData.offset, monitorDetailData.pageSize]);

  // 放大/缩小时同步 pageSize，并重置到第一页重新加载
  useEffect(() => {
    if (monitorDetailModal?.open) {
      setMonitorDetailData((prev) => ({
        ...prev,
        offset: 0,
        pageSize: detailModal.pageSize,
      }));
    }
  }, [monitorDetailModal?.open, detailModal.isMaximized, detailModal.pageSize]);

  // 收集所有监控命令ID
  const allMonitorCommandIds = useMemo(() => {
    const ids = new Set<string>();
    results.forEach((r) => {
      if (r.monitorResults) {
        Object.keys(r.monitorResults).forEach((id) => ids.add(id));
      }
    });
    return Array.from(ids);
  }, [results]);

  // 按原始监控命令分组（处理 list 模式的 __col__N 后缀）
  const monitorGroups = useMemo(() => {
    const groups: Record<string, { originalId: string; name: string; colIds: string[] }> = {};
    // 基于当前配置构建分组骨架
    config.monitorCommands?.forEach((cmd) => {
      if (cmd.enabled) {
        groups[cmd.id] = { originalId: cmd.id, name: cmd.name, colIds: [] };
      }
    });
    // 将结果中的 commandId 分配到对应分组
    allMonitorCommandIds.forEach((id) => {
      const originalId = id.replace(/__col__\d+$/, '');
      if (!groups[originalId]) {
        groups[originalId] = { originalId, name: originalId, colIds: [] };
      }
      if (!groups[originalId].colIds.includes(id)) {
        groups[originalId].colIds.push(id);
      }
    });
    return Object.values(groups)
      .filter((g) => g.colIds.length > 0)
      .sort((a, b) => a.originalId.localeCompare(b.originalId));
  }, [allMonitorCommandIds, config.monitorCommands]);

  // 性能分数趋势图
  const scoreChartOption = useMemo(() => {
    const labels = results.map((r) => r.iterationLabel || `${r.power}`);
    const scoreData = results.map((r) => r.score);

    return {
      title: {
        text: '性能分数趋势',
        left: 'center',
        textStyle: { fontSize: 14 },
      },
      tooltip: {
        trigger: 'axis',
        formatter: (params: any[]) => {
          const data = params[0];
          return `迭代: ${data.dataIndex + 1}<br/>参数: ${labels[data.dataIndex]}<br/>分数: ${data.value}`;
        },
      },
      grid: {
        left: '3%',
        right: '4%',
        bottom: '3%',
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        name: '迭代',
        data: labels,
        boundaryGap: false,
      },
      yAxis: {
        type: 'value',
        name: '分数',
      },
      series: [
        {
          name: '性能分数',
          type: 'line',
          data: scoreData,
          smooth: true,
          symbol: 'circle',
          symbolSize: 8,
          lineStyle: {
            width: 2,
            color: '#1890ff',
          },
          itemStyle: {
            color: '#1890ff',
          },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(24,144,255,0.3)' },
                { offset: 1, color: 'rgba(24,144,255,0.05)' },
              ],
            },
          },
        },
      ],
    };
  }, [results]);

  // 为一组监控命令生成跨迭代的图表配置（平均值），支持多曲线
  const generateMonitorChartOption = (commandIds: string[], results: JobResult[]) => {
    const relevantResults = results.filter((r) =>
      commandIds.some((id) => r.monitorResults?.[id])
    );

    const seriesList = commandIds.map((id) => {
      const firstResult = results.find((r) => r.monitorResults?.[id]);
      const fullName = firstResult?.monitorResults?.[id].commandName || id;
      const shortName = fullName.includes(' - ') ? fullName.split(' - ').pop()! : fullName;
      return { id, name: shortName, fullName };
    });

    const groupName = seriesList[0]?.fullName.split(' - ')[0] || '监控';

    return {
      title: { text: `${groupName} - 跨迭代平均值趋势`, left: 'center', textStyle: { fontSize: 14 } },
      tooltip: {
        ...tooltipBase,
        formatter: (params: any[]) => formatAxisTooltip(params, (idx) => relevantResults[idx]),
      },
      legend: getScrollLegend(seriesList.map((s) => s.name)),
      grid: { left: '3%', right: '4%', bottom: '15%', containLabel: true },
      xAxis: {
        type: 'category',
        name: '迭代',
        data: relevantResults.map((r) => `${r.iteration}\n(${r.iterationLabel || `功耗=${r.power}`})`),
      },
      yAxis: { type: 'value', name: '平均值' },
      series: seriesList.map((s, idx) => {
        const color = COLORS[idx % COLORS.length];
        const data = relevantResults.map((r) => {
          const mr = r.monitorResults?.[s.id];
          return mr ? mr.averageValue : null;
        });
        return {
          name: s.name,
          type: 'line',
          data,
          smooth: true,
          symbol: 'circle',
          symbolSize: 6,
          lineStyle: { width: 2, color },
          itemStyle: { color },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: color + '33' },
                { offset: 1, color: color + '0D' },
              ],
            },
          },
        };
      }),
    };
  };

  // 为一组监控命令生成分数/平均值趋势图，支持多曲线
  const generateMonitorScoreRatioChartOption = (commandIds: string[], results: JobResult[]) => {
    const relevantResults = results.filter((r) =>
      commandIds.some((id) => r.monitorResults?.[id]) && r.score > 0
    );

    const seriesList = commandIds.map((id) => {
      const firstResult = results.find((r) => r.monitorResults?.[id]);
      const fullName = firstResult?.monitorResults?.[id].commandName || id;
      const shortName = fullName.includes(' - ') ? fullName.split(' - ').pop()! : fullName;
      return { id, name: shortName, fullName };
    });

    const groupName = seriesList[0]?.fullName.split(' - ')[0] || '监控';

    return {
      title: { text: `${groupName} - 分数/平均值趋势`, left: 'center', textStyle: { fontSize: 14 } },
      tooltip: {
        ...tooltipBase,
        formatter: (params: any[]) => formatAxisTooltip(
          params,
          (idx) => relevantResults[idx],
          (ctx) => `分数: ${ctx?.score}<br/>`
        ),
      },
      legend: getScrollLegend(seriesList.map((s) => s.name)),
      grid: { left: '3%', right: '4%', bottom: '15%', containLabel: true },
      xAxis: {
        type: 'category',
        name: '迭代',
        data: relevantResults.map((r) => `${r.iteration}\n(${r.iterationLabel || `功耗=${r.power}`})`),
      },
      yAxis: { type: 'value', name: '分数/平均值' },
      series: seriesList.map((s, idx) => {
        const color = COLORS[idx % COLORS.length];
        const data = relevantResults.map((r) => {
          const mr = r.monitorResults?.[s.id];
          return mr && mr.averageValue > 0 ? r.score / mr.averageValue : null;
        });
        return {
          name: s.name,
          type: 'line',
          data,
          smooth: true,
          symbol: 'circle',
          symbolSize: 6,
          lineStyle: { width: 2, color },
          itemStyle: { color },
        };
      }),
    };
  };

  // 按监控命令组预计算图表配置，避免每次渲染都重新生成大对象
  const monitorChartOptions = useMemo(() => {
    const map: Record<string, { avg: any; ratio: any }> = {};
    monitorGroups.forEach((group) => {
      map[group.originalId] = {
        avg: generateMonitorChartOption(group.colIds, results),
        ratio: generateMonitorScoreRatioChartOption(group.colIds, results),
      };
    });
    return map;
  }, [monitorGroups, results]);

  if (results.length === 0) {
    return null;
  }

  return (
    <>
      {/* 性能分数趋势图 */}
      <div style={{ marginBottom: 16 }}>
        <ReactECharts
          option={scoreChartOption}
          style={{ height: 300 }}
          onChartReady={bindYAxisWheelZoom}
        />
      </div>

      {/* 迭代日志下载 */}
      {jobId && results.some((r) => r.logArchivePath) && (
        <>
          <Divider style={{ margin: '16px 0' }} />
          <div style={{ fontWeight: 'bold', marginBottom: 12, fontSize: 14 }}>
            <FileTextOutlined style={{ marginRight: 6 }} />
            迭代日志
          </div>
          <Space wrap>
            {results
              .filter((r) => r.logArchivePath)
              .map((r) => (
                <Button
                  key={r.iteration}
                  size="small"
                  icon={<FileTextOutlined />}
                  onClick={() => {
                    window.open(`/api/test/logs/download?jobId=${jobId}&iteration=${r.iteration}`);
                  }}
                >
                  第 {r.iteration} 轮
                </Button>
              ))}
          </Space>
        </>
      )}

      {/* 监控数据展示 */}
      {monitorGroups.length > 0 && (
        <>
          <Divider style={{ margin: '16px 0' }} />
          <div style={{ fontWeight: 'bold', marginBottom: 12, fontSize: 14 }}>
            <DesktopOutlined style={{ marginRight: 6 }} />
            监控数据
          </div>
          <Tabs
            size="small"
            items={monitorGroups.map((group) => {
              return {
                key: group.originalId,
                label: group.name,
                children: (
                  <Space direction="vertical" style={{ width: '100%' }}>
                    <ReactECharts
                      option={monitorChartOptions[group.originalId]?.avg}
                      style={{ height: 260 }}
                      onChartReady={bindYAxisWheelZoom}
                    />
                    <ReactECharts
                      option={monitorChartOptions[group.originalId]?.ratio}
                      style={{ height: 260 }}
                      onChartReady={bindYAxisWheelZoom}
                    />
                    <Table
                      size="small"
                      pagination={false}
                      columns={[
                        { title: '迭代', dataIndex: 'iteration', width: 70 },
                        {
                          title: '迭代参数',
                          dataIndex: 'iterationLabel',
                          width: 150,
                          render: (v: string) => (
                            <Tooltip title={v} placement="topLeft">
                              <span
                                style={{
                                  display: 'inline-block',
                                  maxWidth: '100%',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {v}
                              </span>
                            </Tooltip>
                          ),
                        },
                        ...group.colIds.map((colId) => {
                          const firstResult = results.find((r) => r.monitorResults?.[colId]);
                          const colName =
                            firstResult?.monitorResults?.[colId].commandName.split(' - ').pop() || colId;
                          return {
                            title: (
                              <Popover
                                trigger="hover"
                                content={
                                  customAvgRange[colId]
                                    ? <span>自定义范围: 第{customAvgRange[colId].avgStart} ~ 第{customAvgRange[colId].avgEnd}点</span>
                                    : <span>使用原始平均值</span>
                                }
                              >
                                <span style={{ cursor: 'help' }}>{colName}</span>
                              </Popover>
                            ),
                            key: colId,
                            width: 130,
                            render: (_: unknown, record: any) => {
                              const mr = record.monitorResults?.[colId];
                              if (!mr) return '-';
                              const customRange = customAvgRange[colId];
                              const avgValue = customRange && mr.dataPoints?.length
                                ? calculateCustomAvg(mr.dataPoints, customRange.avgStart, customRange.avgEnd)
                                : mr.averageValue;
                              const ratio =
                                avgValue > 0 && record.score > 0
                                  ? (record.score / avgValue).toFixed(4)
                                  : '-';
                              return (
                                <div style={{ textAlign: 'center' }}>
                                  <div
                                    style={{ fontWeight: 'bold', color: customRange ? '#1890ff' : '#52c41a', fontSize: 12 }}
                                  >
                                    {avgValue.toFixed(4)}
                                  </div>
                                  <div style={{ fontSize: 11, color: '#fa8c16' }}>÷{ratio}</div>
                                </div>
                              );
                            },
                          };
                        }),
                      ]}
                      dataSource={results.filter((r) =>
                        group.colIds.some((id) => r.monitorResults?.[id])
                      )}
                      rowKey={(r) => `${r.stageId || 'default'}-${r.iteration}`}
                      scroll={{ y: 200, x: group.colIds.length > 4 ? 800 : undefined }}
                    />
                    <Collapse
                      size="small"
                      ghost
                      style={{ marginTop: 8 }}
                      items={[{
                        key: 'actions',
                        label: <span style={{ fontSize: 12, color: '#666' }}>查看采样详情（点击展开）</span>,
                        children: (
                          <Space direction="vertical" style={{ width: '100%' }}>
                            {results
                              .filter((r) => group.colIds.some((id) => r.monitorResults?.[id]))
                              .map((result) => (
                                <div key={`${result.stageId || 'default'}-${result.iteration}`} style={{ fontSize: 12 }}>
                                  <span style={{ fontWeight: 500, marginRight: 8 }}>第{result.iteration}轮:</span>
                                  <Space size="small" wrap>
                                    {group.colIds.map((colId) => {
                                      const mr = result.monitorResults?.[colId];
                                      if (!mr) return null;
                                      const colName = mr.commandName.replace(/^.* - /, '') || colId;
                                      return (
                                        <Button
                                          key={colId}
                                          type="link"
                                          size="small"
                                          icon={<LineChartOutlined />}
                                          onClick={() => {
                                            setMonitorDetailData((prev) => ({ ...prev, offset: 0, dataPoints: [], total: 0 }));
                                            setMonitorDetailModal({
                                              open: true,
                                              commandId: colId,
                                              commandName: mr.commandName,
                                              iteration: result.iteration,
                                              power: result.power,
                                              iterationLabel: result.iterationLabel || `功耗=${result.power}`,
                                              stageId: result.stageId,
                                            });
                                          }}
                                        >
                                          {colName}
                                        </Button>
                                      );
                                    })}
                                  </Space>
                                </div>
                              ))}
                          </Space>
                        ),
                      }]}
                    />
                  </Space>
                ),
              };
            })}
          />
        </>
      )}

      {/* 单次迭代采样点详情弹窗 */}
      <Modal
        title={detailModal.renderTitle(
          monitorDetailModal
            ? `${monitorDetailModal.commandName} - 第 ${monitorDetailModal.iteration} 轮采样详情`
            : ''
        )}
        open={monitorDetailModal?.open || false}
        onCancel={() => setMonitorDetailModal(null)}
        width={detailModal.width}
        style={detailModal.style}
        styles={{ body: detailModal.bodyStyle }}
        footer={[
          <Button key="close" onClick={() => setMonitorDetailModal(null)}>
            关闭
          </Button>,
        ]}
      >
        {monitorDetailModal && (
          <Spin spinning={monitorDetailData.loading} tip="加载采样点...">
            <div style={{ marginBottom: 16 }}>
              <Tag>迭代: {monitorDetailModal.iteration}</Tag>
              <Tag>参数: {monitorDetailModal.iterationLabel || `${monitorDetailModal.power}`}</Tag>
              <Tag>采样点数: {monitorDetailData.total}</Tag>
            </div>
            <div style={{ marginBottom: 16, padding: '8px 12px', background: '#f5f5f5', borderRadius: 4 }}>
              <Space align="center">
                <span style={{ fontWeight: 500 }}>自定义平均值计算范围：</span>
                <InputNumber
                  size="small"
                  min={1}
                  max={monitorDetailData.total || 9999}
                  value={monitorDetailModal.avgStart || 1}
                  onChange={(val) => setMonitorDetailModal((prev) => prev ? { ...prev, avgStart: val || undefined } : null)}
                  style={{ width: 70 }}
                  placeholder="起始点"
                />
                <span>~</span>
                <InputNumber
                  size="small"
                  min={1}
                  max={monitorDetailData.total || 9999}
                  value={monitorDetailModal.avgEnd || monitorDetailData.total || undefined}
                  onChange={(val) => setMonitorDetailModal((prev) => prev ? { ...prev, avgEnd: val || undefined } : null)}
                  style={{ width: 70 }}
                  placeholder="结束点"
                />
                <span style={{ color: '#52c41a', fontWeight: 500 }}>
                  范围平均值: {calculateCustomAvg(monitorDetailData.dataPoints, monitorDetailModal.avgStart, monitorDetailModal.avgEnd).toFixed(4)}
                </span>
                <Button size="small" onClick={async () => {
                  if (!jobId) {
                    message.warning('任务ID不存在，无法保存');
                    return;
                  }
                  const range = {
                    avgStart: monitorDetailModal.avgStart,
                    avgEnd: monitorDetailModal.avgEnd,
                  };
                  const result = await updateJobCustomAvgRanges(jobId, {
                    [monitorDetailModal.commandId]: range,
                  });
                  if (result.success) {
                    setCustomAvgRange((prev) => ({
                      ...prev,
                      [monitorDetailModal.commandId]: range,
                    }));
                    message.success('已应用此范围计算平均值并保存');
                    onAverageRangeApplied?.();
                  } else {
                    message.error(result.message || '保存失败');
                  }
                }}>
                  应用到所有迭代
                </Button>
              </Space>
            </div>
            {monitorDetailData.dataPoints.length === 0 ? (
              <Empty description="暂无采样点数据" style={{ margin: '24px 0' }} />
            ) : (
              <>
                <IterationDetailChart
                  commandName={monitorDetailModal.commandName}
                  dataPoints={monitorDetailData.dataPoints}
                />
                <Table
                  size="small"
                  pagination={{
                    current: Math.floor(monitorDetailData.offset / monitorDetailData.pageSize) + 1,
                    pageSize: monitorDetailData.pageSize,
                    total: monitorDetailData.total,
                    size: 'small',
                    showSizeChanger: false,
                  }}
                  onChange={(pagination) => {
                    const newOffset = ((pagination.current || 1) - 1) * monitorDetailData.pageSize;
                    setMonitorDetailData((prev) => ({ ...prev, offset: newOffset }));
                  }}
                  columns={[
                    {
                      title: '序号',
                      dataIndex: 'idx',
                      width: 70,
                      render: (v: number) => v + 1 + monitorDetailData.offset,
                    },
                    {
                      title: '时间',
                      dataIndex: 'timestamp',
                      width: 180,
                      render: (v: string) => new Date(v).toLocaleTimeString(),
                    },
                    {
                      title: '监控值',
                      dataIndex: 'value',
                      width: 100,
                      render: (v: number | null) =>
                        !isNaN(v ?? 0) ? (v ?? 0).toFixed(4) : '0',
                    },
                    { title: '原始输出', dataIndex: 'raw', ellipsis: true },
                  ]}
                  dataSource={monitorDetailData.dataPoints.map((p, idx) => ({
                    ...p,
                    idx,
                    key: idx,
                  }))}
                  scroll={{ x: 'max-content', y: detailModal.isMaximized ? 420 : 250 }}
                />
              </>
            )}
          </Spin>
        )}
      </Modal>
    </>
  );
}
