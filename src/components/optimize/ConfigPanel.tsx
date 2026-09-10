'use client';

import React, { useState } from 'react';
import {
  Card,
  Form,
  Select,
  InputNumber,
  Slider,
  Button,
  Tag,
  Space,
  Collapse,
  Tooltip,
  Switch,
  Row,
  Col,
  Typography,
  Divider,
  Alert,
  message,
  Input,
} from 'antd';
import {
  SettingOutlined,
  PlayCircleOutlined,
  PauseCircleOutlined,
  StopOutlined,
  PlusOutlined,
  DeleteOutlined,
  InfoCircleOutlined,
  ExperimentOutlined,
  ThunderboltOutlined,
  DashboardOutlined,
} from '@ant-design/icons';
import {
  useOptimizeStore,
  algorithmOptions,
  type VariableRange,
  type ObjectiveConfig,
  type Constraint,
} from '../../stores/optimizeStore';

const { Panel } = Collapse;
const { Text } = Typography;

const algorithmParamDefs: Record<string, { key: string; label: string; min?: number; max?: number; step?: number; help?: string }[]> = {
  ga: [
    { key: 'populationSize', label: '种群大小', min: 10, max: 500, step: 10, help: '每代个体数量' },
    { key: 'crossoverRate', label: '交叉概率', min: 0, max: 1, step: 0.05, help: '基因交叉的概率' },
    { key: 'mutationRate', label: '变异概率', min: 0, max: 1, step: 0.01, help: '基因变异的概率' },
    { key: 'eliteCount', label: '精英保留数', min: 0, max: 50, step: 1, help: '直接进入下一代的最优个体数' },
  ],
  pso: [
    { key: 'swarmSize', label: '粒子数量', min: 10, max: 300, step: 10, help: '搜索空间中的粒子数' },
    { key: 'inertiaWeight', label: '惯性权重', min: 0, max: 2, step: 0.1, help: '速度保持比例' },
    { key: 'cognitiveCoeff', label: '认知系数', min: 0, max: 4, step: 0.1, help: '个体最优影响权重' },
    { key: 'socialCoeff', label: '社会系数', min: 0, max: 4, step: 0.1, help: '全局最优影响权重' },
  ],
  sa: [
    { key: 'initialTemp', label: '初始温度', min: 1, max: 10000, step: 10, help: '退火起始温度' },
    { key: 'coolingRate', label: '冷却系数', min: 0.8, max: 0.999, step: 0.001, help: '温度衰减系数' },
    { key: 'minTemp', label: '终止温度', min: 0.0001, max: 1, step: 0.0001, help: '停止搜索的温度阈值' },
  ],
  bo: [
    { key: 'initPoints', label: '初始采样点', min: 3, max: 50, step: 1, help: '随机探索的初始点数' },
    { key: 'kappa', label: '探索系数 κ', min: 0, max: 10, step: 0.1, help: 'UCB策略的探索权重' },
    { key: 'xi', label: '改善阈值 ξ', min: 0, max: 0.5, step: 0.001, help: '期望改善的最小阈值' },
  ],
  de: [
    { key: 'populationSize', label: '种群大小', min: 10, max: 500, step: 10, help: '每代个体数量' },
    { key: 'crossoverProb', label: '交叉概率', min: 0, max: 1, step: 0.05, help: '差分交叉概率' },
    { key: 'differentialWeight', label: '差分权重', min: 0, max: 2, step: 0.1, help: '变异缩放因子' },
  ],
  cmaes: [
    { key: 'populationSize', label: '种群大小', min: 10, max: 500, step: 10, help: '采样点数量' },
    { key: 'sigma', label: '步长 σ', min: 0.01, max: 2, step: 0.01, help: '初始搜索步长' },
  ],
};

const constraintVarOptions = [
  { value: 'temperature', label: '芯片温度' },
  { value: 'power', label: '整机功耗' },
  { value: 'voltage', label: '核心电压' },
  { value: 'frequency', label: '工作频率' },
];

