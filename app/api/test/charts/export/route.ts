/** 把图表快照 + 数据导出成 xlsx（数据表 + 内嵌已绘制曲线图） */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';

interface ExportPayload {
  title?: string;
  imageDataUrl?: string | null;
  columns?: string[];
  rows?: Array<Array<string | number | null>>;
  notes?: string[];
}

/** 解析 dataURL：`data:image/png;base64,xxxx` */
function parseImageDataUrl(dataUrl: string): { extension: 'png' | 'jpeg'; base64: string } | null {
  const match = /^data:image\/(png|jpeg|jpg);base64,(.+)$/i.exec(dataUrl);
  if (!match) return null;
  const extension = match[1].toLowerCase() === 'png' ? 'png' : 'jpeg';
  return { extension, base64: match[2] };
}

function sanitizeFilename(name: string) {
  return (name || 'chart').replace(/[\\/:*?"<>|]/g, '_').trim() || 'chart';
}

export async function POST(request: NextRequest) {
  let payload: ExportPayload;
  try {
    payload = (await request.json()) as ExportPayload;
  } catch {
    return NextResponse.json({ message: '请求体不是合法 JSON' }, { status: 400 });
  }

  const title = payload.title?.trim() || '图表';
  const columns = Array.isArray(payload.columns) ? payload.columns : [];
  const rows = Array.isArray(payload.rows) ? payload.rows : [];
  const notes = Array.isArray(payload.notes) ? payload.notes : [];

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'BLUE_BLUE_SKY';
  workbook.created = new Date();

  // Sheet1：图表页（嵌入已绘制好的曲线图）
  const chartSheet = workbook.addWorksheet('图表', {
    views: [{ showGridLines: false }],
  });

  chartSheet.getCell('A1').value = title;
  chartSheet.getCell('A1').font = { size: 14, bold: true };
  chartSheet.mergeCells('A1:H1');

  const image = payload.imageDataUrl ? parseImageDataUrl(payload.imageDataUrl) : null;
  if (image) {
    const imageId = workbook.addImage({ base64: image.base64, extension: image.extension });
    // 图片按列宽铺开，保持可读比例
    chartSheet.addImage(imageId, {
      tl: { col: 0, row: 1.2 },
      ext: { width: 960, height: 540 },
    });
    // 给图片预留纵向空间（约 30 行）
    for (let i = 2; i <= 32; i += 1) {
      chartSheet.getRow(i).height = 20;
    }
  } else {
    chartSheet.getCell('A3').value = '（无图表快照）';
    chartSheet.getCell('A3').font = { color: { argb: 'FF999999' }, italic: true };
  }

  if (notes.length > 0) {
    const startRow = image ? 34 : 5;
    chartSheet.getCell(`A${startRow}`).value = '说明';
    chartSheet.getCell(`A${startRow}`).font = { bold: true };
    notes.forEach((note, index) => {
      chartSheet.getCell(`A${startRow + 1 + index}`).value = note;
    });
  }

  // Sheet2：数据明细
  const dataSheet = workbook.addWorksheet('数据');
  if (columns.length > 0) {
    const header = dataSheet.addRow(columns);
    header.font = { bold: true };
    header.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F0F0' } };
      cell.border = { bottom: { style: 'thin', color: { argb: 'FFD9D9D9' } } };
    });
    rows.forEach((row) => dataSheet.addRow(row));
    // 按列内容估算列宽（中文按 2 个字符宽）
    columns.forEach((col, index) => {
      const maxLen = rows.reduce((max, row) => {
        const value = row[index];
        const text = value === null || value === undefined ? '' : String(value);
        const len = text.replace(/[^\x00-\xff]/g, 'xx').length;
        return Math.max(max, len);
      }, String(col).replace(/[^\x00-\xff]/g, 'xx').length);
      dataSheet.getColumn(index + 1).width = Math.min(40, Math.max(10, maxLen + 2));
    });
    dataSheet.views = [{ state: 'frozen', ySplit: 1 }];
  } else {
    dataSheet.getCell('A1').value = '（无数据）';
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const filename = `${sanitizeFilename(title)}.xlsx`;
  // filename= 用 ASCII 兜底名，filename*= 保留中文原名
  const asciiName = filename.replace(/[^\x20-\x7e]/g, '_');

  return new NextResponse(new Uint8Array(buffer as ArrayBuffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Cache-Control': 'no-store',
    },
  });
}
