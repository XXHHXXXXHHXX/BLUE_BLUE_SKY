'use client';

import React, { useCallback, useRef, useState, useEffect } from 'react';
import { Button, Tooltip, message, Divider } from 'antd';
import {
  ZoomInOutlined,
  ZoomOutOutlined,
  ExpandOutlined,
  DownloadOutlined,
  UploadOutlined,
  EyeOutlined,
  VideoCameraOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  SafetyOutlined,
} from '@ant-design/icons';
import { useReactFlow } from '@xyflow/react';
import { useCloneTopologyStore } from '../../stores/cloneTopologyStore';
import { useMonitorStore } from '../../stores/monitorStore';
import { useBatchRecordStore } from '../../stores/batchRecordStore';
import CloneTopologySelector from './CloneTopologySelector';
import BatchRecordModal from '../modals/BatchRecordModal';
import BMCConfigPanel from '../monitor/BMCConfigPanel';

const CloneToolbar: React.FC = () => {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const { exportTopology, importTopology, nodes } = useCloneTopologyStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // 概览面板状态
  const toggleOverview = useCloneTopologyStore((s) => s.toggleOverview);
  
  // 监控状态
  const { isPolling, startPolling, stopPolling } = useMonitorStore();
  
  // BMC 配置面板
  const [bmcPanelOpen, setBmcPanelOpen] = useState(false);

  // 批量录像状态
  const [modalOpen, setModalOpen] = useState(false);
  const isBatchRecording = useBatchRecordStore((s) => s.isBatchRecording);
  const startBatchRecording = useBatchRecordStore((s) => s.startBatchRecording);
  const stopBatchRecording = useBatchRecordStore((s) => s.stopBatchRecording);
  const addDataPoint = useBatchRecordStore((s) => s.addDataPoint);
  const downloadZip = useBatchRecordStore((s) => s.downloadZip);
  const clearBatchData = useBatchRecordStore((s) => s.clearBatchData);

  const handleExport = useCallback(() => {
    const data = exportTopology();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `topology-clone-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    message.success('拓扑已导出');
  }, [exportTopology]);

  const handleImport = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string);
        const success = await importTopology(data);
        if (success) {
          message.success('拓扑已导入');
        } else {
          message.error('文件格式不正确，请检查 JSON 格式');
        }
      } catch {
        message.error('文件解析失败，请检查 JSON 格式');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }, [importTopology]);

  // 开始批量录像
  const handleStartBatchRecord = useCallback((selectedIds: string[]) => {
    const getNodeInfo = (id: string) => {
      const node = nodes.find((n) => n.id === id);
      if (!node) return null;
      return {
        label: node.data.label || node.id,
        type: node.data.nodeType,
      };
    };
    startBatchRecording(selectedIds, getNodeInfo);
    message.success(`开始批量录像，已选择 ${selectedIds.length} 个模块`);
  }, [nodes, startBatchRecording]);

  // 停止批量录像
  const handleStopBatchRecord = useCallback(async () => {
    stopBatchRecording();
    message.info('正在生成压缩包...');
    try {
      await downloadZip();
      message.success('压缩包已下载');
      clearBatchData();
    } catch (error) {
      message.error('生成压缩包失败');
      console.error(error);
    }
  }, [stopBatchRecording, downloadZip, clearBatchData]);

  // 批量录像数据收集 - 使用 useEffect 监听节点变化
  useEffect(() => {
    if (!isBatchRecording || !isPolling) return;

    // 为每个正在录像的节点添加数据点
    nodes.forEach((node) => {
      const { nodeType } = node.data;
      
      let dataPoint: Parameters<typeof addDataPoint>[1] = {};
      let hasData = false;

      switch (nodeType) {
        case 'ac':
        case 'psu':
        case 'vr':
        case 'psip': {
          const sourceData = (node.data as { sourceData?: { outputPower: number; temperature: number; outputVoltage: number; current: number } }).sourceData;
          if (sourceData) {
            dataPoint = {
              power: sourceData.outputPower,
              temperature: sourceData.temperature,
              voltage: sourceData.outputVoltage,
              current: sourceData.current,
            };
            hasData = true;
          }
          break;
        }
        case 'busbar': {
          const busbarSourceData = (node.data as { sourceData?: { busbarPower: number; busbarVoltage: number; busbarCurrent: number } }).sourceData;
          if (busbarSourceData) {
            dataPoint = {
              power: busbarSourceData.busbarPower,
              voltage: busbarSourceData.busbarVoltage,
              current: busbarSourceData.busbarCurrent,
            };
            hasData = true;
          }
          break;
        }
        case 'fan': {
          const fanData = (node.data as { fanData?: { power: number; temperature: number; rpm: number; speedPercent: number } }).fanData;
          if (fanData) {
            dataPoint = {
              power: fanData.power,
              temperature: fanData.temperature,
              rpm: fanData.rpm,
              speedPercent: fanData.speedPercent,
            };
            hasData = true;
          }
          break;
        }
        case 'cpu': {
          const cpuData = (node.data as { cpuData?: { power: number; temperature: number } }).cpuData;
          if (cpuData) {
            dataPoint = {
              power: cpuData.power,
              temperature: cpuData.temperature,
            };
            hasData = true;
          }
          break;
        }
        case 'memory': {
          const memoryData = (node.data as { memoryData?: { power: number; temperature: number } }).memoryData;
          if (memoryData) {
            dataPoint = {
              power: memoryData.power,
              temperature: memoryData.temperature,
            };
            hasData = true;
          }
          break;
        }
        case 'disk': {
          const diskData = (node.data as { diskData?: { power: number; temperature: number } }).diskData;
          if (diskData) {
            dataPoint = {
              power: diskData.power,
              temperature: diskData.temperature,
            };
            hasData = true;
          }
          break;
        }
        case 'io': {
          const ioData = (node.data as { ioData?: { power: number; temperature: number } }).ioData;
          if (ioData) {
            dataPoint = {
              power: ioData.power,
              temperature: ioData.temperature,
            };
            hasData = true;
          }
          break;
        }
        case 'card': {
          const cardData = (node.data as { cardData?: { power: number; temperature: number } }).cardData;
          if (cardData) {
            dataPoint = {
              power: cardData.power,
              temperature: cardData.temperature,
            };
            hasData = true;
          }
          break;
        }
        case 'sensor': {
          const sensorData = (node.data as { sensorData?: { temperature: number } }).sensorData;
          if (sensorData) {
            dataPoint = {
              temperature: sensorData.temperature,
            };
            hasData = true;
          }
          break;
        }
      }

      if (hasData) {
        addDataPoint(node.id, dataPoint);
      }
    });
  }, [isBatchRecording, isPolling, nodes, addDataPoint]);

  const buttons = [
    { title: '放大', icon: <ZoomInOutlined />, onClick: () => zoomIn() },
    { title: '缩小', icon: <ZoomOutOutlined />, onClick: () => zoomOut() },
    { title: '适应画布', icon: <ExpandOutlined />, onClick: () => fitView() },
    { title: '导出拓扑', icon: <DownloadOutlined />, onClick: handleExport },
    { title: '导入拓扑', icon: <UploadOutlined />, onClick: handleImport },
  ];

  return (
    <>
      <div
        className="clone-toolbar"
        style={{
          position: 'absolute',
          top: 10,
          left: 10,
          zIndex: 10,
          display: 'flex',
          gap: 4,
          background: '#fff',
          borderRadius: 6,
          padding: 4,
          boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
          alignItems: 'center',
        }}
      >
        {/* 拓扑选择器 */}
        <CloneTopologySelector />
        
        <Divider type="vertical" style={{ margin: '0 4px' }} />
        
        {buttons.map(({ title, icon, onClick }) => (
          <Tooltip key={title} title={title}>
            <Button type="text" size="small" icon={icon} onClick={onClick} />
          </Tooltip>
        ))}

        {/* 概览面板切换按钮 */}
        <Tooltip title="拓扑概览">
          <Button
            type="text"
            size="small"
            icon={<EyeOutlined />}
            onClick={toggleOverview}
          >
            概览
          </Button>
        </Tooltip>

        <Divider type="vertical" style={{ margin: '0 4px' }} />

        {/* BMC 配置按钮 */}
        <Tooltip title="BMC 连接配置">
          <Button
            type="text"
            size="small"
            icon={<SafetyOutlined />}
            onClick={() => setBmcPanelOpen(true)}
          >
            BMC
          </Button>
        </Tooltip>

        <Divider type="vertical" style={{ margin: '0 4px' }} />

        {/* 实时监控开关 */}
        {isPolling ? (
          <Tooltip title="停止实时监控">
            <Button
              type="primary"
              danger
              size="small"
              icon={<PauseCircleOutlined />}
              onClick={stopPolling}
            >
              监控中
            </Button>
          </Tooltip>
        ) : (
          <Tooltip title="开启实时监控">
            <Button
              type="primary"
              size="small"
              icon={<PlayCircleOutlined />}
              onClick={startPolling}
            >
              开启监控
            </Button>
          </Tooltip>
        )}

        <Divider type="vertical" style={{ margin: '0 4px' }} />

        {/* 批量录像按钮 */}
        {isBatchRecording ? (
          <Tooltip title="停止批量录像并下载">
            <Button
              type="primary"
              danger
              size="small"
              icon={<PauseCircleOutlined />}
              onClick={handleStopBatchRecord}
            >
              停止录像
            </Button>
          </Tooltip>
        ) : (
          <Tooltip title={isPolling ? '批量录像' : '请先开启实时监控'}>
            <Button
              type={isPolling ? 'primary' : 'default'}
              size="small"
              icon={<VideoCameraOutlined />}
              onClick={() => setModalOpen(true)}
              disabled={!isPolling}
            >
              批量录像
            </Button>
          </Tooltip>
        )}
        
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          onChange={handleFileChange}
          style={{ display: 'none' }}
        />
      </div>

      {/* 批量录像选择弹窗 */}
      <BatchRecordModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onConfirm={handleStartBatchRecord}
        isRecording={isBatchRecording}
        nodes={nodes}
      />

      <BMCConfigPanel
        open={bmcPanelOpen}
        onClose={() => setBmcPanelOpen(false)}
      />
    </>
  );
};

export default CloneToolbar;
