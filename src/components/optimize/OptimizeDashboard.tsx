'use client';

import React, { useEffect, useRef } from 'react';
import { Row, Col, Tabs, message } from 'antd';
import { AimOutlined, HistoryOutlined, BarChartOutlined } from '@ant-design/icons';
import { useOptimizeStore } from '../../stores/optimizeStore';
import ConfigPanel from './ConfigPanel';
import RealtimeMonitor from './RealtimeMonitor';
import ConvergenceChart from './ConvergenceChart';
import ParetoChart from './ParetoChart';
import HeatmapChart from './HeatmapChart';
import OptimalSolutionPanel from './OptimalSolutionPanel';
import TaskHistoryPanel from './TaskHistoryPanel';

const OptimizeDashboard: React.FC = () => {
  const {
    isRunning,
    currentTaskId,
    addConvergencePoint,
    updateTask,
    setParetoFront,
  } = useOptimizeStore();

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 模拟寻优过程
  useEffect(() => {
    if (isRunning && currentTaskId) {
      timerRef.current = setInterval(() => {
        const state = useOptimizeStore.getState();
        const task = state.tasks.find((t) => t.id === state.currentTaskId);
        if (!task || task.status !== 'running') return;

        const nextIter = task.currentIteration + 1;
        if (nextIter > task.maxIterations) {
          state.stopOptimization();
          message.success('寻优任务已完成');
          return;
        }

        // 模拟收敛数据
        const decay = Math.exp(-nextIter / (task.maxIterations * 0.3));
        const noise = (Math.random() - 0.5) * 0.02;
        const bestFitness = 0.95 + (1 - decay) * 0.04 + noise;
        const avgFitness = bestFitness - decay * 0.15 + noise * 2;
        const diversity = decay * 0.8 + 0.05;

        state.addConvergencePoint({
          iteration: nextIter,
          bestFitness: Math.max(0, Math.min(1, bestFitness)),
          avgFitness: Math.max(0, Math.min(1, avgFitness)),
          diversity: Math.max(0, Math.min(1, diversity)),
        });

        state.updateTask(task.id, {
          currentIteration: nextIter,
          progress: Math.round((nextIter / task.maxIterations) * 100),
          bestFitness: Math.max(0, Math.min(1, bestFitness)),
        });

        // 模拟帕累托前沿（每5代更新一次）
        if (nextIter % 5 === 0) {
          const pareto: typeof state.paretoFront = [];
          for (let i = 0; i < 30; i++) {
            const power = 80 + Math.random() * 120;
            const performance = 5000 + Math.random() * 5000;
            pareto.push({
              power,
              performance,
              efficiency: performance / power,
              params: {
                voltage: 0.8 + Math.random() * 0.6,
                frequency: 1.2 + Math.random() * 3.3,
                fanSpeed: 800 + Math.random() * 3200,
                cacheRatio: 8 + Math.floor(Math.random() * 16),
                uncoreVoltage: 0.9 + Math.random() * 0.4,
              },
            });
          }
          pareto.sort((a, b) => b.efficiency - a.efficiency);
          state.setParetoFront(pareto.slice(0, 20));
        }
      }, 200);
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [isRunning, currentTaskId]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#f5f5f5' }}>
      {/* 顶部实时监控条 */}
      <div style={{ padding: '12px 16px 0' }}>
        <RealtimeMonitor />
      </div>

      {/* 主内容区 */}
      <div style={{ flex: 1, padding: 12, overflow: 'auto' }}>
        <Tabs
          defaultActiveKey="console"
          items={[
            {
              key: 'console',
              label: (
                <span>
                  <AimOutlined /> 寻优控制台
                </span>
              ),
              children: (
                <Row gutter={12} style={{ margin: 0 }}>
                  {/* 左侧配置面板 */}
                  <Col span={6} style={{ paddingRight: 6 }}>
                    <div
                      style={{
                        height: 'calc(100vh - 200px)',
                        overflow: 'auto',
                        background: '#fff',
                        borderRadius: 8,
                        padding: 12,
                      }}
                    >
                      <ConfigPanel />
                    </div>
                  </Col>

                  {/* 右侧可视化区 */}
                  <Col span={18} style={{ paddingLeft: 6 }}>
                    <Row gutter={[12, 12]}>
                      <Col span={12}>
                        <ConvergenceChart />
                      </Col>
                      <Col span={12}>
                        <ParetoChart />
                      </Col>
                      <Col span={12}>
                        <HeatmapChart />
                      </Col>
                      <Col span={12}>
                        <OptimalSolutionPanel />
                      </Col>
                    </Row>
                  </Col>
                </Row>
              ),
            },
            {
              key: 'history',
              label: (
                <span>
                  <HistoryOutlined /> 任务历史
                </span>
              ),
              children: (
                <div style={{ background: '#fff', borderRadius: 8, padding: 16 }}>
                  <TaskHistoryPanel />
                </div>
              ),
            },
            {
              key: 'analysis',
              label: (
                <span>
                  <BarChartOutlined /> 深度分析
                </span>
              ),
              children: (
                <div style={{ background: '#fff', borderRadius: 8, padding: 16, minHeight: 400 }}>
                  <OptimalSolutionPanel />
                </div>
              ),
            },
          ]}
        />
      </div>
    </div>
  );
};

export default OptimizeDashboard;
