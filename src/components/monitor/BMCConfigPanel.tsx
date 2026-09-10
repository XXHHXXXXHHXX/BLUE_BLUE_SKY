'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  Drawer,
  Button,
  Form,
  Input,
  Switch,
  Alert,
  Tag,
  Divider,
  Typography,
  List,
  Tooltip,
  message,
  Empty,
} from 'antd';
import {
  SafetyOutlined,
  EyeInvisibleOutlined,
  EyeTwoTone,
  LinkOutlined,
  CheckCircleOutlined,
  PlusOutlined,
  DeleteOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import { useBMCSessionStore } from '../../stores/bmcSessionStore';

const { Text, Title } = Typography;

interface BMCConfigPanelProps {
  open: boolean;
  onClose: () => void;
}

const BMCConfigPanel: React.FC<BMCConfigPanelProps> = ({ open, onClose }) => {
  const {
    sessions,
    activeSessionId,
    connectedSessionId,
    addSession,
    updateSession,
    deleteSession,
    setActiveSessionId,
    setConnectedSessionId,
    testConnection,
    loadSessions,
  } = useBMCSessionStore();

  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [testStatus, setTestStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [testMessage, setTestMessage] = useState('');

  // 打开时加载
  useEffect(() => {
    if (open) {
      loadSessions();
    }
  }, [open, loadSessions]);

  // 切换 activeSession 时同步到表单
  useEffect(() => {
    const session = sessions.find((s) => s.id === activeSessionId);
    if (session) {
      form.setFieldsValue({
        name: session.name,
        enabled: session.enabled,
        ip: session.ip,
        port: session.port || 22,
        username: session.username,
        password: session.password,
      });
    } else {
      form.resetFields();
      form.setFieldsValue({ enabled: false, port: 22 });
    }
    setTestStatus('idle');
    setTestMessage('');
  }, [activeSessionId, sessions, form]);

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId),
    [sessions, activeSessionId]
  );

  const handleCreate = () => {
    const id = addSession({
      name: `BMC 会话 ${sessions.length + 1}`,
      enabled: false,
      ip: '',
      port: 22,
      protocol: 'ssh',
      username: '',
      password: '',
    });
    setConnectedSessionId(null);
    setActiveSessionId(id);
  };

  const handleSaveSession = async () => {
    if (!activeSession) return;
    try {
      const values = await form.validateFields();
      updateSession(activeSession.id, {
        name: values.name,
        enabled: values.enabled,
        ip: values.ip,
        port: values.port || 22,
        username: values.username,
        password: values.password,
      });
      message.success('会话已保存');
    } catch {
      // 表单验证失败
    }
  };

  const handleTest = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);
      setTestStatus('idle');
      setTestMessage('');

      const result = await testConnection({
        enabled: values.enabled,
        ip: values.ip,
        port: values.port || 22,
        protocol: 'ssh',
        username: values.username,
        password: values.password,
      });

      setLoading(false);
      if (result.success) {
        setTestStatus('success');
        setTestMessage(result.message || 'SSH 连接测试成功');
        message.success('BMC SSH 连接测试成功');
        // 测试成功后，如果当前有 activeSession，自动标记为已连接
        if (activeSession) {
          setConnectedSessionId(activeSession.id);
        }
      } else {
        setTestStatus('error');
        setTestMessage(result.message || 'SSH 连接测试失败');
        message.error(result.message || 'BMC SSH 连接测试失败');
        if (connectedSessionId === activeSession?.id) {
          setConnectedSessionId(null);
        }
      }
    } catch {
      setLoading(false);
      setTestStatus('error');
      setTestMessage('请检查输入信息');
    }
  };

  const handleDelete = (id: string) => {
    deleteSession(id);
    if (connectedSessionId === id) {
      setConnectedSessionId(null);
    }
  };

  return (
    <Drawer
      title={
        <span>
          <SafetyOutlined style={{ marginRight: 8 }} />
          BMC 连接会话管理
        </span>
      }
      placement="right"
      width={720}
      open={open}
      onClose={onClose}
      styles={{ body: { padding: 0 } }}
    >
      <div style={{ display: 'flex', height: '100%' }}>
        {/* 左侧会话列表 */}
        <div
          style={{
            width: 240,
            borderRight: '1px solid #f0f0f0',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div style={{ padding: 12, borderBottom: '1px solid #f0f0f0' }}>
            <Button type="primary" icon={<PlusOutlined />} block onClick={handleCreate}>
              新建会话
            </Button>
          </div>
          <div style={{ flex: 1, overflow: 'auto', padding: 8 }}>
            {sessions.length === 0 ? (
              <Empty description="暂无会话" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              <List
                dataSource={sessions}
                renderItem={(item) => {
                  const isActive = item.id === activeSessionId;
                  const isConnected = item.id === connectedSessionId;
                  return (
                    <List.Item
                      style={{
                        padding: '8px 12px',
                        cursor: 'pointer',
                        borderRadius: 6,
                        background: isActive ? '#e6f7ff' : 'transparent',
                        marginBottom: 4,
                      }}
                      onClick={() => setActiveSessionId(item.id)}
                      actions={[
                        <Tooltip title="删除" key="delete">
                          <Button
                            type="text"
                            size="small"
                            danger
                            icon={<DeleteOutlined />}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDelete(item.id);
                            }}
                          />
                        </Tooltip>,
                      ]}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {isConnected ? (
                          <SafetyCertificateOutlined style={{ color: '#52c41a' }} />
                        ) : (
                          <SafetyOutlined style={{ color: '#8c8c8c' }} />
                        )}
                        <div style={{ overflow: 'hidden' }}>
                          <div style={{ fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {item.name}
                          </div>
                          <div style={{ fontSize: 12, color: '#8c8c8c' }}>
                            {item.ip || '未配置 IP'}
                            {isConnected && <Tag color="green" style={{ marginLeft: 8 }}>已连接</Tag>}
                          </div>
                        </div>
                      </div>
                    </List.Item>
                  );
                }}
              />
            )}
          </div>
        </div>

        {/* 右侧编辑区 */}
        <div style={{ flex: 1, padding: 20, overflow: 'auto' }}>
          {!activeSession ? (
            <Empty description="请选择或创建一个 BMC 会话" style={{ marginTop: 80 }} />
          ) : (
            <>
              <Alert
                message="SSH 连接到 BMC"
                description="配置并测试连接成功后，该会话将用于实时监控数据。"
                type="info"
                showIcon
                style={{ marginBottom: 16 }}
              />

              <Form form={form} layout="vertical" initialValues={{ enabled: false, port: 22 }}>
                <Form.Item name="name" label="会话名称" rules={[{ required: true, message: '请输入会话名称' }]}>
                  <Input placeholder="例如：测试环境 BMC" />
                </Form.Item>

                <Form.Item name="enabled" label="启用 BMC 监控" valuePropName="checked">
                  <Switch checkedChildren="启用" unCheckedChildren="禁用" />
                </Form.Item>

                <Divider style={{ margin: '16px 0' }} />

                <Form.Item noStyle shouldUpdate={(prev, curr) => prev.enabled !== curr.enabled}>
                  {({ getFieldValue }) => {
                    const enabled = getFieldValue('enabled');
                    return enabled ? (
                      <>
                        <div style={{ display: 'flex', gap: 16 }}>
                          <Form.Item label="协议" style={{ flex: 1 }}>
                            <Tag color="blue" style={{ fontSize: 14, padding: '4px 12px' }}>SSH</Tag>
                          </Form.Item>
                          <Form.Item
                            name="port"
                            label="端口"
                            style={{ flex: 1 }}
                            rules={[{ required: true, message: '请输入端口' }]}
                          >
                            <Input type="number" placeholder="22" />
                          </Form.Item>
                        </div>

                        <Form.Item
                          name="ip"
                          label="BMC IP 地址"
                          rules={[
                            { required: true, message: '请输入 BMC IP 地址' },
                            {
                              pattern: /^((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/,
                              message: '请输入有效的 IP 地址',
                            },
                          ]}
                        >
                          <Input placeholder="例如: 192.168.1.100" prefix={<LinkOutlined />} />
                        </Form.Item>

                        <Form.Item
                          name="username"
                          label="SSH 用户名"
                          rules={[{ required: true, message: '请输入用户名' }]}
                        >
                          <Input placeholder="BMC SSH 用户名" autoComplete="off" />
                        </Form.Item>

                        <Form.Item
                          name="password"
                          label="SSH 密码"
                          rules={[{ required: true, message: '请输入密码' }]}
                        >
                          <Input.Password
                            placeholder="BMC SSH 密码"
                            iconRender={(visible) => (visible ? <EyeTwoTone /> : <EyeInvisibleOutlined />)}
                            autoComplete="off"
                          />
                        </Form.Item>

                        <Form.Item>
                          <Button
                            type="dashed"
                            block
                            icon={<CheckCircleOutlined />}
                            loading={loading}
                            onClick={handleTest}
                          >
                            测试 SSH 连接
                          </Button>
                        </Form.Item>

                        {testStatus !== 'idle' && (
                          <Alert
                            message={testStatus === 'success' ? 'SSH 连接成功' : 'SSH 连接失败'}
                            description={testMessage}
                            type={testStatus === 'success' ? 'success' : 'error'}
                            showIcon
                            style={{ marginBottom: 16 }}
                          />
                        )}

                        <Divider style={{ margin: '16px 0' }} />

                        <div>
                          <Title level={5}>
                            <SafetyOutlined /> 使用说明
                          </Title>
                          <div style={{ background: '#f6f8fa', padding: 12, borderRadius: 6, fontSize: 13 }}>
                            <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
                              配置完成后，系统将通过 SSH 连接到 BMC 执行以下命令获取 Sensor 数据：
                            </Text>
                            <code
                              style={{
                                fontSize: 11,
                                color: '#595959',
                                background: '#e6f7ff',
                                padding: '4px 8px',
                                borderRadius: 4,
                                display: 'block',
                              }}
                            >
                              bash -l -c &apos;ipmcget -t sensor -d list&apos;
                            </code>
                            <Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
                              请确保 BMC 的 SSH 服务已启用，且用户名/密码具有执行该命令的权限。
                            </Text>
                          </div>
                        </div>
                      </>
                    ) : (
                      <Alert
                        message="BMC 监控已禁用"
                        description="启用后，系统将通过 SSH 连接到 BMC 获取实时 Sensor 数据。"
                        type="warning"
                        showIcon
                      />
                    );
                  }}
                </Form.Item>
              </Form>

              <div style={{ marginTop: 24, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <Button onClick={() => form.resetFields()}>重置</Button>
                <Button type="primary" onClick={handleSaveSession}>
                  保存会话
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </Drawer>
  );
};

export default BMCConfigPanel;
