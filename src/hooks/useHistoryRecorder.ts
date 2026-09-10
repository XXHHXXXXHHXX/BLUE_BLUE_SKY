/** 历史曲线录像 Hook - 记录节点数据历史 */
import { useState, useCallback, useRef, useEffect } from 'react';

export interface HistoryDataPoint {
  timestamp: number;
  timeStr: string;
  power?: number | null;
  temperature?: number | null;
  voltage?: number | null;
  current?: number | null;
  rpm?: number | null;
  speedPercent?: number | null;
  [key: string]: number | string | null | undefined;
}

export interface UseHistoryRecorderOptions {
  /** 最大记录时长（秒），默认 60，设为 null 表示无限制 */
  maxDuration?: number | null;
  /** 采样间隔（毫秒），默认 2000 */
  sampleInterval?: number;
}

export interface UseHistoryRecorderReturn {
  /** 是否正在录像 */
  isRecording: boolean;
  /** 历史数据 */
  historyData: HistoryDataPoint[];
  /** 开始录像 */
  startRecording: () => void;
  /** 停止录像 */
  stopRecording: () => void;
  /** 清空历史 */
  clearHistory: () => void;
  /** 下载历史数据为 CSV */
  downloadCSV: () => void;
  /** 下载历史数据为 JSON */
  downloadJSON: () => void;
  /** 添加数据点 */
  addDataPoint: (data: Omit<HistoryDataPoint, 'timestamp' | 'timeStr'>) => void;
}

/** 格式化时间为 HH:mm:ss */
function formatTime(date: Date): string {
  return date.toTimeString().slice(0, 8);
}

/** 格式化时间为 yyyy-MM-dd HH:mm:ss */
function formatFullTime(date: Date): string {
  return date.toLocaleString('zh-CN');
}

export function useHistoryRecorder(
  options: UseHistoryRecorderOptions = {}
): UseHistoryRecorderReturn {
  const { maxDuration = 60, sampleInterval = 2000 } = options;

  const [isRecording, setIsRecording] = useState(false);
  const [historyData, setHistoryData] = useState<HistoryDataPoint[]>([]);
  
  const intervalRef = useRef<number | null>(null);
  const pendingDataRef = useRef<Omit<HistoryDataPoint, 'timestamp' | 'timeStr'> | null>(null);

  /** 开始录像 */
  const startRecording = useCallback(() => {
    setIsRecording(true);
  }, []);

  /** 停止录像 */
  const stopRecording = useCallback(() => {
    setIsRecording(false);
  }, []);

  /** 清空历史 */
  const clearHistory = useCallback(() => {
    setHistoryData([]);
  }, []);

  /** 添加数据点 */
  const addDataPoint = useCallback((data: Omit<HistoryDataPoint, 'timestamp' | 'timeStr'>) => {
    pendingDataRef.current = data;
  }, []);

  /** 定时采样 */
  useEffect(() => {
    if (!isRecording) {
      if (intervalRef.current) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    // 立即添加一个数据点
    if (pendingDataRef.current) {
      const now = new Date();
      const newPoint: HistoryDataPoint = {
        ...pendingDataRef.current,
        timestamp: now.getTime(),
        timeStr: formatTime(now),
      };
      setHistoryData(prev => {
        const updated = [...prev, newPoint];
        // 如果有 maxDuration 限制，只保留最近的数据
        if (maxDuration != null) {
          const cutoffTime = now.getTime() - maxDuration * 1000;
          return updated.filter(p => p.timestamp >= cutoffTime);
        }
        return updated;
      });
    }

    // 启动定时采样
    intervalRef.current = window.setInterval(() => {
      if (pendingDataRef.current) {
        const now = new Date();
        const newPoint: HistoryDataPoint = {
          ...pendingDataRef.current,
          timestamp: now.getTime(),
          timeStr: formatTime(now),
        };
        setHistoryData(prev => {
          const updated = [...prev, newPoint];
          // 如果有 maxDuration 限制，只保留最近的数据
          if (maxDuration != null) {
            const cutoffTime = now.getTime() - maxDuration * 1000;
            return updated.filter(p => p.timestamp >= cutoffTime);
          }
          return updated;
        });
      }
    }, sampleInterval);

    return () => {
      if (intervalRef.current) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isRecording, maxDuration, sampleInterval]);

  /** 生成 CSV 内容 */
  const generateCSV = useCallback((): string => {
    if (historyData.length === 0) return '';

    const headers = ['时间', '时间戳', ...Object.keys(historyData[0]).filter(k => !['timestamp', 'timeStr'].includes(k))];
    
    const rows = historyData.map(point => {
      return [
        formatFullTime(new Date(point.timestamp)),
        point.timestamp,
        ...headers.slice(2).map(h => point[h] ?? '')
      ].join(',');
    });

    return [headers.join(','), ...rows].join('\n');
  }, [historyData]);

  /** 下载 CSV */
  const downloadCSV = useCallback(() => {
    if (historyData.length === 0) {
      return;
    }

    const csv = generateCSV();
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `history_data_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [historyData, generateCSV]);

  /** 下载 JSON */
  const downloadJSON = useCallback(() => {
    if (historyData.length === 0) {
      return;
    }

    const data = {
      exportTime: new Date().toISOString(),
      duration: maxDuration,
      sampleInterval,
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
  }, [historyData, maxDuration, sampleInterval]);

  return {
    isRecording,
    historyData,
    startRecording,
    stopRecording,
    clearHistory,
    downloadCSV,
    downloadJSON,
    addDataPoint,
  };
}
