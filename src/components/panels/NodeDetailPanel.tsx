'use client';

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { Drawer, Descriptions, Slider, message, Tag, Typography, Button, Space, Divider, Tooltip, Badge } from 'antd';
import { 
  setFanSpeed, 
  setVoltage 
} from '../../services/bmcApi';
import { useTopologyStore } from '../../stores/topologyStore';
import { useMonitorStore } from '../../stores/monitorStore';
import { useHistoryRecorder } from '../../hooks/useHistoryRecorder';
import { useNodeFieldConfig } from '../topology/nodes/useNodeFieldConfig';
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
import { DEFAULT_FIELD_THRESHOLDS } from '../../types/topology';
import type { TopologyNode } from '../../types/topology';
import { getThresholdColorForField } from '../../utils/formatters';
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

/** 曲线颜色盘 */
const CHART_COLORS = ['#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de', '#3ba272', '#fc8452', '#9a60b4', '#ea7ccc'];

/** 根据字段名推断单位与分配曲线颜色 */
function getFieldUnitInfo(fieldKey: string, index: number): { unit: string; color: string } {
  const lower = fieldKey.toLowerCase();
  let unit = '';
  if (lower.includes('temp')) unit = '°C';
  else if (lower.includes('voltage')) unit = 'V';
  else if (lower.includes('current')) unit = 'A';
  else if (lower.includes('power')) unit = 'W';
  else if (lower.includes('efficiency')) unit = '%';
  else if (lower.includes('rpm')) unit = 'RPM';
  else if (lower.includes('speed') || lower.includes('percent')) unit = '%';
  else if (lower.includes('loss')) unit = 'W';
  return { unit, color: CHART_COLORS[index % CHART_COLORS.length] };
}

/** 从节点数据中提取所有数值字段（结构化数据 + displayMetrics），用于录像 */
function getNodeNumericFieldValues(d: Record<string, unknown>): Record<string, number | null> {
  const result: Record<string, number | null> = {};
  const collect = (obj: Record<string, unknown> | undefined) => {
    if (!obj) return;
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'number') {
        result[k] = v;
      }
    }
  };
  collect(d.sourceData as Record<string, unknown> | undefined);
  collect(d.fanData as Record<string, unknown> | undefined);
  collect(d.cpuData as Record<string, unknown> | undefined);
  collect(d.memoryData as Record<string, unknown> | undefined);
  collect(d.diskData as Record<string, unknown> | undefined);
  collect(d.ioData as Record<string, unknown> | undefined);
  collect(d.cardData as Record<string, unknown> | undefined);
  collect(d.sensorData as Record<string, unknown> | undefined);
  collect(d.mgmtBoardData as Record<string, unknown> | undefined);
  // displayMetrics 覆盖（包含自定义字段值）
  collect(d.displayMetrics as Record<string, unknown> | undefined);
  return result;
}

interface NodeDetailPanelProps {
  open: boolean;
  onClose: () => void;
  node: TopologyNode | null;
}

