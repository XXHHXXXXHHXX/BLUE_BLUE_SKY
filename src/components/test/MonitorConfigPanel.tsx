'use client';

import React, { useEffect, useState } from 'react';
import {
  Card,
  Button,
  Input,
  Select,
  InputNumber,
  Checkbox,
  Space,
  Row,
  Col,
  Tooltip,
  Alert,
  Empty,
  Tag,
  Modal,
  Form,
  Divider,
  message,
} from 'antd';
import {
  PlusOutlined,
  MinusCircleOutlined,
  DesktopOutlined,
  SafetyOutlined,
  InfoCircleOutlined,
  SaveOutlined,
  DeleteOutlined,
  DatabaseOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { useTestStore, type MonitorCommand } from '../../stores/testStore';
import { useBMCSessionStore } from '../../stores/bmcSessionStore';
import { useTestIterationConfigStore } from '../../stores/testIterationConfigStore';
import useMaximizableModal from '../../hooks/useMaximizableModal';

const { Option } = Select;

interface MonitorConfigPanelProps {
  tabId: string;
  disabled?: boolean;
  globalBmcSessionId?: string | null;
  /** 受控模式：传入后不再读写 tab store */
  commands?: MonitorCommand[];
  onChange?: (commands: MonitorCommand[]) => void;
}

const MonitorConfigPanel: React.FC<MonitorConfigPanelProps> = ({
  tabId,
  disabled = false,
  globalBmcSessionId,
  commands: controlledCommands,
  onChange,
}) => {
  const { tabs, setMonitorCommands } = useTestStore();
  const { sessions: bmcSessions } = useBMCSessionStore();
  const { configs: savedConfigs, fetchConfigs, addConfig, removeConfig } = useTestIterationConfigStore();

  const tab = tabs.find((t) => t.id === tabId);
  const commands = controlledCommands ?? tab?.powerTestConfig.monitorCommands ?? [];

  const [saveConfigForm] = Form.useForm();
  const [isSaveConfigModalOpen, setIsSaveConfigModalOpen] = useState(false);
  const [selectedConfigId, setSelectedConfigId] = useState<string | null>(null);

  const saveModal = useMaximizableModal({ minWidth: 700 });

  // 加载监控配置模板列表
  useEffect(() => {
    fetchConfigs('monitor');
  }, [fetchConfigs]);

  const updateCommands = (newCommands: MonitorCommand[]) => {
    if (onChange) {
      onChange(newCommands);
    } else {
      setMonitorCommands(tabId, newCommands);
    }
  };

  const addCommand = () => {
    const newCommand: MonitorCommand = {
      id: `monitor-${Date.now()}`,
      name: '',
      command: '',
      target: 'host',
      sessionId: null,
      interval: 5,
      enabled: true,
      mode: 'single',
      columns: [],
      jumpThreshold: 0,
      jumpThresholdType: 'percent',
      skipJumps: 0,
      skipFirst: 0,
      takeLast: 0,
      skipLast: 0,
      excludeZero: false,
    };
    updateCommands([...commands, newCommand]);
  };

  const removeCommand = (index: number) => {
    updateCommands(commands.filter((_, i) => i !== index));
  };

  const updateCommand = (index: number, updates: Partial<MonitorCommand>) => {
    const newCommands = commands.map((cmd, i) =>
      i === index ? { ...cmd, ...updates } : cmd
    );
    updateCommands(newCommands);
  };

  const enabledCount = commands.filter((c) => c.enabled).length;

  // 加载监控配置模板
  const handleLoadConfig = (configId: string) => {
    const config = savedConfigs.find((c) => c.id === configId);
    if (!config) return;

    updateCommands(config.monitorCommands || []);
    setSelectedConfigId(configId);
    // 使用 antd message 需要通过父组件传入，这里用 console 或静默处理
    // 由于 MonitorConfigPanel 没有引入 message，我们用简单的反馈
  };

  // 保存当前监控配置
  const handleSaveConfig = async () => {
    const values = await saveConfigForm.validateFields();
    try {
      await addConfig({
        name: values.name,
        description: values.description,
        configType: 'monitor',
        iterationParams: [],
        adjustmentCommands: [],
        monitorCommands: commands,
        envVars: [],
      });
      setIsSaveConfigModalOpen(false);
      saveConfigForm.resetFields();
      await fetchConfigs('monitor');
    } catch {
      // 保存失败
    }
  };

  // 删除配置模板
  const handleDeleteConfig = async (configId: string) => {
    try {
      await removeConfig(configId);
      if (selectedConfigId === configId) {
        setSelectedConfigId(null);
      }
    } catch {
      // 删除失败
    }
  };

  return (
    <Card
      title={
        <Space>
          <DesktopOutlined />
          <span>监控命令配置</span>
          {enabledCount > 0 && (
            <Tag color="blue">{enabledCount} 个启用</Tag>
          )}
        </Space>
      }
      size="small"
      style={{ marginTop: 16 }}
      extra={
        <Space>
          <Button
            type="link"
            size="small"
            icon={<ReloadOutlined />}
            onClick={() => {
              updateCommands([]);
              setSelectedConfigId(null);
              message.success('已清空监控命令');
            }}
            disabled={disabled}
          >
            恢复默认
          </Button>
          <Tooltip title="在每次迭代期间，系统会按设定的间隔通过SSH执行勾选的监控命令，采集时序数据">
            <InfoCircleOutlined style={{ color: '#1890ff', cursor: 'help' }} />
          </Tooltip>
        </Space>
      }
    >
      {/* 配置模板保存/加载 */}
      <div
        style={{
          border: '1px solid #f0f0f0',
          borderRadius: 6,
          padding: 10,
          marginBottom: 12,
          background: '#fafafa',
        }}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Select
            size="small"
            placeholder="选择已保存的监控配置模板"
            value={selectedConfigId || undefined}
            onChange={(value) => {
              if (value) {
                handleLoadConfig(value);
              } else {
                setSelectedConfigId(null);
              }
            }}
            allowClear
            showSearch
            optionFilterProp="label"
            style={{ width: '100%' }}
          >
            {savedConfigs
              .filter((c) => c.configType === 'monitor')
              .map((config) => (
                <Option key={config.id} value={config.id} label={config.name}>
                  <Space>
                    <DatabaseOutlined style={{ color: '#1890ff' }} />
                    <span>{config.name}</span>
                    <span style={{ color: '#999', fontSize: 12 }}>
                      {config.monitorCommands?.length || 0} 条命令
                    </span>
                  </Space>
                </Option>
              ))}
          </Select>
          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
            <Button
              type="dashed"
              size="small"
              icon={<SaveOutlined />}
              onClick={() => setIsSaveConfigModalOpen(true)}
            >
              保存当前配置
            </Button>
            {selectedConfigId && (
              <Button
                danger
                size="small"
                icon={<DeleteOutlined />}
                onClick={() => handleDeleteConfig(selectedConfigId)}
              >
                删除配置
              </Button>
            )}
          </Space>
        </Space>
      </div>

      <Divider style={{ margin: '8px 0' }} />

      {commands.length === 0 ? (
        <Empty description="暂无监控命令" image={Empty.PRESENTED_IMAGE_SIMPLE}>
          <Button
            type="dashed"
            size="small"
            icon={<PlusOutlined />}
            onClick={addCommand}
            disabled={disabled}
          >
            添加监控命令
          </Button>
        </Empty>
      ) : (
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          {commands.map((cmd, index) => (
            <div
              key={cmd.id}
              style={{
                border: '1px solid #f0f0f0',
                borderRadius: 6,
                padding: 12,
                background: cmd.enabled ? '#fafafa' : '#f5f5f5',
                opacity: cmd.enabled ? 1 : 0.7,
              }}
            >
              <Row gutter={[8, 8]} align="middle">
                <Col flex="none">
                  <Checkbox
                    checked={cmd.enabled}
                    onChange={(e) => updateCommand(index, { enabled: e.target.checked })}
                    disabled={disabled}
                  />
                </Col>
                <Col flex="auto">
                  <Row gutter={[8, 8]}>
                    <Col span={8}>
                      <Input
                        size="small"
                        placeholder="监控名称"
                        value={cmd.name}
                        onChange={(e) => updateCommand(index, { name: e.target.value })}
                        disabled={disabled}
                        prefix={<span style={{ color: '#999', fontSize: 12 }}>名称</span>}
                      />
                    </Col>
                    <Col span={16}>
                      <Input
                        size="small"
                        placeholder="监控命令，例如：cat /proc/loadavg | awk '{print $1}'"
                        value={cmd.command}
                        onChange={(e) => updateCommand(index, { command: e.target.value })}
                        disabled={disabled}
                        prefix={<span style={{ color: '#999', fontSize: 12 }}>命令</span>}
                      />
                    </Col>
                    <Col span={8}>
                      <Select
                        size="small"
                        style={{ width: '100%' }}
                        value={cmd.mode || 'single'}
                        onChange={(value) =>
                          updateCommand(index, {
                            mode: value as 'single' | 'list',
                            columns: value === 'list' ? cmd.columns || [] : undefined,
                          })
                        }
                        disabled={disabled}
                        placeholder="模式"
                      >
                        <Option value="single">单值模式</Option>
                        <Option value="list">列表模式</Option>
                      </Select>
                    </Col>
                    {(cmd.mode === 'list') && (
                      <Col span={16}>
                        <Input
                          size="small"
                          placeholder="列名，用逗号分隔，例如：CPU0,CPU1,CPU2,CPU3"
                          value={(cmd.columns || []).join(',')}
                          onChange={(e) => {
                            const cols = e.target.value
                              .split(',')
                              .map((s) => s.trim());
                            updateCommand(index, { columns: cols });
                          }}
                          disabled={disabled}
                          prefix={<span style={{ color: '#999', fontSize: 12 }}>列名</span>}
                        />
                      </Col>
                    )}
                    <Col span={8}>
                      <Select
                        size="small"
                        style={{ width: '100%' }}
                        value={cmd.target}
                        onChange={(value) =>
                          updateCommand(index, {
                            target: value,
                            sessionId: value === 'host' ? null : cmd.sessionId,
                          })
                        }
                        disabled={disabled}
                        placeholder="执行目标"
                      >
                        <Option value="host">
                          <Space>
                            <DesktopOutlined />
                            远程主机
                          </Space>
                        </Option>
                        <Option value="bmc">
                          <Space>
                            <SafetyOutlined />
                            BMC
                          </Space>
                        </Option>
                      </Select>
                    </Col>
                    {cmd.target === 'bmc' && (
                      <Col span={10}>
                        <div style={{ fontSize: 12, color: '#666', paddingTop: 4 }}>
                          {globalBmcSessionId ? (
                            <Tag color="green">
                              <SafetyOutlined /> 使用统一 BMC 会话
                            </Tag>
                          ) : (
                            <Tag color="warning">
                              <SafetyOutlined /> 未选择统一 BMC 会话
                            </Tag>
                          )}
                        </div>
                      </Col>
                    )}
                    <Col span={cmd.target === 'bmc' ? 6 : 16}>
                      <Space>
                        <span style={{ color: '#666', fontSize: 12 }}>间隔</span>
                        <InputNumber
                          size="small"
                          min={0.1}
                          max={60}
                          value={cmd.interval}
                          onChange={(val) => updateCommand(index, { interval: val || 0.1 })}
                          disabled={disabled}
                          style={{ width: 60 }}
                        />
                        <span style={{ color: '#666', fontSize: 12 }}>秒</span>
                      </Space>
                    </Col>
                    <Col span={cmd.target === 'bmc' ? 14 : 16}>
                      <Space>
                        <Tooltip title="相邻采样点变化超过此值时记为一次跳变，用于自动识别校准/预热阶段。0 表示不启用跳变检测">
                          <span style={{ color: '#666', fontSize: 12, cursor: 'help' }}>跳变阈值</span>
                        </Tooltip>
                        <InputNumber
                          size="small"
                          min={0}
                          value={cmd.jumpThreshold ?? 0}
                          onChange={(val) => updateCommand(index, { jumpThreshold: val || 0 })}
                          disabled={disabled}
                          style={{ width: 60 }}
                        />
                        <Select
                          size="small"
                          value={cmd.jumpThresholdType || 'percent'}
                          onChange={(val) => updateCommand(index, { jumpThresholdType: val as 'percent' | 'absolute' })}
                          disabled={disabled}
                          style={{ width: 80 }}
                        >
                          <Option value="percent">%</Option>
                          <Option value="absolute">绝对值</Option>
                        </Select>
                      </Space>
                    </Col>
                    <Col span={6}>
                      <Space>
                        <Tooltip title="跳过前 N 次超过阈值的跳变，从第 N+1 次跳变开始的数据计入平均值。0 表示不跳过">
                          <span style={{ color: '#666', fontSize: 12, cursor: 'help' }}>跳过跳变</span>
                        </Tooltip>
                        <InputNumber
                          size="small"
                          min={0}
                          max={100}
                          value={cmd.skipJumps ?? 0}
                          onChange={(val) => updateCommand(index, { skipJumps: val || 0 })}
                          disabled={disabled}
                          style={{ width: 60 }}
                        />
                        <span style={{ color: '#666', fontSize: 12 }}>次</span>
                      </Space>
                    </Col>
                    <Col span={6}>
                      <Space>
                        <Tooltip title="直接跳过前 N 个采样点（无论值是多少）。与跳变检测独立，可叠加使用">
                          <span style={{ color: '#666', fontSize: 12, cursor: 'help' }}>跳过前</span>
                        </Tooltip>
                        <InputNumber
                          size="small"
                          min={0}
                          value={cmd.skipFirst ?? 0}
                          onChange={(val) => updateCommand(index, { skipFirst: val || 0 })}
                          disabled={disabled}
                          style={{ width: 60 }}
                        />
                        <span style={{ color: '#666', fontSize: 12 }}>点</span>
                      </Space>
                    </Col>
                    <Col span={6}>
                      <Space>
                        <Tooltip title="只保留最后 N 个采样点。0 表示不限制。可与【跳过前 N 点】叠加">
                          <span style={{ color: '#666', fontSize: 12, cursor: 'help' }}>保留最后</span>
                        </Tooltip>
                        <InputNumber
                          size="small"
                          min={0}
                          value={cmd.takeLast ?? 0}
                          onChange={(val) => updateCommand(index, { takeLast: val || 0 })}
                          disabled={disabled}
                          style={{ width: 60 }}
                        />
                        <span style={{ color: '#666', fontSize: 12 }}>点</span>
                      </Space>
                    </Col>
                    <Col span={6}>
                      <Space>
                        <Tooltip title="屏蔽（跳过）最后 N 个采样点。0 表示不限制。可与【跳过前 N 点】叠加，只保留中间段">
                          <span style={{ color: '#666', fontSize: 12, cursor: 'help' }}>屏蔽最后</span>
                        </Tooltip>
                        <InputNumber
                          size="small"
                          min={0}
                          value={cmd.skipLast ?? 0}
                          onChange={(val) => updateCommand(index, { skipLast: val || 0 })}
                          disabled={disabled}
                          style={{ width: 60 }}
                        />
                        <span style={{ color: '#666', fontSize: 12 }}>点</span>
                      </Space>
                    </Col>
                    <Col span={6}>
                      <Space>
                        <Tooltip title="勾选后，数值为 0 的采样点将不纳入平均值计算">
                          <Checkbox
                            checked={cmd.excludeZero ?? false}
                            onChange={(e) => updateCommand(index, { excludeZero: e.target.checked })}
                            disabled={disabled}
                          >
                            <span style={{ color: '#666', fontSize: 12 }}>排除 0 值</span>
                          </Checkbox>
                        </Tooltip>
                      </Space>
                    </Col>
                  </Row>
                </Col>
                <Col flex="none">
                  <Button
                    type="link"
                    danger
                    size="small"
                    icon={<MinusCircleOutlined />}
                    onClick={() => removeCommand(index)}
                    disabled={disabled}
                  />
                </Col>
              </Row>
            </div>
          ))}

          <Button
            type="dashed"
            size="small"
            icon={<PlusOutlined />}
            onClick={addCommand}
            disabled={disabled}
            style={{ width: '100%' }}
          >
            添加监控命令
          </Button>

          <Alert
            message="提示"
            description="系统会尝试将命令输出的第一行解析为数字。如果解析失败，将记录原始文本。监控命令失败不会影响主测试流程。"
            type="info"
            showIcon
            style={{ fontSize: 12 }}
          />
        </Space>
      )}

      {/* 保存配置弹窗 */}
      <Modal
        title={saveModal.renderTitle('保存监控配置')}
        open={isSaveConfigModalOpen}
        onCancel={() => setIsSaveConfigModalOpen(false)}
        onOk={handleSaveConfig}
        width={saveModal.width}
        style={saveModal.style}
        styles={{ body: saveModal.bodyStyle }}
      >
        <Form form={saveConfigForm} layout="vertical">
          <Form.Item
            name="name"
            label="配置名称"
            rules={[{ required: true, message: '请输入配置名称' }]}
          >
            <Input placeholder="例如：CPU负载+温度监控" />
          </Form.Item>
          <Form.Item
            name="description"
            label="描述"
          >
            <Input.TextArea placeholder="可选：添加配置说明" rows={3} />
          </Form.Item>
          <Form.Item>
            <div style={{ color: '#666' }}>
              监控命令数量: {commands.length} 条
            </div>
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
};

export default MonitorConfigPanel;
