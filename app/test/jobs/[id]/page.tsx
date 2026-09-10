'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  Card,
  Button,
  Space,
  Tag,
  Progress,
  Typography,
  Descriptions,
  Table,
  Badge,
  Spin,
  message,
  Row,
  Col,
  Form,
  Input,
  Modal,
  TreeSelect,
} from 'antd';
import {
  ArrowLeftOutlined,
  StopOutlined,
  PlayCircleOutlined,
  ExperimentOutlined,
  DesktopOutlined,
  CodeOutlined,
  LineChartOutlined,
  SyncOutlined,
  SaveOutlined,
} from '@ant-design/icons';
import { useTestJobStore, type Job } from '../../../../src/stores/testJobStore';
import { useTestReportStore } from '../../../../src/stores/testReportStore';
import useMaximizableModal from '../../../../src/hooks/useMaximizableModal';
import ShellTerminal from '../../../../src/components/test/ShellTerminal';
import JobResultDisplay from '../../../../src/components/test/JobResultDisplay';

const { Title, Text } = Typography;

export default function JobDetailPage() {
  const params = useParams();
  const router = useRouter();
  const jobId = params.id as string;
  const { getJobById, abortJob, resumeJob, jobs } = useTestJobStore();

  const [job, setJob] = useState<Job | null>(null);
  const jobRef = useRef<Job | null>(job);
  const [isShellVisible, setIsShellVisible] = useState(true);
  const [loading, setLoading] = useState(true);
  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
  const [saveReportForm] = Form.useForm();
  const saveModal = useMaximizableModal({ minWidth: 700 });
  const prevStatusRef = useRef<string | null>(null);
  const processedLogCountRef = useRef<number>(0);
  const [shellOutput, setShellOutput] = useState<string[]>([]);

  const refetchJob = async () => {
    try {
      const res = await fetch(`/api/test/jobs/${jobId}?includeLogs=true&includeDataPoints=false`);
      const data = await res.json();
      if (data.success && data.job) {
        setJob(data.job);
      }
    } catch (err) {
      console.error('Failed to refetch job:', err);
    }
  };

  useEffect(() => {
    jobRef.current = job;
  }, [job]);

  const { addReport, buildFolderTreeOptions, getSelectedFolderId, fetchFolders } = useTestReportStore();

  // 初始加载 + 轮询
  useEffect(() => {
    if (!jobId) return;

    let interval: NodeJS.Timeout | null = null;

    const isTerminal = (status: Job['status']) =>
      status === 'completed' || status === 'error' || status === 'aborted';

    const poll = async () => {
      try {
        const res = await fetch(
          `/api/test/jobs/${jobId}?includeLogs=true&includeDataPoints=false`
        );
        const data = await res.json();
        if (!data.success) return;

        const fetchedJob = data.job as Job;
        setJob(fetchedJob);
        setLoading(false);

        // 处理新增日志并推送到 shell 输出
        if (fetchedJob.logs && fetchedJob.logs.length > 0) {
          const newLogs = fetchedJob.logs.slice(processedLogCountRef.current);
          if (newLogs.length > 0) {
            const shellOutputs: string[] = [];
            for (const log of newLogs) {
              const timeStr = new Date(log.timestamp).toLocaleTimeString();
              switch (log.type) {
                case 'start':
                case 'info':
                  shellOutputs.push(`[${timeStr}] ${log.message}`);
                  break;
                case 'stdout':
                  shellOutputs.push(`[远程主机] ${log.message}`);
                  break;
                case 'stderr':
                  shellOutputs.push(`[远程主机-错误] ${log.message}`);
                  break;
                case 'monitor_sample':
                  shellOutputs.push(`[${timeStr}] [监控] ${log.message}`);
                  break;
                case 'iteration_start':
                  shellOutputs.push(`\n[${timeStr}] >>> ${log.message}`);
                  break;
                case 'iteration_end':
                  shellOutputs.push(`[${timeStr}] <<< ${log.message}`);
                  break;
                case 'iteration_error':
                  shellOutputs.push(`[${timeStr}] ${log.message}`);
                  break;
                case 'complete':
                  shellOutputs.push(`\n[${timeStr}] ====== ${log.message} ======`);
                  break;
                case 'error':
                  shellOutputs.push(`[${timeStr}] 错误: ${log.message}`);
                  break;
                default:
                  shellOutputs.push(`[${timeStr}] ${log.message}`);
                  break;
              }
            }
            if (shellOutputs.length > 0) {
              setShellOutput(prev => [...prev, ...shellOutputs]);
            }
            processedLogCountRef.current = fetchedJob.logs.length;
          }
        }

        // 状态变化提示
        if (prevStatusRef.current !== fetchedJob.status) {
          prevStatusRef.current = fetchedJob.status;
          if (fetchedJob.status === 'completed') {
            message.success('任务已完成');
          } else if (fetchedJob.status === 'error') {
            message.error(fetchedJob.errorMessage || '任务执行出错');
          } else if (fetchedJob.status === 'aborted') {
            message.info('任务已中止');
          }
        }

        // 任务到达终态时停止轮询，避免持续拉取大对象
        if (isTerminal(fetchedJob.status) && interval) {
          clearInterval(interval);
          interval = null;
        }
      } catch (err) {
        console.error('轮询任务失败:', err);
      }
    };

    poll();
    interval = setInterval(poll, 1000);
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [jobId]);

  // 从全局 store 同步（当其他页面操作任务时），按 updatedAt 判断是否需要更新
  // 使用 ref 避免在每次 poll 更新 job 时都触发该 effect，减少渲染抖动
  useEffect(() => {
    const storeJob = getJobById(jobId);
    const currentJob = jobRef.current;
    if (storeJob && (!currentJob || new Date(storeJob.updatedAt) > new Date(currentJob.updatedAt))) {
      setJob(storeJob);
    }
  }, [jobId, getJobById, jobs]);

  const handleAbort = async () => {
    if (!job) return;
    await abortJob(job.id);
    message.info('已发送中止请求');
  };

  const handleResume = async () => {
    if (!job) return;
    await resumeJob(job.id);
    message.success('任务已恢复，将从当前迭代继续执行');
  };

  const handleSaveReport = async () => {
    if (!job) return;
    const stages = job.config.stages;
    const isPipeline = stages && stages.length > 0;
    if (isPipeline) {
      const hasStageResults = job.stageResults && Object.values(job.stageResults).some(sr => sr.results.length > 0);
      if (!hasStageResults) return;
    } else {
      if (job.results.length === 0) return;
    }
    setIsSaveModalOpen(true);
    fetchFolders();
    saveReportForm.setFieldsValue({
      name: `${job.name} 报告`,
      folderId: getSelectedFolderId() || 'uncategorized',
    });
  };

  const doSaveReport = async (values: { name: string; description?: string; folderId: string }) => {
    if (!job) return;
    try {
      const stages = job.config.stages;
      const isPipeline = stages && stages.length > 0;
      if (isPipeline) {
        let savedCount = 0;
        for (const stage of stages.slice().sort((a, b) => a.order - b.order)) {
          const sr = job.stageResults?.[stage.id];
          if (!sr || sr.results.length === 0) continue;
          await addReport({
            name: `${values.name} - ${stage.name}`,
            description: values.description,
            folderId: values.folderId,
            config: {
              host: job.config.host,
              iterationParams: stage.iterationParams,
              adjustmentCommands: (stage.adjustmentCommands || []).map((cmd) => ({
                ...cmd,
                sessionId: cmd.sessionId ?? null,
              })),
            },
            results: sr.results as any,
            jobId: job.id,
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
        if (job.results.length === 0) {
          message.warning('没有可保存的结果');
          return;
        }
        await addReport({
          name: values.name,
          description: values.description,
          folderId: values.folderId,
          config: {
            host: job.config.host,
            iterationParams: job.config.iterationParams,
            adjustmentCommands: (job.config.adjustmentCommands || []).map((cmd) => ({
              ...cmd,
              sessionId: cmd.sessionId ?? null,
            })),
          },
          results: job.results as any,
          jobId: job.id,
        });
        message.success('报告已保存');
      }
      setIsSaveModalOpen(false);
      saveReportForm.resetFields();
    } catch (err) {
      console.error('[JobDetailPage] Save report failed:', err);
      message.error('保存报告失败: ' + (err instanceof Error ? err.message : String(err)));
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

  // 必须在所有早期 return 之前调用 Hook
  const percent = useMemo(() => {
    if (!job) return 0;
    return job.progress.totalIterations > 0
      ? Math.round((job.progress.currentIteration / job.progress.totalIterations) * 100)
      : 0;
  }, [job]);

  // 构造兼容 ShellTerminal 的 tab 对象（ShellTerminal 实际从 store 读取 shellOutput，这里无需包含 logs）
  const mockTab = useMemo(() => {
    if (!job) return null;
    return {
      id: job.id,
      name: job.name,
      sshConfig: {
        host: job.config.host,
        port: job.config.port,
        username: job.config.username,
        password: '',
      },
      isSSHConnected: true,
      isTestingConnection: false,
      testStatus: job.status === 'running' || job.status === 'pending' ? 'testing' :
                  job.status === 'completed' ? 'completed' :
                  job.status === 'error' ? 'error' : 'idle',
      testError: job.errorMessage || null,
      powerTestConfig: {
        iterationParams: job.config.iterationParams,
        adjustmentCommands: job.config.adjustmentCommands.map(cmd => ({
          id: cmd.id,
          name: cmd.name,
          target: cmd.target,
          sessionId: null,
          command: cmd.command,
          parameterName: cmd.parameterName,
          paramId: '',
        })),
        packageFile: null,
        envVars: job.config.envVars || [],
        monitorCommands: job.config.monitorCommands?.map(cmd => ({
          id: cmd.id,
          name: cmd.name,
          command: cmd.command,
          target: cmd.target,
          sessionId: null,
          interval: cmd.interval,
          enabled: cmd.enabled,
          mode: cmd.mode,
          columns: cmd.columns,
          jumpThreshold: cmd.jumpThreshold,
          jumpThresholdType: cmd.jumpThresholdType,
          skipJumps: cmd.skipJumps,
          skipFirst: cmd.skipFirst,
          takeLast: cmd.takeLast,
          skipLast: cmd.skipLast,
        })) || [],
        globalBmcSessionId: job.config.globalBmcSessionId || null,
      },
      testResults: job.results.map(r => ({
        iteration: r.iteration,
        power: r.power,
        score: r.score,
        status: r.status,
        message: r.message,
        timestamp: r.timestamp,
        iterationValues: r.iterationValues,
        iterationLabel: r.iterationLabel,
        monitorResults: r.monitorResults,
      })),
      currentIteration: job.progress.currentIteration,
      isRunningTest: job.status === 'running' || job.status === 'pending',
    };
  }, [job]);

  if (loading || !job || !mockTab) {
    return (
      <div style={{ padding: 24, height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Spin size="large" tip="加载任务详情..." />
      </div>
    );
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* 顶部信息栏 */}
      <div style={{
        padding: '12px 16px',
        background: '#f5f5f5',
        borderBottom: '1px solid #d9d9d9',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={() => router.push('/test')}>
            返回测试页面
          </Button>
          <ExperimentOutlined />
          <Title level={5} style={{ margin: 0 }}>{job.name}</Title>
          {getStatusTag(job.status)}
          <Tag color="blue">{job.config.host}</Tag>
        </Space>
        <Space>
          <Text type="secondary" style={{ fontSize: 12 }}>
            进度: {job.progress.currentIteration} / {job.progress.totalIterations}
          </Text>
          {job.results.length > 0 && job.status !== 'running' && job.status !== 'pending' && (
            <Button size="small" icon={<SaveOutlined />} onClick={handleSaveReport}>
              保存到报告
            </Button>
          )}
          {job.status === 'aborted' && (
            <Button type="primary" size="small" icon={<PlayCircleOutlined />} onClick={handleResume}>
              恢复
            </Button>
          )}
          {(job.status === 'running' || job.status === 'pending') && (
            <Button danger size="small" icon={<StopOutlined />} onClick={handleAbort}>
              中止
            </Button>
          )}
        </Space>
      </div>

      {/* 进度条 */}
      <div style={{ padding: '8px 16px', background: '#fff', borderBottom: '1px solid #f0f0f0' }}>
        <Progress
          percent={percent}
          size="small"
          status={job.status === 'error' ? 'exception' : job.status === 'running' ? 'active' : 'success'}
          format={() => `${job.progress.currentIteration} / ${job.progress.totalIterations}`}
        />
        {job.progress.currentLabel && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            当前参数: {job.progress.currentLabel}
          </Text>
        )}
      </div>

      {/* 主体内容 */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* 左侧：配置和结果 */}
        <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
          <Row gutter={[16, 16]}>
            <Col span={24}>
              <Card title={<Space><DesktopOutlined />SSH 连接信息</Space>} size="small">
                <Descriptions size="small" column={2} bordered>
                  <Descriptions.Item label="主机">{job.config.host}</Descriptions.Item>
                  <Descriptions.Item label="端口">{job.config.port || 22}</Descriptions.Item>
                  <Descriptions.Item label="用户名">{job.config.username}</Descriptions.Item>
                  <Descriptions.Item label="迭代次数">{job.progress.totalIterations}</Descriptions.Item>
                </Descriptions>
              </Card>
            </Col>

            <Col span={24}>
              <Card title={<Space><CodeOutlined />迭代参数</Space>} size="small">
                <Table
                  dataSource={job.config.iterationParams}
                  rowKey="id"
                  size="small"
                  pagination={false}
                  columns={[
                    { title: '名称', dataIndex: 'name', key: 'name' },
                    { title: '模式', dataIndex: 'mode', key: 'mode', render: (v) => <Tag>{v === 'custom' ? '自定义' : '范围'}</Tag> },
                    { title: '配置', key: 'config', render: (_: unknown, record: any) => {
                      if (record.mode === 'custom') {
                        return <span>{record.values?.filter((v: string) => v.trim() !== '').join(', ') || '-'}</span>;
                      }
                      return <span>起始 {record.start} ~ 终止 {record.end}，步长 {record.step}</span>;
                    }},
                  ]}
                />
              </Card>
            </Col>

            {job.config.adjustmentCommands && job.config.adjustmentCommands.length > 0 && (
              <Col span={24}>
                <Card title={<Space><CodeOutlined />调整命令</Space>} size="small">
                  <Table
                    dataSource={job.config.adjustmentCommands}
                    rowKey="id"
                    size="small"
                    pagination={false}
                    columns={[
                      { title: '名称', dataIndex: 'name', key: 'name' },
                      { title: '目标', dataIndex: 'target', key: 'target', render: (v) => <Tag>{v}</Tag> },
                      { title: '关联参数', dataIndex: 'parameterName', key: 'parameterName' },
                      {
                        title: '命令',
                        dataIndex: 'command',
                        key: 'command',
                        ellipsis: true,
                        render: (cmd) => <code style={{ fontSize: 11 }}>{cmd}</code>,
                      },
                    ]}
                  />
                </Card>
              </Col>
            )}

            {job.config.monitorCommands && job.config.monitorCommands.length > 0 && (
              <Col span={24}>
                <Card title={<Space><SyncOutlined />监控命令</Space>} size="small">
                  <Table
                    dataSource={job.config.monitorCommands.filter(c => c.enabled)}
                    rowKey="id"
                    size="small"
                    pagination={false}
                    columns={[
                      { title: '名称', dataIndex: 'name', key: 'name' },
                      { title: '模式', dataIndex: 'mode', key: 'mode', render: (v) => <Tag>{v === 'list' ? '列表' : '单值'}</Tag> },
                      {
                        title: '列名',
                        key: 'columns',
                        render: (_: unknown, record: any) => record.mode === 'list' && record.columns?.length > 0
                          ? <span style={{ fontSize: 11 }}>{record.columns.join(', ')}</span>
                          : '-',
                      },
                      { title: '目标', dataIndex: 'target', key: 'target', render: (v) => <Tag>{v}</Tag> },
                      { title: '间隔(秒)', dataIndex: 'interval', key: 'interval' },
                      {
                        title: '命令',
                        dataIndex: 'command',
                        key: 'command',
                        ellipsis: true,
                        render: (cmd) => <code style={{ fontSize: 11 }}>{cmd}</code>,
                      },
                    ]}
                  />
                </Card>
              </Col>
            )}

            {job.results.length > 0 && (
              <Col span={24}>
                <Card title={<Space><LineChartOutlined />测试结果</Space>} size="small">
                  <JobResultDisplay results={job.results} config={job.config} jobId={job.id} onAverageRangeApplied={refetchJob} />
                </Card>
              </Col>
            )}
          </Row>
        </div>

        {/* 右侧：Shell 终端 */}
        <ShellTerminal
          key={job.id}
          tab={mockTab as any}
          isVisible={isShellVisible}
          onToggle={() => setIsShellVisible(!isShellVisible)}
          externalShellOutput={shellOutput}
        />
      </div>

      {/* 保存报告弹窗 */}
      <Modal
        title={saveModal.renderTitle('保存测试报告')}
        open={isSaveModalOpen}
        onCancel={() => setIsSaveModalOpen(false)}
        onOk={() => saveReportForm.submit()}
        width={saveModal.width}
        style={saveModal.style}
        styles={{ body: saveModal.bodyStyle }}
      >
        <Form form={saveReportForm} layout="vertical" onFinish={doSaveReport}>
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
          <Form.Item>
            <div style={{ color: '#666' }}>
              <div>测试主机: {job?.config.host}</div>
              <div>数据点: {job?.results.length} 个</div>
              <div>迭代参数: {job?.config.iterationParams.map((p) => p.name).join(', ')}</div>
            </div>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
