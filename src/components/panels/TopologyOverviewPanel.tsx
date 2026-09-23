'use client';

import React, { useMemo, useEffect, useRef, useCallback, useState } from 'react';
import { Button, Statistic, Row, Col, Table, Tabs, Tag, Space, Divider, Tooltip, Badge } from 'antd';
import {
  BarChartOutlined,
  LeftOutlined,
  RightOutlined,
  ThunderboltOutlined,
  DashboardOutlined,
  VideoCameraOutlined,
  PlayCircleOutlined,
  PauseCircleOutlined,
  DeleteOutlined,
  FileTextOutlined,
  CodeOutlined,
} from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import { bindYAxisWheelZoom } from '../../utils/chartWheelZoom';
import { useTopologyStore } from '../../stores/topologyStore';
import { useMonitorStore } from '../../stores/monitorStore';
import { useHistoryRecorder } from '../../hooks/useHistoryRecorder';
import type { TopologyNode, TopologyEdge } from '../../types/topology';
import { formatPower, getNodeDisplayLabel } from '../../utils/formatters';

interface HistoryPoint {
  time: string;
  totalInput: number;
  totalOutput: number;
  totalLoss: number;
  efficiency: number;
  maxTemperature: number;
}

// const MAX_HISTORY_POINTS = 30; // 最多显示30个数据点（暂时未使用）
const FIXED_TIME_RANGE = 60; // 固定60秒时间范围

/** 从节点中计算总功率数据 */
function computePowerSummary(nodes: TopologyNode[], edges: TopologyEdge[]) {
  let totalInput = 0;
  let totalOutput = 0;
  let maxTemp = 0;

  const modulePowers: Array<{ name: string; type: string; power: number }> = [];

  for (const node of nodes) {
    const d = node.data;
    const displayName = getNodeDisplayLabel(d as Record<string, unknown>) || d.label || node.id;

    // Source modules contribute input/output
    if ('sourceData' in d && d.sourceData) {
      // Only count the top-level AC input as total input
      if (d.nodeType === 'ac') {
        totalInput += d.sourceData.inputPower || 0;
      }
    }
    // Gather power from all load modules
    if ('cpuData' in d && d.cpuData) {
      modulePowers.push({ name: displayName, type: d.nodeType, power: d.cpuData.power || 0 });
      if (d.cpuData.temperature && d.cpuData.temperature > maxTemp) maxTemp = d.cpuData.temperature;
    }
    if ('fanData' in d && d.fanData) {
      modulePowers.push({ name: displayName, type: d.nodeType, power: d.fanData.power || 0 });
      if (d.fanData.temperature && d.fanData.temperature > maxTemp) maxTemp = d.fanData.temperature;
    }
    if ('memoryData' in d && d.memoryData) {
      modulePowers.push({ name: displayName, type: d.nodeType, power: d.memoryData.power || 0 });
      if (d.memoryData.temperature && d.memoryData.temperature > maxTemp) maxTemp = d.memoryData.temperature;
    }
    if ('diskData' in d && d.diskData) {
      modulePowers.push({ name: displayName, type: d.nodeType, power: d.diskData.power || 0 });
      if (d.diskData.temperature && d.diskData.temperature > maxTemp) maxTemp = d.diskData.temperature;
    }
    if ('ioData' in d && d.ioData) {
      modulePowers.push({ name: displayName, type: d.nodeType, power: d.ioData.power || 0 });
      if (d.ioData.temperature && d.ioData.temperature > maxTemp) maxTemp = d.ioData.temperature;
    }
    if ('cardData' in d && d.cardData) {
      modulePowers.push({ name: displayName, type: d.nodeType, power: d.cardData.power || 0 });
      if (d.cardData.temperature && d.cardData.temperature > maxTemp) maxTemp = d.cardData.temperature;
    }
    if ('sensorData' in d && d.sensorData) {
      if (d.sensorData.temperature && d.sensorData.temperature > maxTemp) maxTemp = d.sensorData.temperature;
    }
    if ('sourceData' in d && d.sourceData) {
      // Track source module output power for ranking
      const sourcePower = d.nodeType === 'busbar' ? d.sourceData.busbarPower || 0 : d.sourceData.outputPower || 0;
      modulePowers.push({ name: displayName, type: d.nodeType, power: sourcePower });
      if (d.sourceData.temperature && d.sourceData.temperature > maxTemp) maxTemp = d.sourceData.temperature;
    }
  }

  // Total output = sum of all end-load power
  totalOutput = modulePowers
    .filter(m => ['cpu', 'memory', 'fan', 'disk', 'io', 'card'].includes(m.type))
    .reduce((sum, m) => sum + m.power, 0);

  // Total loss from edges
  const totalEdgeLoss = edges.reduce((sum, e) => sum + (e.data?.loss ?? 0), 0);

  // Power loss rankings from edges
  const edgeLosses = edges
    .filter(e => e.data?.loss !== undefined)
    .map(e => {
      const srcNode = nodes.find(n => n.id === e.source);
      const tgtNode = nodes.find(n => n.id === e.target);
      const srcLabel = srcNode?.data ? (getNodeDisplayLabel(srcNode.data as Record<string, unknown>) || srcNode.data.label || e.source) : e.source;
      const tgtLabel = tgtNode?.data ? (getNodeDisplayLabel(tgtNode.data as Record<string, unknown>) || tgtNode.data.label || e.target) : e.target;
      return {
        path: `${srcLabel} → ${tgtLabel}`,
        loss: e.data!.loss,
        lossPercent: e.data!.lossPercent,
      };
    })
    .sort((a, b) => b.loss - a.loss);

  // Module power ranking (loads only)
  const loadPowerRanking = modulePowers
    .filter(m => ['cpu', 'memory', 'fan', 'disk', 'io', 'card'].includes(m.type))
    .sort((a, b) => b.power - a.power);

  return {
    totalInput,
    totalOutput,
    totalLoss: totalEdgeLoss,
    efficiency: totalInput > 0 ? (totalOutput / totalInput) * 100 : 0,
    maxTemperature: maxTemp,
    loadPowerRanking,
    edgeLosses,
  };
}

