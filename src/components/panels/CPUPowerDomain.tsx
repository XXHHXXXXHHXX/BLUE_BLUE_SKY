'use client';

import React, { useMemo } from 'react';
import { Modal, Table, Divider, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import PowerDomainPie from '../charts/PowerDomainPie';
import AMUEventList from '../charts/AMUEventList';
import { useTopologyStore } from '../../stores/topologyStore';
import useMaximizableModal from '../../hooks/useMaximizableModal';
import type { CPUData, CPUPowerDomain as CPUPowerDomainType } from '../../types/power';

const { Title } = Typography;

interface CPUPowerDomainProps {
  open: boolean;
  onClose: () => void;
  nodeId: string | null;
  cpuData: CPUData | null;
}

const columns: ColumnsType<CPUPowerDomainType> = [
  { title: '域名称', dataIndex: 'name', key: 'name' },
  { title: '电压(V)', dataIndex: 'voltage', key: 'voltage', render: (v: number) => v.toFixed(3) },
  { title: '电流(A)', dataIndex: 'current', key: 'current', render: (v: number) => v.toFixed(2) },
  { title: '功耗(W)', dataIndex: 'power', key: 'power', render: (v: number) => v.toFixed(1) },
];

const CPUPowerDomain: React.FC<CPUPowerDomainProps> = ({ open, onClose, nodeId, cpuData: initialCpuData }) => {
  const modal = useMaximizableModal({ minWidth: 1100 });
  // 从store获取实时数据
  const nodes = useTopologyStore((state) => state.nodes);
  
  // 实时获取最新的CPU数据
  const liveCpuData = useMemo(() => {
    if (!nodeId) return initialCpuData;
    const node = nodes.find((n) => n.id === nodeId);
    if (node && node.data && (node.data as Record<string, unknown>).cpuData) {
      return (node.data as Record<string, unknown>).cpuData as CPUData;
    }
    return initialCpuData;
  }, [nodes, nodeId, initialCpuData]);

  return (
    <Modal
      title={modal.renderTitle(`CPU电源域详情 - ${nodeId ?? ''}`)}
      open={open}
      onCancel={onClose}
      footer={null}
      width={modal.width}
      style={modal.style}
      styles={{ body: modal.bodyStyle }}
      destroyOnClose
    >
      {liveCpuData ? (
        <>
          <PowerDomainPie domains={liveCpuData.powerDomains} />
          <Divider />
          <Table<CPUPowerDomainType>
            columns={columns}
            dataSource={liveCpuData.powerDomains}
            rowKey="name"
            pagination={false}
            size="small"
            scroll={{ x: 'max-content', y: modal.isMaximized ? 420 : 250 }}
          />
          <Divider />
          <Title level={5}>AMU事件</Title>
          <AMUEventList events={liveCpuData.amuEvents} />
        </>
      ) : (
        <div>暂无数据</div>
      )}
    </Modal>
  );
};

export default CPUPowerDomain;
