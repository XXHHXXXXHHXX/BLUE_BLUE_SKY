'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  Modal,
  Button,
  Table,
  Space,
  Tag,
  Popconfirm,
  message,
  Input,
  Empty,
  Tooltip,
  Form,
  Spin,
  Progress,
  Row,
  Col,
  Tree,
  TreeSelect,
  Typography,
  Tabs,
  InputNumber,
  Popover,
} from 'antd';
import {
  FileTextOutlined,
  DeleteOutlined,
  DownloadOutlined,
  SearchOutlined,
  LineChartOutlined,
  DesktopOutlined,
  EditOutlined,
  PlusOutlined,
  FolderOutlined,
  FolderOpenOutlined,
  FolderAddOutlined,
  EnvironmentOutlined,
  ImportOutlined,
  MergeOutlined,
} from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import {
  useTestReportStore,
  generateChartOption,
  type TestReport,
  type FolderTreeNode,
  isDefaultFolder,
} from '../../stores/testReportStore';
import type { MonitorDataPoint } from '../../stores/testStore';

import { bindYAxisWheelZoom } from '../../utils/chartWheelZoom';
import { getScrollLegend, tooltipBase, formatAxisTooltip } from '../../utils/monitorChartFormat';
import useMaximizableModal from '../../hooks/useMaximizableModal';
import EnvironmentInfoModal from './EnvironmentInfoModal';

interface TestReportManagerProps {
  visible: boolean;
  onClose: () => void;
}

const { Text } = Typography;

