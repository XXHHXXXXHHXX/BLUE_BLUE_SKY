/** 图表导出工具：保存快照（PNG）与导出带曲线的 Excel
 *
 * 快照直接取 ECharts 实例的 getDataURL，保证和页面渲染一致；
 * Excel 由服务端用 ExcelJS 生成（数据表 + 内嵌图表图片），前端只负责下载。
 */

/** ECharts 实例中导出图片所需的最小接口 */
export interface ExportableChart {
  getDataURL: (opts?: {
    type?: string;
    pixelRatio?: number;
    backgroundColor?: string;
  }) => string;
  isDisposed?: () => boolean;
}

/** 文件名里不能出现的字符统一替换掉 */
export function sanitizeFilename(name: string): string {
  return (name || 'chart').replace(/[\\/:*?"<>|]/g, '_').trim() || 'chart';
}

/** 从 ECharts 实例取 PNG dataURL；实例未就绪或已销毁时返回 null */
export function getChartDataUrl(instance: ExportableChart | null | undefined): string | null {
  if (!instance || instance.isDisposed?.()) return null;
  try {
    return instance.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#fff' });
  } catch {
    return null;
  }
}

/** 触发浏览器下载 dataURL */
export function downloadDataUrl(dataUrl: string, filename: string): void {
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export interface ChartExcelPayload {
  /** 图表标题，同时用作文件名 */
  title: string;
  /** 图表快照 dataURL（可选；没有时只导出数据表） */
  imageDataUrl?: string | null;
  /** 数据表列名 */
  columns: string[];
  /** 数据表行 */
  rows: Array<Array<string | number | null>>;
  /** 图表说明（轴名称、系列说明等），写在图表页图片下方 */
  notes?: string[];
}

/** 把图表（图片 + 数据）交给服务端生成 xlsx 并下载 */
export async function downloadChartExcel(payload: ChartExcelPayload): Promise<void> {
  const res = await fetch('/api/test/charts/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    let message = '导出失败';
    try {
      const data = await res.json();
      if (data?.message) message = data.message;
    } catch {
      // 忽略非 JSON 响应
    }
    throw new Error(message);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  try {
    downloadDataUrl(url, `${sanitizeFilename(payload.title)}.xlsx`);
  } finally {
    // 下载动作是同步触发的，稍后回收即可
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
