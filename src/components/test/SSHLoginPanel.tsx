'use client';

import React, { useState, useEffect } from 'react';
import { Card, Form, Input, Button, Space, Tag, message, Row, Col, Select } from 'antd';
import { CheckCircleOutlined, DisconnectOutlined, LoadingOutlined, FolderOpenOutlined } from '@ant-design/icons';
import { useTestStore, type TestTab } from '../../stores/testStore';
import { useSSHSessionStore } from '../../stores/sshSessionStore';
import SSHSessionManager from './SSHSessionManager';

interface SSHLoginPanelProps {
  tab: TestTab;
}

const SSHLoginPanel: React.FC<SSHLoginPanelProps> = ({ tab }) => {
  const {
    setSSHConfig,
    testSSHConnection,
    setSSHConnected,
    addShellOutput,
  } = useTestStore();

  const { sessions, getDecryptedPassword, recordUsage } = useSSHSessionStore();
  const [isSessionManagerOpen, setIsSessionManagerOpen] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState<string | undefined>(undefined);

  // 当标签页切换时，重置选择状态
  useEffect(() => {
    setSelectedSessionId(undefined);
  }, [tab.id]);

  const handleSelectSession = (sessionId: string) => {
    if (!sessionId) {
      setSelectedSessionId(undefined);
      return;
    }
    
    const session = sessions.find(s => s.id === sessionId);
    if (!session) {
      setSelectedSessionId(undefined);
      return;
    }

    const password = getDecryptedPassword(sessionId);
    if (!password) {
      message.error('无法获取会话密码');
      setSelectedSessionId(undefined);
      return;
    }

    setSelectedSessionId(sessionId);
    setSSHConfig(tab.id, {
      host: session.host,
      port: session.port,
      username: session.username,
      password,
    });

    message.success(`已加载会话: ${session.name}`);
  };

  const handleTestConnection = async () => {
    if (!tab.sshConfig.host || !tab.sshConfig.username || !tab.sshConfig.password) {
      message.error('请填写完整的SSH连接信息');
      return;
    }

    addShellOutput(tab.id, `[${new Date().toLocaleTimeString()}] 正在测试SSH连接到 ${tab.sshConfig.host}:${tab.sshConfig.port}...`);
    
    const success = await testSSHConnection(tab.id);
    
    if (success) {
      message.success('SSH连接成功');
      addShellOutput(tab.id, `[${new Date().toLocaleTimeString()}] SSH连接成功`);
      
      // 如果有匹配的会话，记录使用次数
      const matchingSession = sessions.find(
        s => s.host === tab.sshConfig.host && s.username === tab.sshConfig.username
      );
      if (matchingSession) {
        recordUsage(matchingSession.id);
      }
    } else {
      const { tabs } = useTestStore.getState();
      const currentTab = tabs.find(t => t.id === tab.id);
      const errorMsg = currentTab?.testError || '连接失败';
      message.error(`SSH连接失败: ${errorMsg}`);
      addShellOutput(tab.id, `[${new Date().toLocaleTimeString()}] SSH连接失败: ${errorMsg}`);
    }
  };

  const handleDisconnect = () => {
    setSSHConnected(tab.id, false);
    addShellOutput(tab.id, `[${new Date().toLocaleTimeString()}] 已断开SSH连接`);
    message.info('已断开SSH连接');
  };

  return (
    <Card 
      title={
        <Space>
          <span>SSH连接配置</span>
        </Space>
      }
      size="small"
      extra={
        <Space>
          {tab.isSSHConnected ? (
            <Tag icon={<CheckCircleOutlined />} color="success">
              已连接
            </Tag>
          ) : (
            <Tag icon={<DisconnectOutlined />} color="default">
              未连接
            </Tag>
          )}
          <Button
            type="primary"
            ghost
            size="small"
            icon={<FolderOpenOutlined />}
            onClick={() => setIsSessionManagerOpen(true)}
          >
            SSH会话管理
          </Button>
        </Space>
      }
    >
      {sessions.length > 0 && (
        <Form layout="vertical" size="small" style={{ marginBottom: 16 }}>
          <Form.Item label="快速选择已保存的会话">
            <Select
              placeholder="选择已保存的SSH会话"
              allowClear
              value={selectedSessionId}
              onChange={handleSelectSession}
              style={{ width: '100%' }}
            >
              {sessions.map(session => (
                <Select.Option key={session.id} value={session.id}>
                  <Space>
                    <span>{session.name}</span>
                    <Tag color="blue">{session.host}</Tag>
                    <span style={{ color: '#999' }}>{session.username}</span>
                  </Space>
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
        </Form>
      )}

      <Form layout="vertical" size="small">
        <Row gutter={16}>
          <Col span={8}>
            <Form.Item 
              label="主机地址" 
              required
              validateStatus={tab.testError && !tab.isSSHConnected ? 'error' : undefined}
              help={tab.testError && !tab.isSSHConnected ? tab.testError : undefined}
            >
              <Input
                placeholder="例如: 192.168.1.100"
                value={tab.sshConfig.host}
                onChange={(e) => setSSHConfig(tab.id, { host: e.target.value })}
                disabled={tab.isSSHConnected}
              />
            </Form.Item>
          </Col>
          <Col span={4}>
            <Form.Item label="端口">
              <Input
                type="number"
                placeholder="22"
                value={tab.sshConfig.port}
                onChange={(e) => setSSHConfig(tab.id, { port: parseInt(e.target.value) || 22 })}
                disabled={tab.isSSHConnected}
              />
            </Form.Item>
          </Col>
          <Col span={6}>
            <Form.Item label="用户名" required>
              <Input
                placeholder="例如: root"
                value={tab.sshConfig.username}
                onChange={(e) => setSSHConfig(tab.id, { username: e.target.value })}
                disabled={tab.isSSHConnected}
              />
            </Form.Item>
          </Col>
          <Col span={6}>
            <Form.Item label="密码" required>
              <Input.Password
                placeholder="输入密码"
                value={tab.sshConfig.password}
                onChange={(e) => setSSHConfig(tab.id, { password: e.target.value })}
                disabled={tab.isSSHConnected}
              />
            </Form.Item>
          </Col>
        </Row>
        
        <Form.Item>
          <Space>
            {tab.isSSHConnected ? (
              <Button 
                type="primary" 
                danger
                icon={<DisconnectOutlined />}
                onClick={handleDisconnect}
              >
                断开连接
              </Button>
            ) : (
              <Button
                type="primary"
                icon={tab.isTestingConnection ? <LoadingOutlined /> : <CheckCircleOutlined />}
                onClick={handleTestConnection}
                loading={tab.isTestingConnection}
              >
                {tab.isTestingConnection ? '连接中...' : '测试连接'}
              </Button>
            )}
          </Space>
        </Form.Item>
      </Form>

      <SSHSessionManager
        visible={isSessionManagerOpen}
        onClose={() => setIsSessionManagerOpen(false)}
        onSelectSession={handleSelectSession}
      />
    </Card>
  );
};

export default SSHLoginPanel;