const NodeDetailPanel: React.FC<NodeDetailPanelProps> = ({ open, onClose, node: propNode }) => {
  const nodes = useTopologyStore((s) => s.nodes);
  const updateFanSpeed = useTopologyStore((s) => s.updateFanSpeed);
  const updateSourceVoltage = useTopologyStore((s) => s.updateSourceVoltage);
  const isPolling = useMonitorStore((s) => s.isPolling);
  
  // 从 store 获取实时节点数据
  const node = useMemo(() => {
    if (!propNode) return null;
    const liveNode = nodes.find((n) => n.id === propNode.id);
    return liveNode || propNode;
  }, [nodes, propNode]);

  const [fanSpeed, setFanSpeedLocal] = useState<number>(50);
  const [voltageValue, setVoltageValue] = useState<number>(1.0);

  // 使用节点字段配置，根据 apiConfig.fieldMappings 动态决定显示哪些字段
  const nodeDataForConfig = (node?.data || {}) as Record<string, unknown>;
  const { orderedVisibleFieldKeys, getFieldLabel } = useNodeFieldConfig(nodeDataForConfig);

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

  // 当开启实时监控且正在录像时，记录数据点（只记录当前节点配置为显示的字段）
  useEffect(() => {
    if (!isRecording || !isPolling || !node?.data) return;

    const data = node.data as Record<string, unknown>;
    const nodeFieldValues = getNodeNumericFieldValues(data);

    // 只记录配置为显示的字段，字段名保持与展示一致
    const dataPoint: Parameters<typeof addDataPoint>[0] = {};
    for (const key of orderedVisibleFieldKeys) {
      if (Object.prototype.hasOwnProperty.call(nodeFieldValues, key)) {
        dataPoint[key] = nodeFieldValues[key];
      }
    }

    if (Object.keys(dataPoint).length > 0) {
      addDataPoint(dataPoint);
    }
  // 依赖项包含 nodes（从store订阅的实时数据），确保每次节点数据更新时都会记录
  }, [isRecording, isPolling, nodes, node?.id, orderedVisibleFieldKeys, addDataPoint]);

  const handleFanSpeedComplete = useCallback(async (value: number) => {
    if (!node) return;
    setFanSpeedLocal(value);
    // 更新 store 使拓扑节点显示同步
    updateFanSpeed(node.id, value);
    try {
      await setFanSpeed(node.id, value);
      message.success(`风扇转速已设置为 ${value}%`);
    } catch {
      message.error('设置风扇转速失败');
    }
  }, [node, updateFanSpeed]);

  const handleVoltageComplete = useCallback(async (value: number) => {
    if (!node) return;
    setVoltageValue(value);
    // 更新 store 使拓扑节点显示同步
    updateSourceVoltage(node.id, value);
    try {
      await setVoltage(node.id, value);
      message.success(`电压已设置为 ${value.toFixed(2)}V`);
    } catch {
      message.error('设置电压失败');
    }
  }, [node, updateSourceVoltage]);

  const renderContent = () => {
    if (!node?.data) return <div>暂无数据</div>;

    const d = node.data as Record<string, unknown>;
    const nodeType = d.nodeType as string;

    // 读取 controlRange 配置
    const controlRange = d.controlRange as { min: number; max: number } | undefined;
    const thresholds = node.data.apiConfig?.fieldThresholds;
    const displayMetrics = d.displayMetrics as Record<string, number | null> | undefined;

    // 通用字段渲染：对已知字段从数据对象取值，对未知字段从 displayMetrics 取值
    // rawValues 提供字段对应的原始数值，用于应用阈值颜色
    const renderDynamicFields = (
      fieldValues: Record<string, React.ReactNode>,
      rawValues: Record<string, number | null | undefined> = {},
      skipKeys: string[] = []
    ) => {
      return orderedVisibleFieldKeys
        .filter((key) => !skipKeys.includes(key))
        .map((key) => {
          let content: React.ReactNode;
          let raw: number | null | undefined;

          if (fieldValues[key] !== undefined) {
            content = fieldValues[key];
            raw = rawValues[key];
          } else {
            raw = displayMetrics?.[key];
            content = (raw !== null && raw !== undefined && !Number.isNaN(raw))
              ? typeof raw === 'number' ? raw.toFixed(2) : String(raw)
              : 'NA';
          }

          // 应用阈值颜色（仅对纯文本内容生效，不覆盖已有 ReactNode 的自定义颜色）
          const thresholdColor = getThresholdColorForField(raw, key, thresholds, DEFAULT_FIELD_THRESHOLDS);
          if (thresholdColor && typeof content === 'string') {
            content = <span style={{ color: thresholdColor }}>{content}</span>;
          }

          return (
            <Descriptions.Item key={key} label={getFieldLabel(key)}>
              {content}
            </Descriptions.Item>
          );
        });
    };

    switch (nodeType) {
      case 'ac': {
        const s = d.sourceData as SourceData;
        if (!s) return <div>暂无数据</div>;

        const fieldValues: Record<string, React.ReactNode> = {
          outputVoltage: formatVoltage(s.outputVoltage),
          current: formatCurrent(s.current),
          outputPower: (
            <span style={{ color: getThresholdColorForField(s.outputPower, 'outputPower', thresholds) }}>
              {formatPower(s.outputPower)}
            </span>
          ),
        };
        const rawValues: Record<string, number | null | undefined> = {
          outputVoltage: s.outputVoltage,
          current: s.current,
          outputPower: s.outputPower,
        };

        return (
          <Descriptions column={1} bordered size="small">
            {renderDynamicFields(fieldValues, rawValues)}
          </Descriptions>
        );
      }

      case 'psu': {
        const s = d.sourceData as SourceData;
        if (!s) return <div>暂无数据</div>;

        const fieldValues: Record<string, React.ReactNode> = {
          inputVoltage: formatVoltage(s.inputVoltage),
          inputCurrent: formatCurrent(s.inputCurrent ?? s.current),
          inputPower: (
            <span style={{ color: getThresholdColorForField(s.inputPower, 'inputPower', thresholds) }}>
              {formatPower(s.inputPower)}
            </span>
          ),
          outputVoltage: formatVoltage(s.outputVoltage),
          outputCurrent: formatCurrent(s.outputCurrent ?? s.current),
          outputPower: (
            <span style={{ color: getThresholdColorForField(s.outputPower, 'outputPower', thresholds) }}>
              {formatPower(s.outputPower)}
            </span>
          ),
          efficiency: (
            <span style={{ color: getThresholdColorForField(s.efficiency, 'efficiency', thresholds) }}>
              {formatEfficiency(s.efficiency)}
            </span>
          ),
          temperature: (
            <span style={{ color: getThresholdColorForField(s.temperature, 'temperature', thresholds) }}>
              {formatTemperature(s.temperature)}
            </span>
          ),
          psuIntakeTemp: (
            <span style={{ color: getThresholdColorForField(s.psuIntakeTemp, 'psuIntakeTemp', thresholds) }}>
              {formatTemperature(s.psuIntakeTemp)}
            </span>
          ),
          psuMosTemp: (
            <span style={{ color: getThresholdColorForField(s.psuMosTemp, 'psuMosTemp', thresholds) }}>
              {formatTemperature(s.psuMosTemp)}
            </span>
          ),
          psuRearIntakeTemp: (
            <span style={{ color: getThresholdColorForField(s.psuRearIntakeTemp, 'psuRearIntakeTemp', thresholds) }}>
              {formatTemperature(s.psuRearIntakeTemp)}
            </span>
          ),
        };
        const rawValues: Record<string, number | null | undefined> = {
          inputVoltage: s.inputVoltage,
          inputCurrent: s.inputCurrent ?? s.current,
          inputPower: s.inputPower,
          outputVoltage: s.outputVoltage,
          outputCurrent: s.outputCurrent ?? s.current,
          outputPower: s.outputPower,
          efficiency: s.efficiency,
          temperature: s.temperature,
          psuIntakeTemp: s.psuIntakeTemp,
          psuMosTemp: s.psuMosTemp,
          psuRearIntakeTemp: s.psuRearIntakeTemp,
        };

        return (
          <Descriptions column={1} bordered size="small">
            {renderDynamicFields(fieldValues, rawValues)}
          </Descriptions>
        );
      }

      case 'busbar': {
        const s = d.sourceData as SourceData;
        if (!s) return <div>暂无数据</div>;

        const fieldValues: Record<string, React.ReactNode> = {
          busbarVoltage: formatVoltage(s.busbarVoltage),
          busbarCurrent: formatCurrent(s.busbarCurrent),
          busbarPower: (
            <span style={{ color: getThresholdColorForField(s.busbarPower, 'busbarPower', thresholds) }}>
              {formatPower(s.busbarPower)}
            </span>
          ),
        };
        const rawValues: Record<string, number | null | undefined> = {
          busbarVoltage: s.busbarVoltage,
          busbarCurrent: s.busbarCurrent,
          busbarPower: s.busbarPower,
        };

        return (
          <Descriptions column={1} bordered size="small">
            {renderDynamicFields(fieldValues, rawValues)}
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

        const fieldValues: Record<string, React.ReactNode> = {
          inputVoltage: formatVoltage(s.inputVoltage),
          inputCurrent: formatCurrent(s.inputCurrent ?? s.current),
          inputPower: formatPower(s.inputPower),
          outputVoltage: formatVoltage(s.outputVoltage),
          outputCurrent: formatCurrent(s.outputCurrent ?? s.current),
          outputPower: (
            <span style={{ color: getThresholdColorForField(s.outputPower, 'outputPower', thresholds) }}>
              {formatPower(s.outputPower)}
            </span>
          ),
          efficiency: (
            <span style={{ color: getThresholdColorForField(s.efficiency, 'efficiency', thresholds) }}>
              {formatEfficiency(s.efficiency)}
            </span>
          ),
          temperature: (
            <span style={{ color: getThresholdColorForField(s.temperature, 'temperature', thresholds) }}>
              {formatTemperature(s.temperature)}
            </span>
          ),
        };
        const rawValues: Record<string, number | null | undefined> = {
          inputVoltage: s.inputVoltage,
          inputCurrent: s.inputCurrent ?? s.current,
          inputPower: s.inputPower,
          outputVoltage: s.outputVoltage,
          outputCurrent: s.outputCurrent ?? s.current,
          outputPower: s.outputPower,
          efficiency: s.efficiency,
          temperature: s.temperature,
        };

        return (
          <>
            <Descriptions column={1} bordered size="small">
              {renderDynamicFields(fieldValues, rawValues, ['vrOutputVoltageControl'])}
            </Descriptions>
            <div style={{ marginTop: 16 }}>
              <Title level={5}>VR输出电压调节接口</Title>
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

        const fieldValues: Record<string, React.ReactNode> = {
          inputVoltage: formatVoltage(s.inputVoltage),
          inputCurrent: formatCurrent(s.inputCurrent ?? s.current),
          inputPower: formatPower(s.inputPower),
          outputVoltage: formatVoltage(s.outputVoltage),
          outputCurrent: formatCurrent(s.outputCurrent ?? s.current),
          outputPower: (
            <span style={{ color: getThresholdColorForField(s.outputPower, 'outputPower', thresholds) }}>
              {formatPower(s.outputPower)}
            </span>
          ),
          efficiency: (
            <span style={{ color: getThresholdColorForField(s.efficiency, 'efficiency', thresholds) }}>
              {formatEfficiency(s.efficiency)}
            </span>
          ),
          temperature: (
            <span style={{ color: getThresholdColorForField(s.temperature, 'temperature', thresholds) }}>
              {formatTemperature(s.temperature)}
            </span>
          ),
        };
        const rawValues: Record<string, number | null | undefined> = {
          inputVoltage: s.inputVoltage,
          inputCurrent: s.inputCurrent ?? s.current,
          inputPower: s.inputPower,
          outputVoltage: s.outputVoltage,
          outputCurrent: s.outputCurrent ?? s.current,
          outputPower: s.outputPower,
          efficiency: s.efficiency,
          temperature: s.temperature,
        };

        return (
          <>
            <Descriptions column={1} bordered size="small">
              {renderDynamicFields(fieldValues, rawValues, ['psipOutputVoltageControl'])}
            </Descriptions>
            <div style={{ marginTop: 16 }}>
              <Title level={5}>psip输出电压调节接口</Title>
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

        const fieldValues: Record<string, React.ReactNode> = {
          power: (
            <span style={{ color: getThresholdColorForField(f.power, 'power', thresholds) }}>
              {formatPower(f.power)}
            </span>
          ),
          temperature: (
            <span style={{ color: getThresholdColorForField(f.temperature, 'temperature', thresholds) }}>
              {formatTemperature(f.temperature)}
            </span>
          ),
          rpm: formatRPM(f.rpm),
          speedPercent: `${f.speedPercent ?? 'NA'}%`,
        };
        const rawValues: Record<string, number | null | undefined> = {
          power: f.power,
          temperature: f.temperature,
          rpm: f.rpm,
          speedPercent: f.speedPercent,
          fanInputVoltage: f.fanInputVoltage,
          fanInputCurrent: f.fanInputCurrent,
        };

        return (
          <>
            <Descriptions column={1} bordered size="small">
              {renderDynamicFields(fieldValues, rawValues, ['fanSpeedControl'])}
            </Descriptions>
            <div style={{ marginTop: 16 }}>
              <Title level={5}>风扇调速接口</Title>
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

        const fieldValues: Record<string, React.ReactNode> = {
          power: (
            <span style={{ color: getThresholdColorForField(c.power, 'power', thresholds) }}>
              {formatPower(c.power)}
            </span>
          ),
          temperature: (
            <span style={{ color: getThresholdColorForField(c.temperature, 'temperature', thresholds) }}>
              {formatTemperature(c.temperature)}
            </span>
          ),
        };
        const rawValues: Record<string, number | null | undefined> = {
          power: c.power,
          temperature: c.temperature,
        };

        return (
          <Descriptions column={1} bordered size="small">
            {renderDynamicFields(fieldValues, rawValues)}
          </Descriptions>
        );
      }

      case 'memory': {
        const m = d.memoryData as MemoryData;
        if (!m) return <div>暂无数据</div>;

        const fieldValues: Record<string, React.ReactNode> = {
          power: (
            <span style={{ color: getThresholdColorForField(m.power, 'power', thresholds) }}>
              {formatPower(m.power)}
            </span>
          ),
          temperature: (
            <span style={{ color: getThresholdColorForField(m.temperature, 'temperature', thresholds) }}>
              {formatTemperature(m.temperature)}
            </span>
          ),
          thermalThrottle: (
            <Tag color={m.thermalThrottle ? 'red' : 'green'}>
              {m.thermalThrottle ? '已触发' : '正常'}
            </Tag>
          ),
        };
        const rawValues: Record<string, number | null | undefined> = {
          power: m.power,
          temperature: m.temperature,
        };

        return (
          <Descriptions column={1} bordered size="small">
            {renderDynamicFields(fieldValues, rawValues)}
          </Descriptions>
        );
      }

      case 'disk': {
        const dk = d.diskData as DiskData;
        if (!dk) return <div>暂无数据</div>;

        const fieldValues: Record<string, React.ReactNode> = {
          power: (
            <span style={{ color: getThresholdColorForField(dk.power, 'power', thresholds) }}>
              {formatPower(dk.power)}
            </span>
          ),
          temperature: (
            <span style={{ color: getThresholdColorForField(dk.temperature, 'temperature', thresholds) }}>
              {formatTemperature(dk.temperature)}
            </span>
          ),
          status: (
            <Tag color={dk.status === 'normal' ? 'green' : dk.status === 'warning' ? 'orange' : 'red'}>
              {dk.status}
            </Tag>
          ),
        };
        const rawValues: Record<string, number | null | undefined> = {
          power: dk.power,
          temperature: dk.temperature,
          diskInputVoltage: dk.diskInputVoltage,
          diskInputCurrent: dk.diskInputCurrent,
          nvmeInternalTemp: dk.nvmeInternalTemp,
          nvmeMaxTemp: dk.nvmeMaxTemp,
        };

        return (
          <Descriptions column={1} bordered size="small">
            {renderDynamicFields(fieldValues, rawValues)}
          </Descriptions>
        );
      }

      case 'io': {
        const io = d.ioData as IOData;
        if (!io) return <div>暂无数据</div>;

        const fieldValues: Record<string, React.ReactNode> = {
          power: (
            <span style={{ color: getThresholdColorForField(io.power, 'power', thresholds) }}>
              {formatPower(io.power)}
            </span>
          ),
          temperature: (
            <span style={{ color: getThresholdColorForField(io.temperature, 'temperature', thresholds) }}>
              {formatTemperature(io.temperature)}
            </span>
          ),
          linkSpeed: io.linkSpeed,
        };
        const rawValues: Record<string, number | null | undefined> = {
          power: io.power,
          temperature: io.temperature,
          linkSpeed: io.linkSpeed as number | null | undefined,
        };

        return (
          <Descriptions column={1} bordered size="small">
            {renderDynamicFields(fieldValues, rawValues)}
          </Descriptions>
        );
      }

      case 'card': {
        const cd = d.cardData as CardData;
        if (!cd) return <div>暂无数据</div>;

        const fieldValues: Record<string, React.ReactNode> = {
          power: (
            <span style={{ color: getThresholdColorForField(cd.power, 'power', thresholds) }}>
              {formatPower(cd.power)}
            </span>
          ),
          temperature: (
            <span style={{ color: getThresholdColorForField(cd.temperature, 'temperature', thresholds) }}>
              {formatTemperature(cd.temperature)}
            </span>
          ),
          slotId: cd.slotId,
        };
        const rawValues: Record<string, number | null | undefined> = {
          power: cd.power,
          temperature: cd.temperature,
          cardInputVoltage: cd.cardInputVoltage,
          cardInputCurrent: cd.cardInputCurrent,
          ocpMainChipTemp: cd.ocpMainChipTemp,
          ocpOpticalMaxTemp: cd.ocpOpticalMaxTemp,
        };

        return (
          <Descriptions column={1} bordered size="small">
            {renderDynamicFields(fieldValues, rawValues)}
          </Descriptions>
        );
      }

      case 'sensor': {
        const sn = d.sensorData as SensorData;
        if (!sn) return <div>暂无数据</div>;

        // sensor 特殊布局：temperature 显示为大数字，location 显示为位置
        const visibleKeys = orderedVisibleFieldKeys;
        const hasTemp = visibleKeys.includes('temperature');
        const hasLocation = visibleKeys.includes('location');
        const tempValue = sn.temperature ?? 0;
        const customColor = getThresholdColorForField(sn.temperature, 'temperature', thresholds);
        const color = customColor || getTemperatureColor(tempValue);

        if (!hasTemp && !hasLocation) {
          return <div>暂无数据</div>;
        }

        return (
          <div style={{ textAlign: 'center', padding: 24 }}>
            {hasTemp && (
              <div style={{ fontSize: 48, fontWeight: 'bold', color }}>
                {tempValue.toFixed(1)}°C
              </div>
            )}
            {hasLocation && (
              <div style={{ marginTop: 8, color: '#888' }}>
                {sn.location || 'Unknown'}
              </div>
            )}
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


  // 判断当前节点是否有可记录的数据
  const hasRecordableData = useCallback(() => {
    if (!node?.data) return false;
    const { nodeType } = node.data;
    return ['ac', 'psu', 'vr', 'psip', 'busbar', 'fan', 'cpu', 'memory', 'disk', 'io', 'card', 'sensor'].includes(nodeType);
  }, [node]);

  // 获取历史曲线数据（按录制的字段生成曲线，字段名与展示保持一致）
  const getHistoryChartData = useCallback(() => {
    if (!historyData.length) return [];

    const first = historyData[0];
    const fieldKeys = Object.keys(first).filter((k) => !['timestamp', 'timeStr'].includes(k));

    const charts: Array<{ title: string; data: Array<{ time: string; value: number | null }>; unit: string; color: string }> = [];

    fieldKeys.forEach((key, index) => {
      const { unit, color } = getFieldUnitInfo(key, index);
      charts.push({
        title: getFieldLabel(key),
        data: historyData.map((d) => ({ time: d.timeStr, value: (d[key] as number | null | undefined) ?? null })),
        unit,
        color,
      });
    });

    return charts;
  }, [historyData, getFieldLabel]);

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
      
      {/* 历史曲线录像区域 */}
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

            {/* 状态提示 */}
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

            {/* 历史曲线图表 */}
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
                <div style={{ fontSize: 12, marginTop: 4 }}>开启实时监控后点击&quot;开始录像&quot;</div>
              </div>
            )}
          </div>
        </>
      )}
    </Drawer>
  );
};

export default NodeDetailPanel;
