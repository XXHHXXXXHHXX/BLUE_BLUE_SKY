'use client';

import React from 'react';
import { Card, Statistic, Row, Col, Progress, Tag, Space } from 'antd';
import {
  SyncOutlined,
  ThunderboltOutlined,
  DashboardOutlined,
  FireOutlined,
  ClockCircleOutlined,
  BarChartOutlined,
} from '@ant-design/icons';
import { useOptimizeStore } from '../../stores/optimizeStore';

const RealtimeMonitor: React.FC = () => {
  const { isRunning, tasks, currentTaskId, convergenceHistory } = useOptimizeStore();
  const currentTask = tasks.find((t) => t.id === currentTaskId);

  const latestPoint = convergenceHistory.length > 0
    ? convergenceHistory[convergenceHistory.length - 1]
    : null;

  const elapsedTime = currentTask?.startTime
    ? Math.floor((Date.now() - currentTask.startTime) / 1000)
    : 0;

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <Row gutter={12}>
      <Col span={4}>
        <Card size="small">
          <Statistic
            title="寻优状态"
            value={isRunning ? '运行中' : currentTask?.status === 'completed' ? '已完成' : '空闲'}
            prefix={
              isRunning ? (
                <SyncOutlined spin style={{ color: '#1890ff' }} />
              ) : currentTask?.status === 'completed' ? (
                <BarChartOutlined style={{ color: '#52c41a' }} />
              ) : (
                <ClockCircleOutlined style={{ color: '#999' }} />
              )
            }
            valueStyle={{ fontSize: 16, color: isRunning ? '#1890ff' : currentTask?.status === 'completed' ? '#52c41a' : '#999' }}
          />
        </Card>
      </Col>
      <Col span={5}>
        <Card size="small">
          <Statistic
            title="迭代进度"
            value={currentTask?.currentIteration ?? 0}
            suffix={`/ ${currentTask?.maxIterations ?? 0}`}
            prefix={<DashboardOutlined />}
            valueStyle={{ fontSize: 16 }}
          />
          <Progress
            percent={
              currentTask?.maxIterations
                ? Math.round((currentTask.currentIteration / currentTask.maxIterations) * 100)
                : 0
            }
            size="small"
            status={isRunning ? 'active' : 'normal'}
            style={{ marginTop: 4 }}
          />
        </Card>
      </Col>
      <Col span={5}>
        <Card size="small">
          <Statistic
            title="当前最优适应度"
            value={latestPoint?.bestFitness ?? currentTask?.bestFitness ?? 0}
            precision={4}
            prefix={<FireOutlined />}
            valueStyle={{ fontSize: 16, color: '#fa8c16' }}
          />
          {latestPoint && (
            <div style={{ marginTop: 4, fontSize: 11 }}>
              <Tag color="blue">多样性 {latestPoint.diversity.toFixed(3)}</Tag>
            </div>
          )}
        </Card>
      </Col>
      <Col span={5}>
        <Card size="small">
          <Statistic
            title="平均适应度"
            value={latestPoint?.avgFitness ?? 0}
            precision={4}
            prefix={<ThunderboltOutlined />}
            valueStyle={{ fontSize: 16 }}
          />
        </Card>
      </Col>
      <Col span={5}>
        <Card size="small">
          <Statistic
            title="运行时间"
            value={formatTime(elapsedTime)}
            prefix={<ClockCircleOutlined />}
            valueStyle={{ fontSize: 16, fontFamily: 'monospace' }}
          />
        </Card>
      </Col>
    </Row>
  );
};

export default RealtimeMonitor;