const ConfigPanel: React.FC = () => {
  const {
    inputVariables,
    outputObjectives,
    selectedAlgorithm,
    algorithmParams,
    constraints,
    isRunning,
    tasks,
    currentTaskId,
    setSelectedAlgorithm,
    setAlgorithmParam,
    updateVariableRange,
    setOutputObjectives,
    addConstraint,
    removeConstraint,
    startOptimization,
    pauseOptimization,
    stopOptimization,
    addTask,
    setCurrentTask,
    clearHistory,
  } = useOptimizeStore();

  const [taskName, setTaskName] = useState('');
  const [maxIterations, setMaxIterations] = useState(200);

  const currentTask = tasks.find((t) => t.id === currentTaskId);

  const handleStart = () => {
    if (inputVariables.length === 0 || outputObjectives.length === 0) {
      message.warning('请至少配置一个输入变量和一个输出目标');
      return;
    }
    clearHistory();
    const newTaskId = `task_${Date.now()}`;
    const newTask = {
      id: newTaskId,
      name: taskName || `寻优任务-${new Date().toLocaleTimeString()}`,
      status: 'running' as const,
      algorithm: selectedAlgorithm,
      progress: 0,
      currentIteration: 0,
      maxIterations,
      startTime: Date.now(),
      bestFitness: 0,
      objectives: outputObjectives.map((o) => o.name),
    };
    addTask(newTask);
    setCurrentTask(newTaskId);
    startOptimization();
    message.success('寻优任务已启动');
  };

  const handlePause = () => {
    pauseOptimization();
    if (currentTaskId) {
      useOptimizeStore.getState().updateTask(currentTaskId, { status: 'paused' });
    }
    message.info('寻优已暂停');
  };

  const handleStop = () => {
    stopOptimization();
    message.success('寻优已停止');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'auto' }}>
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        {/* 任务名称 */}
        <Card size="small" title={<><ExperimentOutlined /> 任务配置</>}>
          <Form layout="vertical" size="small">
            <Form.Item label="任务名称">
              <Input
                placeholder="输入任务名称"
                value={taskName}
                onChange={(e) => setTaskName(e.target.value)}
                disabled={isRunning}
              />
            </Form.Item>
            <Form.Item label="最大迭代次数">
              <InputNumber
                min={10}
                max={10000}
                value={maxIterations}
                onChange={(v) => setMaxIterations(v ?? 200)}
                style={{ width: '100%' }}
                disabled={isRunning}
              />
            </Form.Item>
          </Form>
        </Card>

        {/* 算法选择 */}
        <Card
          size="small"
          title={
            <Space>
              <SettingOutlined />
              <span>算法配置</span>
            </Space>
          }
        >
          <Form layout="vertical" size="small">
            <Form.Item label="优化算法">
              <Select
                value={selectedAlgorithm}
                onChange={setSelectedAlgorithm}
                options={algorithmOptions}
                disabled={isRunning}
              />
            </Form.Item>
            <Divider style={{ margin: '8px 0' }} />
            <Space direction="vertical" style={{ width: '100%' }} size="small">
              {algorithmParamDefs[selectedAlgorithm]?.map((param) => (
                <Form.Item
                  key={param.key}
                  label={
                    <span>
                      {param.label}
                      <Tooltip title={param.help}>
                        <InfoCircleOutlined style={{ marginLeft: 4, color: '#999' }} />
                      </Tooltip>
                    </span>
                  }
                  style={{ marginBottom: 8 }}
                >
                  <InputNumber
                    min={param.min}
                    max={param.max}
                    step={param.step}
                    value={algorithmParams[param.key] as number}
                    onChange={(v) => setAlgorithmParam(param.key, v ?? 0)}
                    style={{ width: '100%' }}
                    disabled={isRunning}
                  />
                </Form.Item>
              ))}
            </Space>
          </Form>
        </Card>

        {/* 变量配置 */}
        <Collapse defaultActiveKey={['inputs', 'outputs']} ghost>
          <Panel
            header={
              <Space>
                <ThunderboltOutlined />
                <span>输入变量（可调参数）</span>
                <Tag color="blue">{inputVariables.length}</Tag>
              </Space>
            }
            key="inputs"
          >
            <Space direction="vertical" style={{ width: '100%' }} size="small">
              {inputVariables.map((v) => (
                <Card size="small" key={v.name} style={{ background: '#fafafa' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <Text strong>{v.label}</Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      当前: {v.current} {v.unit}
                    </Text>
                  </div>
                  <Row gutter={8}>
                    <Col span={8}>
                      <InputNumber
                        size="small"
                        prefix="Min"
                        value={v.min}
                        onChange={(val) => updateVariableRange(v.name, { min: val ?? 0 })}
                        style={{ width: '100%' }}
                        disabled={isRunning}
                      />
                    </Col>
                    <Col span={8}>
                      <InputNumber
                        size="small"
                        prefix="Max"
                        value={v.max}
                        onChange={(val) => updateVariableRange(v.name, { max: val ?? 0 })}
                        style={{ width: '100%' }}
                        disabled={isRunning}
                      />
                    </Col>
                    <Col span={8}>
                      <InputNumber
                        size="small"
                        prefix="步进"
                        value={v.step}
                        onChange={(val) => updateVariableRange(v.name, { step: val ?? 0.1 })}
                        style={{ width: '100%' }}
                        disabled={isRunning}
                      />
                    </Col>
                  </Row>
                  <Slider
                    range
                    min={v.min}
                    max={v.max}
                    step={v.step}
                    value={[v.min, v.max]}
                    onChange={(val) => {
                      updateVariableRange(v.name, { min: val[0], max: val[1] });
                    }}
                    disabled={isRunning}
                    style={{ marginTop: 8, marginBottom: 0 }}
                    tooltip={{ formatter: (val) => `${val} ${v.unit}` }}
                  />
                </Card>
              ))}
            </Space>
          </Panel>

          <Panel
            header={
              <Space>
                <DashboardOutlined />
                <span>输出目标</span>
                <Tag color="green">{outputObjectives.length}</Tag>
              </Space>
            }
            key="outputs"
          >
            <Space direction="vertical" style={{ width: '100%' }} size="small">
              {outputObjectives.map((obj, idx) => (
                <Card size="small" key={obj.name} style={{ background: '#fafafa' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Space>
                      <Text strong>{obj.label}</Text>
                      <Tag
                        color={obj.direction === 'maximize' ? 'green' : 'red'}
                        style={{ fontSize: 11 }}
                      >
                        {obj.direction === 'maximize' ? '最大化' : '最小化'}
                      </Tag>
                    </Space>
                    <InputNumber
                      size="small"
                      prefix="权重"
                      min={0}
                      max={1}
                      step={0.1}
                      value={obj.weight}
                      onChange={(val) => {
                        const newObjs = [...outputObjectives];
                        newObjs[idx] = { ...obj, weight: val ?? 0 };
                        setOutputObjectives(newObjs);
                      }}
                      style={{ width: 90 }}
                      disabled={isRunning}
                    />
                  </div>
                </Card>
              ))}
            </Space>
          </Panel>

          <Panel
            header={
              <Space>
                <InfoCircleOutlined />
                <span>约束条件</span>
                <Tag color="orange">{constraints.filter((c) => c.enabled).length}</Tag>
              </Space>
            }
            key="constraints"
          >
            <Space direction="vertical" style={{ width: '100%' }} size="small">
              {constraints.map((c) => (
                <Card
                  size="small"
                  key={c.id}
                  style={{ background: '#fafafa', opacity: c.enabled ? 1 : 0.5 }}
                >
                  <Row gutter={8} align="middle">
                    <Col flex="auto">
                      <Space>
                        <Select
                          size="small"
                          value={c.variable}
                          options={constraintVarOptions}
                          disabled={isRunning}
                          style={{ width: 110 }}
                        />
                        <Select
                          size="small"
                          value={c.operator}
                          options={[
                            { value: '<=', label: '≤' },
                            { value: '>=', label: '≥' },
                            { value: '=', label: '=' },
                            { value: '<', label: '<' },
                            { value: '>', label: '>' },
                          ]}
                          disabled={isRunning}
                          style={{ width: 60 }}
                        />
                        <InputNumber
                          size="small"
                          value={c.value}
                          onChange={(val) => {
                            const newConstraints = constraints.map((cc) =>
                              cc.id === c.id ? { ...cc, value: val ?? 0 } : cc
                            );
                            useOptimizeStore.getState().setConstraints(newConstraints);
                          }}
                          disabled={isRunning}
                          style={{ width: 80 }}
                        />
                        <Switch
                          size="small"
                          checked={c.enabled}
                          onChange={(checked) => {
                            const newConstraints = constraints.map((cc) =>
                              cc.id === c.id ? { ...cc, enabled: checked } : cc
                            );
                            useOptimizeStore.getState().setConstraints(newConstraints);
                          }}
                          disabled={isRunning}
                        />
                      </Space>
                    </Col>
                    <Col>
                      <Button
                        size="small"
                        type="text"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={() => removeConstraint(c.id)}
                        disabled={isRunning}
                      />
                    </Col>
                  </Row>
                </Card>
              ))}
              <Button
                size="small"
                type="dashed"
                block
                icon={<PlusOutlined />}
                onClick={() =>
                  addConstraint({
                    id: `c_${Date.now()}`,
                    variable: 'temperature',
                    operator: '<=',
                    value: 85,
                    enabled: true,
                  })
                }
                disabled={isRunning}
              >
                添加约束
              </Button>
            </Space>
          </Panel>
        </Collapse>

        {/* 控制按钮 */}
        <Card size="small">
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            {isRunning ? (
              <>
                <Alert
                  message={`寻优进行中: ${currentTask?.name || ''}`}
                  description={`迭代 ${currentTask?.currentIteration || 0} / ${currentTask?.maxIterations || maxIterations} | 当前最优适应度: ${currentTask?.bestFitness.toFixed(4) || 0}`}
                  type="info"
                  showIcon
                />
                <Row gutter={8}>
                  <Col span={12}>
                    <Button block icon={<PauseCircleOutlined />} onClick={handlePause}>
                      暂停
                    </Button>
                  </Col>
                  <Col span={12}>
                    <Button block danger icon={<StopOutlined />} onClick={handleStop}>
                      停止
                    </Button>
                  </Col>
                </Row>
              </>
            ) : (
              <Button
                type="primary"
                block
                size="large"
                icon={<PlayCircleOutlined />}
                onClick={handleStart}
                disabled={isRunning}
              >
                {currentTask?.status === 'paused' ? '继续寻优' : '开始寻优'}
              </Button>
            )}
          </Space>
        </Card>
      </Space>
    </div>
  );
};

export default ConfigPanel;
