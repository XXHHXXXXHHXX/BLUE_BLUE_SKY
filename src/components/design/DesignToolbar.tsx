'use client';

import React, { useCallback, useRef, useState } from 'react';
import { Button, Tooltip, message, Badge, Divider } from 'antd';
import {
  ZoomInOutlined,
  ZoomOutOutlined,
  ExpandOutlined,
  DeleteOutlined,
  ClearOutlined,
  ReloadOutlined,
  DownloadOutlined,
  UploadOutlined,
  SaveOutlined,
  HistoryOutlined,
  CopyOutlined,
  SnippetsOutlined,
  QuestionCircleOutlined,
} from '@ant-design/icons';
import { useReactFlow } from '@xyflow/react';
import { useDesignTopologyStore } from '../../stores/designTopologyStore';
import VersionHistoryPanel from './VersionHistoryPanel';
import TopologyManager from './TopologyManager';

interface DesignToolbarProps {
  onDelete: () => void;
  onClear: () => void;
  onReset: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onDiscard: () => Promise<void>;
  hasUnsavedChanges: boolean;
}

const DesignToolbar: React.FC<DesignToolbarProps> = ({ 
  onDelete, 
  onClear, 
  onReset, 
  onCopy, 
  onPaste, 
  onDiscard,
  hasUnsavedChanges 
}) => {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const { exportTopology, importTopology, saveManual, saveToBackend, isSaving } = useDesignTopologyStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [versionPanelOpen, setVersionPanelOpen] = useState(false);

  const handleExport = useCallback(() => {
    const data = exportTopology();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `topology-${new Date().toISOString().slice(0, 10)}.json`;
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
        if (data && Array.isArray(data.nodes) && Array.isArray(data.edges)) {
          importTopology(data);
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

  // 保存版本：先保存拓扑，再创建版本
  const handleSaveVersion = useCallback(async () => {
    try {
      // 1. 先保存拓扑到后端并同步到主 store
      const success = await saveToBackend();
      if (!success) {
        message.error('保存失败，请检查后端连接');
        return;
      }
      // 2. 创建版本
      await saveManual('手动保存');
      message.success('拓扑已保存并创建版本');
    } catch {
      message.error('保存失败，请检查后端连接');
    }
  }, [saveToBackend, saveManual]);

  const handleDiscard = useCallback(async () => {
    await onDiscard();
    message.info('已放弃更改，重新加载');
  }, [onDiscard]);

  const buttons = [
    { 
      title: hasUnsavedChanges ? '保存版本 (有未保存更改)' : '保存版本', 
      icon: hasUnsavedChanges ? (
        <Badge dot>
          <HistoryOutlined />
        </Badge>
      ) : <HistoryOutlined />, 
      onClick: handleSaveVersion,
      loading: isSaving,
    },
    { title: '版本历史', icon: <HistoryOutlined />, onClick: () => setVersionPanelOpen(true), type: 'text' as const },
    'divider' as const,
    { title: '放大', icon: <ZoomInOutlined />, onClick: () => zoomIn() },
    { title: '缩小', icon: <ZoomOutOutlined />, onClick: () => zoomOut() },
    { title: '适应画布', icon: <ExpandOutlined />, onClick: () => fitView() },
    'divider' as const,
    { title: '复制 (Ctrl+C)', icon: <CopyOutlined />, onClick: onCopy },
    { title: '粘贴 (Ctrl+V)', icon: <SnippetsOutlined />, onClick: onPaste },
    { title: '删除选中 (Del)', icon: <DeleteOutlined />, onClick: onDelete, description: '删除选中的节点和连线' },
    { title: '清空画布', icon: <ClearOutlined />, onClick: onClear },
    'divider' as const,
    { title: '导出拓扑', icon: <DownloadOutlined />, onClick: handleExport },
    { title: '导入拓扑', icon: <UploadOutlined />, onClick: handleImport },
    { title: '放弃更改', icon: <ReloadOutlined />, onClick: handleDiscard, disabled: !hasUnsavedChanges },
    { title: '重置默认', icon: <ReloadOutlined />, onClick: onReset },
    'divider' as const,
    { title: '批量选择帮助', icon: <QuestionCircleOutlined />, onClick: () => message.info('框选: 按住鼠标画框 | Ctrl+点击: 多选 | 选中后可批量拖拽') },
  ];

  return (
    <>
      <div
        className="topology-toolbar"
        style={{
          position: 'absolute',
          top: 10,
          left: 10,
          zIndex: 10,
          display: 'flex',
          gap: 4,
          alignItems: 'center',
          background: '#fff',
          borderRadius: 6,
          padding: 4,
          boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
        }}
      >
        {/* 拓扑管理器 */}
        <TopologyManager />
        
        <Divider type="vertical" style={{ height: 20, margin: '0 4px' }} />
        
        {buttons.map((item, i) => {
          if (item === 'divider') {
            return (
              <div
                key={`divider-${i}`}
                style={{
                  width: 1,
                  height: 20,
                  background: '#e8e8e8',
                  margin: '0 2px',
                }}
              />
            );
          }
          const { title, icon, onClick, loading, disabled, type: btnType } = item;
          return (
            <Tooltip key={title} title={title}>
              <Button 
                type={btnType || 'text'} 
                size="small" 
                icon={icon} 
                onClick={onClick} 
                loading={loading}
                disabled={disabled}
              />
            </Tooltip>
          );
        })}
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          onChange={handleFileChange}
          style={{ display: 'none' }}
        />
      </div>

      <VersionHistoryPanel
        open={versionPanelOpen}
        onClose={() => setVersionPanelOpen(false)}
      />
    </>
  );
};

export default DesignToolbar;
