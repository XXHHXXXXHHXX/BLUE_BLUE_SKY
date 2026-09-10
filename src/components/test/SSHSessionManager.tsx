'use client';

import React, { useState } from 'react';
import {
  Modal,
  Button,
  Table,
  Space,
  Tag,
  Form,
  Input,
  InputNumber,
  Popconfirm,
  message,
  Tooltip,
} from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  EditOutlined,
  FolderOpenOutlined,
  SearchOutlined,
  UserOutlined,
  GlobalOutlined,
  LinkOutlined,
} from '@ant-design/icons';
import { useSSHSessionStore } from '../../stores/sshSessionStore';
import useMaximizableModal from '../../hooks/useMaximizableModal';

interface SSHSessionManagerProps {
  visible: boolean;
  onClose: () => void;
  onSelectSession: (sessionId: string) => void;
}

const SSHSessionManager: React.FC<SSHSessionManagerProps> = ({
  visible,
  onClose,
  onSelectSession,
}) => {
  const {
    sessions,
    addSession,
    removeSession,
    updateSession,
    searchSessions,
    getSortedSessions,
  } = useSSHSessionStore();
  const [searchKeyword, setSearchKeyword] = useState('');
  const [form] = Form.useForm();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isFormVisible, setIsFormVisible] = useState(false);

  const mainModal = useMaximizableModal({ minWidth: 1100, minPageSize: 5, maxPageSize: 25 });

  const displayedSessions = searchKeyword
    ? searchSessions(searchKeyword)
    : getSortedSessions();

  const handleSave = async () => {
    const values = await form.validateFields();

    if (editingId) {
      updateSession(editingId, {
        ...values,
        passwordEncrypted: values.password,
      });
      message.success('会话已更新');
    } else {
      addSession({
        name: values.name,
        host: values.host,
        port: values.port || 22,
        username: values.username,
        passwordEncrypted: values.password,
        description: values.description,
      });
      message.success('会话已保存');
    }

    form.resetFields();
    setEditingId(null);
    setIsFormVisible(false);
  };

  const handleEdit = (record: typeof sessions[0]) => {
    setEditingId(record.id);
    form.setFieldsValue({
      name: record.name,
      host: record.host,
      port: record.port,
      username: record.username,
      password: '',
      description: record.description,
    });
    setIsFormVisible(true);
  };

  const handleAdd = () => {
    setEditingId(null);
    form.resetFields();
    setIsFormVisible(true);
  };

  const handleDelete = (id: string) => {
    removeSession(id);
    message.success('已删除');
  };

  const handleSelect = (record: typeof sessions[0]) => {
    onSelectSession(record.id);
    onClose();
  };

  const columns = [
    {
      title: '会话名称',
      dataIndex: 'name',
      key: 'name',
      render: (text: string, record: typeof sessions[0]) => (
        <Space>
          <FolderOpenOutlined />
          <span>{text}</span>
          {record.useCount > 0 && (
            <Tooltip title={`已使用 ${record.useCount} 次`}>
              <Tag color="green">常用</Tag>
            </Tooltip>
          )}
        </Space>
      ),
    },
    {
      title: '主机信息',
      key: 'host',
      render: (_: unknown, record: typeof sessions[0]) => (
        <Space>
          <GlobalOutlined />
          <span>{record.host}</span>
          <Tag>:{record.port || 22}</Tag>
        </Space>
      ),
    },
    {
      title: '用户名',
      dataIndex: 'username',
      key: 'username',
      render: (text: string) => (
        <Space>
          <UserOutlined />
          <span>{text}</span>
        </Space>
      ),
    },
    {
      title: '描述',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
    },
    {
      title: '操作',
      key: 'action',
      width: 180,
      render: (_: unknown, record: typeof sessions[0]) => (
        <Space>
          <Button
            type="primary"
            size="small"
            icon={<LinkOutlined />}
            onClick={() => handleSelect(record)}
          >
            连接
          </Button>
          <Button
            type="text"
            icon={<EditOutlined />}
            onClick={() => handleEdit(record)}
            size="small"
          />
          <Popconfirm
            title="确定删除此会话？"
            onConfirm={() => handleDelete(record.id)}
          >
            <Button type="text" danger icon={<DeleteOutlined />} size="small" />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Modal
      title={mainModal.renderTitle(
        <Space>
          <FolderOpenOutlined />
          <span>SSH会话管理</span>
        </Space>
      )}
      open={visible}
      onCancel={onClose}
      width={mainModal.width}
      style={mainModal.style}
      styles={{ body: mainModal.bodyStyle }}
      footer={[
        <Button key="close" onClick={onClose}>
          关闭
        </Button>,
      ]}
    >
      <Space direction="vertical" style={{ width: '100%' }} size="large">
        {isFormVisible && (
          <div style={{ background: '#f5f5f5', padding: 16, borderRadius: 8 }}>
            <h4 style={{ marginBottom: 16 }}>
              {editingId ? '编辑会话' : '新建会话'}
            </h4>
            <Form form={form} layout="inline" size="small">
              <Form.Item
                name="name"
                label="会话名称"
                rules={[{ required: true, message: '请输入名称' }]}
              >
                <Input placeholder="例如：测试服务器1" style={{ width: 150 }} />
              </Form.Item>
              <Form.Item
                name="host"
                label="主机地址"
                rules={[{ required: true, message: '请输入主机' }]}
              >
                <Input placeholder="192.168.1.100" style={{ width: 140 }} />
              </Form.Item>
              <Form.Item name="port" label="端口" initialValue={22}>
                <InputNumber min={1} max={65535} style={{ width: 70 }} />
              </Form.Item>
              <Form.Item
                name="username"
                label="用户名"
                rules={[{ required: true, message: '请输入用户名' }]}
              >
                <Input placeholder="root" style={{ width: 100 }} />
              </Form.Item>
              <Form.Item
                name="password"
                label="密码"
                rules={[{ required: true, message: '请输入密码' }]}
              >
                <Input.Password placeholder="密码" style={{ width: 120 }} />
              </Form.Item>
              <Form.Item name="description" label="描述">
                <Input placeholder="可选" style={{ width: 120 }} />
              </Form.Item>
              <Form.Item>
                <Space>
                  <Button type="primary" onClick={handleSave} size="small">
                    保存
                  </Button>
                  <Button onClick={() => setIsFormVisible(false)} size="small">
                    取消
                  </Button>
                </Space>
              </Form.Item>
            </Form>
          </div>
        )}

        <div>
          <div style={{ marginBottom: 16, display: 'flex', gap: 8 }}>
            <Input
              prefix={<SearchOutlined />}
              placeholder="搜索会话名称、主机或描述"
              value={searchKeyword}
              onChange={(e) => setSearchKeyword(e.target.value)}
              allowClear
              style={{ flex: 1 }}
            />
            <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
              新建会话
            </Button>
          </div>

          <Table
            columns={columns}
            dataSource={displayedSessions}
            rowKey="id"
            size="small"
            pagination={{ pageSize: mainModal.pageSize }}
            scroll={mainModal.tableScroll}
          />
        </div>
      </Space>
    </Modal>
  );
};

export default SSHSessionManager;
