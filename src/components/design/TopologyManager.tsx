'use client';

import React, { useState, useCallback } from 'react';
import { Button, Select, Space, Tooltip, Tag, Modal, message } from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  DatabaseOutlined,
} from '@ant-design/icons';
import { useDesignTopologyStore } from '../../stores/designTopologyStore';
import CreateTopologyModal from '../modals/CreateTopologyModal';
import RenameTopologyModal from '../modals/RenameTopologyModal';

const TopologyManager: React.FC = () => {
  const {
    topologies,
    currentTopologyId,
    isLoadingTopologies,
    switchTopology,
    deleteTopology,
  } = useDesignTopologyStore();

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [renameModalOpen, setRenameModalOpen] = useState(false);
  const [selectedForRename, setSelectedForRename] = useState<{
    id: string;
    name: string;
    description?: string;
  } | null>(null);

  // 处理拓扑切换（设计页面切换更简单，不需要确认）
  const handleTopologyChange = useCallback(
    async (value: string) => {
      if (value === currentTopologyId) return;

      const success = await switchTopology(value);
      if (success) {
        message.success(`已切换到: ${topologies.find(t => t.id === value)?.name}`);
      } else {
        message.error('切换失败');
      }
    },
    [currentTopologyId, switchTopology, topologies]
  );

  // 处理删除拓扑
  const handleDeleteTopology = useCallback(
    (id: string, name: string, isDefault: boolean, e?: React.MouseEvent) => {
      e?.stopPropagation();
      
      if (isDefault) {
        message.warning('默认拓扑不能删除');
        return;
      }

      if (id === currentTopologyId) {
        message.warning('不能删除当前正在编辑的拓扑，请先切换到其他拓扑');
        return;
      }

      Modal.confirm({
        title: '删除拓扑',
        content: `确定要删除拓扑 "${name}" 吗？该操作将同时删除其所有历史版本，且不可恢复。`,
        okText: '删除',
        okType: 'danger',
        cancelText: '取消',
        onOk: async () => {
          const success = await deleteTopology(id);
          if (success) {
            message.success('拓扑已删除');
          } else {
            message.error('删除失败');
          }
        },
      });
    },
    [currentTopologyId, deleteTopology]
  );

  // 打开重命名弹窗
  const handleOpenRename = useCallback(
    (id: string, name: string, description?: string, e?: React.MouseEvent) => {
      e?.stopPropagation();
      setSelectedForRename({ id, name, description });
      setRenameModalOpen(true);
    },
    []
  );

  // 选择器选项 - 带管理按钮
  const options = topologies.map((t) => ({
    value: t.id,
    label: (
      <Space style={{ width: '100%', justifyContent: 'space-between' }}>
        <Space>
          <DatabaseOutlined />
          <span>{t.name}</span>
          {t.isDefault && <Tag color="blue">默认</Tag>}
          {t.id === currentTopologyId && <Tag color="green">当前</Tag>}
          <span style={{ color: '#999', fontSize: 12 }}>({t.nodeCount} 节点)</span>
        </Space>
        <Space onClick={(e) => e.stopPropagation()}>
          <Tooltip title="重命名">
            <Button
              type="text"
              size="small"
              icon={<EditOutlined />}
              onClick={(e) => handleOpenRename(t.id, t.name, t.description, e)}
            />
          </Tooltip>
          <Tooltip title={t.isDefault ? '默认拓扑不可删除' : '删除'}>
            <Button
              type="text"
              size="small"
              danger={!t.isDefault}
              disabled={t.isDefault || t.id === currentTopologyId}
              icon={<DeleteOutlined />}
              onClick={(e) => handleDeleteTopology(t.id, t.name, t.isDefault, e)}
            />
          </Tooltip>
        </Space>
      </Space>
    ),
  }));

  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <DatabaseOutlined style={{ color: '#1677ff' }} />
        <span style={{ fontWeight: 500 }}>拓扑:</span>
        
        <Select
          value={currentTopologyId || undefined}
          onChange={handleTopologyChange}
          loading={isLoadingTopologies}
          style={{ width: 200 }}
          placeholder="选择拓扑"
          options={options}
          dropdownMatchSelectWidth={320}
        />

        <Tooltip title="新建拓扑">
          <Button
            type="primary"
            icon={<PlusOutlined />}
            size="small"
            onClick={() => setCreateModalOpen(true)}
          >
            新建
          </Button>
        </Tooltip>
      </div>

      {/* 新建拓扑弹窗 */}
      <CreateTopologyModal
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
      />

      {/* 重命名拓扑弹窗 */}
      {selectedForRename && (
        <RenameTopologyModal
          open={renameModalOpen}
          onClose={() => {
            setRenameModalOpen(false);
            setSelectedForRename(null);
          }}
          topologyId={selectedForRename.id}
          currentName={selectedForRename.name}
          currentDescription={selectedForRename.description}
        />
      )}
    </>
  );
};

export default TopologyManager;
