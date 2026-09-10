/** 服务端流式导出测试报告为 Excel */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import ExcelJS from 'exceljs';
import { randomUUID } from 'crypto';
import { Readable } from 'stream';
import type { TestReport } from '../../../../../../src/stores/testReportStore';

const REPORTS_JSON = path.join(process.cwd(), '.data', 'test-reports.json');
const REPORTS_DATA_DIR = path.join(process.cwd(), '.data', 'reports');
const EXPORTS_DIR = path.join(process.cwd(), '.data', 'exports');

interface ExportJob {
  filePath: string;
  createdAt: number;
}

const exportJobs = new Map<string, ExportJob>();

function sanitizeFilename(name: string) {
  return name.replace(/[\\/:*?"<>|]/g, '_');
}

async function loadReport(id: string): Promise<TestReport | undefined> {
  if (!fs.existsSync(REPORTS_JSON)) return undefined;
  try {
    const raw = fs.readFileSync(REPORTS_JSON, 'utf-8');
    if (!raw.trim()) return undefined;
    const reports = JSON.parse(raw) as TestReport[];
    return reports.find((r) => r.id === id);
  } catch (err) {
    console.error('[Report Export] Failed to load reports:', err);
    return undefined;
  }
}

function sendEvent(
  controller: ReadableStreamDefaultController<Uint8Array>,
  event: string,
  data: unknown
) {
  const text = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  controller.enqueue(new TextEncoder().encode(text));
}

async function buildExcel(
  reportId: string,
  report: TestReport,
  filePath: string,
  controller: ReadableStreamDefaultController<Uint8Array>
) {
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    stream: fs.createWriteStream(filePath),
    useStyles: true,
    useSharedStrings: false,
  });

  // 估算总行数（采样点行），用于进度条
  let totalRows = 0;
  report.results.forEach((r) => {
    if (!r.monitorResults) return;
    Object.values(r.monitorResults).forEach((mr) => {
      totalRows += mr.dataPointsCount ?? mr.dataPoints?.length ?? 0;
    });
  });
  if (totalRows === 0) totalRows = 1;

  let processed = 0;
  let lastPercent = -1;
  const reportProgress = (increment = 1) => {
    processed += increment;
    const percent = Math.min(100, Math.floor((processed / totalRows) * 100));
    if (percent !== lastPercent) {
      sendEvent(controller, 'progress', { percent, processed, totalRows });
      lastPercent = percent;
    }
  };

  sendEvent(controller, 'progress', { percent: 0, processed: 0, totalRows });

  // ===== Sheet 1: 报告概览 =====
  const overviewSheet = workbook.addWorksheet('报告概览');
  overviewSheet.addRow(['报告名称', report.name]).commit();
  overviewSheet.addRow(['测试主机', report.config.host]).commit();
  overviewSheet.addRow(['创建时间', report.createdAt]).commit();
  overviewSheet.addRow(['描述', report.description || '-']).commit();
  overviewSheet.addRow([]).commit();

  if (report.config.iterationParams?.length) {
    overviewSheet.addRow(['迭代参数配置']).commit();
    overviewSheet.addRow(['参数名', '起始值', '结束值', '步长']).commit();
    report.config.iterationParams.forEach((p) => {
      overviewSheet.addRow([p.name, p.start, p.end, p.step]).commit();
    });
    overviewSheet.addRow([]).commit();
  }

  overviewSheet.addRow(['迭代结果']).commit();
  const resultHeader = overviewSheet.addRow(['迭代', '参数', '分数', '状态', '迭代标签']);
  resultHeader.font = { bold: true };
  resultHeader.commit();
  report.results.forEach((r) => {
    const row = overviewSheet.addRow([
      r.iteration,
      r.iterationLabel || `${r.power}`,
      r.score,
      r.status,
      r.iterationLabel || '-',
    ]);
    row.commit();
  });
  overviewSheet.commit();

  // 收集所有监控命令ID
  const monitorIds = report.results
    .flatMap((r) => (r.monitorResults ? Object.keys(r.monitorResults) : []))
    .filter((v, i, a) => a.indexOf(v) === i);

  // ===== Sheet 2: 监控命令汇总 =====
  if (monitorIds.length > 0) {
    const monitorSheet = workbook.addWorksheet('监控命令汇总');
    for (const cmdId of monitorIds) {
      const firstResult = report.results.find((r) => r.monitorResults?.[cmdId]);
      const cmdName = firstResult?.monitorResults?.[cmdId].commandName || cmdId;

      const titleRow = monitorSheet.addRow([`${cmdName} - 跨迭代数据`]);
      titleRow.font = { bold: true, size: 12 };
      titleRow.commit();

      const headerRow = monitorSheet.addRow(['迭代', '参数', '平均值', '分数', '分数/平均值']);
      headerRow.font = { bold: true };
      headerRow.commit();

      report.results.forEach((r) => {
        const mr = r.monitorResults?.[cmdId];
        if (mr) {
          const ratio = mr.averageValue > 0 && r.score > 0 ? r.score / mr.averageValue : 0;
          monitorSheet
            .addRow([r.iteration, r.iterationLabel || `${r.power}`, mr.averageValue, r.score, ratio])
            .commit();
        }
      });
      monitorSheet.addRow([]).commit();
    }
    monitorSheet.commit();
  }

  // ===== Sheet 3+: 原始采样数据（按监控命令分 sheet） =====
  const usedSheetNames = new Set<string>();
  for (const cmdId of monitorIds) {
    const firstResult = report.results.find((r) => r.monitorResults?.[cmdId]);
    const cmdName = firstResult?.monitorResults?.[cmdId].commandName || cmdId;

    const lastPart = cmdName.split(' - ').pop() || cmdName;
    let sheetName = (lastPart || cmdId || 'Sheet').replace(/[\\\/:*?:\[\]]/g, '_').slice(0, 31);
    let suffix = 1;
    const baseName = sheetName;
    while (usedSheetNames.has(sheetName)) {
      const suffixStr = ` (${suffix})`;
      sheetName = baseName.slice(0, 31 - suffixStr.length) + suffixStr;
      suffix++;
    }
    usedSheetNames.add(sheetName);

    const rawSheet = workbook.addWorksheet(sheetName);
    const rawHeader = rawSheet.addRow(['迭代', '采样序号', '时间戳', '监控值', '原始输出']);
    rawHeader.font = { bold: true };
    rawHeader.commit();

    for (const r of report.results) {
      const mr = r.monitorResults?.[cmdId];
      if (!mr) continue;

      const expectedCount = mr.dataPointsCount ?? mr.dataPoints?.length ?? 0;
      if (expectedCount === 0) continue;

      const dataFile = path.join(
        REPORTS_DATA_DIR,
        reportId,
        'dataPoints',
        `iteration-${r.iteration}-${cmdId}.json`
      );
      if (!fs.existsSync(dataFile)) continue;

      const points = JSON.parse(fs.readFileSync(dataFile, 'utf-8')) as Array<{
        timestamp: string;
        value: number;
        raw: string;
      }>;

      points.forEach((dp, idx) => {
        rawSheet
          .addRow([r.iteration, idx + 1, dp.timestamp, isNaN(dp.value) ? '-' : dp.value, dp.raw])
          .commit();
      });

      reportProgress(points.length);
    }

    rawSheet.commit();
  }

  await workbook.commit();
  sendEvent(controller, 'progress', { percent: 100, processed: totalRows, totalRows });
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const downloadToken = searchParams.get('download');

  if (downloadToken) {
    const job = exportJobs.get(downloadToken);
    if (!job || !fs.existsSync(job.filePath)) {
      return NextResponse.json({ success: false, message: '下载链接已失效' }, { status: 404 });
    }

    const report = await loadReport(id);
    const baseName = sanitizeFilename(
      `test-report-${report?.name || id}-${(report?.createdAt || new Date().toISOString()).split('T')[0]}`
    );
    // HTTP 头要求 ASCII，用 ASCII 兜底 + UTF-8 filename* 保证中文文件名
    const asciiFilename = `${baseName.replace(/[^\x00-\x7F]/g, '_')}.xlsx`;
    const utf8Filename = `${encodeURIComponent(baseName)}.xlsx`;

    const fileStream = fs.createReadStream(job.filePath);
    const headers = new Headers();
    headers.set(
      'Content-Disposition',
      `attachment; filename="${asciiFilename}"; filename*=UTF-8''${utf8Filename}`
    );
    headers.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

    // 发送后清理临时文件
    fileStream.on('close', () => {
      try {
        fs.unlinkSync(job.filePath);
      } catch {
        // ignore
      }
      exportJobs.delete(downloadToken);
    });

    return new Response(Readable.toWeb(fileStream) as ReadableStream, { headers });
  }

  const report = await loadReport(id);
  if (!report) {
    return NextResponse.json({ success: false, message: '报告不存在' }, { status: 404 });
  }

  if (!fs.existsSync(EXPORTS_DIR)) {
    fs.mkdirSync(EXPORTS_DIR, { recursive: true });
  }

  const token = randomUUID();
  const filePath = path.join(EXPORTS_DIR, `${token}.xlsx`);
  exportJobs.set(token, { filePath, createdAt: Date.now() });

  const stream = new ReadableStream({
    start(controller) {
      buildExcel(id, report, filePath, controller)
        .then(() => {
          const downloadUrl = `/api/test/reports/${id}/export?download=${token}`;
          sendEvent(controller, 'done', { downloadUrl });
          controller.close();
        })
        .catch((error) => {
          const msg = error instanceof Error ? error.message : '导出失败';
          console.error('[Report Export] Error:', error);
          sendEvent(controller, 'error', { message: msg });
          controller.close();
          try {
            fs.unlinkSync(filePath);
          } catch {
            // ignore
          }
          exportJobs.delete(token);
        });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
