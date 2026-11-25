'use client';

/** 流水线阶段动态编辑器
 *
 * 用于任务详情页：对「尚未开始」的阶段改配迭代参数 / 监控命令 / 心跳告警，
 * 以及为运行中的流水线追加新阶段。已开始或已结束的阶段只读。
 */
import React, { useMemo, useState } from 'react';
import {
  Card,
  Button,
  Space,
  Tag,
  Input,
  InputNumber,
  Radio,
  Row,
  Col,
  Form,
  Modal,
  Select,
  message,
  Tooltip,
  Empty,
  Divider,
  Typography,
} from 'antd';
import {
  PlusOutlined,
  MinusCircleOutlined,
  EditOutlined,
  SaveOutlined,
  ClockCircleOutlined,
  LockOutlined,
} from '@ant-design/icons';
import MonitorConfigPanel from './MonitorConfigPanel';
import type { Job, PipelineStage } from '../../stores/testJobStore';
import type { MonitorCommand } from '../../stores/testStore';

const { Text } = Typography;

type IterationParam = NonNullable<Job['config']['iterationParams']>[number];

interface PipelineStageEditorProps {
  job: Job;
  /** 改配/追加成功后刷新任务详情 */
  onChanged: () => void;
}

/** 生成默认迭代参数 */
function createParam(): IterationParam {
  return {
    id: `param-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: '',
    mode: 'range',
    start: 0,
    end: 100,
    step: 10,
    values: [],
  };
}

/** 迭代参数编辑器（受控） */
const IterationParamsEditor: React.FC<{
  value: IterationParam[];
  onChange: (next: IterationParam[]) => void;
}> = ({ value, onChange }) => {
  const update = (id: string, patch: Partial<IterationParam>) => {
    onChange(value.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  };
  return (
    <div>
      {value.map((param, index) => (
        <div
          key={param.id}
          style={{ border: '1px solid #d9d9d9', borderRadius: 6, padding: 10, marginBottom: 10 }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontWeight: 'bold', fontSize: 13, color: '#1890ff' }}>
              参数 {index + 1}{param.name ? `: ${param.name}` : ''}
            </span>
            <Button
              type="link"
              danger
              size="small"
              icon={<MinusCircleOutlined />}
              onClick={() => onChange(value.filter((p) => p.id !== param.id))}
            >
              删除
            </Button>
          </div>
          <Row gutter={8}>
            <Col span={12}>
              <Input
                size="small"
                placeholder="参数名称，如：功耗"
                value={param.name}
                onChange={(e) => update(param.id, { name: e.target.value })}
              />
            </Col>
            <Col span={12}>
              <Radio.Group
                size="small"
                value={param.mode}
                onChange={(e) => update(param.id, { mode: e.target.value })}
              >
                <Radio value="range">范围</Radio>
                <Radio value="custom">自定义</Radio>
              </Radio.Group>
            </Col>
          </Row>
          {param.mode === 'range' ? (
            <Row gutter={8} style={{ marginTop: 8 }}>
              <Col span={8}>
                <InputNumber
                  size="small"
                  style={{ width: '100%' }}
                  placeholder="起始"
                  value={param.start}
                  onChange={(v) => update(param.id, { start: v ?? 0 })}
                />
              </Col>
              <Col span={8}>
                <InputNumber
                  size="small"
                  style={{ width: '100%' }}
                  placeholder="终止"
                  value={param.end}
                  onChange={(v) => update(param.id, { end: v ?? 0 })}
                />
              </Col>
              <Col span={8}>
                <InputNumber
                  size="small"
                  style={{ width: '100%' }}
                  placeholder="步长"
                  min={1}
                  value={param.step}
                  onChange={(v) => update(param.id, { step: v ?? 1 })}
                />
              </Col>
            </Row>
          ) : (
            <div style={{ marginTop: 8 }}>
              {(param.values || []).map((val, vi) => (
                <Row gutter={8} key={vi} style={{ marginBottom: 6 }}>
                  <Col span={20}>
                    <Input
                      size="small"
                      placeholder={`值 ${vi + 1}`}
                      value={val}
                      onChange={(e) => {
                        const next = [...(param.values || [])];
                        next[vi] = e.target.value;
                        update(param.id, { values: next });
                      }}
                    />
                  </Col>
                  <Col span={4}>
                    <Button
                      type="link"
                      danger
                      size="small"
                      icon={<MinusCircleOutlined />}
                      onClick={() =>
                        update(param.id, { values: (param.values || []).filter((_, i) => i !== vi) })
                      }
                    />
                  </Col>
                </Row>
              ))}
              <Button
                type="dashed"
                size="small"
                block
                icon={<PlusOutlined />}
                onClick={() => update(param.id, { values: [...(param.values || []), ''] })}
              >
                添加值
              </Button>
            </div>
          )}
        </div>
      ))}
      <Button type="dashed" size="small" block icon={<PlusOutlined />} onClick={() => onChange([...value, createParam()])}>
        添加迭代参数
      </Button>
    </div>
  );
};

/** 校验迭代参数，返回错误文案 */
function validateParams(params: IterationParam[]): string | null {
  if (params.length === 0) return '请至少配置一个迭代参数';
  for (const p of params) {
    if (!p.name.trim()) return '请填写所有迭代参数的名称';
    if (p.mode === 'custom') {
      if ((p.values || []).filter((v) => v.trim() !== '').length === 0) {
        return `参数 [${p.name}] 的自定义值列表不能为空`;
      }
    } else {
      if (p.step <= 0) return `参数 [${p.name}] 的步长必须大于 0`;
      if (p.start === p.end) return `参数 [${p.name}] 的起始值和终止值不能相同`;
    }
  }
  return null;
}

const PipelineStageEditor: React.FC<PipelineStageEditorProps> = ({ job, onChanged }) => {
  const stages = useMemo(
    () => (job.config.stages || []).slice().sort((a, b) => a.order - b.order),
    [job.config.stages],
  );
  const currentIndex = job.config.currentStageIndex ?? 0;
  const isRunning = job.status === 'running' || job.status === 'pending';

  const [editingStage, setEditingStage] = useState<PipelineStage | null>(null);
  const [editParams, setEditParams] = useState<IterationParam[]>([]);
  const [editMonitor, setEditMonitor] = useState<MonitorCommand[]>([]);
  const [editName, setEditName] = useState('');
  const [saving, setSaving] = useState(false);

  const [appendOpen, setAppendOpen] = useState(false);
  const [appendName, setAppendName] = useState('');
  const [appendMode, setAppendMode] = useState<'local' | 'huoyan'>('local');
  const [appendParams, setAppendParams] = useState<IterationParam[]>([createParam()]);
  const [appendMonitor, setAppendMonitor] = useState<MonitorCommand[]>([]);
  const [appendPackage, setAppendPackage] = useState<string | undefined>();

  if (stages.length === 0) return null;

  const openEdit = (stage: PipelineStage) => {
    setEditingStage(stage);
    setEditName(stage.name);
    setEditParams(stage.iterationParams || []);
    setEditMonitor((stage.monitorCommands || []) as MonitorCommand[]);
  };

  const saveEdit = async () => {
    if (!editingStage) return;
    const err = validateParams(editParams);
    if (err) {
      message.error(err);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/test/jobs/${job.id}/stages`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stageId: editingStage.id,
          patch: {
            name: editName.trim() || editingStage.name,
            iterationParams: editParams,
            monitorCommands: editMonitor,
          },
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message || '改配失败');
      message.success(data.message || '阶段已更新');
      setEditingStage(null);
      onChanged();
    } catch (e) {
      message.error(e instanceof Error ? e.message : '改配失败');
    } finally {
      setSaving(false);
    }
  };

  const openAppend = () => {
    setAppendName(`阶段 ${stages.length + 1}`);
    setAppendMode('local');
    setAppendParams([createParam()]);
    setAppendMonitor([]);
    setAppendPackage(undefined);
    setAppendOpen(true);
  };

  const submitAppend = async () => {
    if (!appendName.trim()) {
      message.error('请填写阶段名称');
      return;
    }
    if (appendMode === 'local') {
      const err = validateParams(appendParams);
      if (err) {
        message.error(err);
        return;
      }
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/test/jobs/${job.id}/stages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: appendName.trim(),
          packageMode: appendMode,
          iterationParams: appendMode === 'local' ? appendParams : [],
          monitorCommands: appendMonitor,
          packageLibraryId: appendMode === 'local' ? appendPackage : undefined,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message || '追加失败');
      message.success(data.message || '阶段已追加');
      setAppendOpen(false);
      onChanged();
    } catch (e) {
      message.error(e instanceof Error ? e.message : '追加失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card
      size="small"
      title={<Space><ClockCircleOutlined />流水线阶段配置</Space>}
      extra={
        isRunning ? (
          <Tooltip title="追加的阶段会在当前阶段结束后接力执行">
            <Button size="small" type="primary" icon={<PlusOutlined />} onClick={openAppend}>
              追加阶段
            </Button>
          </Tooltip>
        ) : (
          <Tag>任务未运行，阶段不可改配</Tag>
        )
      }
    >
      <Space direction="vertical" style={{ width: '100%' }} size={8}>
        {stages.map((stage, index) => {
          const editable = isRunning && index > currentIndex;
          const running = isRunning && index === currentIndex;
          return (
            <div
              key={stage.id}
              style={{
                border: '1px solid #f0f0f0',
                borderRadius: 6,
                padding: '8px 12px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                background: running ? '#e6f7ff' : '#fafafa',
              }}
            >
              <Space size={8}>
                <span style={{ fontWeight: 500 }}>{`${index + 1}. ${stage.name}`}</span>
                {running && <Tag color="processing">运行中</Tag>}
                {!running && !editable && <Tag>已完成</Tag>}
                {editable && <Tag color="orange">待执行</Tag>}
                <Tag>{stage.packageMode === 'huoyan' ? '火眼' : '本地'}</Tag>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {stage.iterationParams?.length || 0} 个参数 ·{' '}
                  {(stage.monitorCommands || []).filter((c) => c.enabled).length} 条监控
                </Text>
              </Space>
              {editable ? (
                <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(stage)}>
                  改配
                </Button>
              ) : (
                <Tooltip title={running ? '阶段正在运行，配置已生效' : '阶段已开始或已完成，不可修改'}>
                  <LockOutlined style={{ color: '#bfbfbf' }} />
                </Tooltip>
              )}
            </div>
          );
        })}
      </Space>

      {/* 改配弹窗 */}
      <Modal
        title={`改配阶段：${editingStage?.name || ''}`}
        open={!!editingStage}
        onCancel={() => setEditingStage(null)}
        onOk={saveEdit}
        confirmLoading={saving}
        okText="保存"
        width={720}
        destroyOnHidden
      >
        <Form layout="vertical" size="small">
          <Form.Item label="阶段名称">
            <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
          </Form.Item>
          <Divider titlePlacement="left" style={{ margin: '8px 0' }}>迭代参数</Divider>
          <IterationParamsEditor value={editParams} onChange={setEditParams} />
          <Divider titlePlacement="left" style={{ margin: '12px 0 8px' }}>监控命令</Divider>
          <MonitorConfigPanel
            tabId={job.tabId || ''}
            commands={editMonitor}
            onChange={(cmds) => setEditMonitor(cmds)}
            globalBmcSessionId={job.config.globalBmcSessionId}
          />
        </Form>
      </Modal>

      {/* 追加阶段弹窗 */}
      <Modal
        title="追加流水线阶段"
        open={appendOpen}
        onCancel={() => setAppendOpen(false)}
        onOk={submitAppend}
        confirmLoading={saving}
        okText="追加"
        width={720}
        destroyOnHidden
      >
        <Form layout="vertical" size="small">
          <Form.Item label="阶段名称" required>
            <Input value={appendName} onChange={(e) => setAppendName(e.target.value)} />
          </Form.Item>
          <Form.Item label="执行模式">
            <Select
              value={appendMode}
              onChange={(v) => setAppendMode(v)}
              options={[
                { value: 'local', label: '本地用例包' },
                { value: 'huoyan', label: '火眼平台' },
              ]}
            />
          </Form.Item>
          {appendMode === 'local' ? (
            <>
              <Form.Item label="用例包 ID（可选，留空沿用任务级配置）">
                <Input
                  value={appendPackage}
                  onChange={(e) => setAppendPackage(e.target.value || undefined)}
                  placeholder="如 pkg-xxxx"
                />
              </Form.Item>
              <Divider titlePlacement="left" style={{ margin: '8px 0' }}>迭代参数</Divider>
              <IterationParamsEditor value={appendParams} onChange={setAppendParams} />
            </>
          ) : (
            <Empty description="火眼阶段请先在测试页配置好火眼用例后再追加，或直接使用本地模式" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          )}
          <Divider titlePlacement="left" style={{ margin: '12px 0 8px' }}>监控命令</Divider>
          <MonitorConfigPanel
            tabId={job.tabId || ''}
            commands={appendMonitor}
            onChange={(cmds) => setAppendMonitor(cmds)}
            globalBmcSessionId={job.config.globalBmcSessionId}
          />
        </Form>
      </Modal>
    </Card>
  );
};

export default PipelineStageEditor;
