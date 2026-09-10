/** 测试报告合并 API - 将两个采样字段相同的报告合并为一个 */
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), '.data');
const REPORTS_FILE = path.join(DATA_DIR, 'test-reports.json');
const REPORTS_DATA_DIR = path.join(DATA_DIR, 'reports');
const DEFAULT_FOLDER_ID = 'uncategorized';

interface MonitorResult {
  commandId: string;
  commandName: string;
  dataPoints: Array<{ timestamp: string; value: number; raw: string }>;
  dataPointsCount?: number;
  averageValue: number;
}

interface TestResult {
  iteration: number;
  power: number;
  score: number;
  status: string;
  message?: string;
  timestamp: string;
  iterationValues?: Record<string, string>;
  iterationLabel?: string;
  monitorResults?: Record<string, MonitorResult>;
  logArchivePath?: string;
}

interface TestReportData {
  id: string;
  name: string;
  description?: string;
  folderId?: string;
  createdAt: string;
  config: {
    host: string;
    iterationParams?: Array<{ id: string; name: string; mode: 'range' | 'custom'; start: number; end: number; step: number; values: string[] }>;
    adjustmentCommands?: Array<{ id: string; name: string; target: string; sessionId: string | null; command: string; parameterName: string }>;
    startPower?: number;
    endPower?: number;
    step?: number;
  };
  results: TestResult[];
  jobId?: string;
  chartData?: { powerData: number[]; scoreData: number[] };
  monitorResults?: Record<string, MonitorResult>;
  environment?: Record<string, string>;
  stageId?: string;
  stageName?: string;
}

function loadReports(): TestReportData[] {
  try {
    if (fs.existsSync(REPORTS_FILE)) {
      return JSON.parse(fs.readFileSync(REPORTS_FILE, 'utf-8'));
    }
  } catch {
    console.error('[Report Merge] Failed to load reports');
  }
  return [];
}

function saveReports(reports: TestReportData[]) {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  try {
    fs.writeFileSync(REPORTS_FILE, JSON.stringify(reports, null, 2));
  } catch (err) {
    console.error('[Report Merge] Failed to save reports:', err);
    throw err;
  }
}

function getCommandIds(report: TestReportData): string[] {
  const ids = new Set<string>();
  for (const result of report.results) {
    if (result.monitorResults) {
      Object.keys(result.monitorResults).forEach((key) => ids.add(key));
    }
  }
  return Array.from(ids).sort();
}

function copyDataPointsWithRename(
  sourceDataDir: string,
  destDataDir: string,
  iterationOffset: number
) {
  if (!fs.existsSync(sourceDataDir)) return;

  if (!fs.existsSync(destDataDir)) {
    fs.mkdirSync(destDataDir, { recursive: true });
  }

  const files = fs.readdirSync(sourceDataDir);
  for (const file of files) {
    const match = file.match(/^iteration-(\d+)-(.+)\.json$/);
    if (match) {
      const oldIteration = parseInt(match[1], 10);
      const commandId = match[2];
      const newIteration = oldIteration + iterationOffset;
      const srcPath = path.join(sourceDataDir, file);
      const destPath = path.join(destDataDir, `iteration-${newIteration}-${commandId}.json`);
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/** POST /api/test/reports/merge */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { report1Id, report2Id } = body;

    if (!report1Id || !report2Id) {
      return NextResponse.json({ success: false, message: '缺少报告ID' }, { status: 400 });
    }

    if (report1Id === report2Id) {
      return NextResponse.json({ success: false, message: '不能合并同一个报告' }, { status: 400 });
    }

    const reports = loadReports();
    const report1 = reports.find((r) => r.id === report1Id);
    const report2 = reports.find((r) => r.id === report2Id);

    if (!report1) {
      return NextResponse.json({ success: false, message: '第一个报告不存在' }, { status: 404 });
    }
    if (!report2) {
      return NextResponse.json({ success: false, message: '第二个报告不存在' }, { status: 404 });
    }

    const commandIds1 = getCommandIds(report1);
    const commandIds2 = getCommandIds(report2);

    if (commandIds1.length !== commandIds2.length || !commandIds1.every((id, idx) => id === commandIds2[idx])) {
      return NextResponse.json({ success: false, message: '两个报告的采样字段不一致，无法合并' }, { status: 400 });
    }

    const maxIteration1 = Math.max(...report1.results.map((r) => r.iteration));
    const newReportId = `report-${Date.now()}`;
    const newReportDataDir = path.join(REPORTS_DATA_DIR, newReportId, 'dataPoints');

    if (!fs.existsSync(newReportDataDir)) {
      fs.mkdirSync(newReportDataDir, { recursive: true });
    }

    const newResults: TestResult[] = [];

    for (const result of report1.results) {
      newResults.push({ ...result });
    }

    for (let i = 0; i < report2.results.length; i++) {
      const result = report2.results[i];
      const newIteration = maxIteration1 + 1 + i;
      const newResult = { ...result, iteration: newIteration };
      newResults.push(newResult);
    }

    const source1DataDir = path.join(REPORTS_DATA_DIR, report1Id, 'dataPoints');
    const source2DataDir = path.join(REPORTS_DATA_DIR, report2Id, 'dataPoints');

    copyDataPointsWithRename(source1DataDir, newReportDataDir, 0);
    copyDataPointsWithRename(source2DataDir, newReportDataDir, maxIteration1);

    const mergedReport: TestReportData = {
      id: newReportId,
      name: `${report1.name} + ${report2.name}`,
      description: `由 "${report1.name}" 和 "${report2.name}" 合并生成`,
      folderId: report1.folderId || DEFAULT_FOLDER_ID,
      createdAt: new Date().toISOString(),
      config: report1.config,
      results: newResults,
      jobId: report1.jobId,
      chartData: {
        powerData: newResults.map((r) => r.power),
        scoreData: newResults.map((r) => r.score),
      },
      environment: { ...report1.environment, ...report2.environment },
      stageId: report1.stageId,
      stageName: report1.stageName,
    };

    reports.unshift(mergedReport);
    saveReports(reports);

    console.log('[Report Merge] Merged successfully:', {
      newReportId,
      report1Id,
      report2Id,
      report1Iterations: report1.results.length,
      report2Iterations: report2.results.length,
      newIterationCount: newResults.length,
      iterationOffset: maxIteration1,
    });

    return NextResponse.json({ success: true, report: mergedReport });
  } catch (error) {
    const msg = error instanceof Error ? error.message : '合并失败';
    console.error('[Report Merge] Error:', msg);
    return NextResponse.json({ success: false, message: msg }, { status: 500 });
  }
}