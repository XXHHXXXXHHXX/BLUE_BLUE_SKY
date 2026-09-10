import fs from 'fs';
import path from 'path';
import ExcelJS from 'exceljs';
import PptxGenJS from 'pptxgenjs';

const DATA_DIR = path.join(process.cwd(), '.data');
const REPORTS_FILE = path.join(DATA_DIR, 'test-reports.json');
const PUBLIC_DIR = path.join(process.cwd(), 'public');
const GENERATED_DIR = path.join(PUBLIC_DIR, 'generated');

export interface ReportSummary {
  id: string;
  name: string;
  host: string;
  resultCount: number;
  avgScore: number;
  maxScore: number;
  minScore: number;
  createdAt: string;
}

export interface ReportDetail {
  id: string;
  name: string;
  host: string;
  createdAt: string;
  results: Array<{
    iteration: number;
    score: number;
    power: number;
    iterationLabel?: string;
    monitorValues: Record<string, number>;
  }>;
  monitors: string[];
}

function ensureGeneratedDir() {
  if (!fs.existsSync(GENERATED_DIR)) {
    fs.mkdirSync(GENERATED_DIR, { recursive: true });
  }
}

function loadReports(): any[] {
  try {
    if (fs.existsSync(REPORTS_FILE)) {
      return JSON.parse(fs.readFileSync(REPORTS_FILE, 'utf-8'));
    }
  } catch {
    console.error('[AI Report Generator] Failed to load test-reports');
  }
  return [];
}

function summarizeReports(reportIds: string[]): ReportSummary[] {
  const reports = loadReports();
  return reportIds
    .map((id) => reports.find((r: any) => r.id === id))
    .filter(Boolean)
    .map((r: any) => {
      const scores = r.results?.map((res: any) => res.score ?? 0) || [];
      const avg = scores.length ? scores.reduce((a: number, b: number) => a + b, 0) / scores.length : 0;
      return {
        id: r.id,
        name: r.name || '未命名',
        host: r.config?.host || '-',
        resultCount: r.results?.length || 0,
        avgScore: Number(avg.toFixed(4)),
        maxScore: scores.length ? Math.max(...scores) : 0,
        minScore: scores.length ? Math.min(...scores) : 0,
        createdAt: r.createdAt || '-',
      };
    });
}

function buildReportDetails(reportIds: string[]): ReportDetail[] {
  const reports = loadReports();
  return reportIds
    .map((id) => reports.find((r: any) => r.id === id))
    .filter(Boolean)
    .map((r: any) => {
      const monitorIds = new Set<string>();
      r.results?.forEach((res: any) => {
        Object.keys(res.monitorResults || {}).forEach((id) => monitorIds.add(id));
      });
      const monitors = Array.from(monitorIds);
      return {
        id: r.id,
        name: r.name || '未命名',
        host: r.config?.host || '-',
        createdAt: r.createdAt || '-',
        results: r.results?.map((res: any) => ({
          iteration: res.iteration,
          score: res.score ?? 0,
          power: res.power ?? 0,
          iterationLabel: res.iterationLabel,
          monitorValues: monitors.reduce((acc: Record<string, number>, id) => {
            acc[id] = res.monitorResults?.[id]?.averageValue ?? 0;
            return acc;
          }, {}),
        })) || [],
        monitors,
      };
    });
}

