'use client';

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { Drawer, Descriptions, Slider, Tag, Typography, Button, Space, Divider, Tooltip, Badge } from 'antd';
import { useCloneTopologyStore } from '../../stores/cloneTopologyStore';
import { useHistoryRecorder } from '../../hooks/useHistoryRecorder';
import TrendChart from '../charts/TrendChart';
import {
  formatVoltage,
  formatCurrent,
  formatPower,
  formatEfficiency,
  formatTemperature,
  formatRPM,
  getTemperatureColor,
  getNodeDisplayLabel,
} from '../../utils/formatters';
import type { SourceData, FanData, LoadData, MemoryData, DiskData, IOData, CardData, SensorData } from '../../types/power';
import type { TopologyNode } from '../../types/topology';
import { 
  VideoCameraOutlined, 
  VideoCameraAddOutlined,
  DeleteOutlined,
  PlayCircleOutlined,
  PauseCircleOutlined,
  FileTextOutlined,
  CodeOutlined
} from '@ant-design/icons';

const { Title } = Typography;

interface CloneNodeDetailPanelProps {
  open: boolean;
  onClose: () => void;
  node: TopologyNode | null;
}

const CloneNodeDetailPanel: React.FC<CloneNodeDetailPanelProps> = ({ open, onClose, node: propNode }) => {
  const nodes = useCloneTopologyStore((s) => s.nodes);
  const updateFanSpeed = useCloneTopologyStore((s) => s.updateFanSpeed);
  const updateSourceVoltage = useCloneTopologyStore((s) => s.updateSourceVoltage);
  
  // 从 store 获取实时节点数据
  const node = useMemo(() => {
    if (!propNode) return null;
    const liveNode = nodes.find((n) => n.id === propNode.id);
    return liveNode || propNode;
  }, [nodes, propNode]);

  const [fanSpeed, setFanSpeedLocal] = useState<number>(50);
  const [voltageValue, setVoltageValue] = useState<number>(1.0);

  // 历史曲线录像功能
  const {
    isRecording,
    historyData,
    startRecording,
    stopRecording,
    clearHistory,
    downloadCSV,
    downloadJSON,
    addDataPoint,
  } = useHistoryRecorder({ maxDuration: 60, sampleInterval: 2000 });

  // 当节点变化时，同步初始值
  useEffect(() => {
    if (!node?.data) return;
    const { nodeType } = node.data;
    if (nodeType === 'fan' && node.data.fanData) {
      setFanSpeedLocal(node.data.fanData.speedPercent ?? 50);
    }
    if ((nodeType === 'vr' || nodeType === 'psip') && node.data.sourceData) {
      setVoltageValue(node.data.sourceData.outputVoltage ?? 1.0);
    }
  }, [node]);

  // 当正在录像时，记录数据点
  useEffect(() => {
    if (!isRecording || !node?.data) return;

    const data = node.data as Record<string, unknown>;
    const nodeType = data.nodeType as string;
    const sourceData = data.sourceData as SourceData | undefined;
    const fanData = data.fanData as FanData | undefined;
    const cpuData = data.cpuData as LoadData | undefined;
    const memoryData = data.memoryData as MemoryData | undefined;
    const diskData = data.diskData as DiskData | undefined;
    const ioData = data.ioData as IOData | undefined;
    const cardData = data.cardData as CardData | undefined;
    const sensorData = data.sensorData as SensorData | undefined;

    let dataPoint: Parameters<typeof addDataPoint>[0] = {};

    switch (nodeType) {
      case 'ac':
      case 'psu':
      case 'vr':
      case 'psip':
        if (sourceData) {
          dataPoint = {
            power: sourceData.outputPower,
            temperature: sourceData.temperature,
            voltage: sourceData.outputVoltage,
            current: sourceData.current,
          };
        }
        break;
      case 'fan':
        if (fanData) {
          dataPoint = {
            power: fanData.power,
            temperature: fanData.temperature,
            rpm: fanData.rpm,
            speedPercent: fanData.speedPercent,
          };
        }
        break;
      case 'cpu':
        if (cpuData) {
          dataPoint = {
            power: cpuData.power,
            temperature: cpuData.temperature,
          };
        }
        break;
      case 'memory':
        if (memoryData) {
          dataPoint = {
            power: memoryData.power,
            temperature: memoryData.temperature,
          };
        }
        break;
      case 'disk':
        if (diskData) {
          dataPoint = {
            power: diskData.power,
            temperature: diskData.temperature,
          };
        }
        break;
      case 'io':
        if (ioData) {
          dataPoint = {
            power: ioData.power,
            temperature: ioData.temperature,
          };
        }
        break;
      case 'card':
        if (cardData) {
          dataPoint = {
            power: cardData.power,
            temperature: cardData.temperature,
          };
        }
        break;
      case 'sensor':
        if (sensorData) {
          dataPoint = {
            temperature: sensorData.temperature,
          };
        }
        break;
    }

    if (Object.keys(dataPoint).length > 0) {
      addDataPoint(dataPoint);
    }
  }, [isRecording, nodes, node?.id, addDataPoint]);

  // 分身页面只更新本地状态，不发送后端命令
  const handleFanSpeedComplete = useCallback(async (value: number) => {
    if (!node) return;
    setFanSpeedLocal(value);
    updateFanSpeed(node.id, value);
    // 分身页面不实际发送控制命令，只做本地演示
  }, [node, updateFanSpeed]);

  const handleVoltageComplete = useCallback(async (value: number) => {
    if (!node) return;
    setVoltageValue(value);
    updateSourceVoltage(node.id, value);
    // 分身页面不实际发送控制命令，只做本地演示
  }, [node, updateSourceVoltage]);

  const renderContent = () => {
    if (!node?.data) return <div>暂无数据</div>;

    const d = node.data as Record<string, unknown>;
    const nodeType = d.nodeType as string;
    const controlRange = d.controlRange as { min: number; max: number } | undefined;

    switch (nodeType) {
      case 'ac': {
        const s = d.sourceData as SourceData;
        if (!s) return <div>暂无数据</div>;
        return (
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="AC输出电压查询">{formatVoltage(s.outputVoltage)}</Descriptions.Item>
            <Descriptions.Item label="AC输出电流查询">{formatCurrent(s.current)}</Descriptions.Item>
            <Descriptions.Item label="AC输出功率查询">{formatPower(s.outputPower)}</Descriptions.Item>
          </Descriptions>
        );
      }

      case 'psu': {
        const s = d.sourceData as SourceData;
        if (!s) return <div>暂无数据</div>;
        return (
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="PSU输入电压查询">{formatVoltage(s.inputVoltage)}</Descriptions.Item>
            <Descriptions.Item label="PSU输入电流查询">{formatCurrent(s.inputCurrent ?? s.current)}</Descriptions.Item>
            <Descriptions.Item label="PSU输入功率查询">{formatPower(s.inputPower)}</Descriptions.Item>
            <Descriptions.Item label="PSU输出电压查询">{formatVoltage(s.outputVoltage)}</Descriptions.Item>
            <Descriptions.Item label="PSU输出电流查询">{formatCurrent(s.outputCurrent ?? s.current)}</Descriptions.Item>
            <Descriptions.Item label="PSU输出功率查询">{formatPower(s.outputPower)}</Descriptions.Item>
            <Descriptions.Item label="转换效率">{formatEfficiency(s.efficiency)}</Descriptions.Item>
            {s.temperature != null && (
              <Descriptions.Item label="温度">{formatTemperature(s.temperature)}</Descriptions.Item>
            )}
          </Descriptions>
        );
      }

      case 'vr': {
        const s = d.sourceData as SourceData;
        if (!s) return <div>暂无数据</div>;
        const vMin = controlRange?.min ?? 0.5;
        const vMax = controlRange?.max ?? 1.5;
        const marks: Record<number, string> = {
          [vMin]: `${vMin}V`,
          [vMax]: `${vMax}V`,
        };
        const vMid = +((vMin + vMax) / 2).toFixed(2);
        marks[vMid] = `${vMid}V`;
        return (
          <>
            <Descriptions column={1} bordered size="small">
              <Descriptions.Item label="VR输入电压查询">{formatVoltage(s.inputVoltage)}</Descriptions.Item>
              <Descriptions.Item label="VR输入电流查询">{formatCurrent(s.inputCurrent ?? s.current)}</Descriptions.Item>
              <Descriptions.Item label="VR输入功率查询">{formatPower(s.inputPower)}</Descriptions.Item>
              <Descriptions.Item label="VR输出电压查询">{formatVoltage(s.outputVoltage)}</Descriptions.Item>
              <Descriptions.Item label="VR输出电流查询">{formatCurrent(s.outputCurrent ?? s.current)}</Descriptions.Item>
              <Descriptions.Item label="VR输出功率查询">{formatPower(s.outputPower)}</Descriptions.Item>
              <Descriptions.Item label="转换效率">{formatEfficiency(s.efficiency)}</Descriptions.Item>
              {s.temperature != null && (
                <Descriptions.Item label="温度">{formatTemperature(s.temperature)}</Descriptions.Item>
              )}
            </Descriptions>
            <div style={{ marginTop: 16 }}>
              <Title level={5}>VR输出电压调节接口（演示模式）</Title>
              <Slider
                min={vMin}
                max={vMax}
                step={0.01}
                value={voltageValue}
                onChange={setVoltageValue}
                onChangeComplete={handleVoltageComplete}
                marks={marks}
              />
            </div>
          </>
        );
      }

      case 'psip': {
        const s = d.sourceData as SourceData;
        if (!s) return <div>暂无数据</div>;
        const vMin = controlRange?.min ?? 0.5;
        const vMax = controlRange?.max ?? 1.5;
        const marks: Record<number, string> = {
          [vMin]: `${vMin}V`,
          [vMax]: `${vMax}V`,
        };
        const vMid = +((vMin + vMax) / 2).toFixed(2);
        marks[vMid] = `${vMid}V`;
        return (
          <>
            <Descriptions column={1} bordered size="small">
              <Descriptions.Item label="psip输入电压查询">{formatVoltage(s.inputVoltage)}</Descriptions.Item>
              <Descriptions.Item label="psip输入电流查询">{formatCurrent(s.inputCurrent ?? s.current)}</Descriptions.Item>
              <Descriptions.Item label="psip输入功率查询">{formatPower(s.inputPower)}</Descriptions.Item>
              <Descriptions.Item label="psip输出电压查询">{formatVoltage(s.outputVoltage)}</Descriptions.Item>
              <Descriptions.Item label="psip输出电流查询">{formatCurrent(s.outputCurrent ?? s.current)}</Descriptions.Item>
              <Descriptions.Item label="psip输出功率查询">{formatPower(s.outputPower)}</Descriptions.Item>
              <Descriptions.Item label="转换效率">{formatEfficiency(s.efficiency)}</Descriptions.Item>
              {s.temperature != null && (
                <Descriptions.Item label="温度">{formatTemperature(s.temperature)}</Descriptions.Item>
              )}
            </Descriptions>
            <div style={{ marginTop: 16 }}>
              <Title level={5}>psip输出电压调节接口（演示模式）</Title>
              <Slider
                min={vMin}
                max={vMax}
                step={0.01}
                value={voltageValue}
                onChange={setVoltageValue}
                onChangeComplete={handleVoltageComplete}
                marks={marks}
              />
            </div>
          </>
        );
      }

      case 'fan': {
        const f = d.fanData as FanData;
        if (!f) return <div>暂无数据</div>;
        const sMin = controlRange?.min ?? 0;
        const sMax = controlRange?.max ?? 100;
        const marks: Record<number, string> = {
          [sMin]: `${sMin}%`,
          [sMax]: `${sMax}%`,
        };
        const sMid = Math.round((sMin + sMax) / 2);
        marks[sMid] = `${sMid}%`;
        return (
          <>
            <Descriptions column={1} bordered size="small">
              <Descriptions.Item label="风扇功耗查询">{formatPower(f.power)}</Descriptions.Item>
              {f.temperature != null && (
                <Descriptions.Item label="风扇温度查询">{formatTemperature(f.temperature)}</Descriptions.Item>
              )}
              <Descriptions.Item label="转速">{formatRPM(f.rpm)}</Descriptions.Item>
              <Descriptions.Item label="速度百分比">{f.speedPercent}%</Descriptions.Item>
            </Descriptions>
            <div style={{ marginTop: 16 }}>
              <Title level={5}>风扇调速接口（演示模式）</Title>
              <Slider
                min={sMin}
                max={sMax}
                value={fanSpeed}
                onChange={setFanSpeedLocal}
                onChangeComplete={handleFanSpeedComplete}
                marks={marks}
              />
            </div>
          </>
        );
      }

      case 'cpu': {
        const c = d.cpuData as LoadData;
        if (!c) return <div>暂无数据</div>;
        return (
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="CPU输入功耗查询">{formatPower(c.power)}</Descriptions.Item>
            {c.temperature != null && (
              <Descriptions.Item label="CPU温度查询">{formatTemperature(c.temperature)}</Descriptions.Item>
            )}
          </Descriptions>
        );
      }

      case 'memory': {
        const m = d.memoryData as MemoryData;
        if (!m) return <div>暂无数据</div>;
        return (
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="内存功耗查询">{formatPower(m.power)}</Descriptions.Item>
            {m.temperature != null && (
              <Descriptions.Item label="内存条温度查询">{formatTemperature(m.temperature)}</Descriptions.Item>
            )}
            <Descriptions.Item label="热节流">
              <Tag color={m.thermalThrottle ? 'red' : 'green'}>
                {m.thermalThrottle ? '已触发' : '正常'}
              </Tag>
            </Descriptions.Item>
          </Descriptions>
        );
      }

      case 'disk': {
        const dk = d.diskData as DiskData;
        if (!dk) return <div>暂无数据</div>;
        return (
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="硬盘功耗查询">{formatPower(dk.power)}</Descriptions.Item>
            {dk.temperature != null && (
              <Descriptions.Item label="硬盘温度查询">{formatTemperature(dk.temperature)}</Descriptions.Item>
            )}
            <Descriptions.Item label="状态">
              <Tag color={dk.status === 'normal' ? 'green' : dk.status === 'warning' ? 'orange' : 'red'}>
                {dk.status}
              </Tag>
            </Descriptions.Item>
          </Descriptions>
        );
      }

      case 'io': {
        const io = d.ioData as IOData;
        if (!io) return <div>暂无数据</div>;
        return (
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="功耗">{formatPower(io.power)}</Descriptions.Item>
            {io.temperature != null && (
              <Descriptions.Item label="温度">{formatTemperature(io.temperature)}</Descriptions.Item>
            )}
            <Descriptions.Item label="链路速率">{io.linkSpeed}</Descriptions.Item>
          </Descriptions>
        );
      }

      case 'card': {
        const cd = d.cardData as CardData;
        if (!cd) return <div>暂无数据</div>;
        return (
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="标卡功耗查询">{formatPower(cd.power)}</Descriptions.Item>
            {cd.temperature != null && (
              <Descriptions.Item label="标卡温度查询">{formatTemperature(cd.temperature)}</Descriptions.Item>
            )}
            <Descriptions.Item label="插槽">{cd.slotId}</Descriptions.Item>
          </Descriptions>
        );
      }

      case 'sensor': {
        const sn = d.sensorData as SensorData;
        if (!sn) return <div>暂无数据</div>;
        const tempValue = sn.temperature ?? 0;
        const color = getTemperatureColor(tempValue);
        return (
          <div style={{ textAlign: 'center', padding: 24 }}>
            <div style={{ fontSize: 48, fontWeight: 'bold', color }}>{tempValue.toFixed(1)}°C</div>
            <div style={{ marginTop: 8, color: '#888' }}>{sn.location || 'Unknown'}</div>
          </div>
        );
      }

      default:
        return (
          <Descriptions column={1} bordered size="small">
            {Object.entries(d).map(([k, v]) => (
              <Descriptions.Item key={k} label={k}>{String(v)}</Descriptions.Item>
            ))}
          </Descriptions>
        );
    }
  };

  const hasRecordableData = useCallback(() => {
    if (!node?.data) return false;
    const { nodeType } = node.data;
    return ['ac', 'psu', 'vr', 'psip', 'fan', 'cpu', 'memory', 'disk', 'io', 'card', 'sensor'].includes(nodeType);
  }, [node]);

  const getHistoryChartData = useCallback(() => {
    if (!historyData.length) return [];

    const charts: Array<{ title: string; data: Array<{ time: string; value: number }>; unit: string; color: string }> = [];

    if (historyData[0].power !== undefined) {
      charts.push({
        title: '功耗趋势',
        data: historyData.map(d => ({ time: d.timeStr, value: d.power || 0 })),
        unit: 'W',
        color: '#5470c6',
      });
    }

    if (historyData[0].temperature !== undefined) {
      charts.push({
        title: '温度趋势',
        data: historyData.map(d => ({ time: d.timeStr, value: d.temperature || 0 })),
        unit: '°C',
        color: '#91cc75',
      });
    }

    if (historyData[0].voltage !== undefined) {
      charts.push({
        title: '电压趋势',
        data: historyData.map(d => ({ time: d.timeStr, value: d.voltage || 0 })),
        unit: 'V',
        color: '#fac858',
      });
    }

    if (historyData[0].current !== undefined) {
      charts.push({
        title: '电流趋势',
        data: historyData.map(d => ({ time: d.timeStr, value: d.current || 0 })),
        unit: 'A',
        color: '#ee6666',
      });
    }

    if (historyData[0].rpm !== undefined) {
      charts.push({
        title: '转速趋势',
        data: historyData.map(d => ({ time: d.timeStr, value: d.rpm || 0 })),
        unit: 'RPM',
        color: '#73c0de',
      });
    }

    return charts;
  }, [historyData]);

  return (
    <Drawer
      title={node?.data ? getNodeDisplayLabel(node.data) || '节点详情' : '节点详情'}
      placement="right"
      width={520}
      open={open}
      onClose={onClose}
      styles={{ body: { maxHeight: 'calc(100vh - 120px)', overflow: 'auto' } }}
      destroyOnClose
    >
      {renderContent()}
      
      {hasRecordableData() && (
        <>
          <Divider style={{ margin: '24px 0 16px' }} />
          
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <Title level={5} style={{ margin: 0 }}>
                <VideoCameraOutlined /> 历史曲线
                {isRecording && (
                  <Badge 
                    status="processing" 
                    color="red" 
                    style={{ marginLeft: 8 }}
                  />
                )}
              </Title>
              
              <Space size={4}>
                {!isRecording ? (
                  <Button
                    type="primary"
                    size="small"
                    icon={<PlayCircleOutlined />}
                    onClick={startRecording}
                  >
                    开始录像
                  </Button>
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

            <div style={{ marginBottom: 12, fontSize: 12, color: '#888' }}>
              {isRecording ? (
                <span style={{ color: '#52c41a' }}>
                  <Badge status="processing" color="red" /> 正在录像中... 已记录 {historyData.length} 个数据点
                </span>
              ) : historyData.length > 0 ? (
                <span>已记录 {historyData.length} 个数据点（最近 60 秒）</span>
              ) : (
                <span>点击&quot;开始录像&quot;记录实时数据（最多保存 60 秒）</span>
              )}
            </div>

            {getHistoryChartData().map((chart, index) => (
              <div key={index} style={{ marginBottom: 16 }}>
                <TrendChart
                  title={chart.title}
                  data={chart.data}
                  unit={chart.unit}
                  color={chart.color}
                />
              </div>
            ))}

            {historyData.length === 0 && !isRecording && (
              <div style={{ 
                textAlign: 'center', 
                padding: '40px 20px', 
                background: '#f5f5f5', 
                borderRadius: 8,
                color: '#999' 
              }}>
                <VideoCameraAddOutlined style={{ fontSize: 32, marginBottom: 8 }} />
                <div>暂无历史数据</div>
                <div style={{ fontSize: 12, marginTop: 4 }}>点击&quot;开始录像&quot;即可记录</div>
              </div>
            )}
          </div>
        </>
      )}
    </Drawer>
  );
};

export default CloneNodeDetailPanel;
