'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Modal, Checkbox, Button, List, Tag, Space, Typography, Alert } from 'antd';
import { VideoCameraOutlined, CheckCircleOutlined } from '@ant-design/icons';
import type { TopologyNode } from '../../types/topology';
import useMaximizableModal from '../../hooks/useMaximizableModal';

const { Text } = Typography;

interface BatchRecordModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (selectedIds: string[]) => void;
  isRecording: boolean;
  nodes: TopologyNode[]; // 传入节点列表，支持主页面和分身页面
}

/** 可录像的节点类型 */
const RECORDABLE_TYPES = ['ac', 'psu', 'vr', 'psip', 'busbar', 'fan', 'cpu', 'memory', 'disk', 'io', 'card', 'sensor'];

/** 节点类型显示名称 */
const TYPE_NAMES: Record<string, string> = {
  ac: 'AC 电源',
  psu: 'PSU 电源',
  busbar: '母线',
  vr: 'VR 稳压器',
  psip: 'PSIP 电源',
  fan: '风扇',
  cpu: 'CPU',
  memory: '内存',
  disk: '磁盘',
  io: 'IO 设备',
  card: '扩展卡',
  sensor: '温度传感器',
};

/** 节点类型颜色 */
const TYPE_COLORS: Record<string, string> = {
  ac: 'green',
  psu: 'green',
  busbar: 'green',
  vr: 'blue',
  psip: 'blue',
  fan: 'cyan',
  cpu: 'red',
  memory: 'purple',
  disk: 'orange',
  io: 'geekblue',
  card: 'gold',
  sensor: 'magenta',
};

const BatchRecordModal: React.FC<BatchRecordModalProps> = ({
  open,
  onClose,
  onConfirm,
  nodes,
}) => {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const modal = useMaximizableModal({ minWidth: 700 });

  // 过滤可录像的节点
  const recordableNodes = useMemo(() => {
    return nodes.filter((node) => RECORDABLE_TYPES.includes(node.data.nodeType));
  }, [nodes]);

  // 重置选择
  useEffect(() => {
    if (open) {
      setSelectedIds([]);
    }
  }, [open]);

  const handleToggle = (nodeId: string) => {
    setSelectedIds((prev) =>
      prev.includes(nodeId)
        ? prev.filter((id) => id !== nodeId)
        : [...prev, nodeId]
    );
  };

  const handleSelectAll = () => {
    setSelectedIds(recordableNodes.map((n) => n.id));
  };

  const handleDeselectAll = () => {
    setSelectedIds([]);
  };

  const handleConfirm = () => {
    onConfirm(selectedIds);
    onClose();
  };

  return (
    <Modal
      title={modal.renderTitle(
        <Space>
          <VideoCameraOutlined />
          <span>选择要录像的模块</span>
        </Space>
      )}
      open={open}
      onCancel={onClose}
      footer={
        <Space>
          <Button onClick={onClose}>取消</Button>
          <Button
            type="primary"
            icon={<VideoCameraOutlined />}
            onClick={handleConfirm}
            disabled={selectedIds.length === 0}
          >
            开始批量录像 ({selectedIds.length})
          </Button>
        </Space>
      }
      width={modal.width}
      style={modal.style}
      styles={{ body: modal.bodyStyle }}
    >
      <Alert
        message="批量录像说明"
        description="选择需要同时录像的模块，系统将同时记录所有选中模块的数据。录像期间固定保留最近 60 秒的数据。"
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
      />

      <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between' }}>
        <Text strong>可录像模块 ({recordableNodes.length})</Text>
        <Space size={4}>
          <Button size="small" onClick={handleSelectAll}>
            全选
          </Button>
          <Button size="small" onClick={handleDeselectAll}>
            清空
          </Button>
        </Space>
      </div>

      <List
        bordered
        size="small"
        style={{ maxHeight: modal.isMaximized ? 600 : 400, overflow: 'auto' }}
        dataSource={recordableNodes}
        renderItem={(node: TopologyNode) => (
          <List.Item
            key={node.id}
            onClick={() => handleToggle(node.id)}
            style={{
              cursor: 'pointer',
              background: selectedIds.includes(node.id) ? '#e6f7ff' : 'transparent',
            }}
          >
            <Checkbox
              checked={selectedIds.includes(node.id)}
              onChange={() => handleToggle(node.id)}
              onClick={(e) => e.stopPropagation()}
            >
              <Space>
                <Tag color={TYPE_COLORS[node.data.nodeType] || 'default'}>
                  {TYPE_NAMES[node.data.nodeType] || node.data.nodeType}
                </Tag>
                <Text>{node.data.label || node.id}</Text>
              </Space>
            </Checkbox>
          </List.Item>
        )}
      />

      {selectedIds.length > 0 && (
        <div style={{ marginTop: 12, padding: 8, background: '#f6ffed', borderRadius: 4 }}>
          <CheckCircleOutlined style={{ color: '#52c41a', marginRight: 8 }} />
          <Text type="success">已选择 {selectedIds.length} 个模块</Text>
        </div>
      )}
    </Modal>
  );
};

export default BatchRecordModal;
