/** 历史曲线录像状态管理 - 按模块（节点）分别保存，互不干扰 */
import { create } from 'zustand';
import type { HistoryDataPoint } from '../hooks/useHistoryRecorder';

export interface NodeHistoryRecording {
  nodeId: string;
  isRecording: boolean;
  data: HistoryDataPoint[];
  maxDuration: number | null;
}

interface HistoryRecordState {
  recordings: Record<string, NodeHistoryRecording>;

  startRecording: (nodeId: string, maxDuration?: number | null) => void;
  stopRecording: (nodeId: string) => void;
  clearHistory: (nodeId: string) => void;
  addDataPoint: (nodeId: string, data: Omit<HistoryDataPoint, 'timestamp' | 'timeStr'>) => void;
}

/** 格式化时间为 HH:mm:ss */
function formatTime(date: Date): string {
  return date.toTimeString().slice(0, 8);
}

export const useHistoryRecordStore = create<HistoryRecordState>((set, get) => ({
  recordings: {},

  startRecording: (nodeId, maxDuration = 60) => {
    set((state) => {
      const existing = state.recordings[nodeId];
      return {
        recordings: {
          ...state.recordings,
          [nodeId]: {
            nodeId,
            isRecording: true,
            data: existing?.data ?? [],
            maxDuration: maxDuration ?? null,
          },
        },
      };
    });
  },

  stopRecording: (nodeId) => {
    set((state) => {
      const rec = state.recordings[nodeId];
      if (!rec) return state;
      return {
        recordings: {
          ...state.recordings,
          [nodeId]: { ...rec, isRecording: false },
        },
      };
    });
  },

  clearHistory: (nodeId) => {
    set((state) => {
      const rec = state.recordings[nodeId];
      if (!rec) return state;
      return {
        recordings: {
          ...state.recordings,
          [nodeId]: { ...rec, data: [] },
        },
      };
    });
  },

  addDataPoint: (nodeId, data) => {
    const rec = get().recordings[nodeId];
    if (!rec || !rec.isRecording) return;

    const now = new Date();
    const newPoint: HistoryDataPoint = {
      ...data,
      timestamp: now.getTime(),
      timeStr: formatTime(now),
    };

    set((state) => {
      const current = state.recordings[nodeId];
      if (!current) return state;
      const updated = [...current.data, newPoint];
      const maxDuration = current.maxDuration;
      const dataOut =
        maxDuration != null
          ? updated.filter((p) => p.timestamp >= now.getTime() - maxDuration * 1000)
          : updated;
      return {
        recordings: {
          ...state.recordings,
          [nodeId]: { ...current, data: dataOut },
        },
      };
    });
  },
}));

/** 格式化完整时间为 yyyy-MM-dd HH:mm:ss */
function formatFullTime(date: Date): string {
  return date.toLocaleString('zh-CN');
}

/** 下载历史数据为 CSV */
export function downloadHistoryCSV(historyData: HistoryDataPoint[]): void {
  if (historyData.length === 0) return;

  const headers = ['时间', '时间戳', ...Object.keys(historyData[0]).filter(k => !['timestamp', 'timeStr'].includes(k))];
  const rows = historyData.map(point => [
    formatFullTime(new Date(point.timestamp)),
    point.timestamp,
    ...headers.slice(2).map(h => point[h] ?? ''),
  ]);
  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');

  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `history_data_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** 下载历史数据为 JSON */
export function downloadHistoryJSON(
  historyData: HistoryDataPoint[],
  meta: { maxDuration?: number | null; sampleInterval?: number } = {}
): void {
  if (historyData.length === 0) return;

  const data = {
    exportTime: new Date().toISOString(),
    duration: meta.maxDuration,
    sampleInterval: meta.sampleInterval,
    totalPoints: historyData.length,
    data: historyData,
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `history_data_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
