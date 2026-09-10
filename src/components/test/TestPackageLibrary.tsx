'use client';

import React, { useState, useEffect } from 'react';
import {
  Modal,
  Button,
  Table,
  Space,
  Tag,
  Upload,
  Input,
  Form,
  Popconfirm,
  message,
  Descriptions,
  Empty,
} from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  DatabaseOutlined,
  UploadOutlined,
  SearchOutlined,
  DownloadOutlined,
} from '@ant-design/icons';
import type { UploadFile } from 'antd/es/upload';
import {
  useTestPackageStore,
  formatFileSize,
  type TestPackage,
} from '../../stores/testPackageStore';
import useMaximizableModal from '../../hooks/useMaximizableModal';

interface TestPackageLibraryProps {
  visible: boolean;
  onClose: () => void;
}

const TestPackageLibrary: React.FC<TestPackageLibraryProps> = ({
  visible,
  onClose,
}) => {
  const {
    packages,
    isLoading,
    addPackage,
    removePackage,
    searchPackages,
    downloadPackage,
    fetchPackages,
  } = useTestPackageStore();
  const [searchKeyword, setSearchKeyword] = useState('');
  const [uploadForm] = Form.useForm();
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [showUploadForm, setShowUploadForm] = useState(false);

  const mainModal = useMaximizableModal({ minWidth: 1200, minPageSize: 5, maxPageSize: 25 });

  // 组件挂载时预加载，避免第一次打开弹窗时空白
  useEffect(() => {
    fetchPackages();
  }, [fetchPackages]);

  // 打开弹窗时刷新数据
  useEffect(() => {
    if (visible) {
      fetchPackages();
    }
  }, [visible, fetchPackages]);

  const displayedPackages = searchKeyword ? searchPackages(searchKeyword) : packages;

  const handleUpload = async () => {
    const values = await uploadForm.validateFields();
    const file = fileList[0]?.originFileObj;

    if (!file) {
      message.error('请选择文件');
      return;
    }

    setIsUploading(true);
    try {
      await addPackage({
        name: values.name,
        description: values.description || '',
        filename: file.name,
        size: formatFileSize(file.size),
        file,
        requiredEnvVars: values.requiredEnvVars
          ? values.requiredEnvVars.split(',').map((s: string) => s.trim()).filter(Boolean)
          : [],
      });

      message.success('用例包上传成功');
      uploadForm.resetFields();
      setFileList([]);
      setShowUploadForm(false);
    } catch (error) {
      message.error('上传失败');
    } finally {
      setIsUploading(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await removePackage(id);
      message.success('已删除');
    } catch {
      message.error('删除失败');
    }
  };

  const handleDownload = async (id: string, name: string) => {
    try {
      await downloadPackage(id);
      message.success(`已开始下载: ${name}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : '下载失败';
      message.error(`下载失败: ${msg}`);
    }
  };

  const columns = [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      render: (text: string, record: TestPackage) => (
        <Space>
          <span>{text}</span>
          {record.id.startsWith('builtin-') && <Tag color="blue">内置</Tag>}
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
      title: '文件名',
      dataIndex: 'filename',
      key: 'filename',
    },
    {
      title: '大小',
      dataIndex: 'size',
      key: 'size',
      width: 100,
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      width: 120,
    },
    {
      title: '操作',
      key: 'action',
      width: 100,
      render: (_: unknown, record: TestPackage) => (
        <Space>
          <Button
            type="text"
            icon={<DownloadOutlined />}
            size="small"
            onClick={() => handleDownload(record.id, record.name)}
            title="下载"
          />
          {!record.id.startsWith('builtin-') && (
            <Popconfirm
              title="确定删除？"
              onConfirm={() => handleDelete(record.id)}
            >
              <Button type="text" danger icon={<DeleteOutlined />} size="small" title="删除" />
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <Modal
      title={mainModal.renderTitle(
        <Space>
          <DatabaseOutlined />
          <span>用例包库管理</span>
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
        {/* 上传区域 */}
        <div style={{ background: '#f5f5f5', padding: 16, borderRadius: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: showUploadForm ? 16 : 0 }}>
            <h4 style={{ margin: 0 }}>
              <DatabaseOutlined /> 用例包列表
            </h4>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setShowUploadForm(!showUploadForm)}
              size="small"
            >
              {showUploadForm ? '取消上传' : '上传新包'}
            </Button>
          </div>

          {showUploadForm && (
            <Form form={uploadForm} layout="inline" size="small" style={{ marginTop: 12 }}>
              <Form.Item
                name="name"
                label="名称"
                rules={[{ required: true, message: '请输入名称' }]}
                style={{ flex: 1 }}
              >
                <Input placeholder="例如：功耗压力测试包" />
              </Form.Item>
              <Form.Item name="description" label="描述" style={{ flex: 1 }}>
                <Input placeholder="简要描述测试包用途" />
              </Form.Item>
              <Form.Item name="requiredEnvVars" label="必填环境变量" style={{ flex: 1 }}>
                <Input placeholder="多个用逗号分隔，如: SERVER_IP,PORT" />
              </Form.Item>
              <Form.Item label="文件" required>
                <Upload
                  fileList={fileList}
                  onChange={({ fileList }) => setFileList(fileList.slice(-1))}
                  beforeUpload={() => false}
                  accept=".zip,.tar,.tar.gz"
                >
                  <Button icon={<UploadOutlined />} size="small">
                    选择文件
                  </Button>
                </Upload>
              </Form.Item>
              <Form.Item>
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={handleUpload}
                  loading={isUploading}
                  disabled={fileList.length === 0}
                  size="small"
                >
                  上传
                </Button>
              </Form.Item>
            </Form>
          )}
        </div>

        {/* 搜索和列表 */}
        <div>
          <div style={{ marginBottom: 16 }}>
            <Input
              prefix={<SearchOutlined />}
              placeholder="搜索用例包"
              value={searchKeyword}
              onChange={(e) => setSearchKeyword(e.target.value)}
              allowClear
            />
          </div>

          {displayedPackages.length === 0 && !isLoading ? (
            <Empty description="暂无例包" />
          ) : (
            <Table
              columns={columns}
              dataSource={displayedPackages}
              rowKey="id"
              size="small"
              pagination={{ pageSize: mainModal.pageSize }}
              loading={isLoading}
              scroll={mainModal.tableScroll}
              expandable={{
                expandedRowRender: (record) => (
                  <Descriptions size="small" bordered column={2}>
                    <Descriptions.Item label="ID">{record.id}</Descriptions.Item>
                    <Descriptions.Item label="创建时间">{record.createdAt}</Descriptions.Item>
                    <Descriptions.Item label="文件名">{record.filename}</Descriptions.Item>
                    <Descriptions.Item label="文件大小">{record.size}</Descriptions.Item>
                    <Descriptions.Item label="描述" span={2}>
                      {record.description || '无'}
                    </Descriptions.Item>
                  </Descriptions>
                ),
              }}
            />
          )}
        </div>
      </Space>
    </Modal>
  );
};

export default TestPackageLibrary;