interface TopologyOverviewPanelProps {
  open: boolean;
  onToggle: () => void;
  isPolling?: boolean;
}

const TopologyOverviewPanel: React.FC<TopologyOverviewPanelProps> = ({ open, onToggle, isPolling: isPollingProp }) => {
  const { nodes, edges } = useTopologyStore();
  const isPollingFromStore = useMonitorStore((s) => s.isPolling);
  // 优先使用传入的 isPolling，否则从 store 获取
  const isPolling = isPollingProp ?? isPollingFromStore;
  const historyRef = useRef<HistoryPoint[]>([]);
  const [displayHistory, setDisplayHistory] = useState<HistoryPoint[]>([]);

  const summary = useMemo(() => computePowerSummary(nodes, edges), [nodes, edges]);

  // 历史曲线录像功能 - 录像无时间限制，按停止按钮才停止
  const {
    isRecording,
    historyData,
    startRecording,
    stopRecording,
    clearHistory,
    downloadCSV,
    downloadJSON,
    addDataPoint,
  } = useHistoryRecorder({ maxDuration: null, sampleInterval: 2000 });

  // Record history point on each data update - 图表显示固定60秒窗口，但录像数据无限制
  useEffect(() => {
    const now = new Date();
    const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
    
    const newPoint: HistoryPoint = {
      time: timeStr,
      totalInput: summary.totalInput,
      totalOutput: summary.totalOutput,
      totalLoss: summary.totalLoss,
      efficiency: summary.efficiency,
      maxTemperature: summary.maxTemperature,
    };

    // 添加到历史记录
    historyRef.current = [...historyRef.current, newPoint];
    
    // 图表显示只保留最近60秒的数据（滑动窗口）
    const maxPoints = Math.ceil(FIXED_TIME_RANGE / 2);
    const displayData = historyRef.current.slice(-maxPoints);
    setDisplayHistory(displayData);

    // 如果正在录像，添加数据点（录像数据无时间限制）
    if (isRecording && isPolling) {
      addDataPoint({
        totalInput: summary.totalInput,
        totalOutput: summary.totalOutput,
        totalLoss: summary.totalLoss,
        efficiency: summary.efficiency,
        maxTemperature: summary.maxTemperature,
      });
    }
  }, [summary, isRecording, isPolling, addDataPoint]);

  // 图表显示使用60秒窗口的历史数据
  const history = displayHistory;

  // Chart option builders - 固定60秒X轴显示
  const buildLineOption = useCallback(
    (
      title: string,
      series: Array<{ name: string; data: number[]; color: string }>,
      unit: string,
    ) => {
      // 计算图表显示范围 - 始终显示最新的60秒数据
      const totalPoints = series[0]?.data.length || 0;
      const maxDisplayPoints = Math.ceil(FIXED_TIME_RANGE / 2); // 60秒 / 2秒间隔 = 30个点
      
      // 如果数据少于最大显示点数，从头显示；否则显示最后maxDisplayPoints个点
      const startPercent = totalPoints <= maxDisplayPoints 
        ? 0 
        : ((totalPoints - maxDisplayPoints) / totalPoints) * 100;

      return {
        title: { text: title, textStyle: { fontSize: 13 }, left: 'center', top: 0 },
        tooltip: {
          trigger: 'axis',
          formatter: (params: unknown) =>
            (params as Array<{ marker: string; seriesName: string; value: number }>)
              .map((p) => `${p.marker} ${p.seriesName}: ${p.value.toFixed(1)}${unit}`)
              .join('<br/>'),
        },
        legend: { bottom: 0, textStyle: { fontSize: 11 } },
        grid: { left: 50, right: 16, top: 40, bottom: 36 },
        xAxis: {
          type: 'category',
          data: history.map((h) => h.time),
          boundaryGap: false,
          axisLabel: { fontSize: 10 },
        },
        yAxis: {
          type: 'value',
          axisLabel: { formatter: `{value}${unit}`, fontSize: 10 },
        },
        // 使用dataZoom固定显示最新的60秒数据
        dataZoom: [
          {
            type: 'inside',
            start: startPercent,
            end: 100,
            zoomLock: true, // 锁定缩放
          },
        ],
        series: series.map((s) => ({
          name: s.name,
          type: 'line',
          smooth: true,
          data: s.data,
          lineStyle: { color: s.color, width: 2 },
          itemStyle: { color: s.color },
          symbol: 'none',
          areaStyle: {
            color: {
              type: 'linear',
              x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: s.color + '40' },
                { offset: 1, color: s.color + '05' },
              ],
            },
          },
        })),
      };
    },
    [history],
  );

  const totalPowerOption = buildLineOption(
    '总功耗曲线',
    [
      { name: '总输入功率', data: history.map((h) => h.totalInput), color: '#1677ff' },
      { name: '总输出功率', data: history.map((h) => h.totalOutput), color: '#52c41a' },
    ],
    'W',
  );

  const lossOption = buildLineOption(
    '功耗损失曲线',
    [{ name: '功耗损失', data: history.map((h) => h.totalLoss), color: '#ff4d4f' }],
    'W',
  );

  const efficiencyOption = buildLineOption(
    '系统效率曲线',
    [{ name: '系统效率', data: history.map((h) => h.efficiency), color: '#722ed1' }],
    '%',
  );

  const temperatureOption = buildLineOption(
    '最高温度曲线',
    [{ name: '最高温度', data: history.map((h) => h.maxTemperature), color: '#fa8c16' }],
    '°C',
  );

  const powerRankColumns = [
    { title: '排名', dataIndex: 'rank', key: 'rank', width: 50, render: (_: unknown, __: unknown, idx: number) => idx + 1 },
    { title: '模块', dataIndex: 'name', key: 'name' },
    { title: '功率', dataIndex: 'power', key: 'power', render: (v: number) => formatPower(v) },
  ];

  const lossRankColumns = [
    { title: '排名', dataIndex: 'rank', key: 'rank', width: 50, render: (_: unknown, __: unknown, idx: number) => idx + 1 },
    { title: '路径', dataIndex: 'path', key: 'path', ellipsis: true },
    { title: '损耗', dataIndex: 'loss', key: 'loss', width: 70, render: (v: number) => formatPower(v) },
    {
      title: '占比',
      dataIndex: 'lossPercent',
      key: 'lossPercent',
      width: 65,
      render: (v: number) => (
        <Tag color={v < 1 ? 'green' : v < 3 ? 'orange' : 'red'}>{v.toFixed(1)}%</Tag>
      ),
    },
  ];

  return (
    <>
      {/* Toggle button - always visible on right edge */}
      <Button
        type="primary"
        icon={open ? <RightOutlined /> : <LeftOutlined />}
        onClick={onToggle}
        style={{
          position: 'absolute',
          right: open ? 420 : 0,
          top: '50%',
          transform: 'translateY(-50%)',
          zIndex: 20,
          borderRadius: open ? '6px 0 0 6px' : '6px 0 0 6px',
          height: 48,
          width: 24,
          padding: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'right 0.3s ease',
          boxShadow: '-2px 0 8px rgba(0,0,0,0.1)',
        }}
      />

      {/* Panel */}
      <div
        className="topology-overview-panel"
        style={{
          position: 'absolute',
          right: open ? 0 : -420,
          top: 0,
          bottom: 0,
          width: 420,
          background: '#fff',
          borderLeft: '1px solid #e8e8e8',
          zIndex: 15,
          transition: 'right 0.3s ease',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '12px 16px',
            borderBottom: '1px solid #f0f0f0',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontWeight: 600,
            fontSize: 15,
            color: '#262626',
            flexShrink: 0,
          }}
        >
          <BarChartOutlined />
          拓扑概览
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflow: 'auto', padding: '0 0 16px' }}>
          <Tabs
            defaultActiveKey="overview"
            centered
            size="small"
            style={{ padding: '0 16px' }}
            items={[
              {
                key: 'overview',
                label: (
                  <span>
                    <DashboardOutlined /> 总览
                  </span>
                ),
                children: (
                  <div>
                    {/* Power stats */}
                    <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
                      <Col span={12}>
                        <div className="overview-stat-card" style={statCardStyle}>
                          <Statistic
                            title="当前总输入功率"
                            value={summary.totalInput}
                            precision={1}
                            suffix="W"
                            valueStyle={{ color: '#1677ff', fontSize: 20 }}
                          />
                        </div>
                      </Col>
                      <Col span={12}>
                        <div className="overview-stat-card" style={statCardStyle}>
                          <Statistic
                            title="当前总输出功率"
                            value={summary.totalOutput}
                            precision={1}
                            suffix="W"
                            valueStyle={{ color: '#52c41a', fontSize: 20 }}
                          />
                        </div>
                      </Col>
                      <Col span={12}>
                        <div className="overview-stat-card" style={statCardStyle}>
                          <Statistic
                            title="当前功率损耗"
                            value={summary.totalLoss}
                            precision={1}
                            suffix="W"
                            valueStyle={{ color: '#ff4d4f', fontSize: 20 }}
                          />
                        </div>
                      </Col>
                      <Col span={12}>
                        <div className="overview-stat-card" style={statCardStyle}>
                          <Statistic
                            title="系统效率"
                            value={summary.efficiency}
                            precision={1}
                            suffix="%"
                            valueStyle={{
                              color:
                                summary.efficiency >= 90
                                  ? '#52c41a'
                                  : summary.efficiency >= 80
                                    ? '#faad14'
                                    : '#ff4d4f',
                              fontSize: 20,
                            }}
                          />
                        </div>
                      </Col>
                    </Row>

                    {/* Module power ranking */}
                    <div style={{ marginBottom: 16 }}>
                      <div style={sectionTitleStyle}>
                        <ThunderboltOutlined /> 模块功率排名
                      </div>
                      <Table
                        dataSource={summary.loadPowerRanking.map((m, i) => ({
                          ...m,
                          key: `${m.name}-${i}`,
                        }))}
                        columns={powerRankColumns}
                        size="small"
                        pagination={false}
                        scroll={{ y: 180 }}
                      />
                    </div>

                    {/* Loss ranking */}
                    <div>
                      <div style={sectionTitleStyle}>
                        <ThunderboltOutlined /> 功率损耗排名
                      </div>
                      <Table
                        dataSource={summary.edgeLosses.map((e, i) => ({
                          ...e,
                          key: `${e.path}-${i}`,
                        }))}
                        columns={lossRankColumns}
                        size="small"
                        pagination={false}
                        scroll={{ y: 180 }}
                      />
                    </div>
                  </div>
                ),
              },
              {
                key: 'history',
                label: (
                  <span>
                    <BarChartOutlined /> 历史曲线
                    {isRecording && (
                      <Badge 
                        status="processing" 
                        color="red" 
                        style={{ marginLeft: 4 }}
                      />
                    )}
                  </span>
                ),
                children: (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {/* 录像控制区域 */}
                    <div style={{ 
                      padding: '12px 16px', 
                      background: '#f6f8fa', 
                      borderRadius: 8,
                      border: '1px solid #e8e8e8',
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <span style={{ fontWeight: 600, fontSize: 14 }}>
                          <VideoCameraOutlined style={{ marginRight: 6 }} />
                          曲线录像
                          {isRecording && (
                            <Badge 
                              status="processing" 
                              color="red" 
                              style={{ marginLeft: 8 }}
                            />
                          )}
                        </span>
                        <Space size={4}>
                          {!isRecording ? (
                            <Tooltip title={isPolling ? '开始录像' : '请先开启实时监控'}>
                              <Button
                                type="primary"
                                size="small"
                                icon={<PlayCircleOutlined />}
                                onClick={startRecording}
                                disabled={!isPolling}
                              >
                                开始录像
                              </Button>
                            </Tooltip>
                          ) : (
                            <Button
                              type="primary"
                              danger
                              size="small"
                              icon={<PauseCircleOutlined />}
                              onClick={stopRecording}
                            >
                              停止录像
                            </Button>
                          )}
                          
                          <Tooltip title="下载 CSV">
                            <Button
                              size="small"
                              icon={<FileTextOutlined />}
                              onClick={downloadCSV}
                              disabled={historyData.length === 0}
                            >
                              CSV
                            </Button>
                          </Tooltip>
                          
                          <Tooltip title="下载 JSON">
                            <Button
                              size="small"
                              icon={<CodeOutlined />}
                              onClick={downloadJSON}
                              disabled={historyData.length === 0}
                            >
                              JSON
                            </Button>
                          </Tooltip>
                          
                          <Tooltip title="清空数据">
                            <Button
                              size="small"
                              danger
                              icon={<DeleteOutlined />}
                              onClick={clearHistory}
                              disabled={historyData.length === 0}
                            />
                          </Tooltip>
                        </Space>
                      </div>
                      <div style={{ fontSize: 12, color: '#888' }}>
                        {isRecording ? (
                          <span style={{ color: '#52c41a' }}>
                            正在录像中... 已记录 {historyData.length} 个数据点
                          </span>
                        ) : historyData.length > 0 ? (
                          <span>已记录 {historyData.length} 个数据点</span>
                        ) : (
                          <span>点击&quot;开始录像&quot;记录拓扑概览数据，曲线显示固定 60 秒窗口</span>
                        )}
                      </div>
                    </div>

                    <Divider style={{ margin: '8px 0' }} />

                    {/* 图表区域 */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
                      <ReactECharts
                        option={totalPowerOption}
                        style={{ height: 200 }}
                        notMerge
                        onChartReady={bindYAxisWheelZoom}
                      />
                      <ReactECharts
                        option={lossOption}
                        style={{ height: 200 }}
                        notMerge
                        onChartReady={bindYAxisWheelZoom}
                      />
                      <ReactECharts
                        option={efficiencyOption}
                        style={{ height: 200 }}
                        notMerge
                        onChartReady={bindYAxisWheelZoom}
                      />
                      <ReactECharts
                        option={temperatureOption}
                        style={{ height: 200 }}
                        notMerge
                        onChartReady={bindYAxisWheelZoom}
                      />
                    </div>
                  </div>
                ),
              },
            ]}
          />
        </div>
      </div>
    </>
  );
};

const statCardStyle: React.CSSProperties = {
  background: '#fafafa',
  borderRadius: 8,
  padding: '12px 14px',
  border: '1px solid #f0f0f0',
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: '#262626',
  marginBottom: 8,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
};

export default TopologyOverviewPanel;