export async function generateExcelReport(reportIds: string[], title?: string): Promise<{ url: string; fileName: string; error?: string }> {
  try {
    ensureGeneratedDir();
    const summary = summarizeReports(reportIds);
    const details = buildReportDetails(reportIds);

    if (!summary.length) {
      return { error: '未找到指定的报告', url: '', fileName: '' };
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = '蓝天 AI 分析助手';
    workbook.created = new Date();

    // 摘要 sheet
    const summarySheet = workbook.addWorksheet('报告摘要');
    summarySheet.addRow([title || 'AI 分析报告']);
    summarySheet.addRow(['生成时间', new Date().toLocaleString()]);
    summarySheet.addRow([]);
    summarySheet.addRow(['报告名称', '主机', '样本数', '平均分数', '最高分数', '最低分数', '创建时间']);
    summary.forEach((r) => {
      summarySheet.addRow([r.name, r.host, r.resultCount, r.avgScore, r.maxScore, r.minScore, r.createdAt]);
    });

    // 每个报告的数据 sheet
    details.forEach((detail) => {
      const sheet = workbook.addWorksheet(detail.name.slice(0, 31)); // Excel sheet 名最大 31 字符
      sheet.addRow([`报告: ${detail.name}`, `主机: ${detail.host}`, `生成时间: ${detail.createdAt}`]);
      const header = ['迭代', '参数', '功耗', '分数', ...detail.monitors];
      sheet.addRow(header);
      detail.results.forEach((r) => {
        sheet.addRow([
          r.iteration,
          r.iterationLabel || `${r.power}`,
          r.power,
          r.score,
          ...detail.monitors.map((m) => r.monitorValues[m] ?? 0),
        ]);
      });
    });

    const fileName = `ai-report-${Date.now()}.xlsx`;
    const filePath = path.join(GENERATED_DIR, fileName);
    await workbook.xlsx.writeFile(filePath);

    return { url: `/generated/${fileName}`, fileName };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Excel 生成失败';
    console.error('[AI Report Generator] Excel error:', msg);
    return { error: msg, url: '', fileName: '' };
  }
}

export async function generatePPTReport(reportIds: string[], title?: string): Promise<{ url: string; fileName: string; error?: string }> {
  try {
    ensureGeneratedDir();
    const summary = summarizeReports(reportIds);

    if (!summary.length) {
      return { error: '未找到指定的报告', url: '', fileName: '' };
    }

    const pptx = new PptxGenJS();
    pptx.author = '蓝天 AI 分析助手';
    pptx.company = '蓝天系统';
    pptx.title = title || 'AI 分析报告';

    // 标题页
    const slideTitle = pptx.addSlide();
    slideTitle.addText(title || 'AI 分析报告', { x: 0.5, y: 1.5, w: 9, h: 1, fontSize: 32, bold: true, align: 'center' });
    slideTitle.addText(`生成时间: ${new Date().toLocaleString()}`, { x: 0.5, y: 3, w: 9, h: 0.5, fontSize: 14, align: 'center', color: '666666' });

    // 摘要页
    const slideSummary = pptx.addSlide();
    slideSummary.addText('报告摘要', { x: 0.5, y: 0.3, w: 9, h: 0.5, fontSize: 20, bold: true });
    const summaryRows = summary.map((r, idx) =>
      [`${idx + 1}`, r.name, r.host, String(r.resultCount), String(r.avgScore), String(r.maxScore), String(r.minScore)].map((text) => ({ text }))
    );
    slideSummary.addTable(
      [
        ['序号', '报告名称', '主机', '样本数', '平均分数', '最高分数', '最低分数'].map((text) => ({ text })),
        ...summaryRows,
      ],
      { x: 0.5, y: 1, w: 9, h: 4, fontSize: 12, border: { pt: 1, color: 'CCCCCC' } }
    );

    // 每个报告一页
    const details = buildReportDetails(reportIds);
    details.forEach((detail) => {
      const slide = pptx.addSlide();
      slide.addText(detail.name, { x: 0.5, y: 0.3, w: 9, h: 0.5, fontSize: 18, bold: true });
      slide.addText(`主机: ${detail.host} | 样本数: ${detail.results.length}`, { x: 0.5, y: 0.9, w: 9, h: 0.3, fontSize: 12, color: '666666' });

      // 取前 10 行数据展示
      const rows = detail.results.slice(0, 10).map((r) =>
        [
          String(r.iteration),
          r.iterationLabel || `${r.power}`,
          String(r.power),
          String(r.score),
          ...detail.monitors.map((m) => String(r.monitorValues[m] ?? 0)),
        ].map((text) => ({ text }))
      );
      slide.addTable(
        [
          ['迭代', '参数', '功耗', '分数', ...detail.monitors].map((text) => ({ text })),
          ...rows,
        ],
        { x: 0.5, y: 1.4, w: 9, h: 4, fontSize: 10, border: { pt: 1, color: 'CCCCCC' } }
      );
    });

    const fileName = `ai-report-${Date.now()}.pptx`;
    const filePath = path.join(GENERATED_DIR, fileName);
    await pptx.writeFile({ fileName: filePath });

    return { url: `/generated/${fileName}`, fileName };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'PPT 生成失败';
    console.error('[AI Report Generator] PPT error:', msg);
    return { error: msg, url: '', fileName: '' };
  }
}
