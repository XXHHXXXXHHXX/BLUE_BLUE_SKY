/** 报告相关工具的实现（从 analyze 路由抽出，便于插件化与单测） */
import { spawn } from 'child_process';
import path from 'path';
import { getReportById, loadReports, loadFolders, type TestReportData, type ReportFolderData } from '../storage/reportStore';

const PYTHON_SCRIPT = path.join(process.cwd(), 'src', 'utils', 'analysis_engine.py');
const PYTHON_CMD = process.platform === 'win32' ? 'python' : 'python3';

export function buildFolderTree(
  folders: ReportFolderData[],
  parentId: string | null = null,
): Array<{ id: string; name: string; children: ReturnType<typeof buildFolderTree> }> {
  return folders
    .filter((f) => f.parentId === parentId)
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
    .map((f) => ({
      id: f.id,
      name: f.name,
      children: buildFolderTree(folders, f.id),
    }));
}

export function summarizeReport(report: TestReportData) {
  const scores = report.results?.map((r) => r.score) || [];
  const namedScores: Record<string, { min: number; max: number; avg: number }> = {};
  const scoreNames: string[] = [];
  (report.results || []).forEach((r) => {
    Object.keys(r.scores || {}).forEach((name) => {
      if (!scoreNames.includes(name)) scoreNames.push(name);
    });
  });
  scoreNames.forEach((name) => {
    const values = (report.results || [])
      .map((r) => r.scores?.[name])
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    if (values.length) {
      namedScores[name] = {
        min: Math.min(...values),
        max: Math.max(...values),
        avg: values.reduce((a, b) => a + b, 0) / values.length,
      };
    }
  });
  return {
    id: report.id,
    name: report.name,
    description: report.description,
    host: report.config?.host,
    folderId: report.folderId || 'uncategorized',
    createdAt: report.createdAt,
    resultCount: report.results?.length || 0,
    iterationParams: report.config?.iterationParams?.map((p) => p.name) || [],
    monitorCommands: report.results?.[0]?.monitorResults
      ? Object.values(report.results[0].monitorResults).map((mr) => mr.commandName)
      : [],
    scoreRange: scores.length
      ? {
          min: Math.min(...scores),
          max: Math.max(...scores),
          avg: scores.reduce((a, b) => a + b, 0) / scores.length,
        }
      : null,
    namedScoreRanges: Object.keys(namedScores).length ? namedScores : undefined,
  };
}

/** 报告详情：采样点聚合为平均值与计数，避免 token 过长 */
export function getReportDetail(reportId: string): Record<string, unknown> | null {
  const report = getReportById(reportId);
  if (!report) return null;
  return {
    ...report,
    results: report.results?.map((r) => ({
      ...r,
      monitorResults: r.monitorResults
        ? Object.fromEntries(
            Object.entries(r.monitorResults).map(([k, mr]) => [
              k,
              {
                commandId: mr.commandId,
                commandName: mr.commandName,
                averageValue: mr.averageValue,
                dataPointsCount: mr.dataPointsCount ?? mr.dataPoints?.length,
              },
            ]),
          )
        : undefined,
    })),
  } as Record<string, unknown>;
}

/** 调用 Python 智能分析引擎（XGBoost + SHAP） */
export async function runSmartAnalysis(
  reportId: string,
  target: string,
  direction: 'max' | 'min',
  rank: number,
): Promise<Record<string, unknown>> {
  const report = getReportById(reportId);
  if (!report) return { error: '报告不存在' };

  const inputData = JSON.stringify({
    report,
    target: target || 'score',
    direction: direction || 'max',
    rank: rank ?? 0,
  });

  return new Promise((resolve, reject) => {
    const python = spawn(PYTHON_CMD, [PYTHON_SCRIPT], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });

    let stdout = '';
    let stderr = '';
    python.stdin.write(inputData);
    python.stdin.end();
    python.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    python.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    python.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Python 进程退出码 ${code}: ${stderr || stdout}`));
        return;
      }
      const lines = stdout.trim().split('\n');
      const jsonLine = lines.find((l) => l.trim().startsWith('{')) || lines[lines.length - 1];
      try {
        resolve(JSON.parse(jsonLine));
      } catch {
        resolve({ rawOutput: stdout.trim() });
      }
    });
    python.on('error', (err) => reject(err));
    setTimeout(() => {
      python.kill('SIGTERM');
      reject(new Error('Python 分析引擎超时'));
    }, 30000);
  });
}

export { loadReports, loadFolders };
