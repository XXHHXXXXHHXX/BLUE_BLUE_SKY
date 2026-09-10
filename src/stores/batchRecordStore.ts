/** 批量录像状态管理 */
import { create } from 'zustand';
import JSZip from 'jszip';
import type { HistoryDataPoint } from '../hooks/useHistoryRecorder';

export interface NodeRecordingState {
  nodeId: string;
  nodeLabel: string;
  nodeType: string;
  isRecording: boolean;
  data: HistoryDataPoint[];
}

export interface BatchRecordingState {
  // 批量录像状态
  isBatchRecording: boolean;
  selectedNodeIds: string[];
  nodeRecordings: Map<string, NodeRecordingState>;
  startTime: Date | null;
  
  // 操作方法
  startBatchRecording: (nodeIds: string[], getNodeInfo: (id: string) => { label: string; type: string } | null) => void;
  stopBatchRecording: () => void;
  addDataPoint: (nodeId: string, data: Omit<HistoryDataPoint, 'timestamp' | 'timeStr'>) => void;
  clearBatchData: () => void;
  downloadZip: () => Promise<void>;
}

/** 格式化时间为 HH:mm:ss */
function formatTime(date: Date): string {
  return date.toTimeString().slice(0, 8);
}

/** 生成时序图 HTML */
function generateChartHtml(recording: NodeRecordingState): string {
  const data = recording.data;
  if (data.length === 0) return '';

  // 提取所有数值字段
  const numericFields = Object.keys(data[0]).filter(
    key => !['timestamp', 'timeStr'].includes(key) && typeof data[0][key as keyof HistoryDataPoint] === 'number'
  );

  const timeLabels = data.map(d => d.timeStr);
  const series = numericFields.map(field => ({
    name: field,
    type: 'line',
    smooth: true,
    data: data.map(d => d[field as keyof HistoryDataPoint]),
    symbol: 'circle',
    symbolSize: 4,
  }));

  const seriesJson = JSON.stringify(series);
  const labelsJson = JSON.stringify(timeLabels);

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${recording.nodeLabel} - 时序图</title>
  <script src="https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js"></script>
  <style>
    body { margin: 0; padding: 20px; font-family: Arial, sans-serif; background: #f5f5f5; }
    .container { max-width: 1200px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    h1 { margin: 0 0 10px 0; font-size: 20px; }
    .info { color: #666; margin-bottom: 20px; font-size: 14px; }
    #chart { width: 100%; height: 500px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>${recording.nodeLabel} (${recording.nodeType})</h1>
    <div class="info">数据点: ${data.length} 个 | 时间范围: ${timeLabels[0]} - ${timeLabels[timeLabels.length - 1]}</div>
    <div id="chart"></div>
  </div>
  <script>
    const chart = echarts.init(document.getElementById('chart'));
    const option = {
      tooltip: { trigger: 'axis' },
      legend: { data: ${JSON.stringify(numericFields)}, top: 10 },
      grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
      xAxis: { type: 'category', boundaryGap: false, data: ${labelsJson} },
      yAxis: { type: 'value' },
      series: ${seriesJson}
    };
    chart.setOption(option);
    window.addEventListener('resize', () => chart.resize());
  </script>
</body>
</html>`;
}

export const useBatchRecordStore = create<BatchRecordingState>((set, get) => ({
  isBatchRecording: false,
  selectedNodeIds: [],
  nodeRecordings: new Map(),
  startTime: null,

  startBatchRecording: (nodeIds, getNodeInfo) => {
    const recordings = new Map<string, NodeRecordingState>();
    
    nodeIds.forEach(id => {
      const info = getNodeInfo(id);
      if (info) {
        recordings.set(id, {
          nodeId: id,
          nodeLabel: info.label,
          nodeType: info.type,
          isRecording: true,
          data: [],
        });
      }
    });

    set({
      isBatchRecording: true,
      selectedNodeIds: nodeIds,
      nodeRecordings: recordings,
      startTime: new Date(),
    });
  },

  stopBatchRecording: () => {
    set((state) => {
      const newRecordings = new Map(state.nodeRecordings);
      newRecordings.forEach((recording) => {
        recording.isRecording = false;
      });
      return {
        isBatchRecording: false,
        nodeRecordings: newRecordings,
      };
    });
  },

  addDataPoint: (nodeId, data) => {
    const { isBatchRecording, nodeRecordings } = get();
    if (!isBatchRecording) return;

    const recording = nodeRecordings.get(nodeId);
    if (!recording || !recording.isRecording) return;

    const now = new Date();
    const newPoint: HistoryDataPoint = {
      ...data,
      timestamp: now.getTime(),
      timeStr: formatTime(now),
    };

    // 只保留最近60秒的数据
    const maxDuration = 60 * 1000;
    const cutoffTime = now.getTime() - maxDuration;
    
    const updatedData = [...recording.data, newPoint].filter(
      p => p.timestamp >= cutoffTime
    );

    const newRecordings = new Map(nodeRecordings);
    newRecordings.set(nodeId, {
      ...recording,
      data: updatedData,
    });

    set({ nodeRecordings: newRecordings });
  },

  clearBatchData: () => {
    set({
      isBatchRecording: false,
      selectedNodeIds: [],
      nodeRecordings: new Map(),
      startTime: null,
    });
  },

  downloadZip: async () => {
    const { nodeRecordings, startTime } = get();
    
    if (nodeRecordings.size === 0) {
      return;
    }

    const zip = new JSZip();
    const folderName = `batch_record_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}`;
    const folder = zip.folder(folderName);

    if (!folder) {
      throw new Error('Failed to create zip folder');
    }

    // 添加汇总信息
    const summary = {
      exportTime: new Date().toISOString(),
      startTime: startTime?.toISOString(),
      duration: startTime ? Math.floor((Date.now() - startTime.getTime()) / 1000) : 0,
      totalNodes: nodeRecordings.size,
      nodes: Array.from(nodeRecordings.values()).map(r => ({
        nodeId: r.nodeId,
        nodeLabel: r.nodeLabel,
        nodeType: r.nodeType,
        dataPoints: r.data.length,
      })),
    };
    folder.file('summary.json', JSON.stringify(summary, null, 2));

    // 为每个节点添加数据文件
    nodeRecordings.forEach((recording) => {
      const nodeFolder = folder.folder(recording.nodeLabel || recording.nodeId);
      if (!nodeFolder) return;

      // JSON 格式
      const jsonData = {
        nodeId: recording.nodeId,
        nodeLabel: recording.nodeLabel,
        nodeType: recording.nodeType,
        exportTime: new Date().toISOString(),
        totalPoints: recording.data.length,
        data: recording.data,
      };
      nodeFolder.file('data.json', JSON.stringify(jsonData, null, 2));

      // CSV 格式
      if (recording.data.length > 0) {
        const headers = ['时间', '时间戳', ...Object.keys(recording.data[0]).filter(k => !['timestamp', 'timeStr'].includes(k))];
        const rows = recording.data.map(point => [
          new Date(point.timestamp).toLocaleString('zh-CN'),
          point.timestamp,
          ...headers.slice(2).map(h => (point as any)[h] ?? ''),
        ]);
        const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
        nodeFolder.file('data.csv', '\ufeff' + csv);
      }

      // 生成时序图 HTML
      if (recording.data.length > 0) {
        const chartHtml = generateChartHtml(recording);
        nodeFolder.file('chart.html', chartHtml);
      }
    });

    // 生成并下载 zip
    const content = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(content);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${folderName}.zip`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  },
}));
