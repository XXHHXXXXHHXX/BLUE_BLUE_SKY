'use client';

import React, { useCallback } from 'react';
import { Select, Space, Tooltip, Tag, message, Modal } from 'antd';
import { SwapOutlined, DatabaseOutlined } from '@ant-design/icons';
import { useCloneTopologyStore } from '../../stores/cloneTopologyStore';
import { useMonitorStore } from '../../stores/monitorStore';

const CloneTopologySelector: React.FC = () => {
  const {
    topologies,
    currentTopologyId,
    isLoadingTopologies,
    switchTopology,
  } = useCloneTopologyStore();

  const { isPolling } = useMonitorStore();

  // 处理拓扑切换
  const handleTopologyChange = useCallback(
    async (value: string) => {
      if (value === currentTopologyId) return;

      // 实时检查监控状态，确保最新
      const currentMonitorState = useMonitorStore.getState();
      if (currentMonitorState.isPolling) {
        message.warning('请先关闭实时监控再切换拓扑');
        return;
      }

      Modal.confirm({
        title: '切换拓扑',
        content: '切换拓扑将加载新的拓扑结构，当前未保存的更改将丢失。是否继续？',
        okText: '切换',
        cancelText: '取消',
        onOk: async () => {
          // 再次检查监控状态，防止在弹窗显示期间监控被开启
          const latestMonitorState = useMonitorStore.getState();
          if (latestMonitorState.isPolling) {
            message.warning('实时监控已开启，无法切换拓扑');
            return;
          }
          const success = await switchTopology(value);
          if (success) {
            message.success('拓扑切换成功');
          } else {
            message.error('拓扑切换失败');
          }
        },
      });
    },
    [currentTopologyId, switchTopology]
  );

  // 选择器选项
  const options = topologies.map((t) => ({
    value: t.id,
    label: (
      <Space>
        <DatabaseOutlined />
        <span>{t.name}</span>
        {t.isDefault && <Tag color="blue">默认</Tag>}
        <span style={{ color: '#999', fontSize: 12 }}>({t.nodeCount} 节点)</span>
      </Space>
    ),
  }));

  return (
    <Tooltip title={isPolling ? '监控开启时无法切换拓扑' : '选择要查看的拓扑'}>
      <Select
        value={currentTopologyId || undefined}
        onChange={handleTopologyChange}
        loading={isLoadingTopologies}
        disabled={isPolling}
        style={{ width: 220 }}
        placeholder="选择拓扑"
        suffixIcon={<SwapOutlined />}
        options={options}
      />
    </Tooltip>
  );
};

export default CloneTopologySelector;
