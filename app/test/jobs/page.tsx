'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Card,
  Table,
  Tag,
  Button,
  Space,
  Progress,
  Typography,
  Empty,
  Badge,
  Tooltip,
  Spin,
  message,
  Modal,
  Form,
  Input,
  TreeSelect,
  Popconfirm,
} from 'antd';
import {
  EyeOutlined,
  StopOutlined,
  DeleteOutlined,
  ReloadOutlined,
  ExperimentOutlined,
  ArrowLeftOutlined,
  PlayCircleOutlined,
  FileTextOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useTestJobStore, type Job } from '../../../src/stores/testJobStore';
import { useTestReportStore, type TestReport } from '../../../src/stores/testReportStore';
import useMaximizableModal from '../../../src/hooks/useMaximizableModal';

const { Title, Text } = Typography;

export default function JobListPage() {
  const router = useRouter();
  const { jobs, isLoading, fetchJobs, abortJob, resumeJob, deleteJob, batchDeleteJobs, deleteJobsByStatus } = useTestJobStore();
  const { addReport, buildFolderTreeOptions, getSelectedFolderId, fetchFolders } = useTestReportStore();
  const [refreshing, setRefreshing] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [saveModalJob, setSaveModalJob] = useState<Job | null>(null);
  const [saveLoading, setSaveLoading] = useState(false);
  const [saveForm] = Form.useForm();

  const saveModal = useMaximizableModal({ minWidth: 700 });

  useEffect(() => {
    // 列表页不需要完整日志和采样点，避免大任务撑爆内存
    fetchJobs({ includeLogs: false, includeDataPoints: false });
    // 自动刷新
    const interval = setInterval(() => {
      fetchJobs({ includeLogs: false, includeDataPoints: false });
    }, 3000);
    return () => clearInterval(interval);
  }, [fetchJobs]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchJobs({ includeLogs: false, includeDataPoints: false });
    setRefreshing(false);
  };

  const handleAbort = async (id: string) => {
    await abortJob(id);
    message.info('已发送中止请求');
  };

  const handleResume = async (id: string) => {
    await resumeJob(id);
    message.success('任务已恢复，将从当前迭代继续执行');
  };

  const handleDelete = async (id: string) => {
    await deleteJob(id);
    message.success('已删除任务');
  };

  const handleBatchDelete = async () => {
    if (selectedRowKeys.length === 0) {
      message.warning('请先选择要删除的任务');
      return;
    }
    const result = await batchDeleteJobs(selectedRowKeys as string[]);
    setSelectedRowKeys([]);
    if (result.deleted.length > 0) {
      message.success(`已删除 ${result.deleted.length} 个任务`);
    }
    if (result.failed.length > 0) {
      message.warning(`${result.failed.length} 个任务不存在`);
    }
  };

  const handleClearFailedJobs = async () => {
    const result = await deleteJobsByStatus(['error', 'aborted']);
    if (result.deleted.length > 0) {
      message.success(`已清空 ${result.deleted.length} 个失败任务`);
    } else {
      message.info('没有可清空的失败任务');
    }
  };

  const handleSaveReport = async (job: Job) => {
    setSaveModalJob(job);
    fetchFolders();
    saveForm.setFieldsValue({
      name: `${job.name} 报告`,
      description: '',
      folderId: getSelectedFolderId() || 'uncategorized',
    });
  };

  const handleSaveReportSubmit = async () => {
    if (!saveModalJob) return;
    const values = await saveForm.validateFields();
    setSaveLoading(true);
    try {
      const stages = saveModalJob.config.stages;
      const isPipeline = stages && stages.length > 0;
      if (isPipeline) {
        let savedCount = 0;
        for (const stage of stages.slice().sort((a, b) => a.order - b.order)) {
          const sr = saveModalJob.stageResults?.[stage.id];
          if (!sr || sr.results.length === 0) continue;
          await addReport({
            name: `${values.name} - ${stage.name}`,
            description: values.description,
            folderId: values.folderId,
            config: {
              host: saveModalJob.config.host,
              iterationParams: stage.iterationParams,
              adjustmentCommands: (stage.adjustmentCommands || []).map((cmd) => ({
                ...cmd,
                sessionId: cmd.sessionId ?? null,
              })),
            },
            results: sr.results as TestReport['results'],
            jobId: saveModalJob.id,
            stageId: stage.id,
            stageName: stage.name,
          });
          savedCount++;
        }
        if (savedCount > 0) {
          message.success(`已保存 ${savedCount} 个阶段报告`);
        } else {
          message.warning('没有可保存的阶段报告');
        }
      } else {
        if (saveModalJob.results.length === 0) {
          message.warning('没有可保存的结果');
          setSaveLoading(false);
          return;
        }
        await addReport({
          name: values.name,
          description: values.description,
          folderId: values.folderId,
          config: saveModalJob.config as TestReport['config'],
          results: saveModalJob.results as TestReport['results'],
          jobId: saveModalJob.id,
        });
        message.success('报告已保存');
      }
      setSaveModalJob(null);
      saveForm.resetFields();
    } catch (err) {
      console.error('[JobListPage] Save report failed:', err);
      message.error('保存报告失败: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSaveLoading(false);
    }
  };

  const getStatusTag = (status: Job['status']) => {
    switch (status) {
      case 'running':
        return <Badge status="processing" text="运行中" />;
      case 'pending':
        return <Badge status="warning" text="等待中" />;
      case 'completed':
        return <Badge status="success" text="已完成" />;
      case 'aborted':
        return <Badge status="default" text="已中止" />;
      case 'error':
        return <Badge status="error" text="出错" />;
      default:
        return <Badge status="default" text={status} />;
    }
  };

  const columns: ColumnsType<Job> = [
    {
      title: '任务名称',
      dataIndex: 'name',
      key: 'name',
      width: 220,
      render: (name, record) => (
        <Space direction="vertical" size={0}>
          <Text strong>{name}</Text>
          <Text type="secondary" style={{ fontSize: 11 }}>{record.id}</Text>
        </Space>
      ),
    },
    {
      title: '目标主机',
      dataIndex: ['config', 'host'],
      key: 'host',
      width: 140,
      render: (host) => <Tag color="blue">{host}</Tag>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status) => getStatusTag(status),
    },
    {
      title: '进度',
      key: 'progress',
      width: 200,
      render: (_, record) => {
        const { currentIteration, totalIterations, currentLabel } = record.progress;
        const percent = totalIterations > 0 ? Math.round((currentIteration / totalIterations) * 100) : 0;
        return (
          <Space direction="vertical" size={2} style={{ width: '100%' }}>
            <Progress
              percent={percent}
              size="small"
              status={record.status === 'error' ? 'exception' : record.status === 'running' ? 'active' : 'success'}
            />
            <Text type="secondary" style={{ fontSize: 11 }}>
              {currentIteration} / {totalIterations} {currentLabel ? `(${currentLabel})` : ''}
            </Text>
          </Space>
        );
      },
    },
    {
      title: '结果',
      key: 'results',
      width: 120,
      render: (_, record) => {
        const successCount = record.results.filter(r => r.status === 'success').length;
        const errorCount = record.results.filter(r => r.status === 'error').length;
        return (
          <Space>
            <Tag color="success">成功 {successCount}</Tag>
            {errorCount > 0 && <Tag color="error">失败 {errorCount}</Tag>}
          </Space>
        );
      },
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 170,
      render: (time) => new Date(time).toLocaleString(),
    },
    {
      title: '操作',
      key: 'action',
      width: 180,
      fixed: 'right',
      render: (_, record) => (
        <Space>
          <Tooltip title="查看详情">
            <Button
              type="primary"
              ghost
              size="small"
              icon={<EyeOutlined />}
              onClick={() => router.push(`/test/jobs/${record.id}`)}
            >
              查看
            </Button>
          </Tooltip>
          {record.status === 'aborted' && (
            <Tooltip title="恢复任务">
              <Button
                type="primary"
                size="small"
                icon={<PlayCircleOutlined />}
                onClick={() => handleResume(record.id)}
              >
                恢复
              </Button>
            </Tooltip>
          )}
          {(record.status === 'running' || record.status === 'pending') && (
            <Tooltip title="中止任务">
              <Button
                danger
                size="small"
                icon={<StopOutlined />}
                onClick={() => handleAbort(record.id)}
              >
                中止
              </Button>
            </Tooltip>
          )}
          {(record.status === 'completed' || record.status === 'aborted' || record.status === 'error') && record.results.length > 0 && (
            <Tooltip title="保存已跑完的结果为报告">
              <Button
                size="small"
                icon={<FileTextOutlined />}
                onClick={() => handleSaveReport(record)}
              >
                保存报告
              </Button>
            </Tooltip>
          )}
          {(record.status === 'completed' || record.status === 'error' || record.status === 'aborted') && (
            <Tooltip title="删除任务">
              <Button
                size="small"
                icon={<DeleteOutlined />}
                onClick={() => handleDelete(record.id)}
              >
                删除
              </Button>
            </Tooltip>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 16, height: '100%', overflow: 'auto' }}>
      <div style={{ marginBottom: 12 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => router.push('/test')}>
          返回测试页面
        </Button>
      </div>
      <Card
        title={
          <Space>
            <ExperimentOutlined />
            <Title level={4} style={{ margin: 0 }}>任务中心</Title>
          </Space>
        }
        extra={
          <Space>
            {selectedRowKeys.length > 0 && (
              <Popconfirm
                title={`确定删除选中的 ${selectedRowKeys.length} 个任务吗？相关数据（如采样点）也将被清理`}
                onConfirm={handleBatchDelete}
                okText="确定"
                cancelText="取消"
              >
                <Button danger size="small" icon={<DeleteOutlined />}>
                  删除选中 ({selectedRowKeys.length})
                </Button>
              </Popconfirm>
            )}
            <Popconfirm
              title="确定清空所有失败（error/aborted）的任务吗？相关数据（如采样点）也将被清理"
              onConfirm={handleClearFailedJobs}
              okText="确定"
              cancelText="取消"
            >
              <Button size="small" danger icon={<DeleteOutlined />}>
                清空失败任务
              </Button>
            </Popconfirm>
            <Button
              icon={<ReloadOutlined spin={refreshing} />}
              onClick={handleRefresh}
              loading={refreshing}
            >
              刷新
            </Button>
          </Space>
        }
      >
        <Spin spinning={isLoading && jobs.length === 0}>
          {jobs.length === 0 ? (
            <Empty description="暂无任务" />
          ) : (
            <Table
              columns={columns}
              dataSource={jobs}
              rowKey="id"
              rowSelection={{
                selectedRowKeys,
                onChange: (keys) => setSelectedRowKeys(keys),
              }}
              pagination={{ pageSize: 10 }}
              scroll={{ x: 1000 }}
              size="small"
            />
          )}
        </Spin>
      </Card>

      <Modal
        title={saveModal.renderTitle('保存测试报告')}
        open={!!saveModalJob}
        onCancel={() => {
          setSaveModalJob(null);
          saveForm.resetFields();
        }}
        onOk={handleSaveReportSubmit}
        confirmLoading={saveLoading}
        width={saveModal.width}
        style={saveModal.style}
        styles={{ body: saveModal.bodyStyle }}
        destroyOnClose
      >
        <Form form={saveForm} layout="vertical">
          <Form.Item
            name="name"
            label="报告名称"
            rules={[{ required: true, message: '请输入报告名称' }]}
          >
            <Input placeholder="例如：功耗迭代测试报告" />
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
    </div>
  );
}
