'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Table, Divider, Typography, Tag, Button, Spin } from 'antd';
import { ReloadOutlined, LoadingOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import PowerDomainPie from '../charts/PowerDomainPie';
import AMUEventList from '../charts/AMUEventList';
import { useTopologyStore } from '../../stores/topologyStore';
import { useBMCSessionStore } from '../../stores/bmcSessionStore';
import { executeViewCommand } from '../../services/backendApi';
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
  /** 电源域获取命令模板（由画布从节点 apiConfig 传入，供刷新按钮重新执行） */
  powerDomainCommand?: string;
  /** 电源域命令字段列表（顺序对应命令输出的值） */
  powerDomainCommandFields?: { name: string; label: string }[];
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

/** 解析命令输出：按逗号（含中英文逗号）或空白拆分值序列 */
function parseCommandValues(stdout: string): (number | null)[] {
  const raw = (stdout || '').trim();
  if (!raw) return [];
  return raw
    .split(/[,，\s]+/)
    .map((s) => s.trim())
    .filter((s) => s !== '')
    .map((s) => {
      const num = Number(s);
      return Number.isNaN(num) ? null : num;
    });
}

const CPUPowerDomain: React.FC<CPUPowerDomainProps> = ({
  open,
  onClose,
  nodeId,
  cpuData: initialCpuData,
  commandMode: initialCommandMode,
  commandPowerDomains: initialCommandPowerDomains,
  commandTime: initialCommandTime,
  commandError: initialCommandError,
  powerDomainCommand: propCommand,
  powerDomainCommandFields: propCommandFields,
}) => {
  const modal = useMaximizableModal({ minWidth: 1100 });
  // 从store获取实时数据
  const nodes = useTopologyStore((state) => state.nodes);

  // 命令模式下的数据由本组件维护，支持点击刷新按钮重新下发命令
  const [commandMode, setCommandMode] = useState(!!initialCommandMode);
  const [commandRowsState, setCommandRowsState] = useState<{ name: string; value: number | null }[]>(
    initialCommandPowerDomains || [],
  );
  const [commandTime, setCommandTime] = useState<string | undefined>(initialCommandTime);
  const [commandError, setCommandError] = useState<string | undefined>(initialCommandError);
  const [refreshing, setRefreshing] = useState(false);
  // 组件卸载/弹窗关闭后不再回写状态，避免内存泄漏与陈旧更新
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  // 外部传入的命令数据变化时（如重新打开弹窗）同步到本地状态
  useEffect(() => {
    setCommandMode(!!initialCommandMode);
    setCommandRowsState(initialCommandPowerDomains || []);
    setCommandTime(initialCommandTime);
    setCommandError(initialCommandError);
  }, [initialCommandMode, initialCommandPowerDomains, initialCommandTime, initialCommandError]);

  // 弹窗关闭时清除转圈状态，避免下次打开仍停留在"获取中"
  useEffect(() => {
    if (!open) setRefreshing(false);
  }, [open]);

  // 当前节点配置的电源域获取命令与字段：优先使用画布传入的配置，
  // 未传入时回退到 topologyStore 中的节点（兼容旧调用）
  const apiConfig = useMemo(() => {
    if (!nodeId) return undefined;
    const node = nodes.find((n) => n.id === nodeId);
    return node?.data?.apiConfig;
  }, [nodes, nodeId]);

  const command = (propCommand ?? apiConfig?.powerDomainCommand ?? '').trim();
  const commandFields = useMemo(
    () => propCommandFields ?? apiConfig?.powerDomainCommandFields ?? [],
    [propCommandFields, apiConfig],
  );
  const canRefresh = commandMode && command !== '' && commandFields.length > 0;

  /** 点击刷新：重新执行电源域获取命令，转圈直到成功或失败 */
  const handleRefresh = useCallback(async () => {
    if (!command || commandFields.length === 0) return;

    const bmcConfig = useBMCSessionStore.getState().getConnectedConfig();
    if (!bmcConfig) {
      setCommandError('未连接 BMC，无法获取电源域数据');
      return;
    }

    setRefreshing(true);
    setCommandError(undefined);
    try {
      // 自动注入 BMC 连接信息占位符（{ip}/{user}/{password}/{pass}）
      const paramValues: Record<string, string> = {
        ip: bmcConfig.ip || '',
        user: bmcConfig.username || '',
        password: bmcConfig.password || '',
        pass: bmcConfig.password || '',
      };
      const res = await executeViewCommand(bmcConfig, command, paramValues);
      if (!aliveRef.current) return;

      if (!res.success) {
        setCommandError(res.message || '命令执行失败');
        return;
      }

      const values = parseCommandValues(res.stdout || '');
      setCommandRowsState(
        commandFields.map((f, i) => ({
          name: f.label || f.name,
          value: values[i] !== undefined ? values[i] : null,
        })),
      );
      setCommandTime(new Date().toLocaleTimeString());
    } catch (err) {
      if (!aliveRef.current) return;
      setCommandError(err instanceof Error ? err.message : String(err));
    } finally {
      if (aliveRef.current) setRefreshing(false);
    }
  }, [command, commandFields]);

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
    return commandRowsState.map((d, i) => ({
      key: `${i}-${d.name}`,
      name: d.name,
      value: d.value,
    }));
  }, [commandRowsState]);

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
          <div
            style={{
              marginBottom: 12,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flexWrap: 'wrap',
            }}
          >
            <Tag color="geekblue">命令获取</Tag>
            {commandTime && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                采集时间：{commandTime}
              </Text>
            )}
            {canRefresh && (
              <Button
                size="small"
                icon={refreshing ? <LoadingOutlined spin /> : <ReloadOutlined />}
                onClick={handleRefresh}
                disabled={refreshing}
                style={{ marginLeft: 'auto' }}
              >
                {refreshing ? '获取中...' : '刷新'}
              </Button>
            )}
          </div>
          {/* 刷新期间持续转圈，直到命令返回成功或失败 */}
          <Spin spinning={refreshing} tip="正在下发命令获取数据..." size="large">
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
          </Spin>
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
