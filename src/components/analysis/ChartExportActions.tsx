'use client';

/** 图表卡片右上角的「保存快照 / 导出 Excel」按钮
 *
 * 快照直接取 ECharts 实例的 getDataURL，保证与页面渲染一致；
 * Excel 把快照图片 + 数据表交给服务端生成 xlsx。
 */
import React, { useState } from 'react';
import { Button, Space, Tooltip, message } from 'antd';
import { DownloadOutlined, FileExcelOutlined } from '@ant-design/icons';
import type { AutoResizeChartHandle } from './AutoResizeChart';
import {
  downloadChartExcel,
  downloadDataUrl,
  sanitizeFilename,
  type ChartExcelPayload,
} from '../../utils/chartExport';

interface ChartExportActionsProps {
  /** 图表实例句柄（用于导出 PNG） */
  chartRef: React.RefObject<AutoResizeChartHandle | null>;
  /** 图表标题，同时用作文件名 */
  title: string;
  /** 数据表列名 */
  columns: string[];
  /** 数据表行 */
  rows: Array<Array<string | number | null>>;
  /** 写在 Excel 图表页图片下方的说明 */
  notes?: string[];
}

const ChartExportActions: React.FC<ChartExportActionsProps> = ({
  chartRef,
  title,
  columns,
  rows,
  notes,
}) => {
  const [exporting, setExporting] = useState(false);

  /** 取当前图表快照；图表未就绪时给出提示并返回 null */
  const takeSnapshot = (): string | null => {
    const dataUrl = chartRef.current?.getDataURL();
    if (!dataUrl) {
      message.warning('图表尚未渲染完成，请稍后再试');
      return null;
    }
    return dataUrl;
  };

  const handleSnapshot = () => {
    const dataUrl = takeSnapshot();
    if (!dataUrl) return;
    downloadDataUrl(dataUrl, `${sanitizeFilename(title)}.png`);
  };

  const handleExportExcel = async () => {
    const dataUrl = takeSnapshot();
    if (!dataUrl) return;
    const payload: ChartExcelPayload = {
      title,
      imageDataUrl: dataUrl,
      columns,
      rows,
      notes,
    };
    setExporting(true);
    try {
      await downloadChartExcel(payload);
      message.success('Excel 已导出');
    } catch (err) {
      message.error(err instanceof Error ? err.message : '导出失败');
    } finally {
      setExporting(false);
    }
  };

  return (
    <Space size={4}>
      <Tooltip title="保存图表快照（PNG）">
        <Button type="text" size="small" icon={<DownloadOutlined />} onClick={handleSnapshot}>
          快照
        </Button>
      </Tooltip>
      <Tooltip title="导出带曲线的 Excel">
        <Button
          type="text"
          size="small"
          icon={<FileExcelOutlined />}
          loading={exporting}
          onClick={handleExportExcel}
        >
          导出 Excel
        </Button>
      </Tooltip>
    </Space>
  );
};

export default ChartExportActions;