const TestReportManager: React.FC<TestReportManagerProps> = ({ visible, onClose }) => {
  const {
    reports,
    folders,
    isLoading,
    removeReport,
    updateReport,
    updateReportCustomAvgRanges,
    searchReports,
    fetchReports,
    createFolder,
    renameFolder,
    deleteFolder,
    getFolderTree,
    getSelectedFolderId,
    setSelectedFolderId,
    getReportsByFolder,
    buildFolderTreeOptions,
  } = useTestReportStore();
  const [searchKeyword, setSearchKeyword] = useState('');
  const [viewingReport, setViewingReport] = useState<TestReport | null>(null);
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const [monitorDetailModal, setMonitorDetailModal] = useState<{
    open: boolean;
    reportId: string;
    jobId?: string;
    commandId: string;
    commandName: string;
    iteration: number;
    power: number;
    iterationLabel?: string;
    dataPoints: MonitorDataPoint[];
    loading: boolean;
    avgStart?: number;
    avgEnd?: number;
  } | null>(null);
  const [renameModal, setRenameModal] = useState<{
    open: boolean;
    report: TestReport | null;
  }>({ open: false, report: null });
  const [batchMoveModal, setBatchMoveModal] = useState<{
    open: boolean;
    targetFolderId: string;
  }>({ open: false, targetFolderId: 'uncategorized' });
  const [environmentModal, setEnvironmentModal] = useState<{
    open: boolean;
    report: TestReport | null;
  }>({ open: false, report: null });
  const [renameForm] = Form.useForm();
  const [exportProgress, setExportProgress] = useState<{
    visible: boolean;
    percent: number;
    status: 'active' | 'success' | 'exception';
    message: string;
  }>({ visible: false, percent: 0, status: 'active', message: '' });

  // 目录相关弹窗
  const [folderModal, setFolderModal] = useState<{
    open: boolean;
    mode: 'create' | 'rename';
    parentId: string | null;
    folderId: string | null;
    folderName: string;
  }>({
    open: false,
    mode: 'create',
    parentId: null,
    folderId: null,
    folderName: '',
  });
  const [folderForm] = Form.useForm();

  // 导入报告弹窗
  const [importModal, setImportModal] = useState<{
    open: boolean;
    step: 'scan' | 'preview';
    scanning: boolean;
    importing: boolean;
  }>({ open: false, step: 'scan', scanning: false, importing: false });
  const [importForm] = Form.useForm();
  const [importPreview, setImportPreview] = useState<{
    iterations: number[];
    commands: { id: string; name: string }[];
    dataPointsCount: number;
    hasMetadata: boolean;
    metadata?: Record<string, unknown>;
  } | null>(null);
  const importModalSize = useMaximizableModal({ minWidth: 800 });

  // 合并报告弹窗
  const [mergeModal, setMergeModal] = useState<{
    open: boolean;
    merging: boolean;
    selectedReports: TestReport[];
  }>({ open: false, merging: false, selectedReports: [] });
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);

  const [customAvgRange, setCustomAvgRange] = useState<Record<string, { avgStart?: number; avgEnd?: number }>>({});

  const calculateCustomAvg = (dataPoints: MonitorDataPoint[], avgStart?: number, avgEnd?: number): number => {
    if (!dataPoints || dataPoints.length === 0) return 0;
    const start = avgStart !== undefined ? Math.max(0, avgStart - 1) : 0;
    const end = avgEnd !== undefined ? Math.min(dataPoints.length, avgEnd) : dataPoints.length;
    if (start >= end) return 0;
    const subset = dataPoints.slice(start, end);
    const validValues = subset.map(p => p.value).filter(v => !isNaN(v));
    return validValues.length > 0 ? validValues.reduce((a, b) => a + b, 0) / validValues.length : 0;
  };

  const reportModal = useMaximizableModal({ minWidth: 1400, minPageSize: 5, maxPageSize: 25 });
  const chartModal = useMaximizableModal({ minWidth: 1200 });
  const detailModal = useMaximizableModal({ minWidth: 1100, minPageSize: 100, maxPageSize: 200 });

  const selectedFolderId = getSelectedFolderId();

  // 打开弹窗时刷新数据
  useEffect(() => {
    if (visible) {
      fetchReports();
    }
  }, [visible, fetchReports]);

  // 确保默认目录展开（仅在弹窗打开时初始化一次，避免依赖自身 state 导致无限循环）
  useEffect(() => {
    if (visible) {
      setExpandedKeys((prev) => {
        const defaultId = 'uncategorized';
        if (prev.includes(defaultId)) return prev;
        return Array.from(new Set([...prev, defaultId]));
      });
    }
  }, [visible]);

  // 高亮匹配文本
  const highlight = (text: string, keyword: string) => {
    if (!keyword.trim()) return <span>{text}</span>;
    const lowerKeyword = keyword.toLowerCase();
    const lowerText = text.toLowerCase();
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let idx = lowerText.indexOf(lowerKeyword, lastIndex);
    let key = 0;
    while (idx !== -1) {
      if (idx > lastIndex) {
        parts.push(<span key={key++}>{text.slice(lastIndex, idx)}</span>);
      }
      parts.push(
        <span key={key++} style={{ background: '#fff566', color: '#000000d9', fontWeight: 500 }}>
          {text.slice(idx, idx + keyword.length)}
        </span>
      );
      lastIndex = idx + keyword.length;
      idx = lowerText.indexOf(lowerKeyword, lastIndex);
    }
    if (lastIndex < text.length) {
      parts.push(<span key={key++}>{text.slice(lastIndex)}</span>);
    }
    return <span>{parts}</span>;
  };

  const currentReports = useMemo(
    () => getReportsByFolder(selectedFolderId),
    [getReportsByFolder, selectedFolderId, reports]
  );
  const displayedReports = searchKeyword
    ? searchReports(selectedFolderId, searchKeyword)
    : currentReports;

  const folderTree = useMemo(() => getFolderTree(), [getFolderTree, folders]);

  // 计算每个目录下的报告数量（包含子目录）
  const folderReportCounts = useMemo(() => {
    const counts: Record<string, number> = {};

    const countFor = (folderId: string): number => {
      if (counts[folderId] !== undefined) return counts[folderId];
      let count = reports.filter((r) => (r.folderId || 'uncategorized') === folderId).length;
      for (const f of folders) {
        if (f.parentId === folderId) {
          count += countFor(f.id);
        }
      }
      counts[folderId] = count;
      return count;
    };

    for (const f of folders) {
      countFor(f.id);
    }
    countFor('uncategorized');
    return counts;
  }, [folders, reports]);

  const handleDelete = async (id: string) => {
    try {
      await removeReport(id);
      message.success('报告已删除');
    } catch {
      message.error('删除失败');
    }
  };

  const handleBatchDelete = async () => {
    if (selectedRowKeys.length === 0) return;
    try {
      for (const id of selectedRowKeys) {
        await removeReport(id);
      }
      setSelectedRowKeys([]);
      message.success(`已删除 ${selectedRowKeys.length} 个报告`);
    } catch {
      message.error('删除失败');
    }
  };

  const handleBatchMove = async () => {
    if (selectedRowKeys.length === 0) return;
    try {
      for (const id of selectedRowKeys) {
        await updateReport(id, { folderId: batchMoveModal.targetFolderId });
      }
      setSelectedRowKeys([]);
      setBatchMoveModal({ open: false, targetFolderId: 'uncategorized' });
      message.success(`已移动 ${selectedRowKeys.length} 个报告`);
    } catch {
      message.error('移动失败');
    }
  };

  const openImportModal = () => {
    setImportModal({ open: true, step: 'scan', scanning: false, importing: false });
    setImportPreview(null);
    importForm.resetFields();
    importForm.setFieldsValue({
      sourcePath: '',
      name: '',
      description: '',
      host: '',
      folderId: getSelectedFolderId() || 'uncategorized',
    });
  };

  const closeImportModal = () => {
    setImportModal((prev) => ({ ...prev, open: false }));
    setImportPreview(null);
    importForm.resetFields();
  };

  const buildDefaultResults = (preview: typeof importPreview) => {
    if (!preview) return [];
    return preview.iterations.map((iteration, idx) => ({
      iteration,
      power: iteration,
      score: 0,
      status: 'success' as const,
      timestamp: new Date(Date.now() - (preview.iterations.length - idx) * 1000).toISOString(),
      iterationLabel: `迭代 ${iteration}`,
      iterationValues: {},
      monitorResults: Object.fromEntries(
        preview.commands.map((cmd) => [
          cmd.id,
          {
            commandId: cmd.id,
            commandName: cmd.name,
            averageValue: 0,
            dataPoints: [],
            dataPointsCount: 0,
          },
        ])
      ),
    }));
  };

  const handleScanImport = async () => {
    const values = await importForm.validateFields(['sourcePath']);
    setImportModal((prev) => ({ ...prev, scanning: true }));
    try {
      const res = await fetch('/api/test/reports/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'scan', sourcePath: values.sourcePath }),
      });
      const data = await res.json();
      if (!data.success) {
        message.error(data.message || '扫描失败');
        return;
      }
      setImportPreview({
        iterations: data.iterations,
        commands: data.commands,
        dataPointsCount: data.dataPointsCount,
        hasMetadata: data.hasMetadata,
        metadata: data.metadata,
      });

      // 如果有 metadata，优先预填
      if (data.hasMetadata && data.metadata) {
        const meta = data.metadata as any;
        importForm.setFieldsValue({
          name: meta.name || '',
          description: meta.description || '',
          host: meta.config?.host || '',
          folderId: meta.folderId || getSelectedFolderId() || 'uncategorized',
          results: JSON.stringify(meta.results || buildDefaultResults({
            iterations: data.iterations,
            commands: data.commands,
            dataPointsCount: data.dataPointsCount,
            hasMetadata: false,
          }), null, 2),
          config: JSON.stringify(meta.config || { host: meta.config?.host || '' }, null, 2),
        });
      } else {
        importForm.setFieldsValue({
          name: `导入报告 ${new Date().toLocaleString()}`,
          description: '',
          host: '',
          folderId: getSelectedFolderId() || 'uncategorized',
          results: JSON.stringify(buildDefaultResults({
            iterations: data.iterations,
            commands: data.commands,
            dataPointsCount: data.dataPointsCount,
            hasMetadata: false,
          }), null, 2),
          config: JSON.stringify({ host: '' }, null, 2),
        });
      }
      setImportModal((prev) => ({ ...prev, step: 'preview' }));
      message.success(`扫描完成：发现 ${data.iterations.length} 个迭代，${data.commands.length} 个命令`);
    } catch {
      message.error('扫描失败');
    } finally {
      setImportModal((prev) => ({ ...prev, scanning: false }));
    }
  };

  const handleImportSubmit = async () => {
    const values = await importForm.validateFields();
    let results: any[];
    let config: any;
    try {
      results = JSON.parse(values.results || '[]');
    } catch {
      message.error('结果 JSON 格式错误');
      return;
    }
    try {
      config = JSON.parse(values.config || '{}');
    } catch {
      message.error('配置 JSON 格式错误');
      return;
    }
    if (!Array.isArray(results)) {
      message.error('结果必须是数组');
      return;
    }

    setImportModal((prev) => ({ ...prev, importing: true }));
    try {
      const res = await fetch('/api/test/reports/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'import',
          sourcePath: values.sourcePath,
          reportData: {
            name: values.name,
            description: values.description,
            folderId: values.folderId,
            host: values.host,
            config,
            results,
          },
        }),
      });
      const data = await res.json();
      if (!data.success) {
        message.error(data.message || '导入失败');
        return;
      }
      message.success('报告导入成功');
      closeImportModal();
      fetchReports();
    } catch {
      message.error('导入失败');
    } finally {
      setImportModal((prev) => ({ ...prev, importing: false }));
    }
  };

  // 打开合并弹窗
  const openMergeModal = () => {
    if (selectedRowKeys.length !== 2) {
      message.warning('请选择两个报告进行合并');
      return;
    }
    const reportsToMerge = displayedReports.filter((r) => selectedRowKeys.includes(r.id));
    if (reportsToMerge.length !== 2) {
      message.warning('请选择两个报告进行合并');
      return;
    }
    setMergeModal({ open: true, merging: false, selectedReports: reportsToMerge });
  };

  // 关闭合并弹窗
  const closeMergeModal = () => {
    setMergeModal({ open: false, merging: false, selectedReports: [] });
  };

  // 执行报告合并
  const handleMergeReports = async () => {
    if (mergeModal.selectedReports.length !== 2) {
      message.warning('请选择两个报告进行合并');
      return;
    }
    const [report1, report2] = mergeModal.selectedReports;

    // 获取两个报告的采样字段（monitorResults commandId 列表）
    const getCommandIds = (report: TestReport): string[] => {
      const ids = new Set<string>();
      for (const result of report.results) {
        if (result.monitorResults) {
          Object.keys(result.monitorResults).forEach((key) => ids.add(key));
        }
      }
      return Array.from(ids).sort();
    };

    const commandIds1 = getCommandIds(report1);
    const commandIds2 = getCommandIds(report2);

    if (commandIds1.length !== commandIds2.length || !commandIds1.every((id, idx) => id === commandIds2[idx])) {
      message.error('两个报告的采样字段不一致，无法合并');
      return;
    }

    setMergeModal((prev) => ({ ...prev, merging: true }));
    try {
      const res = await fetch('/api/test/reports/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          report1Id: report1.id,
          report2Id: report2.id,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        message.error(data.message || '合并失败');
        return;
      }
      message.success('报告合并成功');
      closeMergeModal();
      setSelectedRowKeys([]);
      fetchReports();
    } catch {
      message.error('合并失败');
    } finally {
      setMergeModal((prev) => ({ ...prev, merging: false }));
    }
  };

  const handleExport = (report: TestReport) => {
    setExportProgress({
      visible: true,
      percent: 0,
      status: 'active',
      message: '正在连接导出服务...',
    });

    const es = new EventSource(`/api/test/reports/${report.id}/export`);

    es.addEventListener('progress', (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data);
        setExportProgress({
          visible: true,
          percent: data.percent,
          status: 'active',
          message: `正在生成 Excel：已处理 ${data.processed} / ${data.totalRows} 行`,
        });
      } catch {
        // ignore
      }
    });

    es.addEventListener('done', (e) => {
      try {
        const { downloadUrl } = JSON.parse((e as MessageEvent).data);
        setExportProgress({
          visible: true,
          percent: 100,
          status: 'success',
          message: '导出完成，开始下载...',
        });
        es.close();

        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = `test-report-${report.name}-${report.createdAt.split('T')[0]}.xlsx`;
        document.body.appendChild(a);
        a.click();
        a.remove();

        setTimeout(() => {
          setExportProgress((prev) => ({ ...prev, visible: false }));
        }, 1500);
      } catch {
        es.close();
        setExportProgress({
          visible: true,
          percent: 100,
          status: 'exception',
          message: '下载链接解析失败',
        });
        message.error('导出失败');
      }
    });

    es.addEventListener('error', (e) => {
      let msg = '导出失败';
      try {
        const data = JSON.parse((e as MessageEvent).data);
        msg = data.message || msg;
      } catch {
        // ignore
      }
      es.close();
      setExportProgress({
        visible: true,
        percent: 100,
        status: 'exception',
        message: msg,
      });
      message.error(msg);
    });

    es.onerror = () => {
      setExportProgress((prev) => {
        if (prev.status === 'success') return prev;
        return { ...prev, status: 'exception', message: '导出连接中断' };
      });
      es.close();
    };
  };

  const handleViewChart = (report: TestReport) => {
    setViewingReport(report);
  };

  // 从报告中提取所有监控命令ID
  const reportMonitorCommandIds = React.useMemo(() => {
    if (!viewingReport) return [];
    const ids = new Set<string>();
    viewingReport.results.forEach((r) => {
      if (r.monitorResults) {
        Object.keys(r.monitorResults).forEach((id) => ids.add(id));
      }
    });
    return Array.from(ids);
  }, [viewingReport]);

  const COLORS = ['#52c41a', '#1890ff', '#fa8c16', '#f5222d', '#722ed1', '#13c2c2', '#eb2f96', '#fa541c'];

  // 按原始监控命令分组（处理 list 模式的 __col__N 后缀）
  const reportMonitorGroups = React.useMemo(() => {
    const groups: Record<string, { originalId: string; name: string; colIds: string[] }> = {};
    reportMonitorCommandIds.forEach((id) => {
      const originalId = id.replace(/__col__\d+$/, '');
      if (!groups[originalId]) {
        const firstResult = viewingReport?.results.find((r) => r.monitorResults?.[id]);
        const fullName = firstResult?.monitorResults?.[id].commandName || originalId;
        groups[originalId] = { originalId, name: fullName, colIds: [] };
      }
      if (!groups[originalId].colIds.includes(id)) {
        groups[originalId].colIds.push(id);
      }
    });
    return Object.values(groups)
      .filter((g) => g.colIds.length > 0)
      .sort((a, b) => a.originalId.localeCompare(b.originalId));
  }, [reportMonitorCommandIds, viewingReport]);

  // 生成报告监控图表配置（平均值）
  const generateReportMonitorChartOption = (report: TestReport, commandId: string) => {
    const data = report.results
      .filter((r) => r.monitorResults?.[commandId])
      .map((r) => ({
        iteration: r.iteration,
        power: r.power,
        iterationLabel: r.iterationLabel,
        averageValue: r.monitorResults![commandId].averageValue,
      }));

    const firstResult = report.results.find((r) => r.monitorResults?.[commandId]);
    const commandName = firstResult?.monitorResults?.[commandId].commandName || commandId;

    return {
      title: { text: `${commandName} - 跨迭代平均值趋势`, left: 'center', textStyle: { fontSize: 14 } },
      tooltip: {
        trigger: 'axis',
        formatter: (params: any[]) => {
          const p = params[0];
          const label = data[p.dataIndex].iterationLabel || `${data[p.dataIndex].power}`;
          return `迭代: ${data[p.dataIndex].iteration}<br/>参数: ${label}<br/>平均值: ${p.value}`;
        },
      },
      grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
      xAxis: {
        type: 'category',
        name: '迭代 (参数)',
        data: data.map((d) => `${d.iteration}\n(${d.iterationLabel || d.power})`),
      },
      yAxis: { type: 'value', name: '平均值' },
      series: [
        {
          name: commandName,
          type: 'line',
          data: data.map((d) => d.averageValue),
          smooth: true,
          symbol: 'circle',
          symbolSize: 8,
          lineStyle: { width: 2, color: '#52c41a' },
          itemStyle: { color: '#52c41a' },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(82,196,26,0.3)' },
                { offset: 1, color: 'rgba(82,196,26,0.05)' },
              ],
            },
          },
        },
      ],
    };
  };

  // 生成分数/平均值趋势图
  const generateReportMonitorScoreRatioChartOption = (report: TestReport, commandId: string) => {
    const data = report.results
      .filter((r) => r.monitorResults?.[commandId] && r.score > 0)
      .map((r) => ({
        iteration: r.iteration,
        power: r.power,
        iterationLabel: r.iterationLabel,
        score: r.score,
        averageValue: r.monitorResults![commandId].averageValue,
        ratio: r.monitorResults![commandId].averageValue > 0 ? r.score / r.monitorResults![commandId].averageValue : 0,
      }));

    const firstResult = report.results.find((r) => r.monitorResults?.[commandId]);
    const commandName = firstResult?.monitorResults?.[commandId].commandName || commandId;

    return {
      title: { text: `${commandName} - 分数/平均值趋势`, left: 'center', textStyle: { fontSize: 14 } },
      tooltip: {
        trigger: 'axis',
        formatter: (params: any[]) => {
          const p = params[0];
          const d = data[p.dataIndex];
          const label = d.iterationLabel || `${d.power}`;
          return `迭代: ${d.iteration}<br/>参数: ${label}<br/>分数: ${d.score}<br/>平均值: ${d.averageValue.toFixed(4)}<br/>分数/平均值: ${p.value.toFixed(4)}`;
        },
      },
      grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
      xAxis: {
        type: 'category',
        name: '迭代 (参数)',
        data: data.map((d) => `${d.iteration}\n(${d.iterationLabel || d.power})`),
      },
      yAxis: { type: 'value', name: '分数/平均值' },
      series: [
        {
          name: '分数/平均值',
          type: 'line',
          data: data.map((d) => d.ratio),
          smooth: true,
          symbol: 'circle',
          symbolSize: 8,
          lineStyle: { width: 2, color: '#fa8c16' },
          itemStyle: { color: '#fa8c16' },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(250,140,22,0.3)' },
                { offset: 1, color: 'rgba(250,140,22,0.05)' },
              ],
            },
          },
        },
      ],
    };
  };

  // 生成所有监控命令的平均值趋势图（多曲线）
  const generateReportAllMonitorChartOption = (report: TestReport, commandIds: string[]) => {
    const relevantResults = report.results.filter((r) =>
      commandIds.some((id) => r.monitorResults?.[id])
    );

    const seriesList = commandIds.map((id) => {
      const firstResult = report.results.find((r) => r.monitorResults?.[id]);
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
      legend: getScrollLegend(seriesList.map((s) => s.name)),
      grid: { left: '3%', right: '4%', bottom: '15%', containLabel: true },
      xAxis: {
        type: 'category',
        name: '迭代 (参数)',
        data: relevantResults.map((r) => `${r.iteration}\n(${r.iterationLabel || r.power})`),
      },
      yAxis: { type: 'value', name: '平均值' },
      series: seriesList.map((s, idx) => {
        const color = COLORS[idx % COLORS.length];
        const data = relevantResults.map((r) => {
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

  // 按报告/任务按需加载单次迭代采样点
  const loadReportMonitorDataPoints = async (
    reportId: string,
    iteration: number,
    commandId: string,
    jobId?: string,
    stageId?: string
  ): Promise<MonitorDataPoint[]> => {
    try {
      const res = await fetch(
        `/api/test/reports/${reportId}/monitor-data?iteration=${iteration}&commandId=${encodeURIComponent(commandId)}&limit=5000`
      );
      const data = await res.json();
      if (data.success) return data.data.dataPoints;
    } catch (err) {
      console.error('加载报告采样点失败:', err);
    }

    // 兼容旧报告：如果报告文件不存在且关联任务仍存在，从任务数据加载
    if (jobId) {
      try {
        let url = `/api/test/jobs/${jobId}/monitor-data?iteration=${iteration}&commandId=${encodeURIComponent(commandId)}&limit=5000`;
        if (stageId) {
          url += `&stageId=${encodeURIComponent(stageId)}`;
        }
        const res = await fetch(url);
        const data = await res.json();
        if (data.success) return data.data.dataPoints;
      } catch (err) {
        console.error('从任务加载采样点失败:', err);
      }
    }

    return [];
  };

  // 生成单次迭代采样点曲线图配置
  const generateReportIterationDetailChartOption = (
    commandName: string,
    dataPoints: Array<{ timestamp: string; value: number; raw: string }>
  ) => {
    const validPoints = dataPoints
      .map((p, idx) => ({ idx, value: p.value ?? 0 }))
      .filter((p) => !isNaN(p.value));
    return {
      title: { text: `${commandName} - 单次迭代采样详情`, left: 'center', textStyle: { fontSize: 14 } },
      tooltip: {
        trigger: 'axis',
        formatter: (params: any[]) => {
          const p = params[0];
          const dp = dataPoints[p.dataIndex];
          return `采样点: ${p.dataIndex + 1}<br/>时间: ${new Date(dp.timestamp).toLocaleTimeString()}<br/>值: ${p.value}`;
        },
      },
      grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
      xAxis: {
        type: 'category',
        name: '采样点序号',
        data: validPoints.map((p) => `${p.idx + 1}`),
      },
      yAxis: { type: 'value', name: '监控值' },
      series: [
        {
          name: commandName,
          type: 'line',
          data: validPoints.map((p) => p.value),
          smooth: true,
          symbol: 'circle',
          symbolSize: 6,
          lineStyle: { width: 2, color: '#1890ff' },
          itemStyle: { color: '#1890ff' },
        },
      ],
    };
  };

  // 目录操作
  const openCreateFolderModal = (parentId: string | null) => {
    setFolderModal({
      open: true,
      mode: 'create',
      parentId,
      folderId: null,
      folderName: '',
    });
    folderForm.setFieldsValue({ parentId: parentId || undefined, name: '' });
  };

  const openRenameFolderModal = (folder: FolderTreeNode) => {
    setFolderModal({
      open: true,
      mode: 'rename',
      parentId: folder.data.parentId,
      folderId: folder.key,
      folderName: folder.title,
    });
    folderForm.setFieldsValue({ parentId: folder.data.parentId || undefined, name: folder.title });
  };

  const handleFolderModalOk = async () => {
    const values = await folderForm.validateFields();
    try {
      if (folderModal.mode === 'create') {
        await createFolder(folderModal.parentId, values.name);
        message.success('目录已创建');
        if (folderModal.parentId) {
          setExpandedKeys((prev) => Array.from(new Set([...prev, folderModal.parentId!])));
        }
      } else if (folderModal.mode === 'rename' && folderModal.folderId) {
        await renameFolder(folderModal.folderId, values.name);
        message.success('目录已重命名');
      }
      setFolderModal((prev) => ({ ...prev, open: false }));
      folderForm.resetFields();
    } catch (err: any) {
      message.error(err.message || '操作失败');
    }
  };

  const handleDeleteFolder = async (folder: FolderTreeNode) => {
    try {
      await deleteFolder(folder.key);
      message.success('目录已删除，报告已移至未分类');
    } catch (err: any) {
      message.error(err.message || '删除目录失败');
    }
  };

  const renderTreeTitle = (node: FolderTreeNode) => {
    const isDefault = isDefaultFolder(node.key);
    const count = folderReportCounts[node.key] ?? 0;
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
          paddingRight: 8,
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden' }}>
          {isDefault ? <FolderOutlined style={{ color: '#1890ff' }} /> : <FolderOpenOutlined style={{ color: '#faad14' }} />}
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.title}</span>
          <Tag style={{ marginLeft: 4 }}>{count}</Tag>
        </span>
        <span style={{ display: 'flex', gap: 4 }}>
          <Tooltip title="添加子目录">
            <Button
              type="text"
              size="small"
              icon={<PlusOutlined />}
              onClick={(e) => {
                e.stopPropagation();
                openCreateFolderModal(node.key);
              }}
            />
          </Tooltip>
          {!isDefault && (
            <Tooltip title="重命名">
              <Button
                type="text"
                size="small"
                icon={<EditOutlined />}
                onClick={(e) => {
                  e.stopPropagation();
                  openRenameFolderModal(node);
                }}
              />
            </Tooltip>
          )}
          {!isDefault && (
            <Popconfirm
              title="确定删除此目录？"
              description="子目录和报告会自动处理：报告将移至未分类。"
              onConfirm={(e) => {
                e?.stopPropagation();
                handleDeleteFolder(node);
              }}
              onCancel={(e) => e?.stopPropagation()}
            >
              <Button
                type="text"
                size="small"
                danger
                icon={<DeleteOutlined />}
                onClick={(e) => e.stopPropagation()}
              />
            </Popconfirm>
          )}
        </span>
      </div>
    );
  };

  const columns = [
    {
      title: '报告名称',
      dataIndex: 'name',
      key: 'name',
      render: (text: string) => (
        <Space>
          <FileTextOutlined />
          {highlight(text, searchKeyword)}
        </Space>
      ),
    },
    {
      title: '目录',
      key: 'folder',
      width: 120,
      render: (_: unknown, record: TestReport) => {
        const folderId = record.folderId || 'uncategorized';
        const folder = folders.find((f) => f.id === folderId);
        return <Tag color={isDefaultFolder(folderId) ? 'blue' : 'orange'}>{folder?.name || '未分类'}</Tag>;
      },
    },
    {
      title: '测试主机',
      key: 'host',
      render: (_: unknown, record: TestReport) => highlight(record.config.host, searchKeyword),
    },
    {
      title: '测试范围',
      key: 'range',
      render: (_: unknown, record: TestReport) => (
        <span>
          {record.config.startPower}W - {record.config.endPower}W
        </span>
      ),
    },
    {
      title: '数据点',
      key: 'dataPoints',
      render: (_: unknown, record: TestReport) => <Tag>{record.results.length} 个</Tag>,
    },
    {
      title: '阶段',
      key: 'stage',
      render: (_: unknown, record: TestReport) =>
        record.stageName ? <Tag color="purple">{record.stageName}</Tag> : '-',
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      render: (text: string) => new Date(text).toLocaleString(),
    },
    {
      title: '操作',
      key: 'action',
      width: 240,
      render: (_: unknown, record: TestReport) => (
        <Space>
          <Button type="text" icon={<LineChartOutlined />} onClick={() => handleViewChart(record)} size="small">
            查看图表
          </Button>
          <Button
            type="text"
            icon={<EnvironmentOutlined />}
            onClick={() => {
              setEnvironmentModal({ open: true, report: record });
            }}
            size="small"
          >
            环境信息
          </Button>
          <Button
            type="text"
            icon={<EditOutlined />}
            onClick={() => {
              setRenameModal({ open: true, report: record });
              renameForm.setFieldsValue({
                name: record.name,
                description: record.description,
                folderId: record.folderId || 'uncategorized',
              });
            }}
            size="small"
          >
            重命名/移动
          </Button>
          <Button type="text" icon={<DownloadOutlined />} onClick={() => handleExport(record)} size="small">
            导出
          </Button>
          <Popconfirm title="确定删除此报告？" onConfirm={() => handleDelete(record.id)}>
            <Button type="text" danger icon={<DeleteOutlined />} size="small" />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      <Modal
        title={reportModal.renderTitle(
          <Space>
            <FileTextOutlined />
            <span>测试报告管理</span>
          </Space>
        )}
        open={visible}
        onCancel={onClose}
        width={reportModal.width}
        style={reportModal.style}
        styles={{ body: reportModal.bodyStyle }}
        footer={[
          <Button key="close" onClick={onClose}>
            关闭
          </Button>,
        ]}
      >
        <Row gutter={16}>
          <Col span={6}>
            <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text strong>报告目录</Text>
              <Space>
                <Button
                  size="small"
                  icon={<ImportOutlined />}
                  onClick={openImportModal}
                >
                  导入
                </Button>
                <Button
                  size="small"
                  type="primary"
                  icon={<FolderAddOutlined />}
                  onClick={() => openCreateFolderModal(null)}
                >
                  新建目录
                </Button>
              </Space>
            </div>
            <Tree
              treeData={folderTree}
              titleRender={renderTreeTitle}
              selectedKeys={selectedFolderId ? [selectedFolderId] : []}
              expandedKeys={expandedKeys}
              onExpand={(keys) => setExpandedKeys(keys as string[])}
              onSelect={(keys) => {
                if (keys.length > 0) {
                  setSelectedFolderId(keys[0] as string);
                }
              }}
              showLine
              blockNode
              style={{ background: '#fafafa', padding: 8, borderRadius: 4, minHeight: 300 }}
            />
          </Col>

          <Col span={18}>
            <Space direction="vertical" style={{ width: '100%' }} size="middle">
              <Space direction="vertical" style={{ width: '100%' }} size="small">
                <Input
                  prefix={<SearchOutlined />}
                  placeholder="搜索报告"
                  value={searchKeyword}
                  onChange={(e) => setSearchKeyword(e.target.value)}
                  allowClear
                />
                {searchKeyword && (
                  <Tag color="blue">
                    匹配到 {displayedReports.length} 个报告
                  </Tag>
                )}
              </Space>

              {displayedReports.length === 0 && !isLoading ? (
                <Empty description="当前目录暂无报告" />
              ) : (
                <>
                  <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text type="secondary">已选择 {selectedRowKeys.length} 个报告</Text>
                    <Space>
                      <Button
                        size="small"
                        icon={<FolderOutlined />}
                        onClick={() => setBatchMoveModal({ open: true, targetFolderId: 'uncategorized' })}
                        disabled={selectedRowKeys.length === 0}
                      >
                        移动
                      </Button>
                      <Button
                        size="small"
                        danger
                        onClick={handleBatchDelete}
                        disabled={selectedRowKeys.length === 0}
                      >
                        删除
                      </Button>
                      <Button
                        size="small"
                        icon={<MergeOutlined />}
                        onClick={openMergeModal}
                        disabled={selectedRowKeys.length !== 2}
                      >
                        合并
                      </Button>
                    </Space>
                  </div>
                  <Table
                    columns={columns}
                    dataSource={displayedReports}
                    rowKey="id"
                    size="small"
                    pagination={{ pageSize: reportModal.pageSize }}
                    loading={isLoading}
                    scroll={reportModal.tableScroll}
                    rowSelection={{
                      selectedRowKeys,
                      onChange: (keys) => setSelectedRowKeys(keys as string[]),
                    }}
                  />
                </>
              )}
            </Space>
          </Col>
        </Row>
      </Modal>

      {/* 查看图表弹窗 */}
      <Modal
        title={chartModal.renderTitle(viewingReport?.name)}
        open={!!viewingReport}
        onCancel={() => setViewingReport(null)}
        width={chartModal.width}
        style={chartModal.style}
        styles={{ body: chartModal.bodyStyle }}
        footer={[
          <Button key="close" onClick={() => setViewingReport(null)}>
            关闭
          </Button>,
        ]}
      >
        {viewingReport && (
          <>
            <div style={{ marginBottom: 16 }}>
              <Tag>主机: {viewingReport.config.host}</Tag>
              <Tag>
                范围: {viewingReport.config.startPower}W - {viewingReport.config.endPower}W
              </Tag>
              <Tag>步长: {viewingReport.config.step}W</Tag>
            </div>
            {viewingReport.results.some((r) => r.logArchivePath) && (
              <div style={{ marginBottom: 16 }}>
                <Space wrap>
                  <span style={{ fontWeight: 'bold', fontSize: 13 }}>
                    <FileTextOutlined style={{ marginRight: 6 }} />
                    迭代日志:
                  </span>
                  {viewingReport.results
                    .filter((r) => r.logArchivePath)
                    .map((r, idx) => (
                      <Button
                        key={`log-${viewingReport.id}-${r.iteration}-${idx}`}
                        size="small"
                        icon={<DownloadOutlined />}
                        onClick={() => {
                          window.open(
                            `/api/test/reports/logs/download?reportId=${viewingReport.id}&iteration=${r.iteration}`
                          );
                        }}
                      >
                        第 {r.iteration} 轮
                      </Button>
                    ))}
                </Space>
              </div>
            )}
            <Tabs
              size="small"
              items={[
                {
                  key: 'main',
                  label: '功耗-性能曲线',
                  children: (
                    <ReactECharts
                      option={generateChartOption(viewingReport)}
                      style={{ height: 400 }}
                      onChartReady={bindYAxisWheelZoom}
                    />
                  ),
                },
                ...(reportMonitorGroups.length > 0
                  ? [
                      {
                        key: 'monitor_merge',
                        label: (
                          <Space>
                            <MergeOutlined />
                            监控合并
                          </Space>
                        ),
                        children: (
                          <Space direction="vertical" style={{ width: '100%' }}>
                            {reportMonitorGroups.map((group) => (
                              <ReactECharts
                                key={group.originalId}
                                option={generateReportAllMonitorChartOption(viewingReport, group.colIds)}
                                style={{ height: 260 }}
                                onChartReady={bindYAxisWheelZoom}
                              />
                            ))}
                          </Space>
                        ),
                      },
                    ]
                  : []),
                ...reportMonitorCommandIds.map((cmdId) => {
                  const firstResult = viewingReport.results.find((r) => r.monitorResults?.[cmdId]);
                  const cmdName = firstResult?.monitorResults?.[cmdId].commandName || cmdId;
                  return {
                    key: cmdId,
                    label: (
                      <Space>
                        <DesktopOutlined />
                        {cmdName}
                      </Space>
                    ),
                    children: (
                      <Space direction="vertical" style={{ width: '100%' }}>
                        <ReactECharts
                          option={generateReportMonitorChartOption(viewingReport, cmdId)}
                          style={{ height: 260 }}
                          onChartReady={bindYAxisWheelZoom}
                        />
                        <ReactECharts
                          option={generateReportMonitorScoreRatioChartOption(viewingReport, cmdId)}
                          style={{ height: 260 }}
                          onChartReady={bindYAxisWheelZoom}
                        />
                        <Table
                          size="small"
                          pagination={false}
                          columns={[
                            { title: '迭代', dataIndex: 'iteration', width: 70 },
                            {
                              title: '迭代参数',
                              dataIndex: 'iterationLabel',
                              width: 120,
                              render: (v: string) => (
                                <Tooltip title={v} placement="topLeft">
                                  <span
                                    style={{
                                      display: 'inline-block',
                                      maxWidth: '100%',
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      whiteSpace: 'nowrap',
                                    }}
                                  >
                                    {v}
                                  </span>
                                </Tooltip>
                              ),
                            },
                            {
                              title: (
                                <Popover
                                  trigger="hover"
                                  content={
                                    customAvgRange[cmdId]
                                      ? <span>自定义范围: 第{customAvgRange[cmdId].avgStart} ~ 第{customAvgRange[cmdId].avgEnd}点</span>
                                      : <span>使用原始平均值</span>
                                  }
                                >
                                  <span style={{ cursor: 'help' }}>平均值</span>
                                </Popover>
                              ),
                              dataIndex: 'averageValue',
                              width: 100,
                              render: (_: unknown, record: any) => {
                                const mr = record.monitorResults?.[cmdId];
                                if (!mr) return '-';
                                const customRange = customAvgRange[cmdId];
                                const avgValue = customRange && mr.dataPoints?.length
                                  ? calculateCustomAvg(mr.dataPoints, customRange.avgStart, customRange.avgEnd)
                                  : mr.averageValue;
                                return <span style={{ fontWeight: 'bold', color: customRange ? '#1890ff' : '#52c41a' }}>{avgValue.toFixed(4)}</span>;
                              },
                            },
                            {
                              title: '分数/平均值',
                              dataIndex: 'scoreRatio',
                              width: 110,
                              render: (_: unknown, record: any) => {
                                const mr = record.monitorResults?.[cmdId];
                                if (!mr) return '-';
                                const customRange = customAvgRange[cmdId];
                                const avgValue = customRange && mr.dataPoints?.length
                                  ? calculateCustomAvg(mr.dataPoints, customRange.avgStart, customRange.avgEnd)
                                  : mr.averageValue;
                                const ratio = avgValue > 0 && record.score > 0 ? (record.score / avgValue).toFixed(4) : '-';
                                return <span style={{ fontWeight: 'bold', color: '#fa8c16' }}>{ratio}</span>;
                              },
                            },
                            { title: '采样点数', dataIndex: 'sampleCount', width: 80 },
                            {
                              title: '操作',
                              key: 'action',
                              width: 100,
                              render: (_: unknown, record: any) => (
                                <Button
                                  type="link"
                                  size="small"
                                  icon={<LineChartOutlined />}
                                  onClick={async () => {
                                    const result = viewingReport.results.find((r) => r.iteration === record.iteration);
                                    const mr = result?.monitorResults?.[cmdId];
                                    if (!mr) return;
                                    const hasLocalData = mr.dataPoints.length > 0;
                                    setMonitorDetailModal({
                                      open: true,
                                      reportId: viewingReport.id,
                                      jobId: viewingReport.jobId,
                                      commandId: cmdId,
                                      commandName: mr.commandName,
                                      iteration: record.iteration,
                                      power: record.power,
                                      iterationLabel: result?.iterationLabel,
                                      dataPoints: hasLocalData ? mr.dataPoints : [],
                                      loading: !hasLocalData,
                                    });
                                    if (!hasLocalData) {
                                      const points = await loadReportMonitorDataPoints(
                                        viewingReport.id,
                                        record.iteration,
                                        cmdId,
                                        viewingReport.jobId,
                                        viewingReport.stageId
                                      );
                                      setMonitorDetailModal((prev) =>
                                        prev && prev.iteration === record.iteration && prev.commandId === cmdId
                                          ? { ...prev, dataPoints: points, loading: false }
                                          : prev
                                      );
                                    }
                                  }}
                                >
                                  查看详情
                                </Button>
                              ),
                            },
                          ]}
                          dataSource={viewingReport.results
                            .filter((r) => r.monitorResults?.[cmdId])
                            .map((r) => ({
                              iteration: r.iteration,
                              power: r.power,
                              iterationLabel: r.iterationLabel || `${r.power}`,
                              averageValue: r.monitorResults![cmdId].averageValue.toFixed(4),
                              scoreRatio:
                                r.monitorResults![cmdId].averageValue > 0 && r.score > 0
                                  ? (r.score / r.monitorResults![cmdId].averageValue).toFixed(4)
                                  : '-',
                              sampleCount:
                                r.monitorResults![cmdId].dataPointsCount ?? r.monitorResults![cmdId].dataPoints.length,
                            }))}
                          rowKey={(r) => `${r.iteration}-${r.power}`}
                          scroll={{ x: 'max-content', y: 200 }}
                        />
                      </Space>
                    ),
                  };
                }),
              ]}
            />
          </>
        )}
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
          <Spin spinning={monitorDetailModal.loading} tip="加载采样点...">
            <div style={{ marginBottom: 16 }}>
              <Tag>迭代: {monitorDetailModal.iteration}</Tag>
              <Tag>参数: {monitorDetailModal.iterationLabel || `${monitorDetailModal.power}`}</Tag>
              <Tag>采样点数: {monitorDetailModal.dataPoints.length}</Tag>
            </div>
            <div style={{ marginBottom: 16, padding: '8px 12px', background: '#f5f5f5', borderRadius: 4 }}>
              <Space align="center">
                <span style={{ fontWeight: 500 }}>自定义平均值计算范围：</span>
                <InputNumber
                  size="small"
                  min={1}
                  max={monitorDetailModal.dataPoints.length || 9999}
                  value={monitorDetailModal.avgStart || 1}
                  onChange={(val) => setMonitorDetailModal((prev) => prev ? { ...prev, avgStart: val || undefined } : null)}
                  style={{ width: 70 }}
                  placeholder="起始点"
                />
                <span>~</span>
                <InputNumber
                  size="small"
                  min={1}
                  max={monitorDetailModal.dataPoints.length || 9999}
                  value={monitorDetailModal.avgEnd || monitorDetailModal.dataPoints.length || undefined}
                  onChange={(val) => setMonitorDetailModal((prev) => prev ? { ...prev, avgEnd: val || undefined } : null)}
                  style={{ width: 70 }}
                  placeholder="结束点"
                />
                <span style={{ color: '#52c41a', fontWeight: 500 }}>
                  范围平均值: {calculateCustomAvg(monitorDetailModal.dataPoints, monitorDetailModal.avgStart, monitorDetailModal.avgEnd).toFixed(4)}
                </span>
                <Button size="small" onClick={async () => {
                  if (!monitorDetailModal.reportId) {
                    message.warning('报告ID不存在，无法保存');
                    return;
                  }
                  const range = {
                    avgStart: monitorDetailModal.avgStart,
                    avgEnd: monitorDetailModal.avgEnd,
                  };
                  const result = await updateReportCustomAvgRanges(monitorDetailModal.reportId, {
                    [monitorDetailModal.commandId]: range,
                  });
                  if (result.success) {
                    setCustomAvgRange((prev) => ({
                      ...prev,
                      [monitorDetailModal.commandId]: range,
                    }));
                    message.success('已应用此范围计算平均值并保存');
                    if (viewingReport?.id === monitorDetailModal.reportId) {
                      await fetchReports();
                      const { reports: freshReports } = useTestReportStore.getState();
                      const updatedReport = freshReports.find(r => r.id === monitorDetailModal.reportId);
                      if (updatedReport) {
                        setViewingReport(updatedReport);
                      }
                    }
                  } else {
                    message.error(result.message || '保存失败');
                  }
                }}>
                  应用到所有迭代
                </Button>
              </Space>
            </div>
            <ReactECharts
              option={generateReportIterationDetailChartOption(monitorDetailModal.commandName, monitorDetailModal.dataPoints)}
              style={{ height: 400 }}
              onChartReady={bindYAxisWheelZoom}
            />
            <Table
              size="small"
              pagination={{ pageSize: detailModal.pageSize, showSizeChanger: true, pageSizeOptions: [50, 100, 200, 500] }}
              columns={[
                { title: '序号', dataIndex: 'idx', width: 70, render: (v: number) => v + 1 },
                {
                  title: '时间',
                  dataIndex: 'timestamp',
                  width: 180,
                  render: (v: string) => new Date(v).toLocaleTimeString(),
                },
                {
                  title: '监控值',
                  dataIndex: 'value',
                  width: 100,
                  render: (v: number | null) => (!isNaN(v ?? 0) ? (v ?? 0).toFixed(4) : '0'),
                },
                { title: '原始输出', dataIndex: 'raw', ellipsis: true },
              ]}
              dataSource={monitorDetailModal.dataPoints.map((p, idx) => ({ ...p, idx, key: idx }))}
              scroll={{ x: 'max-content', y: 250 }}
            />
          </Spin>
        )}
      </Modal>

      {/* 导出进度弹窗 */}
      <Modal
        title="正在导出 Excel"
        open={exportProgress.visible}
        width={520}
        footer={null}
        closable={false}
        maskClosable={false}
      >
        <Progress
          percent={exportProgress.percent}
          status={exportProgress.status}
          strokeColor={exportProgress.status === 'exception' ? '#ff4d4f' : undefined}
        />
        <div style={{ textAlign: 'center', marginTop: 8, color: '#595959' }}>
          {exportProgress.message}
        </div>
      </Modal>

      {/* 重命名/移动报告弹窗 */}
      <Modal
        title="重命名/移动报告"
        open={renameModal.open}
        onCancel={() => setRenameModal({ open: false, report: null })}
        onOk={async () => {
          const values = await renameForm.validateFields();
          if (renameModal.report) {
            try {
              await updateReport(renameModal.report.id, {
                name: values.name,
                description: values.description,
                folderId: values.folderId,
              });
              message.success('报告已更新');
              setRenameModal({ open: false, report: null });
            } catch (err) {
              const msg = err instanceof Error ? err.message : '更新失败';
              message.error(msg);
            }
          }
        }}
        width={700}
        destroyOnClose
      >
        <Form form={renameForm} layout="vertical">
          <Form.Item name="name" label="报告名称" rules={[{ required: true, message: '请输入报告名称' }]}>
            <Input placeholder="请输入报告名称" />
          </Form.Item>
          <Form.Item name="folderId" label="所属目录" rules={[{ required: true, message: '请选择所属目录' }]}>
            <TreeSelect
              treeData={buildFolderTreeOptions()}
              placeholder="请选择所属目录"
              treeDefaultExpandAll
              allowClear={false}
            />
          </Form.Item>
          <Form.Item name="description" label="报告描述">
            <Input.TextArea rows={3} placeholder="请输入报告描述（可选）" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 批量移动报告弹窗 */}
      <Modal
        title="批量移动报告"
        open={batchMoveModal.open}
        onCancel={() => setBatchMoveModal({ open: false, targetFolderId: 'uncategorized' })}
        onOk={handleBatchMove}
        width={400}
        destroyOnClose
      >
        <Form layout="vertical">
          <Form.Item label="目标目录">
            <TreeSelect
              value={batchMoveModal.targetFolderId}
              treeData={buildFolderTreeOptions()}
              placeholder="请选择目标目录"
              treeDefaultExpandAll
              allowClear={false}
              onChange={(value) => setBatchMoveModal((prev) => ({ ...prev, targetFolderId: value }))}
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* 环境信息管理弹窗 */}
      <EnvironmentInfoModal
        open={environmentModal.open}
        report={environmentModal.report}
        onClose={() => setEnvironmentModal({ open: false, report: null })}
        onSave={async (report: TestReport, environment: Record<string, string>) => {
          try {
            await updateReport(report.id, { environment });
            message.success('环境信息已保存');
            setEnvironmentModal({ open: false, report: null });
          } catch (err) {
            const msg = err instanceof Error ? err.message : '保存失败';
            message.error(msg);
          }
        }}
      />

      {/* 创建/重命名目录弹窗 */}
      <Modal
        title={folderModal.mode === 'create' ? '新建目录' : '重命名目录'}
        open={folderModal.open}
        onCancel={() => setFolderModal((prev) => ({ ...prev, open: false }))}
        onOk={handleFolderModalOk}
        width={520}
        destroyOnClose
      >
        <Form form={folderForm} layout="vertical">
          {folderModal.mode === 'create' && folderModal.parentId && (
            <Form.Item label="父目录">
              <Input disabled value={folderTree.find((n) => n.key === folderModal.parentId)?.title || '根目录'} />
            </Form.Item>
          )}
          <Form.Item
            name="name"
            label="目录名称"
            rules={[
              { required: true, message: '请输入目录名称' },
              { max: 50, message: '目录名称最多 50 个字符' },
            ]}
          >
            <Input placeholder="请输入目录名称" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 导入报告弹窗 */}
      <Modal
        title={importModalSize.renderTitle('从 dataPoints 文件夹导入报告')}
        open={importModal.open}
        onCancel={closeImportModal}
        onOk={() => {
          if (importModal.step === 'scan') {
            handleScanImport();
          } else {
            importForm.submit();
          }
        }}
        okText={importModal.step === 'scan' ? '扫描' : '导入'}
        confirmLoading={importModal.scanning || importModal.importing}
        width={importModalSize.width}
        style={importModalSize.style}
        styles={{ body: importModalSize.bodyStyle }}
        destroyOnClose
      >
        <Form form={importForm} layout="vertical" onFinish={handleImportSubmit}>
          <Form.Item
            name="sourcePath"
            label="dataPoints 文件夹路径"
            extra="支持 dataPoints 文件夹本身，或其父目录（相对 .data 或绝对路径，限项目目录内）"
            rules={[{ required: true, message: '请输入路径' }]}
          >
            <Input.TextArea
              placeholder="例如：reports/report-xxx/dataPoints 或 /absolute/path/to/dataPoints"
              rows={2}
              disabled={importModal.step === 'preview'}
            />
          </Form.Item>

          {importModal.step === 'preview' && importPreview && (
            <>
              <div style={{ marginBottom: 16, padding: 12, background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 4 }}>
                <div>
                  <strong>扫描结果：</strong>
                </div>
                <div>迭代数量：{importPreview.iterations.length}</div>
                <div>监控命令：{importPreview.commands.map((c) => c.name).join(', ') || '-'}</div>
                <div>采样点总数：{importPreview.dataPointsCount}</div>
                {importPreview.hasMetadata && <Tag color="blue">发现 report.json 元数据</Tag>}
              </div>

              <Form.Item
                name="name"
                label="报告名称"
                rules={[{ required: true, message: '请输入报告名称' }]}
              >
                <Input placeholder="例如：流水线阶段 A 导入报告" />
              </Form.Item>

              <Form.Item
                name="host"
                label="测试主机"
                rules={[{ required: true, message: '请输入测试主机' }]}
              >
                <Input placeholder="例如：192.168.1.100" />
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
                <Input.TextArea placeholder="可选：添加说明" rows={2} />
              </Form.Item>

              <Form.Item
                name="config"
                label="报告配置 (JSON)"
                extra="通常包含 host、iterationParams、adjustmentCommands 等"
                rules={[{ required: true, message: '请输入配置 JSON' }]}
              >
                <Input.TextArea rows={4} />
              </Form.Item>

              <Form.Item
                name="results"
                label="迭代结果 (JSON)"
                extra="数组，每个元素包含 iteration、power、score、status、iterationLabel、iterationValues；后端会根据 dataPoints 文件自动补齐 monitorResults"
                rules={[{ required: true, message: '请输入结果 JSON' }]}
              >
                <Input.TextArea rows={10} />
              </Form.Item>
            </>
          )}
        </Form>
      </Modal>

      {/* 合并报告弹窗 */}
      <Modal
        title="合并报告"
        open={mergeModal.open}
        onCancel={closeMergeModal}
        onOk={handleMergeReports}
        okText="合并"
        confirmLoading={mergeModal.merging}
        width={600}
        destroyOnClose
      >
        {mergeModal.selectedReports.length === 2 && (
          <div>
            <Text strong>即将合并以下两个报告：</Text>
            <div style={{ marginTop: 12, marginBottom: 12 }}>
              <Tag color="blue">{mergeModal.selectedReports[0].name}</Tag>
              <Tag>迭代数: {mergeModal.selectedReports[0].results.length}</Tag>
              <Tag>主机: {mergeModal.selectedReports[0].config.host}</Tag>
            </div>
            <div style={{ marginBottom: 12 }}>
              <Tag color="green">{mergeModal.selectedReports[1].name}</Tag>
              <Tag>迭代数: {mergeModal.selectedReports[1].results.length}</Tag>
              <Tag>主机: {mergeModal.selectedReports[1].config.host}</Tag>
            </div>
            <div style={{ padding: 12, background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 4 }}>
              <Text type="secondary">
                合并后总迭代数: {mergeModal.selectedReports[0].results.length + mergeModal.selectedReports[1].results.length}
                <br />
                第二个报告的迭代号将自动重新编号，保持连续
              </Text>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
};

export default TestReportManager;
