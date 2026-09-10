'use client';

import React, { useEffect, useState } from 'react';
import {
  Modal,
  Button,
  Table,
  Space,
  Tag,
  Popconfirm,
  message,
  Empty,
  Tooltip,
  Badge,
  Form,
  Input,
  TreeSelect,
} from 'antd';
import {
  InboxOutlined,
  DeleteOutlined,
  ImportOutlined,
  SaveOutlined,
  StopOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import {
  useTestDraftStore,
  type TestDraft,
} from '../../stores/testDraftStore';
import { useTestReportStore } from '../../stores/testReportStore';
import useMaximizableModal from '../../hooks/useMaximizableModal';

interface TestDraftManagerProps {
  visible: boolean;
  onClose: () => void;
  onImportDraft?: (draft: TestDraft) => void;
}

const TestDraftManager: React.FC<TestDraftManagerProps> = ({
  visible,
  onClose,
  onImportDraft,
}) => {
  const { drafts, removeDraft, clearAllDrafts } = useTestDraftStore();
  const { addReport, buildFolderTreeOptions, getSelectedFolderId, fetchFolders } = useTestReportStore();
  const [savingDraftId, setSavingDraftId] = useState<string | null>(null);
  const [saveDraftModal, setSaveDraftModal] = useState<{ open: boolean; draft: TestDraft | null }>({
    open: false,
    draft: null,
  });
  const [saveDraftForm] = Form.useForm();

  const mainModal = useMaximizableModal({ minWidth: 1200, minPageSize: 5, maxPageSize: 25 });
  const saveModal = useMaximizableModal({ minWidth: 700 });

  useEffect(() => {
    if (saveDraftModal.open && saveDraftModal.draft) {
      fetchFolders();
      saveDraftForm.setFieldsValue({
        name: saveDraftModal.draft.name,
        description: saveDraftModal.draft.description || `从草稿箱导入 | 原标签: ${saveDraftModal.draft.sourceTabName} | 主机: ${saveDraftModal.draft.host}`,
        folderId: getSelectedFolderId() || 'uncategorized',
      });
    }
  }, [saveDraftModal.open, saveDraftModal.draft, fetchFolders, saveDraftForm, getSelectedFolderId]);

  const handleDelete = (id: string) => {
    removeDraft(id);
    message.success('草稿已删除');
  };

  const handleClearAll = () => {
    clearAllDrafts();
    message.success('草稿箱已清空');
  };

  const handleImport = (draft: TestDraft) => {
    if (onImportDraft) {
      onImportDraft(draft);
      message.success('草稿已恢复到当前页面');
      onClose();
    }
  };

  const handleSaveToReport = (draft: TestDraft) => {
    setSaveDraftModal({ open: true, draft });
  };

  const handleSaveDraftToReportSubmit = async () => {
    const values = await saveDraftForm.validateFields();
    const draft = saveDraftModal.draft;
    if (!draft) return;
    setSavingDraftId(draft.id);
    try {
      await addReport({
        name: values.name,
        description: values.description,
        folderId: values.folderId,
        config: {
          host: draft.host,
          iterationParams: draft.config.iterationParams,
          adjustmentCommands: draft.config.adjustmentCommands,
        },
        results: draft.results,
      });
      message.success('已保存到报告管理');
      removeDraft(draft.id);
      setSaveDraftModal({ open: false, draft: null });
      saveDraftForm.resetFields();
    } catch (err) {
      message.error('保存到报告失败: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSavingDraftId(null);
    }
  };

  const getStatusIcon = (status: TestDraft['status']) => {
    switch (status) {
      case 'completed':
        return <CheckCircleOutlined style={{ color: '#52c41a' }} />;
      case 'aborted':
        return <StopOutlined style={{ color: '#fa8c16' }} />;
      case 'error':
        return <CloseCircleOutlined style={{ color: '#ff4d4f' }} />;
      default:
        return <ExclamationCircleOutlined style={{ color: '#999' }} />;
    }
  };

  const getStatusText = (status: TestDraft['status']) => {
    switch (status) {
      case 'completed':
        return '已完成';
      case 'aborted':
        return '已中止';
      case 'error':
        return '出错';
      default:
        return '未知';
    }
  };

  const getStatusColor = (status: TestDraft['status']) => {
    switch (status) {
      case 'completed':
        return 'success';
      case 'aborted':
        return 'warning';
      case 'error':
        return 'error';
      default:
        return 'default';
    }
  };

  const columns: ColumnsType<TestDraft> = [
    {
      title: '状态',
      key: 'status',
      width: 80,
      render: (_: unknown, record: TestDraft) => (
        <Tooltip title={getStatusText(record.status)}>
          <Badge status={getStatusColor(record.status) as any} text={getStatusIcon(record.status)} />
        </Tooltip>
      ),
    },
    {
      title: '草稿名称',
      dataIndex: 'name',
      key: 'name',
      render: (text: string) => (
        <Space>
          <InboxOutlined style={{ color: '#1890ff' }} />
          <span>{text}</span>
        </Space>
      ),
    },
    {
      title: '测试主机',
      key: 'host',
      width: 140,
      render: (_: unknown, record: TestDraft) => (
        <Tag color="blue">{record.host}</Tag>
      ),
    },
    {
      title: '数据点',
      key: 'dataPoints',
      width: 80,
      render: (_: unknown, record: TestDraft) => (
        <Tag>{record.results.length} 个</Tag>
      ),
    },
    {
      title: '保存时间',
      dataIndex: 'savedAt',
      key: 'savedAt',
      width: 170,
      render: (text: string) => new Date(text).toLocaleString(),
    },
    {
      title: '操作',
      key: 'action',
      width: 260,
      render: (_: unknown, record: TestDraft) => (
        <Space>
          <Button
            type="text"
            icon={<ImportOutlined />}
            onClick={() => handleImport(record)}
            size="small"
          >
            恢复
          </Button>
          <Button
            type="text"
            icon={<SaveOutlined />}
            onClick={() => handleSaveToReport(record)}
            size="small"
            loading={savingDraftId === record.id}
          >
            存为报告
          </Button>
          <Popconfirm
            title="确定删除此草稿？"
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
          <InboxOutlined />
          <span>测试草稿箱</span>
        </Space>
      )}
      open={visible}
      onCancel={onClose}
      width={mainModal.width}
      style={mainModal.style}
      styles={{ body: mainModal.bodyStyle }}
      footer={[
        <Popconfirm
          key="clear"
          title="确定清空所有草稿？"
          description="此操作不可恢复"
          onConfirm={handleClearAll}
          disabled={drafts.length === 0}
        >
          <Button danger disabled={drafts.length === 0}>
            清空草稿箱
          </Button>
        </Popconfirm>,
        <Button key="close" type="primary" onClick={onClose}>
          关闭
        </Button>,
      ]}
    >
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        {drafts.length === 0 ? (
          <Empty
            description={
              <div>
                <div>暂无草稿</div>
                <div style={{ color: '#999', fontSize: 12, marginTop: 8 }}>
                  每次测试完成或中止后，数据会自动保存到这里
                </div>
              </div>
            }
          />
        ) : (
          <Table
            columns={columns}
            dataSource={drafts}
            rowKey="id"
            size="small"
            pagination={{ pageSize: mainModal.pageSize }}
            scroll={mainModal.tableScroll}
          />
        )}
      </Space>

      {/* 存为报告弹窗 */}
      <Modal
        title={saveModal.renderTitle('存为报告')}
        open={saveDraftModal.open}
        onCancel={() => {
          setSaveDraftModal({ open: false, draft: null });
          saveDraftForm.resetFields();
        }}
        onOk={() => saveDraftForm.submit()}
        confirmLoading={!!savingDraftId}
        width={saveModal.width}
        style={saveModal.style}
        styles={{ body: saveModal.bodyStyle }}
        destroyOnClose
      >
        <Form form={saveDraftForm} layout="vertical" onFinish={handleSaveDraftToReportSubmit}>
          <Form.Item
            name="name"
            label="报告名称"
            rules={[{ required: true, message: '请输入报告名称' }]}
          >
            <Input placeholder="例如：迭代测试-192.168.1.100" />
          </Form.Item>
          <Form.Item
            name="folderId"
            label="保存目录"
            rules={[{ required: true, message: '请选择保存目录' }]}
          >
            <TreeSelect
              treeData={buildFolderTreeOptions()}
              placeholder="请选择保存目录"
              treeDefaultExpandAll
              allowClear={false}
              style={{ width: '100%' }}
            />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea placeholder="可选：添加测试说明" rows={3} />
          </Form.Item>
        </Form>
      </Modal>
    </Modal>
  );
};

export default TestDraftManager;
