'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { Drawer, List, Button, Tag, Popconfirm, Empty, message, Typography, Input, Space } from 'antd';
import {
  HistoryOutlined,
  RollbackOutlined,
  DeleteOutlined,
  ClearOutlined,
  EditOutlined,
  CheckOutlined,
  CloseOutlined,
} from '@ant-design/icons';
import { useDesignTopologyStore } from '../../stores/designTopologyStore';
import type { TopologyVersion } from '../../services/topologyPersistence';

const { Text } = Typography;
const { TextArea } = Input;

interface VersionHistoryPanelProps {
  open: boolean;
  onClose: () => void;
}

const VersionHistoryPanel: React.FC<VersionHistoryPanelProps> = ({ open, onClose }) => {
  const { getVersions, rollbackToVersion, updateVersionMeta, deleteVersion, clearVersionHistory } = useDesignTopologyStore();
  const [versions, setVersions] = useState<TopologyVersion[]>([]);

  // 编辑状态：哪个版本正在编辑
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editNotes, setEditNotes] = useState('');

  const refresh = useCallback(async () => {
    const versions = await getVersions();
    setVersions(versions);
  }, [getVersions]);

  useEffect(() => {
    if (open) {
      refresh();
      setEditingId(null);
    }
  }, [open, refresh]);

  const handleRollback = useCallback(async (id: string) => {
    const success = await rollbackToVersion(id);
    if (success) {
      message.success('已回滚到选中版本');
      onClose();
    } else {
      message.error('回滚失败');
    }
  }, [rollbackToVersion, onClose]);

  const handleDelete = useCallback(async (id: string) => {
    await deleteVersion(id);
    if (editingId === id) setEditingId(null);
    await refresh();
    message.success('版本已删除');
  }, [deleteVersion, editingId, refresh]);

  const handleClearAll = useCallback(async () => {
    await clearVersionHistory();
    setEditingId(null);
    await refresh();
    message.success('版本历史已清空');
  }, [clearVersionHistory, refresh]);

  const startEdit = useCallback((v: TopologyVersion) => {
    setEditingId(v.id);
    setEditLabel(v.label);
    setEditNotes(v.notes || '');
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
  }, []);

  const saveEdit = useCallback(async () => {
    if (!editingId) return;
    const trimmed = editLabel.trim();
    if (!trimmed) {
      message.warning('版本名称不能为空');
      return;
    }
    await updateVersionMeta(editingId, trimmed, editNotes.trim() || undefined);
    setEditingId(null);
    await refresh();
    message.success('版本信息已更新');
  }, [editingId, editLabel, editNotes, updateVersionMeta, refresh]);

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };

  return (
    <Drawer
      title={
        <span><HistoryOutlined /> 版本历史</span>
      }
      placement="right"
      width={520}
      open={open}
      onClose={onClose}
      styles={{ body: { maxHeight: 'calc(100vh - 180px)', overflow: 'auto' } }}
      extra={
        versions.length > 0 ? (
          <Popconfirm
            title="确定要清空所有版本历史吗？"
            onConfirm={handleClearAll}
            okText="确定"
            cancelText="取消"
          >
            <Button size="small" danger icon={<ClearOutlined />}>
              清空历史
            </Button>
          </Popconfirm>
        ) : null
      }
    >
      {versions.length === 0 ? (
        <Empty description="暂无版本历史" />
      ) : (
        <List
          dataSource={versions}
          renderItem={(v, idx) => {
            const isEditing = editingId === v.id;

            return (
              <List.Item
                key={v.id}
                style={{ alignItems: 'flex-start' }}
                actions={isEditing ? [
                  <Button
                    key="save"
                    size="small"
                    type="link"
                    icon={<CheckOutlined />}
                    onClick={saveEdit}
                  >
                    保存
                  </Button>,
                  <Button
                    key="cancel"
                    size="small"
                    type="link"
                    icon={<CloseOutlined />}
                    onClick={cancelEdit}
                  />,
                ] : [
                  <Button
                    key="edit"
                    size="small"
                    type="link"
                    icon={<EditOutlined />}
                    onClick={() => startEdit(v)}
                    title="编辑名称和备注"
                  />,
                  <Popconfirm
                    key="rollback"
                    title="确定要回滚到这个版本吗？当前拓扑将被替换。"
                    onConfirm={() => handleRollback(v.id)}
                    okText="确定回滚"
                    cancelText="取消"
                  >
                    <Button size="small" type="link" icon={<RollbackOutlined />}>
                      回滚
                    </Button>
                  </Popconfirm>,
                  <Popconfirm
                    key="delete"
                    title="确定要删除这个版本吗？"
                    onConfirm={() => handleDelete(v.id)}
                    okText="确定"
                    cancelText="取消"
                  >
                    <Button size="small" type="link" danger icon={<DeleteOutlined />} />
                  </Popconfirm>,
                ]}
              >
                <List.Item.Meta
                  title={
                    isEditing ? (
                      <Space direction="vertical" style={{ width: '100%' }} size={4}>
                        <Input
                          size="small"
                          value={editLabel}
                          onChange={e => setEditLabel(e.target.value)}
                          placeholder="版本名称"
                          onPressEnter={saveEdit}
                        />
                        <TextArea
                          size="small"
                          value={editNotes}
                          onChange={e => setEditNotes(e.target.value)}
                          placeholder="备注信息（可选）"
                          autoSize={{ minRows: 1, maxRows: 3 }}
                        />
                      </Space>
                    ) : (
                      <span>
                        {v.isAutoSave ? (
                          <Tag color="blue">自动</Tag>
                        ) : (
                          <Tag color="green">手动</Tag>
                        )}
                        {idx === 0 && <Tag color="orange">最新</Tag>}
                        <Text style={{ fontSize: 12 }}>{v.label}</Text>
                      </span>
                    )
                  }
                  description={
                    <div>
                      <div style={{ fontSize: 12, color: '#999' }}>
                        {formatTime(v.timestamp)} · {v.data.nodes?.length ?? 0} 节点 · {v.data.edges?.length ?? 0} 连线
                      </div>
                      {!isEditing && v.notes && (
                        <div style={{
                          fontSize: 12,
                          color: '#666',
                          marginTop: 4,
                          padding: '2px 8px',
                          background: '#f6f8fa',
                          borderRadius: 4,
                          borderLeft: '3px solid #1677ff',
                        }}>
                          {v.notes}
                        </div>
                      )}
                    </div>
                  }
                />
              </List.Item>
            );
          }}
        />
      )}
    </Drawer>
  );
};

export default VersionHistoryPanel;
