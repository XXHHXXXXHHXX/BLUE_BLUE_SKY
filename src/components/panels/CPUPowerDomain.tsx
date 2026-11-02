'use client';

import React, { useMemo } from 'react';
import { Modal, Table, Divider, Typography, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import PowerDomainPie from '../charts/PowerDomainPie';
import AMUEventList from '../charts/AMUEventList';
import { useTopologyStore } from '../../stores/topologyStore';
import useMaximizableModal from '../../hooks/useMaximizableModal';
import type { CPUData, CPUPowerDomain as CPUPowerDomainType } from '../../types/power';

const { Title, Text } = Typography;

interface CPUPowerDomainProps {
  open: boolean;
  onClose: () => void;
  nodeId: string | null;
  cpuData: CPUData | null;
  /** 命令模式：点击"电源域详情"时执行命令获取到的值序列（电源域 → 值） */
  commandMode?: boolean;
  commandPowerDomains?: { name: string; value: number | null }[];
  commandTime?: string;
  commandError?: string;
}

const columns: ColumnsType<CPUPowerDomainType> = [
  { title: '域名称', dataIndex: 'name', key: 'name' },
  { title: '电压(V)', dataIndex: 'voltage', key: 'voltage', render: (v?: number) => (v !== undefined ? v.toFixed(3) : '--') },
  { title: '电流(A)', dataIndex: 'current', key: 'current', render: (v?: number) => (v !== undefined ? v.toFixed(2) : '--') },
  { title: '功耗(W)', dataIndex: 'power', key: 'power', render: (v?: number) => (v !== undefined ? v.toFixed(1) : '--') },
];

interface CommandRow {
  key: string;
  name: string;
  value: number | null;
}

const CPUPowerDomain: React.FC<CPUPowerDomainProps> = ({
  open,
  onClose,
  nodeId,
  cpuData: initialCpuData,
  commandMode,
  commandPowerDomains,
  commandTime,
  commandError,
}) => {
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

  // 命令模式：直接使用命令获取的值序列渲染"电源域 → 值"两列表格
  const commandRows: CommandRow[] = useMemo(() => {
    if (!commandPowerDomains) return [];
    return commandPowerDomains.map((d, i) => ({
      key: `${i}-${d.name}`,
      name: d.name,
      value: d.value,
    }));
  }, [commandPowerDomains]);

  const commandColumns: ColumnsType<CommandRow> = [
    { title: '电源域', dataIndex: 'name', key: 'name' },
    {
      title: '值',
      dataIndex: 'value',
      key: 'value',
      render: (v: number | null) =>
        v !== null && v !== undefined ? (
          <Tag color="blue">{v}</Tag>
        ) : (
          '--'
        ),
    },
  ];

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
      {commandMode ? (
        <>
          <div style={{ marginBottom: 12 }}>
            <Tag color="geekblue">命令获取</Tag>
            {commandTime && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                采集时间：{commandTime}
              </Text>
            )}
          </div>
          {commandError ? (
            <div
              style={{
                color: '#cf1322',
                padding: 16,
                textAlign: 'center',
                background: '#fff2f0',
                borderRadius: 6,
              }}
            >
              命令执行失败：{commandError}
            </div>
          ) : commandRows.length > 0 ? (
            <Table<CommandRow>
              columns={commandColumns}
              dataSource={commandRows}
              pagination={false}
              size="small"
              scroll={{ x: 'max-content', y: modal.isMaximized ? 420 : 250 }}
            />
          ) : (
            <div style={{ textAlign: 'center', color: '#8c8c8c', padding: 24 }}>
              命令未返回可解析的数据
            </div>
          )}
        </>
      ) : liveCpuData && (liveCpuData.powerDomains?.length ?? 0) > 0 ? (
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
