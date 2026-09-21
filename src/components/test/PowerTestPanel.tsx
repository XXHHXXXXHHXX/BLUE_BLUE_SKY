'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  Card,
  Form,
  InputNumber,
  Button,
  Upload,
  Space,
  Tag,
  message,
  Row,
  Col,
  Tooltip,
  Alert,
  Divider,
  Table,
  Progress,
  Badge,
  Select,
  Radio,
  Descriptions,
  Input,
  Empty,
  Modal,
  Switch,
  Tabs,
  Dropdown,
  TreeSelect,
  Menu,
} from 'antd';
import {
  PlayCircleOutlined,
  QuestionCircleOutlined,
  FileZipOutlined,
  CheckCircleOutlined,
  StopOutlined,
  SyncOutlined,
  DatabaseOutlined,
  CloudUploadOutlined,
  UploadOutlined,
  DownloadOutlined,
  SearchOutlined,
  AppstoreOutlined,
  SaveOutlined,
  LineChartOutlined,
  FileTextOutlined,
  MinusCircleOutlined,
  PlusOutlined,
  SafetyOutlined,
  DesktopOutlined,
  SettingOutlined,
  DeleteOutlined,
  InboxOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
  ReloadOutlined,
  DownOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons';
import type { UploadFile, UploadProps } from 'antd/es/upload';
import type { ColumnsType } from 'antd/es/table';
import ReactECharts from 'echarts-for-react';
import { bindYAxisWheelZoom } from '../../utils/chartWheelZoom';
import { getScrollLegend, tooltipBase, formatAxisTooltip } from '../../utils/monitorChartFormat';
import { useTestStore, type TestTab, type TestResult, type IterationParameter, type AdjustmentCommand, type LogMonitorConfig, type PipelineStage, type MonitorCommand } from '../../stores/testStore';
import { useTestPackageStore, formatFileSize } from '../../stores/testPackageStore';
import { useTestReportStore, generateChartOption } from '../../stores/testReportStore';
import { useTestIterationConfigStore } from '../../stores/testIterationConfigStore';
import { useBMCSessionStore } from '../../stores/bmcSessionStore';
import { useTestDraftStore } from '../../stores/testDraftStore';
import { useTestJobStore, type Job, type PipelineStage as ServerPipelineStage } from '../../stores/testJobStore';
import TestPackageLibrary from './TestPackageLibrary';
import TestReportManager from './TestReportManager';
import TestDraftManager from './TestDraftManager';
import BMCConfigPanel from '../monitor/BMCConfigPanel';
import MonitorConfigPanel from './MonitorConfigPanel';
import useMaximizableModal from '../../hooks/useMaximizableModal';

const { Dragger } = Upload;
const { Option } = Select;

type UploadMode = 'upload' | 'library';

interface PowerTestPanelProps {
  tab: TestTab;
}

/** 计算笛卡尔积总迭代次数（支持从高到低和自定义列表） */
const calculateTotalIterations = (params: IterationParameter[]): number => {
  if (params.length === 0) return 0;
  return params.reduce((total, p) => {
    if (p.mode === 'custom') {
      const count = (p.values || []).filter(v => v.trim() !== '').length;
      return total * Math.max(count, 0);
    }
    if (p.step <= 0) return 0;
    const diff = Math.abs(p.end - p.start);
    const count = Math.floor(diff / p.step) + 1;
    return total * count;
  }, 1);
};

/** 生成迭代标签 */
const generateIterationLabel = (values: Record<string, string>): string => {
  return Object.entries(values).map(([k, v]) => `${k}=${v}`).join(', ');
};

const PowerTestPanel: React.FC<PowerTestPanelProps> = ({ tab }) => {
  const {
    addShellOutput,
    appendShellOutput,
    setTestStatus,
    setPowerTestConfig,
    addTestResult,
    clearTestResults,
    setCurrentIteration,
    setIsRunningTest,
    setHeartbeatConfig,
    setAlertWebhook,
    setLogMonitorConfig,
    setGlobalBmcSessionId,
    setPipelineMode,
    setPipelineStages,
    addPipelineStage,
    removePipelineStage,
    updatePipelineStage,
    setPipelineCurrentStageIndex,
  } = useTestStore();

  const { searchPackages, getPackageById, getPackageFile, fetchPackages } = useTestPackageStore();
  const { addReport, buildFolderTreeOptions, getSelectedFolderId, fetchFolders } = useTestReportStore();
  const { addDraft } = useTestDraftStore();
  const { startJob, abortJob } = useTestJobStore();
  const { configs: savedConfigs, fetchConfigs, addConfig, removeConfig } = useTestIterationConfigStore();
  const { sessions: bmcSessions } = useBMCSessionStore();

  const [fileList, setFileList] = useState<UploadFile[]>([]);
  // abortController 已废弃，后台任务通过 /api/test/jobs/[id]/abort 中止
  const [uploadMode, setUploadMode] = useState<UploadMode>('upload');
  const [isLoadingPackage, setIsLoadingPackage] = useState(false);
  const [isLibraryOpen, setIsLibraryOpen] = useState(false);
  const [isReportManagerOpen, setIsReportManagerOpen] = useState(false);
  const [isChartModalOpen, setIsChartModalOpen] = useState(false);
  const [saveReportForm] = Form.useForm();
  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
  const [packageSearchKeyword, setPackageSearchKeyword] = useState('');
  const [selectedLibraryPackageId, setSelectedLibraryPackageId] = useState<string | null>(null);
  const [isBMCConfigOpen, setIsBMCConfigOpen] = useState(false);
  const [editingStageMonitor, setEditingStageMonitor] = useState<{
    stageId: string;
    stageName: string;
    commands: MonitorCommand[];
  } | null>(null);
  const [saveConfigForm] = Form.useForm();
  const [isSaveConfigModalOpen, setIsSaveConfigModalOpen] = useState(false);
  const [selectedConfigId, setSelectedConfigId] = useState<string | null>(null);
  const [isDraftManagerOpen, setIsDraftManagerOpen] = useState(false);
  const [monitorDetailModal, setMonitorDetailModal] = useState<{
    open: boolean;
    commandId: string;
    commandName: string;
    iteration: number;
    power: number;
    iterationLabel: string;
    dataPoints: Array<{ timestamp: string; value: number; raw: string }>;
  } | null>(null);

  const chartModal = useMaximizableModal({ minWidth: 1000 });
  const saveReportModal = useMaximizableModal({ minWidth: 700 });
  const saveConfigModal = useMaximizableModal({ minWidth: 700 });
  const detailModal = useMaximizableModal({ minWidth: 1100, minPageSize: 100, maxPageSize: 200 });
  const stageMonitorModal = useMaximizableModal({ minWidth: 1000 });

  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [activeJob, setActiveJob] = useState<Job | null>(null);
  const lastJobIdRef = useRef<string | null>(null);
  // 同步 activeJobId 到 ref，供 visibilitychange 等事件回调读取最新值，避免闭包捕获旧值
  const activeJobIdRef = useRef<string | null>(null);

  // 保存报告弹窗打开时拉取目录，并默认选中最近使用的目录
  useEffect(() => {
    if (isSaveModalOpen) {
      fetchFolders();
      saveReportForm.setFieldsValue({
        folderId: getSelectedFolderId() || 'uncategorized',
      });
    }
  }, [isSaveModalOpen, fetchFolders, saveReportForm, getSelectedFolderId]);
  const processedLogCountRef = useRef(0);
  const processedResultCountRef = useRef(0);
  const prevJobStatusRef = useRef<string | null>(null);
  const isAbortingRef = useRef(false);
  // 指向轮询函数的引用，供页面重新可见时立即触发一次状态同步
  const pollJobStatusRef = useRef<(() => Promise<void>) | null>(null);

  // 加载已保存的配置列表
  useEffect(() => {
    fetchConfigs('iteration');
  }, [fetchConfigs]);

  // 预加载用例包库数据，避免页面刷新后下拉列表为空
  useEffect(() => {
    fetchPackages();
  }, [fetchPackages]);

  // 自动保存草稿：当测试结束（完成/中止/出错）且有结果数据时
  const prevIsRunningRef = useRef(tab.isRunningTest);
  useEffect(() => {
    const wasRunning = prevIsRunningRef.current;
    const isRunning = tab.isRunningTest;
    prevIsRunningRef.current = isRunning;

    // 从运行中变为非运行状态，且有测试结果
    if (wasRunning && !isRunning && tab.testResults.length > 0) {
      const status: 'completed' | 'aborted' | 'error' =
        tab.testStatus === 'completed' ? 'completed' :
        tab.testStatus === 'error' ? 'error' : 'aborted';

      addDraft({
        name: `${tab.name} - ${new Date().toLocaleString()}`,
        sourceTabName: tab.name,
        host: tab.sshConfig.host,
        config: {
          iterationParams: tab.powerTestConfig.iterationParams,
          adjustmentCommands: tab.powerTestConfig.adjustmentCommands,
          monitorCommands: tab.powerTestConfig.monitorCommands,
          envVars: tab.powerTestConfig.envVars,
          logMonitorConfig: tab.powerTestConfig.logMonitorConfig,
          globalBmcSessionId: tab.powerTestConfig.globalBmcSessionId,
        },
        results: tab.testResults,
        status,
      });

      if (status === 'aborted') {
        message.info('测试已中止，数据已自动保存到草稿箱');
      } else if (status === 'error') {
        message.warning('测试出错，数据已自动保存到草稿箱');
      } else {
        message.success('测试完成，数据已自动保存到草稿箱');
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.isRunningTest, tab.testStatus, tab.testResults.length]);

  // 切换标签页时重置本组件的运行时状态，避免新标签页继承旧任务/临时配置
  useEffect(() => {
    setFileList([]);
    setUploadMode('upload');
    setIsLoadingPackage(false);
    setIsLibraryOpen(false);
    setIsReportManagerOpen(false);
    setIsChartModalOpen(false);
    setIsSaveModalOpen(false);
    setPackageSearchKeyword('');
    setSelectedLibraryPackageId(null);
    setIsBMCConfigOpen(false);
    setEditingStageMonitor(null);
    setIsSaveConfigModalOpen(false);
    setSelectedConfigId(null);
    setIsDraftManagerOpen(false);
    setMonitorDetailModal(null);
    setActiveJobId(null);
    setActiveJob(null);
    lastJobIdRef.current = null;
    processedLogCountRef.current = 0;
    processedResultCountRef.current = 0;
    prevJobStatusRef.current = null;
    isAbortingRef.current = false;
    prevIsRunningRef.current = false;
    saveReportForm.resetFields();
    saveConfigForm.resetFields();
  }, [tab.id, saveReportForm, saveConfigForm]);

  // 保持 activeJobIdRef 与 activeJobId 同步，避免事件回调闭包捕获过期值
  useEffect(() => {
    activeJobIdRef.current = activeJobId;
  }, [activeJobId]);

  // 页面加载时：检测当前主机是否有运行中的后台任务，自动恢复查看
  useEffect(() => {
    const restoreRunningJob = async () => {
      try {
        const res = await fetch('/api/test/jobs');
        const data = await res.json();
        if (!data.success) return;
        const runningJob = data.jobs.find(
          (j: Job) =>
            j.config.host === tab.sshConfig.host &&
            (j.status === 'running' || j.status === 'pending')
        );
        if (runningJob) {
          // 已关联该任务且正在轮询时，避免重复恢复日志/结果导致重复输出
          if (activeJobIdRef.current === runningJob.id && tab.isRunningTest) {
            return;
          }
          setActiveJobId(runningJob.id);
          setIsRunningTest(tab.id, true);
          setTestStatus(tab.id, 'testing');
          setCurrentIteration(tab.id, runningJob.progress.currentIteration);
          // 恢复已有结果
          for (const r of runningJob.results) {
            addTestResult(tab.id, {
              iteration: r.iteration,
              power: r.power,
              score: r.score,
              status: r.status,
              message: r.message,
              timestamp: r.timestamp,
              iterationValues: r.iterationValues,
              iterationLabel: r.iterationLabel,
              monitorResults: r.monitorResults,
              logArchivePath: r.logArchivePath,
              stageId: r.stageId,
              stageName: r.stageName,
            });
          }
          processedResultCountRef.current = runningJob.results.length;
          // 恢复日志输出（简略恢复最近 50 条避免刷屏）
          const recentLogs = runningJob.logs.slice(-50);
          const restoreOutputs: string[] = [];
          for (const log of recentLogs) {
            const timeStr = new Date(log.timestamp).toLocaleTimeString();
            switch (log.type) {
              case 'stdout':
                restoreOutputs.push(`[远程主机] ${log.message}`);
                break;
              case 'stderr':
                restoreOutputs.push(`[远程主机-错误] ${log.message}`);
                break;
              default:
                restoreOutputs.push(`[${timeStr}] ${log.message}`);
                break;
            }
          }
          if (restoreOutputs.length > 0) {
            appendShellOutput(tab.id, restoreOutputs);
          }
          processedLogCountRef.current = runningJob.logs.length;
          prevJobStatusRef.current = runningJob.status;
          addShellOutput(tab.id, `[${new Date().toLocaleTimeString()}] 已恢复关联到运行中的后台任务 [${runningJob.id}]`);
        } else if (activeJobIdRef.current || tab.isRunningTest) {
          // 当前主机没有运行中的后台任务，但标签页仍被标记为运行中：
          // 说明任务已在页面隐藏/离开期间结束，主动同步清理运行状态，避免一直显示“运行中”
          const prevJob = lastJobIdRef.current
            ? data.jobs.find((j: Job) => j.id === lastJobIdRef.current)
            : undefined;
          let finalStatus: TestTab['testStatus'] = tab.testResults.length > 0 ? 'completed' : 'idle';
          if (prevJob) {
            if (prevJob.status === 'error') {
              finalStatus = 'error';
            } else if (prevJob.status === 'aborted' || prevJob.status === 'completed') {
              finalStatus = 'completed';
            }
          }
          setTestStatus(tab.id, finalStatus);
          setIsRunningTest(tab.id, false);
          setActiveJobId(null);
          setActiveJob(null);
          prevJobStatusRef.current = null;
          isAbortingRef.current = false;
          if (activeJobIdRef.current) {
            addShellOutput(tab.id, `[${new Date().toLocaleTimeString()}] 后台任务已结束，运行状态已同步`);
          }
        }
      } catch (err) {
        console.error('恢复运行中任务失败:', err);
      }
    };
    restoreRunningJob();

    // 监听页面可见性变化：页面重新可见时，若有活跃轮询则立即同步一次状态
    //（浏览器在后台标签页会节流 setInterval，导致返回时状态更新滞后）；
    // 若没有活跃轮询，则重新检测当前主机是否有运行中的后台任务
    const handleVisibilityChange = () => {
      if (document.hidden) return;
      if (activeJobIdRef.current) {
        pollJobStatusRef.current?.();
      } else {
        restoreRunningJob();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id, tab.sshConfig.host]);

  // 轮询活跃任务状态
  useEffect(() => {
    if (!activeJobId) return;

    const poll = async () => {
      try {
        const res = await fetch(`/api/test/jobs/${activeJobId}`);
        const data = await res.json();
        if (!data.success) return;

        const job = data.job as Job;
        setActiveJob(job);

        // 处理新增日志（批量添加，减少渲染次数）
        const newLogs = job.logs.slice(processedLogCountRef.current);
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
                {
                  // 直接从 store 读取最新状态，避免闭包捕获旧值
                  const currentTab = useTestStore.getState().tabs.find((t) => t.id === tab.id);
                  if (!currentTab?.muteMonitorOutput) {
                    shellOutputs.push(`[${timeStr}] [监控] ${log.message}`);
                  }
                }
                break;
              case 'iteration_start':
                setCurrentIteration(tab.id, job.progress.currentIteration);
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
            appendShellOutput(tab.id, shellOutputs);
          }
          processedLogCountRef.current = job.logs.length;
        }

        // 同步流水线当前阶段和各阶段状态
        if (tab.pipelineMode && job.config.currentStageIndex !== undefined) {
          setPipelineCurrentStageIndex(tab.id, job.config.currentStageIndex);
          if (job.stageResults) {
            for (const sr of Object.values(job.stageResults)) {
              updatePipelineStage(tab.id, sr.stageId, { status: sr.status });
            }
          }
        }

        // 处理新增结果
        const newResults = job.results.slice(processedResultCountRef.current);
        for (const r of newResults) {
          addTestResult(tab.id, {
            iteration: r.iteration,
            power: r.power,
            score: r.score,
            status: r.status,
            message: r.message,
            timestamp: r.timestamp,
            iterationValues: r.iterationValues,
            iterationLabel: r.iterationLabel,
            monitorResults: r.monitorResults,
            logArchivePath: r.logArchivePath,
            stageId: r.stageId,
            stageName: r.stageName,
          });
        }
        processedResultCountRef.current = job.results.length;

        // 处理状态变化
        if (prevJobStatusRef.current !== job.status) {
          prevJobStatusRef.current = job.status;
          if (job.status === 'completed') {
            message.success('迭代测试完成');
            setTestStatus(tab.id, 'completed');
            setIsRunningTest(tab.id, false);
            setActiveJobId(null);
            isAbortingRef.current = false;
            addShellOutput(tab.id, `[${new Date().toLocaleTimeString()}] 任务已完成`);
          } else if (job.status === 'error') {
            message.error(job.errorMessage || '测试执行出错');
            setTestStatus(tab.id, 'error');
            setIsRunningTest(tab.id, false);
            setActiveJobId(null);
            isAbortingRef.current = false;
            addShellOutput(tab.id, `[${new Date().toLocaleTimeString()}] 任务执行出错: ${job.errorMessage || '未知错误'}`);
          } else if (job.status === 'aborted') {
            message.info('测试已中止');
            setIsRunningTest(tab.id, false);
            setActiveJobId(null);
            isAbortingRef.current = false;
            addShellOutput(tab.id, `[${new Date().toLocaleTimeString()}] 测试已中止`);
          }
        }

        // 如果正在中止但任务还在运行，显示等待提示
        if (isAbortingRef.current && job.status === 'running') {
          addShellOutput(tab.id, `[${new Date().toLocaleTimeString()}] 等待当前命令结束后停止...`);
        }
      } catch (err) {
        console.error('轮询任务状态失败:', err);
      }
    };

    pollJobStatusRef.current = poll;
    const interval = setInterval(poll, 1000);
    return () => {
      clearInterval(interval);
      if (pollJobStatusRef.current === poll) {
        pollJobStatusRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeJobId, tab.id]);

  // 搜索用例包
  const packages = searchPackages(packageSearchKeyword);
  const searchedPackages = packages;

  // 加载选中的测试包
  const loadPackageFromLibrary = async (packageId: string) => {
    const pkg = packages.find(p => p.id === packageId);
    if (!pkg) return;

    setIsLoadingPackage(true);
    try {
      addShellOutput(tab.id, `[${new Date().toLocaleTimeString()}] 正在加载测试包: ${pkg.name}...`);

      const file = await getPackageFile(packageId);
      if (!file) {
        throw new Error('获取测试包文件失败');
      }

      setPowerTestConfig(tab.id, { packageFile: file });
      setSelectedLibraryPackageId(packageId);
      message.success(`已加载测试包: ${pkg.name}`);
      addShellOutput(tab.id, `[${new Date().toLocaleTimeString()}] 测试包加载完成`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '加载失败';
      message.error(`加载测试包失败: ${errorMsg}`);
      addShellOutput(tab.id, `[${new Date().toLocaleTimeString()}] 加载测试包失败: ${errorMsg}`);
      setSelectedLibraryPackageId(null);
    } finally {
      setIsLoadingPackage(false);
    }
  };

  // 上传配置
  const uploadProps: UploadProps = {
    name: 'file',
    multiple: false,
    accept: '.zip,.tar,.tar.gz',
    fileList,
    beforeUpload: (file) => {
      const isZip = file.name.endsWith('.zip') || file.name.endsWith('.tar') || file.name.endsWith('.tar.gz');
      if (!isZip) {
        message.error('只能上传压缩包文件 (.zip, .tar, .tar.gz)');
        return Upload.LIST_IGNORE;
      }
      const isLt2G = file.size / 1024 / 1024 / 1024 < 2;
      if (!isLt2G) {
        message.error('文件大小不能超过2GB');
        return Upload.LIST_IGNORE;
      }
      return false;
    },
    onChange: (info) => {
      setFileList(info.fileList.slice(-1));
      if (info.file.status !== 'removed') {
        setPowerTestConfig(tab.id, { packageFile: info.file.originFileObj as File });
      } else {
        setPowerTestConfig(tab.id, { packageFile: null });
      }
    },
    onRemove: () => {
      setPowerTestConfig(tab.id, { packageFile: null });
      return true;
    },
  };

  const handleStartTest = async () => {
    if (!tab.isSSHConnected) {
      message.error('请先连接SSH');
      return;
    }

    const { iterationParams, adjustmentCommands, packageFile, monitorCommands } = tab.powerTestConfig;

    // 验证迭代参数
    if (iterationParams.length === 0) {
      message.error('请至少配置一个迭代参数');
      return;
    }
    for (const param of iterationParams) {
      if (!param.name.trim()) {
        message.error('请填写所有迭代参数的名称');
        return;
      }
      if (param.mode === 'custom') {
        const validValues = (param.values || []).filter(v => v.trim() !== '');
        if (validValues.length === 0) {
          message.error(`参数 [${param.name}] 的自定义值列表不能为空`);
          return;
        }
      } else {
        if (param.step <= 0) {
          message.error(`参数 [${param.name}] 的步长必须大于0`);
          return;
        }
        if (param.start === param.end) {
          message.error(`参数 [${param.name}] 的起始值和终止值不能相同`);
          return;
        }
      }
    }

    // 验证调整命令
    for (const cmd of adjustmentCommands) {
      if (!cmd.name.trim()) {
        message.error('请填写所有调整命令的名称');
        return;
      }
      if (!cmd.command.trim()) {
        message.error(`调整命令 [${cmd.name}] 未填写命令内容`);
        return;
      }
      if (!cmd.parameterName.trim()) {
        message.error(`调整命令 [${cmd.name}] 未选择关联参数`);
        return;
      }
    }

    // 验证监控命令配置
    const enabledMonitors = monitorCommands.filter(c => c.enabled);
    for (const monitor of enabledMonitors) {
      if (!monitor.name.trim()) {
        message.error('请填写所有启用的监控命令名称');
        return;
      }
      if (!monitor.command.trim()) {
        message.error(`监控命令 [${monitor.name}] 未填写命令内容`);
        return;
      }
    }

    // 验证日志监控配置
    const logMonitor = tab.powerTestConfig.logMonitorConfig;
    if (logMonitor.enabled) {
      if (!logMonitor.command.trim()) {
        message.error('日志监控已启用，请填写日志获取命令');
        return;
      }
      if (logMonitor.interval < 0.1) {
        message.error('日志监控间隔必须大于等于0.1秒');
        return;
      }
    }

    // 验证 BMC 统一会话（如果有任何命令使用了 BMC 目标）
    const hasBmcTarget =
      adjustmentCommands.some((cmd) => cmd.target === 'bmc') ||
      enabledMonitors.some((cmd) => cmd.target === 'bmc') ||
      (logMonitor.enabled && logMonitor.target === 'bmc');

    if (hasBmcTarget) {
      if (!tab.powerTestConfig.globalBmcSessionId) {
        message.error('有命令选择了 BMC 目标，请在 BMC 会话区域选择统一的 BMC 会话');
        return;
      }
      const globalSession = bmcSessions.find((s) => s.id === tab.powerTestConfig.globalBmcSessionId);
      if (!globalSession) {
        message.error('统一的 BMC 会话不存在，请重新选择');
        return;
      }
    }

    if (!packageFile) {
      message.error('请先从用例包库选择测试包');
      return;
    }

    if (selectedLibraryPackageId) {
      const pkg = getPackageById(selectedLibraryPackageId);
      if (pkg?.requiredEnvVars && pkg.requiredEnvVars.length > 0) {
        for (const envKey of pkg.requiredEnvVars) {
          const envValue = tab.powerTestConfig.envVars.find(e => e.key === envKey)?.value;
          if (!envValue?.trim()) {
            message.error(`用例包要求填写环境变量 "${envKey}"`);
            return;
          }
        }
      }
    }

    const totalIterations = calculateTotalIterations(iterationParams);

    clearTestResults(tab.id);
    setIsRunningTest(tab.id, true);
    setTestStatus(tab.id, 'testing');

    addShellOutput(tab.id, `\n[${new Date().toLocaleTimeString()}] ====== 开始迭代测试 ======`);
    addShellOutput(tab.id, `[${new Date().toLocaleTimeString()}] 迭代参数:`);
    iterationParams.forEach(p => {
      if (p.mode === 'custom') {
        addShellOutput(tab.id, `[${new Date().toLocaleTimeString()}]   ${p.name}: [${p.values.filter(v => v.trim() !== '').join(', ')}]`);
      } else {
        addShellOutput(tab.id, `[${new Date().toLocaleTimeString()}]   ${p.name}: ${p.start} ~ ${p.end}, 步长 ${p.step}`);
      }
    });
    addShellOutput(tab.id, `[${new Date().toLocaleTimeString()}] 总迭代次数: ${totalIterations}`);
    addShellOutput(tab.id, `[${new Date().toLocaleTimeString()}] 目标主机: ${tab.sshConfig.host}`);
    addShellOutput(tab.id, `[${new Date().toLocaleTimeString()}] 测试包: ${packageFile.name}`);

    const envVars = tab.powerTestConfig.envVars.filter(e => e.key.trim());
    if (envVars.length > 0) {
      addShellOutput(tab.id, `[${new Date().toLocaleTimeString()}] 自定义环境变量:`);
      envVars.forEach(e => {
        addShellOutput(tab.id, `[${new Date().toLocaleTimeString()}]   ${e.key}=${e.value}`);
      });
    }

    if (adjustmentCommands.length > 0) {
      addShellOutput(tab.id, `[${new Date().toLocaleTimeString()}] 调整命令:`);
      adjustmentCommands.forEach(cmd => {
        addShellOutput(tab.id, `[${new Date().toLocaleTimeString()}]   [${cmd.name}] 目标: ${cmd.target}, 参数: {{${cmd.parameterName}}}`);
      });
    }

    try {
      addShellOutput(tab.id, `[${new Date().toLocaleTimeString()}] 正在上传并部署测试包...`);

      const deployFormData = new FormData();
      deployFormData.append('file', packageFile);
      deployFormData.append('host', tab.sshConfig.host);
      deployFormData.append('port', tab.sshConfig.port.toString());
      deployFormData.append('username', tab.sshConfig.username);
      deployFormData.append('password', tab.sshConfig.password);

      const deployResponse = await fetch('/api/test/power-test-deploy', {
        method: 'POST',
        body: deployFormData,
      });

      if (!deployResponse.ok) {
        throw new Error('部署测试包失败');
      }

      const deployResult = await deployResponse.json();
      if (!deployResult.success) {
        throw new Error(deployResult.message || '部署失败');
      }

      addShellOutput(tab.id, `[${new Date().toLocaleTimeString()}] 测试包部署完成: ${deployResult.remotePath}`);
      addShellOutput(tab.id, `[${new Date().toLocaleTimeString()}] 创建后台任务，测试将在服务器端持续运行...`);

      // 展开 BMC 会话凭据（统一从 globalBmcSessionId 解析）
      const globalBmcSession = tab.powerTestConfig.globalBmcSessionId
        ? bmcSessions.find((s) => s.id === tab.powerTestConfig.globalBmcSessionId)
        : null;

      const resolvedAdjustmentCommands = tab.powerTestConfig.adjustmentCommands.map((cmd) => {
        if (cmd.target === 'bmc' && globalBmcSession) {
          return {
            ...cmd,
            bmcConfig: {
              host: globalBmcSession.ip,
              port: globalBmcSession.port || 22,
              username: globalBmcSession.username,
              password: globalBmcSession.password,
            },
          };
        }
        const c = { ...cmd };
        if (c.sessionId === null) {
          (c as any).sessionId = undefined;
        }
        return c;
      });

      const resolvedMonitorCommands = tab.powerTestConfig.monitorCommands.map((cmd) => {
        if (cmd.target === 'bmc' && globalBmcSession) {
          return {
            ...cmd,
            bmcConfig: {
              host: globalBmcSession.ip,
              port: globalBmcSession.port || 22,
              username: globalBmcSession.username,
              password: globalBmcSession.password,
            },
          };
        }
        return { ...cmd };
      });

      // 展开日志监控 BMC 凭据（统一从 globalBmcSessionId 解析）
      const resolvedLogMonitor = { ...logMonitor };
      if (logMonitor.enabled && logMonitor.target === 'bmc' && globalBmcSession) {
        (resolvedLogMonitor as any).bmcConfig = {
          host: globalBmcSession.ip,
          port: globalBmcSession.port || 22,
          username: globalBmcSession.username,
          password: globalBmcSession.password,
        };
      }

      const job = await startJob({
        name: tab.powerTestConfig.jobName || `${uploadMode === 'library' && selectedLibraryPackageId ? getPackageById(selectedLibraryPackageId)?.name || '用例包' : packageFile.name} - ${new Date().toLocaleDateString()}`,
        tabId: tab.id,
        config: {
          host: tab.sshConfig.host,
          port: tab.sshConfig.port,
          username: tab.sshConfig.username,
          password: tab.sshConfig.password,
          iterationParams,
          adjustmentCommands: resolvedAdjustmentCommands as any,
          envVars,
          monitorCommands: resolvedMonitorCommands,
          heartbeatEnabled: tab.powerTestConfig.heartbeatEnabled,
          heartbeatInterval: tab.powerTestConfig.heartbeatInterval,
          heartbeatMaxFailures: tab.powerTestConfig.heartbeatMaxFailures,
          alertWebhook: tab.powerTestConfig.alertWebhook,
          logMonitorConfig: resolvedLogMonitor,
        },
      });

      if (job) {
        setActiveJobId(job.id);
        lastJobIdRef.current = job.id;
        processedLogCountRef.current = 0;
        processedResultCountRef.current = 0;
        prevJobStatusRef.current = job.status;
        addShellOutput(tab.id, `[${new Date().toLocaleTimeString()}] 后台任务已创建 [${job.id}]，正在运行中...`);
      } else {
        throw new Error('创建后台任务失败');
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '测试执行失败';
      message.error(errorMsg);
      addShellOutput(tab.id, `[${new Date().toLocaleTimeString()}] 错误: ${errorMsg}`);
      setTestStatus(tab.id, 'error');
      setIsRunningTest(tab.id, false);
      setActiveJobId(null);
    }
  };

  const handleStartPipeline = async () => {
    if (!tab.isSSHConnected) {
      message.error('请先连接SSH');
      return;
    }

    const stages = tab.pipelineStages || [];
    if (stages.length === 0) {
      message.error('请至少添加一个流水线阶段');
      return;
    }

    for (const stage of stages) {
      if (!stage.name.trim()) {
        message.error('请填写所有阶段名称');
        return;
      }
      if (stage.packageSource === 'library' && !stage.packageLibraryId) {
        message.error(`阶段 [${stage.name}] 未选择用例包`);
        return;
      }
      if (stage.packageLibraryId) {
        const pkg = searchedPackages.find((p) => p.id === stage.packageLibraryId);
        if (pkg?.requiredEnvVars && pkg.requiredEnvVars.length > 0) {
          for (const envKey of pkg.requiredEnvVars) {
            if (!stage.requiredEnvVarValues?.[envKey]?.trim()) {
              message.error(`阶段 [${stage.name}] 的用例包要求填写环境变量 "${envKey}"`);
              return;
            }
          }
        }
      }
      const stageMonitors = stage.monitorCommands ?? [];
      const enabledStageMonitors = stageMonitors.filter((c) => c.enabled);
      for (const monitor of enabledStageMonitors) {
        if (!monitor.name.trim()) {
          message.error(`阶段 [${stage.name}] 的监控命令存在空名称`);
          return;
        }
        if (!monitor.command.trim()) {
          message.error(`阶段 [${stage.name}] 的监控命令 [${monitor.name || '未命名'}] 未填写命令`);
          return;
        }
      }
    }

    clearTestResults(tab.id);
    setIsRunningTest(tab.id, true);
    setTestStatus(tab.id, 'testing');
    setPipelineCurrentStageIndex(tab.id, 0);

    addShellOutput(tab.id, `\n[${new Date().toLocaleTimeString()}] ====== 开始流水线测试（共 ${stages.length} 个阶段） ======`);

    try {
      const serverStages: ServerPipelineStage[] = [];

      for (let i = 0; i < stages.length; i++) {
        const stage = stages[i];
        addShellOutput(tab.id, `[${new Date().toLocaleTimeString()}] 阶段 ${i + 1}/${stages.length}: ${stage.name} - 正在部署用例包...`);

        let file: File | undefined;
        if (stage.packageSource === 'library' && stage.packageLibraryId) {
          file = await getPackageFile(stage.packageLibraryId);
        }
        if (!file) {
          throw new Error(`阶段 [${stage.name}] 无法获取用例包`);
        }

        const deployFormData = new FormData();
        deployFormData.append('file', file);
        deployFormData.append('host', tab.sshConfig.host);
        deployFormData.append('port', tab.sshConfig.port.toString());
        deployFormData.append('username', tab.sshConfig.username);
        deployFormData.append('password', tab.sshConfig.password);

        const deployResponse = await fetch('/api/test/power-test-deploy', {
          method: 'POST',
          body: deployFormData,
        });
        if (!deployResponse.ok) {
          throw new Error(`阶段 [${stage.name}] 部署用例包失败`);
        }
        const deployResult = await deployResponse.json();
        if (!deployResult.success) {
          throw new Error(deployResult.message || `阶段 [${stage.name}] 部署失败`);
        }

        // 解析阶段配置：阶段独立配置 > 配置模板 > 当前标签页配置
        const template = stage.configTemplateId ? savedConfigs.find((c) => c.id === stage.configTemplateId) : null;
        const baseEnvVars = stage.envVars ?? template?.envVars ?? tab.powerTestConfig.envVars;
        const requiredEnvVarEntries = Object.entries(stage.requiredEnvVarValues || {}).filter(([, v]) => v.trim());
        const mergedEnvVars = [...baseEnvVars, ...requiredEnvVarEntries.map(([key, value]) => ({ key, value }))];
        const baseConfig = {
          iterationParams: template?.iterationParams ?? tab.powerTestConfig.iterationParams,
          adjustmentCommands: template?.adjustmentCommands ?? tab.powerTestConfig.adjustmentCommands,
          monitorCommands: stage.monitorCommands ?? template?.monitorCommands ?? tab.powerTestConfig.monitorCommands,
          envVars: mergedEnvVars,
          logMonitorConfig: template?.logMonitorConfig ?? tab.powerTestConfig.logMonitorConfig,
          globalBmcSessionId: template?.globalBmcSessionId ?? tab.powerTestConfig.globalBmcSessionId,
        };

        const globalBmcSession = baseConfig.globalBmcSessionId
          ? bmcSessions.find((s) => s.id === baseConfig.globalBmcSessionId)
          : null;

        const resolvedAdjustmentCommands = baseConfig.adjustmentCommands.map((cmd) => {
          if (cmd.target === 'bmc' && globalBmcSession) {
            return {
              ...cmd,
              bmcConfig: {
                host: globalBmcSession.ip,
                port: globalBmcSession.port || 22,
                username: globalBmcSession.username,
                password: globalBmcSession.password,
              },
            };
          }
          const c = { ...cmd };
          if (c.sessionId === null) {
            (c as any).sessionId = undefined;
          }
          return c;
        });

        const resolvedMonitorCommands = baseConfig.monitorCommands.map((cmd) => {
          if (cmd.target === 'bmc' && globalBmcSession) {
            return {
              ...cmd,
              bmcConfig: {
                host: globalBmcSession.ip,
                port: globalBmcSession.port || 22,
                username: globalBmcSession.username,
                password: globalBmcSession.password,
              },
            };
          }
          return { ...cmd };
        });

        const resolvedLogMonitor = { ...baseConfig.logMonitorConfig };
        if (resolvedLogMonitor.enabled && resolvedLogMonitor.target === 'bmc' && globalBmcSession) {
          (resolvedLogMonitor as any).bmcConfig = {
            host: globalBmcSession.ip,
            port: globalBmcSession.port || 22,
            username: globalBmcSession.username,
            password: globalBmcSession.password,
          };
        }

        serverStages.push({
          id: stage.id,
          name: stage.name,
          order: i,
          remotePath: deployResult.remotePath,
          iterationParams: baseConfig.iterationParams,
          adjustmentCommands: resolvedAdjustmentCommands as any,
          monitorCommands: resolvedMonitorCommands as any,
          envVars: baseConfig.envVars?.filter((e) => e.key.trim()) || [],
          heartbeatEnabled: tab.powerTestConfig.heartbeatEnabled,
          heartbeatInterval: tab.powerTestConfig.heartbeatInterval,
          heartbeatMaxFailures: tab.powerTestConfig.heartbeatMaxFailures,
          alertWebhook: tab.powerTestConfig.alertWebhook,
          logMonitorConfig: resolvedLogMonitor as any,
          globalBmcSessionId: baseConfig.globalBmcSessionId,
          suppressMonitorLogs: tab.muteMonitorOutput,
        } as any);

        updatePipelineStage(tab.id, stage.id, { remotePath: deployResult.remotePath, status: 'pending' });
      }

      const job = await startJob({
        name: tab.powerTestConfig.jobName || `${tab.name} - 流水线 - ${new Date().toLocaleString()}`,
        tabId: tab.id,
        config: {
          host: tab.sshConfig.host,
          port: tab.sshConfig.port,
          username: tab.sshConfig.username,
          password: tab.sshConfig.password,
          iterationParams: [],
          adjustmentCommands: [],
          stages: serverStages,
        },
      });

      if (job) {
        setActiveJobId(job.id);
        lastJobIdRef.current = job.id;
        processedLogCountRef.current = 0;
        processedResultCountRef.current = 0;
        prevJobStatusRef.current = job.status;
        addShellOutput(tab.id, `[${new Date().toLocaleTimeString()}] 流水线后台任务已创建 [${job.id}]，正在运行中...`);
      } else {
        throw new Error('创建流水线后台任务失败');
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '流水线执行失败';
      message.error(errorMsg);
      addShellOutput(tab.id, `[${new Date().toLocaleTimeString()}] 错误: ${errorMsg}`);
      setTestStatus(tab.id, 'error');
      setIsRunningTest(tab.id, false);
      setActiveJobId(null);
    }
  };

  const handleSaveAllStageReports = async () => {
    const jobId = lastJobIdRef.current;
    if (!jobId) {
      message.error('未找到流水线任务');
      return;
    }
    try {
      const res = await fetch(`/api/test/jobs/${jobId}?includeLogs=false&includeDataPoints=true`);
      const data = await res.json();
      if (!data.success || !data.job) {
        throw new Error('获取流水线任务失败');
      }
      const job = data.job as Job;
      if (!job.config.stages || !job.stageResults) {
        throw new Error('没有可保存的流水线结果');
      }

      let savedCount = 0;
      for (const stage of job.config.stages) {
        const sr = job.stageResults[stage.id];
        if (!sr || sr.status !== 'completed') continue;
        await addReport({
          name: `${tab.name} - ${stage.name}`,
          description: `流水线阶段报告：${stage.name}`,
          folderId: getSelectedFolderId() || 'uncategorized',
          config: {
            host: tab.sshConfig.host,
            iterationParams: stage.iterationParams,
            adjustmentCommands: stage.adjustmentCommands.map(cmd => ({
              id: cmd.id,
              name: cmd.name,
              target: cmd.target,
              sessionId: cmd.sessionId ?? null,
              command: cmd.command,
              parameterName: cmd.parameterName,
            })),
          },
          results: sr.results,
          jobId,
          stageId: stage.id,
          stageName: stage.name,
        });
        savedCount++;
      }
      message.success(`已保存 ${savedCount} 个阶段报告`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : '保存阶段报告失败';
      message.error(msg);
    }
  };

  const handleStopTest = () => {
    if (activeJobId) {
      isAbortingRef.current = true;
      abortJob(activeJobId);
      addShellOutput(tab.id, `[${new Date().toLocaleTimeString()}] 正在中止后台任务，等待当前命令结束...`);
    }
  };

  // 获取某个参数对应的调整命令（通过 paramId 一一对应，兼容旧配置按索引回退）
  const getAdjustmentCommandForParam = (paramId: string, index: number): AdjustmentCommand | undefined => {
    // 优先通过 paramId 匹配（新配置）
    const byParamId = tab.powerTestConfig.adjustmentCommands.find(c => c.paramId === paramId);
    if (byParamId) return byParamId;
    // 回退：按数组索引匹配（兼容旧配置或无 paramId 的情况）
    return tab.powerTestConfig.adjustmentCommands[index];
  };

  // 添加迭代参数（自动创建对应的调整命令）
  const addIterationParam = () => {
    const now = Date.now();
    const paramId = `param-${now}`;
    const newParam: IterationParameter = {
      id: paramId,
      name: '',
      mode: 'range',
      start: 0,
      end: 100,
      step: 10,
      values: [],
    };
    const newCmd: AdjustmentCommand = {
      id: `cmd-${now}`,
      name: '',
      target: 'host',
      sessionId: null,
      command: '',
      parameterName: newParam.name,
      paramId: paramId,
    };
    setPowerTestConfig(tab.id, {
      iterationParams: [...tab.powerTestConfig.iterationParams, newParam],
      adjustmentCommands: [...tab.powerTestConfig.adjustmentCommands, newCmd],
    });
  };

  // 删除迭代参数（同时删除对应的调整命令）
  const removeIterationParam = (paramId: string) => {
    const newParams = tab.powerTestConfig.iterationParams.filter(p => p.id !== paramId);
    const newCommands = tab.powerTestConfig.adjustmentCommands.filter(c => c.paramId !== paramId);
    setPowerTestConfig(tab.id, {
      iterationParams: newParams,
      adjustmentCommands: newCommands,
    });
  };

  // 移动迭代参数位置（同时移动对应的调整命令）
  const moveIterationParam = (paramId: string, direction: 'up' | 'down') => {
    const params = tab.powerTestConfig.iterationParams;
    const commands = tab.powerTestConfig.adjustmentCommands;
    const index = params.findIndex(p => p.id === paramId);
    if (index === -1) return;
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= params.length) return;

    const newParams = [...params];
    [newParams[index], newParams[newIndex]] = [newParams[newIndex], newParams[index]];

    const newCommands = [...commands];
    [newCommands[index], newCommands[newIndex]] = [newCommands[newIndex], newCommands[index]];

    setPowerTestConfig(tab.id, {
      iterationParams: newParams,
      adjustmentCommands: newCommands,
    });
  };

  // 更新迭代参数
  const updateIterationParam = (id: string, updates: Partial<IterationParameter>) => {
    const newParams = tab.powerTestConfig.iterationParams.map(p =>
      p.id === id ? { ...p, ...updates } : p
    );
    // 同步更新对应调整命令的 parameterName（通过 paramId 匹配，不依赖名称）
    const newCommands = tab.powerTestConfig.adjustmentCommands.map(c =>
      c.paramId === id && updates.name !== undefined ? { ...c, parameterName: updates.name } : c
    );
    setPowerTestConfig(tab.id, {
      iterationParams: newParams,
      adjustmentCommands: newCommands,
    });
  };

  // 更新某个参数对应的调整命令
  const updateAdjustmentCommandForParam = (paramId: string, updates: Partial<AdjustmentCommand>) => {
    setPowerTestConfig(tab.id, {
      adjustmentCommands: tab.powerTestConfig.adjustmentCommands.map(c =>
        c.paramId === paramId ? { ...c, ...updates } : c
      ),
    });
  };

  // 加载保存的配置
  const handleLoadConfig = (configId: string) => {
    const config = savedConfigs.find(
      (c) => c.id === configId && c.configType === 'iteration'
    );
    if (!config) return;

    // 兼容旧配置：为没有 paramId 的调整命令补全 paramId（按数组索引一一对应）
    const fixedAdjustmentCommands = config.adjustmentCommands.map((cmd, index) => ({
      ...cmd,
      paramId: cmd.paramId || config.iterationParams[index]?.id || '',
    }));

    // 兼容旧配置：为没有 mode 的迭代参数补充默认值
    const fixedIterationParams = config.iterationParams.map((p) => ({
      ...p,
      mode: (p as any).mode || 'range',
      values: (p as any).values || [],
    }));

    // 按需覆盖，没有的配置字段保持当前值不变
    // 注意：迭代配置模板永远不会覆盖监控命令，监控命令由独立的监控配置模板管理
    const updates: Partial<TestTab['powerTestConfig']> = {
      iterationParams: fixedIterationParams,
      adjustmentCommands: fixedAdjustmentCommands,
      envVars: config.envVars,
    };

    if (config.logMonitorConfig !== undefined) {
      updates.logMonitorConfig = config.logMonitorConfig;
    }

    // 兼容旧配置：从未设置 globalBmcSessionId 的命令中提取 sessionId
    if (config.globalBmcSessionId !== undefined) {
      updates.globalBmcSessionId = config.globalBmcSessionId;
    } else {
      const firstBmcCmd =
        config.adjustmentCommands.find((c) => c.target === 'bmc' && c.sessionId);
      if (firstBmcCmd) {
        updates.globalBmcSessionId = firstBmcCmd.sessionId;
      }
    }

    setPowerTestConfig(tab.id, updates);
    setSelectedConfigId(configId);
    message.success(`已加载配置: ${config.name}`);
  };

  // 保存当前配置
  const handleSaveConfig = async () => {
    const values = await saveConfigForm.validateFields();
    try {
      await addConfig({
        name: values.name,
        description: values.description,
        configType: 'iteration',
        iterationParams: tab.powerTestConfig.iterationParams,
        adjustmentCommands: tab.powerTestConfig.adjustmentCommands,
        envVars: tab.powerTestConfig.envVars,
        logMonitorConfig: tab.powerTestConfig.logMonitorConfig,
        globalBmcSessionId: tab.powerTestConfig.globalBmcSessionId,
      });
      message.success('配置已保存');
      setIsSaveConfigModalOpen(false);
      saveConfigForm.resetFields();
      await fetchConfigs('iteration');
    } catch {
      message.error('保存配置失败');
    }
  };

  // 删除配置
  const handleDeleteConfig = async (configId: string) => {
    try {
      await removeConfig(configId);
      if (selectedConfigId === configId) {
        setSelectedConfigId(null);
      }
      message.success('配置已删除');
    } catch {
      message.error('删除配置失败');
    }
  };

  const totalIterations = calculateTotalIterations(tab.powerTestConfig.iterationParams);

  // 流水线模式下进度按当前阶段的迭代总数计算；优先从运行中的任务读取阶段配置
  const currentStageIndex = tab.pipelineCurrentStageIndex ?? 0;
  const activePipelineStage = tab.pipelineMode
    ? (activeJob?.config.stages?.[activeJob.config.currentStageIndex ?? currentStageIndex] ?? tab.pipelineStages?.[currentStageIndex])
    : undefined;
  const stageTotalIterations = tab.pipelineMode && activePipelineStage && Array.isArray((activePipelineStage as any).iterationParams)
    ? calculateTotalIterations((activePipelineStage as any).iterationParams)
    : totalIterations;
  const progress = stageTotalIterations > 0 ? Math.round((tab.currentIteration / stageTotalIterations) * 100) : 0;

  const hasStageInfo = tab.testResults.some((r) => r.stageName);
  const columns: ColumnsType<TestResult> = [
    {
      title: '迭代次数',
      dataIndex: 'iteration',
      key: 'iteration',
      width: 90,
    },
    {
      title: '迭代参数',
      dataIndex: 'iterationLabel',
      key: 'iterationLabel',
      width: 200,
      render: (label) => {
        if (!label) return '-';
        const text = String(label);
        return (
          <Tooltip title={text} placement="topLeft">
            <span style={{ display: 'inline-block', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {text}
            </span>
          </Tooltip>
        );
      },
    },
    ...(hasStageInfo
      ? [
          {
            title: '阶段',
            dataIndex: 'stageName',
            key: 'stageName',
            width: 140,
            render: (name: string | undefined) => name || '-',
          },
        ]
      : []),
    {
      title: '分数 (Score)',
      dataIndex: 'score',
      key: 'score',
      width: 120,
      render: (score, record) => {
        if (record.status === 'error') return <Tag color="error">失败</Tag>;
        return <span style={{ fontWeight: 'bold', color: '#52c41a' }}>{score}</span>;
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 80,
      render: (status) => {
        if (status === 'success') return <Badge status="success" text="成功" />;
        if (status === 'error') return <Badge status="error" text="失败" />;
        return <Badge status="processing" text="运行中" />;
      },
    },
    {
      title: '消息',
      dataIndex: 'message',
      key: 'message',
      ellipsis: true,
    },
    {
      title: '日志',
      key: 'logs',
      width: 100,
      render: (_: unknown, record: TestResult) => {
        if (record.logArchivePath) {
          return (
            <Button
              type="link"
              size="small"
              icon={<FileTextOutlined />}
              onClick={() => {
                const jobId = activeJobId || lastJobIdRef.current;
                if (jobId) {
                  const stageParam = record.stageId ? `&stageId=${record.stageId}` : '';
                  window.open(`/api/test/logs/download?jobId=${jobId}&iteration=${record.iteration}${stageParam}`);
                }
              }}
            >
              下载
            </Button>
          );
        }
        return '-';
      },
    },
  ];

  // 获取所有监控命令ID
  const allMonitorCommandIds = React.useMemo(() => {
    const ids = new Set<string>();
    tab.testResults.forEach(r => {
      if (r.monitorResults) {
        Object.keys(r.monitorResults).forEach(id => ids.add(id));
      }
    });
    return Array.from(ids);
  }, [tab.testResults]);

  // 将监控命令ID按原始命令分组（list模式的虚拟commandId归并到同一组）
  const monitorGroups = React.useMemo(() => {
    const groups: Record<string, { originalId: string; name: string; colIds: string[] }> = {};
    // 基于当前配置构建分组骨架
    tab.powerTestConfig.monitorCommands.forEach(cmd => {
      if (cmd.enabled) {
        groups[cmd.id] = { originalId: cmd.id, name: cmd.name, colIds: [] };
      }
    });
    // 将结果中的 commandId 分配到对应分组
    allMonitorCommandIds.forEach(id => {
      const originalId = id.replace(/__col__\d+$/, '');
      if (!groups[originalId]) {
        groups[originalId] = { originalId, name: originalId, colIds: [] };
      }
      if (!groups[originalId].colIds.includes(id)) {
        groups[originalId].colIds.push(id);
      }
    });
    // 按原始命令id排序，保持稳定性
    return Object.values(groups)
      .filter(g => g.colIds.length > 0)
      .sort((a, b) => a.originalId.localeCompare(b.originalId));
  }, [allMonitorCommandIds, tab.powerTestConfig.monitorCommands]);

  const COLORS = ['#52c41a', '#1890ff', '#fa8c16', '#f5222d', '#722ed1', '#13c2c2', '#eb2f96', '#fa541c'];

  // 为一组监控命令生成跨迭代的图表配置（平均值），支持多曲线
  const generateMonitorChartOption = (commandIds: string[]) => {
    const relevantResults = tab.testResults.filter(r =>
      commandIds.some(id => r.monitorResults?.[id])
    );

    const seriesList = commandIds.map(id => {
      const firstResult = tab.testResults.find(r => r.monitorResults?.[id]);
      const fullName = firstResult?.monitorResults?.[id].commandName || id;
      const shortName = fullName.includes(' - ') ? fullName.split(' - ').pop()! : fullName;
      return { id, name: shortName, fullName };
    });

    const groupName = seriesList[0]?.fullName.split(' - ')[0] || '监控';

    return {
      title: { text: `${groupName} - 跨迭代平均值趋势`, left: 'center', textStyle: { fontSize: 14 } },
      tooltip: {
        ...tooltipBase,
        formatter: (params: any[]) => formatAxisTooltip(params, (idx) => relevantResults[idx]),
      },
      legend: getScrollLegend(seriesList.map(s => s.name)),
      grid: { left: '3%', right: '4%', bottom: '15%', containLabel: true },
      xAxis: {
        type: 'category',
        name: '迭代',
        data: relevantResults.map(r => `${r.iteration}\n(${r.iterationLabel || `功耗=${r.power}`})`),
      },
      yAxis: { type: 'value', name: '平均值' },
      series: seriesList.map((s, idx) => {
        const color = COLORS[idx % COLORS.length];
        const data = relevantResults.map(r => {
          const mr = r.monitorResults?.[s.id];
          return mr ? mr.averageValue : null;
        });
        return {
          name: s.name,
          type: 'line',
          data,
          smooth: true,
          symbol: 'circle',
          symbolSize: 6,
          lineStyle: { width: 2, color },
          itemStyle: { color },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: color + '33' },
                { offset: 1, color: color + '0D' },
              ],
            },
          },
        };
      }),
    };
  };

  // 为一组监控命令生成分数/平均值趋势图，支持多曲线
  const generateMonitorScoreRatioChartOption = (commandIds: string[]) => {
    const relevantResults = tab.testResults.filter(r =>
      commandIds.some(id => r.monitorResults?.[id]) && r.score > 0
    );

    const seriesList = commandIds.map(id => {
      const firstResult = tab.testResults.find(r => r.monitorResults?.[id]);
      const fullName = firstResult?.monitorResults?.[id].commandName || id;
      const shortName = fullName.includes(' - ') ? fullName.split(' - ').pop()! : fullName;
      return { id, name: shortName, fullName };
    });

    const groupName = seriesList[0]?.fullName.split(' - ')[0] || '监控';

    return {
      title: { text: `${groupName} - 分数/平均值趋势`, left: 'center', textStyle: { fontSize: 14 } },
      tooltip: {
        ...tooltipBase,
        formatter: (params: any[]) => formatAxisTooltip(
          params,
          (idx) => relevantResults[idx],
          (ctx) => `分数: ${ctx?.score}<br/>`
        ),
      },
      legend: getScrollLegend(seriesList.map(s => s.name)),
      grid: { left: '3%', right: '4%', bottom: '15%', containLabel: true },
      xAxis: {
        type: 'category',
        name: '迭代',
        data: relevantResults.map(r => `${r.iteration}\n(${r.iterationLabel || `功耗=${r.power}`})`),
      },
      yAxis: { type: 'value', name: '分数/平均值' },
      series: seriesList.map((s, idx) => {
        const color = COLORS[idx % COLORS.length];
        const data = relevantResults.map(r => {
          const mr = r.monitorResults?.[s.id];
          return mr && mr.averageValue > 0 ? r.score / mr.averageValue : null;
        });
        return {
          name: s.name,
          type: 'line',
          data,
          smooth: true,
          symbol: 'circle',
          symbolSize: 6,
          lineStyle: { width: 2, color },
          itemStyle: { color },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: color + '33' },
                { offset: 1, color: color + '0D' },
              ],
            },
          },
        };
      }),
    };
  };

  // 生成单次迭代采样点曲线图配置
  const generateIterationDetailChartOption = (commandName: string, dataPoints: Array<{ timestamp: string; value: number; raw: string }>) => {
    const validPoints = dataPoints.map((p, idx) => ({ idx, value: p.value ?? 0 })).filter(p => !isNaN(p.value));
    return {
      title: { text: `${commandName} - 单次迭代采样详情`, left: 'center', textStyle: { fontSize: 14 } },
      tooltip: { trigger: 'axis', formatter: (params: any[]) => {
        const p = params[0];
        const dp = dataPoints[p.dataIndex];
        return `采样点: ${p.dataIndex + 1}<br/>时间: ${new Date(dp.timestamp).toLocaleTimeString()}<br/>值: ${p.value}`;
      }},
      grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
      xAxis: {
        type: 'category',
        name: '采样点序号',
        data: validPoints.map(p => `${p.idx + 1}`),
      },
      yAxis: { type: 'value', name: '监控值' },
      series: [{
        name: commandName,
        type: 'line',
        data: validPoints.map(p => p.value),
        smooth: true,
        symbol: 'circle',
        symbolSize: 6,
        lineStyle: { width: 2, color: '#1890ff' },
        itemStyle: { color: '#1890ff' },
      }],
    };
  };

  const TestHelpContent = (
    <div style={{ maxWidth: 500 }}>
      <p><strong>迭代测试说明：</strong></p>
      <ol style={{ paddingLeft: 16 }}>
        <li>配置一个或多个迭代参数（支持范围模式或自定义列表模式）</li>
        <li>配置调整命令（可选），用于在每次迭代前调整系统参数</li>
        <li>准备测试压缩包（.zip/.tar/.tar.gz）</li>
        <li>压缩包根目录必须包含 <code>run.sh</code> 脚本</li>
        <li>系统按多层 for 循环遍历所有参数组合，每次调用 <code>run.sh</code></li>
        <li>run.sh 执行完成后需输出 JSON 格式的结果</li>
      </ol>

      <Divider style={{ margin: '8px 0' }} />

      <p><strong>run.sh 要求：</strong></p>
      <ul style={{ paddingLeft: 16 }}>
        <li>接收位置参数：按参数顺序传递的参数值</li>
        <li>可通过环境变量读取所有参数值（参数名=值）</li>
        <li>兼容环境变量：BLUE_SKY_POWER（第一个参数值）、BLUE_SKY_ITERATION（迭代序号）</li>
        <li>最后输出 JSON 格式结果到 stdout</li>
      </ul>

      <Divider style={{ margin: '8px 0' }} />

      <p><strong>调整命令占位符：</strong></p>
      <div style={{ color: '#666', fontSize: 12 }}>
        命令中使用 <code>{'{{参数名}}'}</code> 作为占位符，系统会在每次迭代时自动替换为当前参数值。
        例如命令 <code>ipmitool power cap {'{{功耗}}'}</code>，当功耗参数为 100 时，实际执行 <code>ipmitool power cap 100</code>。
      </div>

      <Divider style={{ margin: '8px 0' }} />

      <p><strong>run.sh 示例：</strong></p>
      <pre style={{ background: '#1e1e1e', color: '#d4d4d4', padding: 8, borderRadius: 4, fontSize: 11, border: '1px solid #333' }}>
{`#!/bin/bash
# run.sh - 迭代测试脚本
# 参数 $1, $2, ...: 按顺序传递的参数值
# 环境变量: 参数名=值, BLUE_SKY_POWER, BLUE_SKY_ITERATION

echo "开始测试，参数: $1, $2"
echo "环境变量: 功耗=$功耗, 电压=$电压"

# 在这里执行你的测试...
sleep 1

# 模拟计算得分
SCORE=$((10000 / ($1 + 1) + RANDOM % 100))

# 必须输出 JSON 格式结果
echo "{\"score\": \${SCORE}}"`}
      </pre>

      <Divider style={{ margin: '8px 0' }} />

      <p><strong>输出格式要求：</strong></p>
      <pre style={{ background: '#1e1e1e', color: '#d4d4d4', padding: 8, borderRadius: 4, fontSize: 11, border: '1px solid #333' }}>
{`{
  "score": 1234,  // 性能分数（数值类型，必需）
}`}
      </pre>
    </div>
  );

  return (
    <div style={{ padding: 16 }}>
      <Alert
        message="迭代测试"
        description="系统控制多参数组合迭代过程，支持多层for循环式的参数遍历，自动收集性能分数"
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
      />

      <Row gutter={24}>
        <Col span={8}>
          {/* 配置模板保存/加载 */}
          <Card title="配置模板" size="small" style={{ marginBottom: 16 }}>
            <Space direction="vertical" style={{ width: '100%' }}>
              <Select
                size="small"
                placeholder="选择已保存的配置模板"
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
                  .filter((config) => config.configType === 'iteration')
                  .map((config) => (
                    <Option key={config.id} value={config.id} label={config.name}>
                      <Space>
                        <span>{config.name}</span>
                        <span style={{ color: '#999', fontSize: 12 }}>{config.description}</span>
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
          </Card>

          <Card
            title="迭代参数与调整命令"
            size="small"
            extra={
              <Button
                type="link"
                size="small"
                icon={<ReloadOutlined />}
                onClick={() => {
                  const now = Date.now();
                  const paramId = `param-${now}`;
                  setPowerTestConfig(tab.id, {
                    iterationParams: [
                      { id: paramId, name: '功耗', mode: 'range', start: 100, end: 500, step: 50, values: [] },
                    ],
                    adjustmentCommands: [
                      {
                        id: `cmd-${now}`,
                        name: 'BMC功耗调整',
                        target: 'bmc',
                        sessionId: null,
                        parameterName: '功耗',
                        paramId,
                        command: `bash -l -c 'mdbctl call Smc_CpuBrdSMC_010101 bmc.kepler.Chip.BlockIO Write 0 0x00008A00 1 0x4 && (printf "powerCap 1 {{功耗}}\\r\\n"; sleep 5) | ipmcset -t sol -d activate -v 1 0; mdbctl call Smc_CpuBrdSMC_010101 bmc.kepler.Chip.BlockIO Write 0 0x00008A00 1 0x9 && (printf "powerCap 1 {{功耗}}\\r\\n"; sleep 5) | ipmcset -t sol -d activate -v 1 0'`,
                      },
                    ],
                  });
                  setSelectedConfigId(null);
                  message.success('已恢复默认迭代参数');
                }}
                disabled={tab.isRunningTest}
              >
                恢复默认
              </Button>
            }
          >
            <div style={{ marginBottom: 12 }}>
              <div style={{ color: '#666', fontSize: 12, marginBottom: 8 }}>
                每个迭代参数对应一条调整命令，测试时按多层 for 循环进行组合迭代
              </div>

              {/* 统一 BMC 会话选择 */}
              <div
                style={{
                  marginBottom: 12,
                  padding: 10,
                  background: '#f6ffed',
                  border: '1px solid #b7eb8f',
                  borderRadius: 6,
                }}
              >
                <div style={{ fontWeight: 'bold', fontSize: 12, color: '#52c41a', marginBottom: 6 }}>
                  <SafetyOutlined style={{ marginRight: 4 }} />
                  BMC 统一会话
                </div>
                <Select
                  size="small"
                  style={{ width: '100%' }}
                  placeholder={bmcSessions.length > 0 ? '选择 BMC 会话（所有 BMC 目标命令将统一使用）' : '暂无 BMC 会话，请先点击下方按钮添加'}
                  value={tab.powerTestConfig.globalBmcSessionId || undefined}
                  onChange={(value) => setGlobalBmcSessionId(tab.id, value || null)}
                  disabled={tab.isRunningTest || bmcSessions.length === 0}
                  allowClear
                >
                  {bmcSessions.map((session) => (
                    <Option key={session.id} value={session.id}>
                      <Space>
                        <span>{session.name}</span>
                        <span style={{ color: '#999', fontSize: 12 }}>
                          {session.ip}:{session.port || 22}
                        </span>
                      </Space>
                    </Option>
                  ))}
                </Select>
                <Button
                  size="small"
                  type="dashed"
                  icon={<SafetyOutlined />}
                  style={{ marginTop: 8, width: '100%' }}
                  onClick={() => setIsBMCConfigOpen(true)}
                >
                  管理 BMC 会话（新增/删除）
                </Button>
              </div>

              {tab.powerTestConfig.iterationParams.map((param, index) => {
                const cmd = getAdjustmentCommandForParam(param.id, index);
                return (
                  <div
                    key={param.id}
                    style={{
                      border: '1px solid #d9d9d9',
                      borderRadius: 6,
                      padding: 12,
                      marginBottom: 12,
                      background: '#fff',
                    }}
                  >
                    {/* 参数头部 */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                      <span style={{ fontWeight: 'bold', fontSize: 13, color: '#1890ff' }}>
                        参数 {index + 1}{param.name ? `: ${param.name}` : ''}
                      </span>
                      <Space>
                        <Button
                          type="link"
                          size="small"
                          icon={<ArrowUpOutlined />}
                          onClick={() => moveIterationParam(param.id, 'up')}
                          disabled={tab.isRunningTest || index === 0}
                        >
                          上移
                        </Button>
                        <Button
                          type="link"
                          size="small"
                          icon={<ArrowDownOutlined />}
                          onClick={() => moveIterationParam(param.id, 'down')}
                          disabled={tab.isRunningTest || index === tab.powerTestConfig.iterationParams.length - 1}
                        >
                          下移
                        </Button>
                        <Button
                          type="link"
                          danger
                          size="small"
                          icon={<MinusCircleOutlined />}
                          onClick={() => removeIterationParam(param.id)}
                          disabled={tab.isRunningTest}
                        >
                          删除
                        </Button>
                      </Space>
                    </div>

                    {/* 参数配置 */}
                    <Form layout="vertical" size="small">
                      <Row gutter={8}>
                        <Col span={24}>
                          <Form.Item style={{ marginBottom: 6 }} label={<span style={{ fontSize: 12 }}>参数名称</span>}>
                            <Input
                              size="small"
                              placeholder="如：功耗、电压"
                              value={param.name}
                              onChange={(e) => updateIterationParam(param.id, { name: e.target.value })}
                              disabled={tab.isRunningTest}
                            />
                          </Form.Item>
                        </Col>
                      </Row>
                      <Row gutter={8}>
                        <Col span={24}>
                          <Form.Item style={{ marginBottom: 6 }}>
                            <Radio.Group
                              size="small"
                              value={param.mode}
                              onChange={(e) => updateIterationParam(param.id, { mode: e.target.value })}
                              disabled={tab.isRunningTest}
                            >
                              <Radio value="range">范围模式</Radio>
                              <Radio value="custom">自定义列表</Radio>
                            </Radio.Group>
                          </Form.Item>
                        </Col>
                      </Row>
                      {param.mode === 'range' ? (
                        <Row gutter={8}>
                          <Col span={8}>
                            <Form.Item style={{ marginBottom: 6 }} label={<span style={{ fontSize: 12 }}>起始</span>}>
                              <InputNumber
                                size="small"
                                style={{ width: '100%' }}
                                placeholder="起始"
                                value={param.start}
                                onChange={(val) => updateIterationParam(param.id, { start: val || 0 })}
                                disabled={tab.isRunningTest}
                              />
                            </Form.Item>
                          </Col>
                          <Col span={8}>
                            <Form.Item style={{ marginBottom: 6 }} label={<span style={{ fontSize: 12 }}>终止</span>}>
                              <InputNumber
                                size="small"
                                style={{ width: '100%' }}
                                placeholder="终止"
                                value={param.end}
                                onChange={(val) => updateIterationParam(param.id, { end: val || 0 })}
                                disabled={tab.isRunningTest}
                              />
                            </Form.Item>
                          </Col>
                          <Col span={8}>
                            <Form.Item style={{ marginBottom: 6 }} label={<span style={{ fontSize: 12 }}>步长</span>}>
                              <InputNumber
                                size="small"
                                style={{ width: '100%' }}
                                placeholder="步长"
                                min={1}
                                value={param.step}
                                onChange={(val) => updateIterationParam(param.id, { step: val || 1 })}
                                disabled={tab.isRunningTest}
                              />
                            </Form.Item>
                          </Col>
                        </Row>
                      ) : (
                        <div>
                          {(param.values || []).map((val, valIdx) => (
                            <Row gutter={8} key={valIdx} style={{ marginBottom: 6 }}>
                              <Col span={20}>
                                <Input
                                  size="small"
                                  placeholder={`值 ${valIdx + 1}`}
                                  value={val}
                                  onChange={(e) => {
                                    const newValues = [...(param.values || [])];
                                    newValues[valIdx] = e.target.value;
                                    updateIterationParam(param.id, { values: newValues });
                                  }}
                                  disabled={tab.isRunningTest}
                                />
                              </Col>
                              <Col span={4}>
                                <Button
                                  type="link"
                                  danger
                                  size="small"
                                  icon={<MinusCircleOutlined />}
                                  onClick={() => {
                                    const newValues = (param.values || []).filter((_, i) => i !== valIdx);
                                    updateIterationParam(param.id, { values: newValues });
                                  }}
                                  disabled={tab.isRunningTest}
                                />
                              </Col>
                            </Row>
                          ))}
                          <Button
                            type="dashed"
                            size="small"
                            block
                            icon={<PlusOutlined />}
                            onClick={() => {
                              updateIterationParam(param.id, { values: [...(param.values || []), ''] });
                            }}
                            disabled={tab.isRunningTest}
                            style={{ marginTop: 4 }}
                          >
                            添加值
                          </Button>
                        </div>
                      )}
                    </Form>

                    {/* 对应的调整命令 */}
                    {cmd && (
                      <div
                        style={{
                          marginTop: 8,
                          padding: 10,
                          borderRadius: 4,
                          background: '#f6ffed',
                          border: '1px solid #b7eb8f',
                        }}
                      >
                        <div style={{ fontWeight: 'bold', fontSize: 12, color: '#52c41a', marginBottom: 8 }}>
                          调整命令
                        </div>
                        <Form layout="vertical" size="small">
                          <Row gutter={8}>
                            <Col span={12}>
                              <Form.Item style={{ marginBottom: 4 }}>
                                <Input
                                  size="small"
                                  placeholder="命令名称"
                                  value={cmd.name}
                                  onChange={(e) => updateAdjustmentCommandForParam(param.id, { name: e.target.value })}
                                  disabled={tab.isRunningTest}
                                />
                              </Form.Item>
                            </Col>
                            <Col span={12}>
                              <Form.Item style={{ marginBottom: 4 }}>
                                <Select
                                  size="small"
                                  placeholder="执行目标"
                                  value={cmd.target}
                                  onChange={(value) => updateAdjustmentCommandForParam(param.id, { target: value })}
                                  disabled={tab.isRunningTest}
                                  style={{ width: '100%' }}
                                >
                                  <Option value="host">远程主机</Option>
                                  <Option value="bmc">BMC</Option>
                                </Select>
                              </Form.Item>
                            </Col>
                          </Row>
                          {cmd.target === 'bmc' && (
                            <div style={{ marginBottom: 4, fontSize: 12, color: '#666' }}>
                              {tab.powerTestConfig.globalBmcSessionId ? (
                                <Tag color="green">
                                  <SafetyOutlined /> 使用统一 BMC 会话
                                </Tag>
                              ) : (
                                <Tag color="warning">
                                  <SafetyOutlined /> 未选择统一 BMC 会话
                                </Tag>
                              )}
                            </div>
                          )}
                          <Form.Item style={{ marginBottom: 0 }}>
                            <Input.TextArea
                              size="small"
                              rows={2}
                              placeholder={`命令模板，使用 {{${param.name || '参数名'}}} 作为占位符`}
                              value={cmd.command}
                              onChange={(e) => updateAdjustmentCommandForParam(param.id, { command: e.target.value })}
                              disabled={tab.isRunningTest}
                            />
                          </Form.Item>
                        </Form>
                      </div>
                    )}
                  </div>
                );
              })}
              <Button
                type="dashed"
                size="small"
                block
                icon={<PlusOutlined />}
                onClick={addIterationParam}
                disabled={tab.isRunningTest}
              >
                添加迭代参数（含调整命令）
              </Button>
              <div style={{ color: '#666', fontSize: 12, marginTop: 8, textAlign: 'center' }}>
                预计迭代次数: <strong>{totalIterations}</strong> 次
              </div>
            </div>

            <Divider style={{ margin: '12px 0' }} />

            <Form.Item>
              <Button
                type="dashed"
                size="small"
                block
                icon={<SafetyOutlined />}
                onClick={() => setIsBMCConfigOpen(true)}
              >
                管理 BMC 会话
              </Button>
            </Form.Item>
          </Card>

          <MonitorConfigPanel
            tabId={tab.id}
            disabled={tab.isRunningTest}
            globalBmcSessionId={tab.powerTestConfig.globalBmcSessionId}
          />

          {/* 心跳检测与告警配置 */}
          <Card title="高级配置" size="small" style={{ marginTop: 16 }}>
            <div style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontWeight: 'bold', fontSize: 13 }}>
                  <SyncOutlined style={{ marginRight: 6, color: '#1890ff' }} />
                  服务器心跳检测
                </span>
                <Switch
                  size="small"
                  checked={tab.powerTestConfig.heartbeatEnabled}
                  onChange={(checked) => setHeartbeatConfig(tab.id, { heartbeatEnabled: checked })}
                  disabled={tab.isRunningTest}
                />
              </div>
              <div style={{ color: '#666', fontSize: 12, marginBottom: 8 }}>
                测试执行期间定期检测服务器连通性，连续失败达到阈值则自动中止测试
              </div>
              {tab.powerTestConfig.heartbeatEnabled && (
                <Row gutter={8}>
                  <Col span={12}>
                    <Form.Item style={{ marginBottom: 4 }} label={<span style={{ fontSize: 12 }}>检测间隔（秒）</span>}>
                      <InputNumber
                        size="small"
                        style={{ width: '100%' }}
                        min={3}
                        max={300}
                        value={tab.powerTestConfig.heartbeatInterval}
                        onChange={(val) => setHeartbeatConfig(tab.id, { heartbeatInterval: val || 10 })}
                        disabled={tab.isRunningTest}
                      />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item style={{ marginBottom: 4 }} label={<span style={{ fontSize: 12 }}>最大失败次数</span>}>
                      <InputNumber
                        size="small"
                        style={{ width: '100%' }}
                        min={1}
                        max={10}
                        value={tab.powerTestConfig.heartbeatMaxFailures}
                        onChange={(val) => setHeartbeatConfig(tab.id, { heartbeatMaxFailures: val || 3 })}
                        disabled={tab.isRunningTest}
                      />
                    </Form.Item>
                  </Col>
                </Row>
              )}
            </div>

            <Divider style={{ margin: '8px 0' }} />

            <div>
              <div style={{ fontWeight: 'bold', fontSize: 13, marginBottom: 8 }}>
                <SafetyOutlined style={{ marginRight: 6, color: '#fa8c16' }} />
                告警通知
              </div>
              <div style={{ color: '#666', fontSize: 12, marginBottom: 8 }}>
                配置 webhook 地址，用于测试发生意外时的告警通知（预留功能，当前不会触发实际请求）
              </div>
              <Form.Item style={{ marginBottom: 0 }}>
                <Input
                  size="small"
                  placeholder="https://hooks.example.com/webhook/xxx"
                  value={tab.powerTestConfig.alertWebhook}
                  onChange={(e) => setAlertWebhook(tab.id, e.target.value)}
                  disabled={tab.isRunningTest}
                />
              </Form.Item>
            </div>

            <Divider style={{ margin: '8px 0' }} />

            {/* 日志监控配置 */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ fontWeight: 'bold', fontSize: 13 }}>
                  <FileTextOutlined style={{ marginRight: 6, color: '#52c41a' }} />
                  日志监控
                </span>
                <Switch
                  size="small"
                  checked={tab.powerTestConfig.logMonitorConfig.enabled}
                  onChange={(checked) => setLogMonitorConfig(tab.id, { enabled: checked })}
                  disabled={tab.isRunningTest}
                />
              </div>
              <div style={{ color: '#666', fontSize: 12, marginBottom: 8 }}>
                在每次迭代期间按设定间隔执行命令获取日志，本轮迭代结束后自动打包成压缩包供下载
              </div>
              {tab.powerTestConfig.logMonitorConfig.enabled && (
                <Space direction="vertical" style={{ width: '100%' }} size="small">
                  <Input.TextArea
                    size="small"
                    rows={2}
                    placeholder="日志获取命令，例如：tail -n 100 /var/log/messages"
                    value={tab.powerTestConfig.logMonitorConfig.command}
                    onChange={(e) => setLogMonitorConfig(tab.id, { command: e.target.value })}
                    disabled={tab.isRunningTest}
                  />
                  <Row gutter={8}>
                    <Col span={12}>
                      <Space>
                        <span style={{ color: '#666', fontSize: 12 }}>间隔</span>
                        <InputNumber
                          size="small"
                          min={0.1}
                          max={300}
                          value={tab.powerTestConfig.logMonitorConfig.interval}
                          onChange={(val) => setLogMonitorConfig(tab.id, { interval: val || 0.1 })}
                          disabled={tab.isRunningTest}
                          style={{ width: 70 }}
                        />
                        <span style={{ color: '#666', fontSize: 12 }}>秒</span>
                      </Space>
                    </Col>
                    <Col span={12}>
                      <Select
                        size="small"
                        style={{ width: '100%' }}
                        value={tab.powerTestConfig.logMonitorConfig.target}
                        onChange={(value) =>
                          setLogMonitorConfig(tab.id, {
                            target: value,
                            sessionId: value === 'host' ? null : tab.powerTestConfig.logMonitorConfig.sessionId,
                          })
                        }
                        disabled={tab.isRunningTest}
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
                  </Row>
                  {tab.powerTestConfig.logMonitorConfig.target === 'bmc' && (
                    <div style={{ fontSize: 12, color: '#666' }}>
                      {tab.powerTestConfig.globalBmcSessionId ? (
                        <Tag color="green">
                          <SafetyOutlined /> 使用统一 BMC 会话
                        </Tag>
                      ) : (
                        <Tag color="warning">
                          <SafetyOutlined /> 未选择统一 BMC 会话
                        </Tag>
                      )}
                    </div>
                  )}
                </Space>
              )}
            </div>
          </Card>
        </Col>

        <Col span={16}>
          <Card
            title={
              <Space>
                <span>测试包选择</span>
                <Tooltip title={TestHelpContent} placement="topLeft">
                  <QuestionCircleOutlined style={{ color: '#1890ff', cursor: 'help' }} />
                </Tooltip>
              </Space>
            }
            extra={
              <Button
                type="primary"
                ghost
                size="small"
                icon={<AppstoreOutlined />}
                onClick={() => setIsLibraryOpen(true)}
              >
                用例包库
              </Button>
            }
            size="small"
          >
            <div style={{ marginBottom: 12 }}>
              <Switch
                checked={tab.pipelineMode}
                onChange={(checked) => setPipelineMode(tab.id, checked)}
                disabled={tab.isRunningTest}
                checkedChildren="流水线模式"
                unCheckedChildren="单阶段模式"
              />
            </div>

            {tab.pipelineMode ? (
              <div>
                <div style={{ marginBottom: 8, fontWeight: 'bold' }}>
                  流水线阶段（共 {(tab.pipelineStages || []).length} 个）
                </div>
                <Space direction="vertical" style={{ width: '100%' }}>
                  {(tab.pipelineStages || []).map((stage, index) => (
                    <Card
                      key={stage.id}
                      size="small"
                      title={
                        <Space>
                          <span>阶段 {index + 1}</span>
                          <Input
                            size="small"
                            placeholder="阶段名称"
                            value={stage.name}
                            onChange={(e) => updatePipelineStage(tab.id, stage.id, { name: e.target.value })}
                            disabled={tab.isRunningTest}
                            style={{ width: 160 }}
                          />
                        </Space>
                      }
                      extra={
                        <Space>
                          <Button
                            size="small"
                            icon={<ArrowUpOutlined />}
                            disabled={index === 0 || tab.isRunningTest}
                            onClick={() => {
                              const stages = [...(tab.pipelineStages || [])];
                              [stages[index - 1], stages[index]] = [stages[index], stages[index - 1]];
                              setPipelineStages(tab.id, stages);
                            }}
                          />
                          <Button
                            size="small"
                            icon={<ArrowDownOutlined />}
                            disabled={index === (tab.pipelineStages || []).length - 1 || tab.isRunningTest}
                            onClick={() => {
                              const stages = [...(tab.pipelineStages || [])];
                              [stages[index], stages[index + 1]] = [stages[index + 1], stages[index]];
                              setPipelineStages(tab.id, stages);
                            }}
                          />
                          <Button
                            size="small"
                            danger
                            icon={<DeleteOutlined />}
                            disabled={tab.isRunningTest}
                            onClick={() => removePipelineStage(tab.id, stage.id)}
                          />
                        </Space>
                      }
                    >
                      <Space direction="vertical" style={{ width: '100%' }}>
                        <Radio.Group
                          size="small"
                          value={stage.packageSource}
                          onChange={(e) =>
                            updatePipelineStage(tab.id, stage.id, {
                              packageSource: e.target.value,
                              packageFile: undefined,
                              packageFileName: '',
                              packageLibraryId: undefined,
                            })
                          }
                          disabled={tab.isRunningTest}
                        >
                          <Radio.Button value="library">用例包库</Radio.Button>
                        </Radio.Group>

                        <Dropdown
                          trigger={['click']}
                          menu={{
                            onClick: ({ key }) => {
                              const pkg = searchedPackages.find((p) => p.id === key);
                              if (pkg) {
                                updatePipelineStage(tab.id, stage.id, {
                                  packageSource: 'library',
                                  packageLibraryId: key,
                                  packageFileName: pkg.filename,
                                });
                              }
                            },
                            items: searchedPackages.length === 0 ? [
                              { key: 'empty', label: '无可用用例包', disabled: true }
                            ] : searchedPackages.map((pkg) => ({
                              key: pkg.id,
                              label: (
                                <Space>
                                  <span>{pkg.name}</span>
                                  {pkg.id.startsWith('builtin-') && <Tag color="blue">内置</Tag>}
                                  <Tag style={{ fontSize: 10 }}>{pkg.size}</Tag>
                                </Space>
                              ),
                            })),
                          }}
                        >
                          <Button
                            block
                            type={stage.packageLibraryId ? 'primary' : 'default'}
                            ghost={!!stage.packageLibraryId}
                            icon={<DatabaseOutlined />}
                            disabled={tab.isRunningTest}
                            style={{ marginBottom: 8 }}
                          >
                            {stage.packageLibraryId
                              ? `已选用例包: ${searchedPackages.find((p) => p.id === stage.packageLibraryId)?.name || stage.packageLibraryId}`
                              : '选择用例包'}
                            <DownOutlined />
                          </Button>
                        </Dropdown>

                        {(() => {
                          const selectedPkg = searchedPackages.find((p) => p.id === stage.packageLibraryId);
                          const requiredEnvVars = selectedPkg?.requiredEnvVars;
                          if (!requiredEnvVars || requiredEnvVars.length === 0) return null;
                          return (
                            <div style={{ marginBottom: 8, padding: '8px', background: '#fffbe6', borderRadius: 4, border: '1px solid #ffe58f' }}>
                              <div style={{ fontWeight: 500, marginBottom: 8, fontSize: 12 }}>
                                <ExclamationCircleOutlined /> 用例包要求配置以下环境变量：
                              </div>
                              {requiredEnvVars.map((envKey) => (
                                <div key={envKey} style={{ marginBottom: 6 }}>
                                  <Space size="small">
                                    <span style={{ width: 100, fontSize: 12 }}>{envKey}:</span>
                                    <Input
                                      size="small"
                                      placeholder={`请填写 ${envKey}`}
                                      value={stage.requiredEnvVarValues?.[envKey] || ''}
                                      onChange={(e) => {
                                        updatePipelineStage(tab.id, stage.id, {
                                          requiredEnvVarValues: {
                                            ...(stage.requiredEnvVarValues || {}),
                                            [envKey]: e.target.value,
                                          },
                                        });
                                      }}
                                      disabled={tab.isRunningTest}
                                      style={{ flex: 1 }}
                                    />
                                  </Space>
                                </div>
                              ))}
                            </div>
                          );
                        })()}

                        <div style={{ marginBottom: 8 }}>
                          <div style={{ fontWeight: 500, marginBottom: 6, fontSize: 12 }}>
                            <SettingOutlined style={{ marginRight: 4 }} />
                            阶段环境变量
                            {stage.envVars === undefined && (
                              <span style={{ color: '#999', fontWeight: 400, marginLeft: 6 }}>
                                （未配置时沿用模板或标签页环境变量）
                              </span>
                            )}
                          </div>
                          {(stage.envVars || []).map((env, envIndex) => (
                            <Row key={envIndex} gutter={6} style={{ marginBottom: 6 }}>
                              <Col span={9}>
                                <Input
                                  size="small"
                                  placeholder="变量名"
                                  value={env.key}
                                  onChange={(e) => {
                                    const list = [...(stage.envVars || [])];
                                    list[envIndex] = { ...list[envIndex], key: e.target.value };
                                    updatePipelineStage(tab.id, stage.id, { envVars: list });
                                  }}
                                  disabled={tab.isRunningTest}
                                />
                              </Col>
                              <Col span={11}>
                                <Input
                                  size="small"
                                  placeholder="变量值"
                                  value={env.value}
                                  onChange={(e) => {
                                    const list = [...(stage.envVars || [])];
                                    list[envIndex] = { ...list[envIndex], value: e.target.value };
                                    updatePipelineStage(tab.id, stage.id, { envVars: list });
                                  }}
                                  disabled={tab.isRunningTest}
                                />
                              </Col>
                              <Col span={4}>
                                <Button
                                  type="link"
                                  danger
                                  size="small"
                                  icon={<MinusCircleOutlined />}
                                  disabled={tab.isRunningTest}
                                  onClick={() => {
                                    const list = (stage.envVars || []).filter((_, i) => i !== envIndex);
                                    updatePipelineStage(tab.id, stage.id, { envVars: list });
                                  }}
                                />
                              </Col>
                            </Row>
                          ))}
                          <Button
                            type="dashed"
                            size="small"
                            icon={<PlusOutlined />}
                            disabled={tab.isRunningTest}
                            onClick={() => {
                              updatePipelineStage(tab.id, stage.id, {
                                envVars: [...(stage.envVars || []), { key: '', value: '' }],
                              });
                            }}
                            style={{ width: '100%' }}
                          >
                            添加环境变量
                          </Button>
                        </div>

                        <Select
                          size="small"
                          placeholder="选择配置模板（可选）"
                          value={stage.configTemplateId || undefined}
                          onChange={(value) => {
                            updatePipelineStage(tab.id, stage.id, { configTemplateId: value || null });
                          }}
                          allowClear
                          showSearch
                          optionFilterProp="label"
                          disabled={tab.isRunningTest}
                          style={{ width: '100%', marginBottom: 8 }}
                        >
                          {savedConfigs.filter((c) => c.configType === 'iteration').length === 0 ? (
                            <Option key="empty" value="empty" disabled label="无可用配置模板">
                              无可用配置模板
                            </Option>
                          ) : (
                            savedConfigs.filter((c) => c.configType === 'iteration').map((cfg) => (
                              <Option key={cfg.id} value={cfg.id} label={cfg.name}>
                                {cfg.name}
                              </Option>
                            ))
                          )}
                        </Select>

                        <Button
                          block
                          size="small"
                          type={stage.monitorCommands && stage.monitorCommands.length > 0 ? 'primary' : 'dashed'}
                          icon={<DesktopOutlined />}
                          disabled={tab.isRunningTest}
                          onClick={() =>
                            setEditingStageMonitor({
                              stageId: stage.id,
                              stageName: stage.name,
                              commands: stage.monitorCommands ? [...stage.monitorCommands] : [],
                            })
                          }
                        >
                          {stage.monitorCommands && stage.monitorCommands.filter((c) => c.enabled).length > 0
                            ? `已配置监控命令 (${stage.monitorCommands.filter((c) => c.enabled).length} 启用)`
                            : '配置阶段监控命令'}
                        </Button>

                        {stage.status && (
                          <Tag
                            color={
                              stage.status === 'completed'
                                ? 'success'
                                : stage.status === 'error'
                                ? 'error'
                                : stage.status === 'running'
                                ? 'processing'
                                : 'default'
                            }
                            style={{ fontSize: 12 }}
                          >
                            {stage.status === 'completed' && '已完成'}
                            {stage.status === 'running' && '运行中'}
                            {stage.status === 'error' && '失败'}
                            {stage.status === 'pending' && '待执行'}
                            {stage.status === 'skipped' && '已跳过'}
                          </Tag>
                        )}
                      </Space>
                    </Card>
                  ))}
                  <Button
                    type="dashed"
                    block
                    icon={<PlusOutlined />}
                    disabled={tab.isRunningTest}
                    onClick={() => {
                      const newStage: PipelineStage = {
                        id: `stage-${Date.now()}`,
                        name: `阶段 ${(tab.pipelineStages || []).length + 1}`,
                        order: (tab.pipelineStages || []).length,
                        packageSource: 'library',
                        packageFileName: '',
                      };
                      addPipelineStage(tab.id, newStage);
                    }}
                  >
                    添加阶段
                  </Button>
                </Space>
              </div>
            ) : (
              <>
                <Input
                  prefix={<SearchOutlined />}
                  placeholder="搜索用例包名称、描述或文件名"
                  value={packageSearchKeyword}
                  onChange={(e) => setPackageSearchKeyword(e.target.value)}
                  allowClear
                  style={{ marginBottom: 12 }}
                />

                <Select
                  style={{ width: '100%' }}
                  placeholder="请从用例包库选择测试包"
                  value={selectedLibraryPackageId}
                  onChange={(value) => {
                    setSelectedLibraryPackageId(value);
                    if (value) {
                      loadPackageFromLibrary(value);
                    }
                  }}
                  loading={isLoadingPackage}
                  disabled={tab.isRunningTest}
                  notFoundContent={<Empty description="未找到匹配的用例包" />}
                >
                  {searchedPackages.map(pkg => (
                    <Option key={pkg.id} value={pkg.id}>
                      <Space>
                        <span>{pkg.name}</span>
                        {pkg.id.startsWith('builtin-') && <Tag color="blue">内置</Tag>}
                        <Tag style={{ fontSize: 10 }}>{pkg.size}</Tag>
                        <span style={{ color: '#999', fontSize: 12 }}>{pkg.filename}</span>
                      </Space>
                    </Option>
                  ))}
                </Select>

                {selectedLibraryPackageId && (
                  <div style={{ marginTop: 12 }}>
                    {(() => {
                      const pkg = getPackageById(selectedLibraryPackageId);
                      return pkg ? (
                        <Descriptions size="small" column={1} bordered>
                          <Descriptions.Item label="描述">{pkg.description}</Descriptions.Item>
                          <Descriptions.Item label="文件名">{pkg.filename}</Descriptions.Item>
                          <Descriptions.Item label="更新时间">{pkg.updatedAt}</Descriptions.Item>
                        </Descriptions>
                      ) : null;
                    })()}
                  </div>
                )}

                {tab.powerTestConfig.packageFile && (
                  <div style={{ marginTop: 12 }}>
                    <Tag icon={<CheckCircleOutlined />} color="success">
                      已选择: {tab.powerTestConfig.packageFile.name}
                    </Tag>
                  </div>
                )}

                <div style={{ marginTop: 12 }}>
                  <Space size="small">
                    <span style={{ fontSize: 12, color: '#666' }}>任务名称（可选）:</span>
                    <Input
                      size="small"
                      placeholder={uploadMode === 'library' && selectedLibraryPackageId
                        ? `${getPackageById(selectedLibraryPackageId)?.name || '用例包'} - ${new Date().toLocaleDateString()}`
                        : tab.powerTestConfig.packageFile ? `${tab.powerTestConfig.packageFile.name} - ${new Date().toLocaleDateString()}` : '默认名称'}
                      value={tab.powerTestConfig.jobName || ''}
                      onChange={(e) => {
                        setPowerTestConfig(tab.id, { jobName: e.target.value || undefined });
                      }}
                      disabled={tab.isRunningTest}
                      style={{ width: 280 }}
                    />
                  </Space>
                </div>
              </>
            )}

            {/* 环境变量配置 - 测试包选择成功后显示（流水线模式下在各自阶段内独立配置） */}
            {!tab.pipelineMode && (tab.powerTestConfig.packageFile || selectedLibraryPackageId) && (
              <div style={{ marginTop: 16 }}>
                <Divider style={{ margin: '8px 0 12px' }} />
                <div style={{ fontWeight: 'bold', marginBottom: 8, fontSize: 14 }}>
                  <DatabaseOutlined style={{ marginRight: 6 }} />
                  环境变量配置
                </div>
                <div style={{ color: '#666', fontSize: 12, marginBottom: 8 }}>
                  自定义环境变量将在运行 run.sh 前注入，脚本中可通过 $变量名 读取
                </div>
                {(() => {
                  const selectedPkg = selectedLibraryPackageId ? getPackageById(selectedLibraryPackageId) : null;
                  const requiredEnvVars = selectedPkg?.requiredEnvVars;
                  if (requiredEnvVars && requiredEnvVars.length > 0) {
                    return (
                      <div style={{ marginBottom: 12, padding: '8px', background: '#fffbe6', borderRadius: 4, border: '1px solid #ffe58f' }}>
                        <div style={{ fontWeight: 500, marginBottom: 8, fontSize: 12 }}>
                          <ExclamationCircleOutlined /> 用例包要求配置以下环境变量：
                        </div>
                        {requiredEnvVars.map((envKey) => (
                          <div key={envKey} style={{ marginBottom: 6 }}>
                            <Space size="small">
                              <span style={{ width: 100, fontSize: 12 }}>{envKey}:</span>
                              <Input
                                size="small"
                                placeholder={`请填写 ${envKey}`}
                                value={tab.powerTestConfig.envVars.find(e => e.key === envKey)?.value || ''}
                                onChange={(e) => {
                                  const existing = tab.powerTestConfig.envVars.find(existing => existing.key === envKey);
                                  if (existing) {
                                    const newEnvVars = tab.powerTestConfig.envVars.map(existing => 
                                      existing.key === envKey ? { ...existing, value: e.target.value } : existing
                                    );
                                    setPowerTestConfig(tab.id, { envVars: newEnvVars });
                                  } else {
                                    setPowerTestConfig(tab.id, {
                                      envVars: [...tab.powerTestConfig.envVars, { key: envKey, value: e.target.value }],
                                    });
                                  }
                                }}
                                disabled={tab.isRunningTest}
                                style={{ flex: 1 }}
                              />
                            </Space>
                          </div>
                        ))}
                      </div>
                    );
                  }
                  return null;
                })()}
                {tab.powerTestConfig.envVars.map((env, index) => (
                  <Row key={index} gutter={8} style={{ marginBottom: 8 }}>
                    <Col span={10}>
                      <Input
                        placeholder="变量名"
                        size="small"
                        value={env.key}
                        onChange={(e) => {
                          const newEnvVars = [...tab.powerTestConfig.envVars];
                          newEnvVars[index] = { ...newEnvVars[index], key: e.target.value };
                          setPowerTestConfig(tab.id, { envVars: newEnvVars });
                        }}
                        disabled={tab.isRunningTest}
                      />
                    </Col>
                    <Col span={10}>
                      <Input
                        placeholder="变量值"
                        size="small"
                        value={env.value}
                        onChange={(e) => {
                          const newEnvVars = [...tab.powerTestConfig.envVars];
                          newEnvVars[index] = { ...newEnvVars[index], value: e.target.value };
                          setPowerTestConfig(tab.id, { envVars: newEnvVars });
                        }}
                        disabled={tab.isRunningTest}
                      />
                    </Col>
                    <Col span={4}>
                      <Button
                        type="link"
                        danger
                        size="small"
                        icon={<MinusCircleOutlined />}
                        onClick={() => {
                          const newEnvVars = tab.powerTestConfig.envVars.filter((_, i) => i !== index);
                          setPowerTestConfig(tab.id, { envVars: newEnvVars });
                        }}
                        disabled={tab.isRunningTest}
                      >
                        删除
                      </Button>
                    </Col>
                  </Row>
                ))}
                <Button
                  type="dashed"
                  size="small"
                  icon={<PlusOutlined />}
                  onClick={() => {
                    setPowerTestConfig(tab.id, {
                      envVars: [...tab.powerTestConfig.envVars, { key: '', value: '' }],
                    });
                  }}
                  disabled={tab.isRunningTest}
                  style={{ width: '100%' }}
                >
                  添加环境变量
                </Button>
              </div>
            )}

            <Divider style={{ margin: '16px 0' }} />

            <div style={{ textAlign: 'center' }}>
              {tab.isRunningTest ? (
                <Button
                  type="primary"
                  danger
                  size="large"
                  icon={<StopOutlined />}
                  onClick={handleStopTest}
                >
                  停止测试
                </Button>
              ) : (
                <>
                  <Space direction="vertical" size="small" style={{ marginBottom: 8, width: '100%' }}>
                    <Space size="small">
                      <span style={{ fontSize: 12, color: '#666' }}>任务名称（可选）:</span>
                      <Input
                        size="small"
                        placeholder={tab.pipelineMode
                          ? `${tab.name} - 流水线 - ${new Date().toLocaleString()}`
                          : `${tab.name} - ${new Date().toLocaleString()}`}
                        value={tab.powerTestConfig.jobName || ''}
                        onChange={(e) => {
                          setPowerTestConfig(tab.id, { jobName: e.target.value || undefined });
                        }}
                        disabled={tab.isRunningTest}
                        style={{ width: 300 }}
                      />
                    </Space>
                  </Space>
                  <Button
                    type="primary"
                    size="large"
                    icon={<PlayCircleOutlined />}
                    onClick={tab.pipelineMode ? handleStartPipeline : handleStartTest}
                  >
                    {tab.pipelineMode ? '开始流水线测试' : '开始迭代测试'}
                  </Button>
                </>
              )}
            </div>

            {tab.isRunningTest && (
              <div style={{ marginTop: 16 }}>
                <Progress percent={progress} status="active" />
                <div style={{ textAlign: 'center', color: '#666' }}>
                  {tab.pipelineMode ? (
                    <>阶段 {((tab.pipelineCurrentStageIndex || 0) + 1)} / {(tab.pipelineStages || []).length} · 迭代 {tab.currentIteration} / {stageTotalIterations}</>
                  ) : (
                    <>当前进度: {tab.currentIteration} / {totalIterations}</>
                  )}
                </div>
              </div>
            )}
          </Card>
        </Col>
      </Row>

      {tab.testResults.length > 0 && (
        <Card
          title={
            <Space>
              <SyncOutlined spin={tab.isRunningTest} />
              <span>测试结果</span>
              {tab.isRunningTest && (
                <Tag color="processing">测试中...</Tag>
              )}
              {!tab.isRunningTest && (
                <>
                  <Button
                    size="small"
                    icon={<LineChartOutlined />}
                    onClick={() => setIsChartModalOpen(true)}
                  >
                    查看时序图
                  </Button>
                  <Button
                    size="small"
                    icon={<InboxOutlined />}
                    onClick={() => setIsDraftManagerOpen(true)}
                  >
                    草稿箱
                  </Button>
                  <Button
                    size="small"
                    type="primary"
                    icon={<SaveOutlined />}
                    onClick={() => setIsSaveModalOpen(true)}
                  >
                    保存报告
                  </Button>
                  {tab.pipelineMode && (
                    <Button
                      size="small"
                      type="primary"
                      icon={<SaveOutlined />}
                      onClick={handleSaveAllStageReports}
                    >
                      保存全部阶段报告
                    </Button>
                  )}
                </>
              )}
            </Space>
          }
          extra={
            <Space>
              <Button
                type="link"
                icon={<InboxOutlined />}
                onClick={() => setIsDraftManagerOpen(true)}
              >
                草稿箱
              </Button>
              <Button
                type="link"
                icon={<FileTextOutlined />}
                onClick={() => setIsReportManagerOpen(true)}
              >
                报告管理
              </Button>
            </Space>
          }
          size="small"
          style={{ marginTop: 16 }}
        >
          <Table
            columns={columns}
            dataSource={tab.testResults}
            size="small"
            pagination={false}
            rowKey="iteration"
            scroll={{ y: 300 }}
          />

          {/* 监控数据展示 */}
          {monitorGroups.length > 0 && (
            <>
              <Divider style={{ margin: '16px 0' }} />
              <div style={{ fontWeight: 'bold', marginBottom: 12, fontSize: 14 }}>
                <DesktopOutlined style={{ marginRight: 6 }} />
                监控数据
              </div>
              <Tabs
                size="small"
                items={monitorGroups.map(group => {
                  return {
                    key: group.originalId,
                    label: group.name,
                    children: (
                      <Space direction="vertical" style={{ width: '100%' }}>
                        <ReactECharts
                          option={generateMonitorChartOption(group.colIds)}
                          style={{ height: 260 }}
                          onChartReady={bindYAxisWheelZoom}
                        />
                        <ReactECharts
                          option={generateMonitorScoreRatioChartOption(group.colIds)}
                          style={{ height: 260 }}
                          onChartReady={bindYAxisWheelZoom}
                        />
                        <Table
                          size="small"
                          pagination={false}
                          columns={[
                            { title: '迭代', dataIndex: 'iteration', width: 70 },
                            { title: '迭代参数', dataIndex: 'iterationLabel', width: 150, render: (v: string) => (
                              <Tooltip title={v} placement="topLeft">
                                <span style={{ display: 'inline-block', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {v}
                                </span>
                              </Tooltip>
                            ) },
                            ...group.colIds.map(colId => {
                              const firstResult = tab.testResults.find(r => r.monitorResults?.[colId]);
                              const colName = firstResult?.monitorResults?.[colId].commandName.split(' - ').pop() || colId;
                              return {
                                title: colName,
                                key: colId,
                                width: 130,
                                render: (_: unknown, record: any) => {
                                  const mr = record.monitorResults?.[colId];
                                  if (!mr) return '-';
                                  const ratio = mr.averageValue > 0 && record.score > 0 ? (record.score / mr.averageValue).toFixed(4) : '-';
                                  return (
                                    <div style={{ textAlign: 'center' }}>
                                      <div style={{ fontWeight: 'bold', color: '#52c41a', fontSize: 12 }}>{mr.averageValue.toFixed(4)}</div>
                                      <div style={{ fontSize: 11, color: '#fa8c16' }}>÷{ratio}</div>
                                    </div>
                                  );
                                },
                              };
                            }),
                            {
                              title: '操作',
                              key: 'action',
                              width: Math.max(80, group.colIds.length * 55),
                              fixed: 'right',
                              render: (_: unknown, record: any) => {
                                const result = tab.testResults.find(r => r.iteration === record.iteration);
                                if (!result) return null;
                                const menuItems = group.colIds
                                  .map(colId => {
                                    const mr = result.monitorResults?.[colId];
                                    if (!mr) return null;
                                    const colName = mr.commandName.split(' - ').pop() || colId;
                                    return {
                                      key: colId,
                                      label: colName,
                                      onClick: () => {
                                        setMonitorDetailModal({
                                          open: true,
                                          commandId: colId,
                                          commandName: mr.commandName,
                                          iteration: record.iteration,
                                          power: record.power,
                                          iterationLabel: result.iterationLabel || `功耗=${record.power}`,
                                          dataPoints: mr.dataPoints,
                                        });
                                      },
                                    };
                                  })
                                  .filter((item): item is NonNullable<typeof item> => item !== null);
                                if (group.colIds.length === 1) {
                                  const colId = group.colIds[0];
                                  const mr = result.monitorResults?.[colId];
                                  if (!mr) return null;
                                  return (
                                    <Button
                                      type="link"
                                      size="small"
                                      icon={<LineChartOutlined />}
                                      onClick={() => {
                                        setMonitorDetailModal({
                                          open: true,
                                          commandId: colId,
                                          commandName: mr.commandName,
                                          iteration: record.iteration,
                                          power: record.power,
                                          iterationLabel: result.iterationLabel || `功耗=${record.power}`,
                                          dataPoints: mr.dataPoints,
                                        });
                                      }}
                                    >
                                      查看详情
                                    </Button>
                                  );
                                }
                                return (
                                  <Dropdown menu={{ items: menuItems }}>
                                    <Button type="link" size="small" icon={<LineChartOutlined />}>
                                      查看详情
                                    </Button>
                                  </Dropdown>
                                );
                              },
                            },
                          ]}
                          dataSource={tab.testResults
                            .filter(r => group.colIds.some(id => r.monitorResults?.[id]))
                            .map(r => ({
                              ...r,
                              key: r.iteration,
                            }))}
                          rowKey="iteration"
                          scroll={{ y: 200, x: group.colIds.length > 4 ? 800 : undefined }}
                        />
                      </Space>
                    ),
                  };
                })}
              />
            </>
          )}
        </Card>
      )}

      {/* 时序图弹窗 */}
      <Modal
        title={chartModal.renderTitle('迭代-性能时序图')}
        open={isChartModalOpen}
        onCancel={() => setIsChartModalOpen(false)}
        width={chartModal.width}
        style={chartModal.style}
        styles={{ body: chartModal.bodyStyle }}
        footer={[
          <Button key="close" onClick={() => setIsChartModalOpen(false)}>
            关闭
          </Button>,
        ]}
      >
        {tab.testResults.length > 0 && (
          <>
            <div style={{ marginBottom: 16 }}>
              <Tag>主机: {tab.sshConfig.host}</Tag>
              <Tag>迭代次数: {tab.testResults.length}</Tag>
            </div>
            <ReactECharts
              onChartReady={bindYAxisWheelZoom}
              option={generateChartOption({
                id: '',
                name: '迭代测试结果',
                createdAt: '',
                config: {
                  host: tab.sshConfig.host,
                },
                results: tab.testResults,
              })}
              style={{ height: 400 }}
            />
          </>
        )}
      </Modal>

      {/* 保存报告弹窗 */}
      <Modal
        title={saveReportModal.renderTitle('保存测试报告')}
        open={isSaveModalOpen}
        onCancel={() => setIsSaveModalOpen(false)}
        onOk={async () => {
          const values = await saveReportForm.validateFields();
          try {
            await addReport({
              name: values.name,
              description: values.description,
              folderId: values.folderId,
              config: {
                host: tab.sshConfig.host,
                iterationParams: tab.powerTestConfig.iterationParams,
                adjustmentCommands: tab.powerTestConfig.adjustmentCommands,
              },
              results: tab.testResults,
              jobId: lastJobIdRef.current || undefined,
            });
            message.success('报告已保存');
            setIsSaveModalOpen(false);
            saveReportForm.resetFields();
          } catch {
            message.error('保存报告失败');
          }
        }}
        width={saveReportModal.width}
        style={saveReportModal.style}
        styles={{ body: saveReportModal.bodyStyle }}
      >
        <Form form={saveReportForm} layout="vertical">
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
          <Form.Item
            name="description"
            label="描述"
          >
            <Input.TextArea placeholder="可选：添加测试说明" rows={3} />
          </Form.Item>
          <Form.Item>
            <div style={{ color: '#666' }}>
              <div>测试主机: {tab.sshConfig.host}</div>
              <div>数据点: {tab.testResults.length} 个</div>
              <div>迭代参数: {tab.powerTestConfig.iterationParams.map(p => p.name).join(', ')}</div>
            </div>
          </Form.Item>
        </Form>
      </Modal>

      {/* 保存配置弹窗 */}
      <Modal
        title={saveConfigModal.renderTitle('保存测试配置')}
        open={isSaveConfigModalOpen}
        onCancel={() => setIsSaveConfigModalOpen(false)}
        onOk={handleSaveConfig}
        width={saveConfigModal.width}
        style={saveConfigModal.style}
        styles={{ body: saveConfigModal.bodyStyle }}
      >
        <Form form={saveConfigForm} layout="vertical">
          <Form.Item
            name="name"
            label="配置名称"
            rules={[{ required: true, message: '请输入配置名称' }]}
          >
            <Input placeholder="例如：标准功耗+电压迭代" />
          </Form.Item>
          <Form.Item
            name="description"
            label="描述"
          >
            <Input.TextArea placeholder="可选：添加配置说明" rows={3} />
          </Form.Item>
        </Form>
      </Modal>

      {/* 单次迭代采样点详情弹窗 */}
      <Modal
        title={detailModal.renderTitle(
          monitorDetailModal ? `${monitorDetailModal.commandName} - 第 ${monitorDetailModal.iteration} 轮采样详情` : ''
        )}
        open={monitorDetailModal?.open || false}
        onCancel={() => setMonitorDetailModal(null)}
        width={detailModal.width}
        style={detailModal.style}
        styles={{ body: detailModal.bodyStyle }}
        footer={[
          <Button key="close" onClick={() => setMonitorDetailModal(null)}>
            关闭
          </Button>,
        ]}
      >
        {monitorDetailModal && (
          <>
            <div style={{ marginBottom: 16 }}>
              <Tag>迭代: {monitorDetailModal.iteration}</Tag>
              <Tag>参数: {monitorDetailModal.iterationLabel}</Tag>
              <Tag>采样点数: {monitorDetailModal.dataPoints.length}</Tag>
            </div>
            <ReactECharts
              option={generateIterationDetailChartOption(monitorDetailModal.commandName, monitorDetailModal.dataPoints)}
              style={{ height: 400 }}
              onChartReady={bindYAxisWheelZoom}
            />
            <Table
              size="small"
              pagination={false}
              columns={[
                { title: '序号', dataIndex: 'idx', width: 70, render: (v: number) => v + 1 },
                { title: '时间', dataIndex: 'timestamp', width: 180, render: (v: string) => new Date(v).toLocaleTimeString() },
                { title: '监控值', dataIndex: 'value', width: 100, render: (v: number | null) => (!isNaN(v ?? 0) ? (v ?? 0).toFixed(4) : '0') },
                { title: '原始输出', dataIndex: 'raw', ellipsis: true },
              ]}
              dataSource={monitorDetailModal.dataPoints.map((p, idx) => ({ ...p, idx, key: idx }))}
              scroll={{ x: 'max-content', y: detailModal.isMaximized ? 420 : 250 }}
            />
          </>
        )}
      </Modal>

      <TestPackageLibrary
        visible={isLibraryOpen}
        onClose={() => setIsLibraryOpen(false)}
      />

      <TestReportManager
        visible={isReportManagerOpen}
        onClose={() => setIsReportManagerOpen(false)}
      />

      <TestDraftManager
        visible={isDraftManagerOpen}
        onClose={() => setIsDraftManagerOpen(false)}
        onImportDraft={(draft) => {
          // 恢复草稿到当前标签页
          setPowerTestConfig(tab.id, {
            iterationParams: draft.config.iterationParams,
            adjustmentCommands: draft.config.adjustmentCommands,
            monitorCommands: draft.config.monitorCommands,
            envVars: draft.config.envVars,
          });
          // 恢复结果数据
          clearTestResults(tab.id);
          draft.results.forEach((result) => {
            addTestResult(tab.id, result);
          });
          setTestStatus(tab.id, 'completed');
          message.success(`已恢复草稿: ${draft.name}`);
        }}
      />

      <Modal
        title={stageMonitorModal.renderTitle(`配置监控命令 - ${editingStageMonitor?.stageName || ''}`)}
        open={!!editingStageMonitor}
        onCancel={() => setEditingStageMonitor(null)}
        onOk={() => {
          if (editingStageMonitor) {
            updatePipelineStage(tab.id, editingStageMonitor.stageId, {
              monitorCommands: editingStageMonitor.commands,
            });
          }
          setEditingStageMonitor(null);
        }}
        width={stageMonitorModal.width}
        style={stageMonitorModal.style}
        styles={{ body: stageMonitorModal.bodyStyle }}
        destroyOnClose
      >
        {editingStageMonitor && (
          <MonitorConfigPanel
            tabId={tab.id}
            commands={editingStageMonitor.commands}
            onChange={(commands) =>
              setEditingStageMonitor((prev) => (prev ? { ...prev, commands } : null))
            }
            globalBmcSessionId={tab.powerTestConfig.globalBmcSessionId}
            disabled={tab.isRunningTest}
          />
        )}
      </Modal>

      <BMCConfigPanel
        open={isBMCConfigOpen}
        onClose={() => setIsBMCConfigOpen(false)}
      />
    </div>
  );
};

export default PowerTestPanel;
