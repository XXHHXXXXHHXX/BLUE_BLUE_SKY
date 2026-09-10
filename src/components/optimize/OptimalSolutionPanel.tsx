'use client';

import React from 'react';
import { Card, Statistic, Row, Col, Tag, Button, Space, Typography, Badge, Descriptions } from 'antd';
import {
  TrophyOutlined,
  ThunderboltOutlined,
  DashboardOutlined,
  FireOutlined,
  CheckCircleOutlined,
  DownloadOutlined,
  CopyOutlined,
  BulbOutlined,
} from '@ant-design/icons';
import { useOptimizeStore } from '../../stores/optimizeStore';

const { Text } = Typography;

const OptimalSolutionPanel: React.FC = () => {
  const { paretoFront, selectedParetoIndex, tasks, currentTaskId } = useOptimizeStore();

  const currentTask = tasks.find((t) => t.id === currentTaskId);
  const selectedPoint = selectedParetoIndex !== null ? paretoFront[selectedParetoIndex] : null;

  // 如果没有选中点，取效率最高的作为默认最优
  const bestPoint = selectedPoint || (paretoFront.length > 0
    ? paretoFront.reduce((best, p) => (p.efficiency > best.efficiency ? p : best), paretoFront[0])
    : null);

  const bestPower = paretoFront.length > 0
    ? paretoFront.reduce((min, p) => (p.power < min.power ? p : min), paretoFront[0])
    : null;

  const bestPerf = paretoFront.length > 0
    ? paretoFront.reduce((max, p) => (p.performance > max.performance ? p : max), paretoFront[0])
    : null;

  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      {/* 当前任务状态 */}
      {currentTask && (
        <Card size="small">
          <Row gutter={16} align="middle">
            <Col flex="auto">
              <Space>
                <Badge
                  status={
                    currentTask.status === 'running'
                      ? 'processing'
                      : currentTask.status === 'completed'
                      ? 'success'
                      : currentTask.status === 'failed'
                      ? 'error'
                      : 'warning'
                  }
                />
                <Text strong>{currentTask.name}</Text>
                <Tag color="blue">{currentTask.algorithm.toUpperCase()}</Tag>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  迭代 {currentTask.currentIteration} / {currentTask.maxIterations}
                </Text>
              </Space>
            </Col>
            <Col>
              <Text type="secondary" style={{ fontSize: 12 }}>
                最优适应度: <Text strong>{currentTask.bestFitness.toFixed(4)}</Text>
              </Text>
            </Col>
          </Row>
        </Card>
      )}

      {/* 三指标最优卡片 */}
      <Row gutter={12}>
        <Col span={8}>
          <Card size="small" hoverable style={{ borderTop: '3px solid #52c41a' }}>
            <Statistic
              title={<Space><ThunderboltOutlined /> 最低功耗</Space>}
              value={bestPower?.power ?? 0}
              precision={1}
              suffix="W"
              valueStyle={{ color: '#52c41a', fontSize: 20 }}
            />
            {bestPower && (
              <div style={{ marginTop: 8, fontSize: 11, color: '#666' }}>
                {Object.entries(bestPower.params).map(([k, v]) => (
                  <Tag key={k} style={{ fontSize: 10, padding: '0 4px', lineHeight: '18px' }}>{k}: {typeof v === 'number' ? v.toFixed(2) : v}</Tag>
                ))}
              </div>
            )}
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small" hoverable style={{ borderTop: '3px solid #1890ff' }}>
            <Statistic
              title={<Space><DashboardOutlined /> 最高性能</Space>}
              value={bestPerf?.performance ?? 0}
              precision={1}
              suffix="分"
              valueStyle={{ color: '#1890ff', fontSize: 20 }}
            />
            {bestPerf && (
              <div style={{ marginTop: 8, fontSize: 11, color: '#666' }}>
                {Object.entries(bestPerf.params).map(([k, v]) => (
                  <Tag key={k} style={{ fontSize: 10, padding: '0 4px', lineHeight: '18px' }}>{k}: {typeof v === 'number' ? v.toFixed(2) : v}</Tag>
                ))}
              </div>
            )}
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small" hoverable style={{ borderTop: '3px solid #fa8c16' }}>
            <Statistic
              title={<Space><FireOutlined /> 最优能效比</Space>}
              value={bestPoint?.efficiency ?? 0}
              precision={2}
              suffix="分/W"
              valueStyle={{ color: '#fa8c16', fontSize: 20 }}
            />
            {bestPoint && (
              <div style={{ marginTop: 8, fontSize: 11, color: '#666' }}>
                {Object.entries(bestPoint.params).map(([k, v]) => (
                  <Tag key={k} style={{ fontSize: 10, padding: '0 4px', lineHeight: '18px' }}>{k}: {typeof v === 'number' ? v.toFixed(2) : v}</Tag>
                ))}
              </div>
            )}
          </Card>
        </Col>
      </Row>

      {/* 推荐方案详情 */}
      <Card
        size="small"
        title={
          <Space>
            <TrophyOutlined />
            <span>推荐最优方案 {selectedPoint ? `(方案 #${selectedParetoIndex! + 1})` : '(自动推荐)'}</span>
          </Space>
        }
        extra={
          <Space>
            <Button size="small" icon={<CopyOutlined />}>复制参数</Button>
            <Button size="small" type="primary" icon={<CheckCircleOutlined />}>应用方案</Button>
          </Space>
        }
      >
        {bestPoint ? (
          <Descriptions bordered size="small" column={2}>
            <Descriptions.Item label="功耗">
              <Text strong>{bestPoint.power.toFixed(2)} W</Text>
            </Descriptions.Item>
            <Descriptions.Item label="性能">
              <Text strong>{bestPoint.performance.toFixed(2)} 分</Text>
            </Descriptions.Item>
            <Descriptions.Item label="能效比">
              <Text strong type="warning">{bestPoint.efficiency.toFixed(2)} 分/W</Text>
            </Descriptions.Item>
            <Descriptions.Item label="帕累托等级">
              <Tag color="gold">Level 1</Tag>
            </Descriptions.Item>
            {Object.entries(bestPoint.params).map(([k, v]) => (
              <Descriptions.Item key={k} label={k}>
                <Text code>{typeof v === 'number' ? v.toFixed(3) : v}</Text>
              </Descriptions.Item>
            ))}
          </Descriptions>
        ) : (
          <Text type="secondary">暂无最优方案数据</Text>
        )}
      </Card>

      {/* 节能潜力估算 */}
      <Card
        size="small"
        title={
          <Space>
            <BulbOutlined />
            <span>节能潜力分析</span>
          </Space>
        }
      >
        <Row gutter={16}>
          <Col span={8}>
            <Statistic
              title="预计节电"
              value={12.5}
              precision={1}
              suffix="%"
              valueStyle={{ color: '#3f8600' }}
              prefix={<ThunderboltOutlined />}
            />
          </Col>
          <Col span={8}>
            <Statistic
              title="性能损失"
              value={3.2}
              precision={1}
              suffix="%"
              valueStyle={{ color: '#cf1322' }}
              prefix={<DashboardOutlined />}
            />
          </Col>
          <Col span={8}>
            <Statistic
              title="能效提升"
              value={28.6}
              precision={1}
              suffix="%"
              valueStyle={{ color: '#1890ff' }}
              prefix={<FireOutlined />}
            />
          </Col>
        </Row>
      </Card>
    </Space>
  );
};

export default OptimalSolutionPanel;
