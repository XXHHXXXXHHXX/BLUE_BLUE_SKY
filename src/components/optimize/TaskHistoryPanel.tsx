'use client';

import React from 'react';
import { Card, Table, Tag, Button, Space, Typography, Tooltip, Popconfirm } from 'antd';
import {
  HistoryOutlined,
  PlayCircleOutlined,
  DeleteOutlined,
  EyeOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  PauseCircleOutlined,
} from '@ant-design/icons';
import { useOptimizeStore, type OptimizationTask } from '../../stores/optimizeStore';

const { Text } = Typography;

const statusMap: Record<string, { color: string; icon: React.ReactNode; text: string }> = {
  idle: { color: 'default', icon: <ClockCircleOutlined />, text: '待启动' },
  running: { color: 'processing', icon: <PlayCircleOutlined />, text: '运行中' },
  paused: { color: 'warning', icon: <PauseCircleOutlined />, text: '已暂停' },
  completed: { color: 'success', icon: <CheckCircleOutlined />, text: '已完成' },
  failed: { color: 'error', icon: <CloseCircleOutlined />, text: '失败' },
};

const TaskHistoryPanel: React.FC = () => {
  const { tasks, currentTaskId, setCurrentTask, removeTask } = useOptimizeStore();

  const columns = [
    {
      title: '任务名称',
      dataIndex: 'name',
      key: 'name',
      render: (text: string, record: OptimizationTask) => (
        <Space>
          <Text strong={record.id === currentTaskId}>{text}</Text>
          {record.id === currentTaskId && <Tag color="blue">当前</Tag>}
        </Space>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: string) => {
        const info = statusMap[status] || statusMap.idle;
        return <Tag icon={info.icon} color={info.color}>{info.text}</Tag>;
      },
    },
    {
      title: '算法',
      dataIndex: 'algorithm',
      key: 'algorithm',
      width: 100,
      render: (v: string) => <Tag>{v.toUpperCase()}</Tag>,
    },
    {
      title: '进度',
      dataIndex: 'progress',
      key: 'progress',
      width: 120,
      render: (_: number, record: OptimizationTask) => (
        <Text style={{ fontSize: 12 }}>
          {record.currentIteration} / {record.maxIterations} (
          {Math.round((record.currentIteration / record.maxIterations) * 100)}%)
        </Text>
      ),
    },
    {
      title: '最优适应度',
      dataIndex: 'bestFitness',
      key: 'bestFitness',
      width: 120,
      render: (v: number) => <Text code style={{ fontSize: 12 }}>{v.toFixed(4)}</Text>,
    },
    {
      title: '目标',
      dataIndex: 'objectives',
      key: 'objectives',
      render: (objs: string[]) => (
        <Space size={2}>
          {objs.map((o) => (
            <Tag key={o} style={{ fontSize: 10, padding: '0 4px', lineHeight: '18px' }}>{o}</Tag>
          ))}
        </Space>
      ),
    },
    {
      title: '时间',
      dataIndex: 'startTime',
      key: 'time',
      width: 160,
      render: (_: number, record: OptimizationTask) => (
        <Text type="secondary" style={{ fontSize: 11 }}>
          {record.startTime
            ? new Date(record.startTime).toLocaleString()
            : '-'}
        </Text>
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 120,
      render: (_: any, record: OptimizationTask) => (
        <Space size="small">
          <Tooltip title="查看详情">
            <Button
              size="small"
              type="text"
              icon={<EyeOutlined />}
              onClick={() => setCurrentTask(record.id)}
            />
          </Tooltip>
          <Popconfirm
            title="确认删除"
            description="删除后不可恢复，是否继续？"
            onConfirm={() => removeTask(record.id)}
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
          >
            <Button size="small" type="text" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Card size="small" title={<><HistoryOutlined /> 寻优任务历史</>}>
      <Table
        dataSource={tasks}
        columns={columns}
        rowKey="id"
        size="small"
        pagination={{ pageSize: 5, size: 'small' }}
        rowClassName={(record) => (record.id === currentTaskId ? 'ant-table-row-selected' : '')}
      />
    </Card>
  );
};

export default TaskHistoryPanel;
