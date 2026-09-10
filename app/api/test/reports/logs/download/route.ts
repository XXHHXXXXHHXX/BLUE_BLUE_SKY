/** 报告日志压缩包下载 API */
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

/** GET /api/test/reports/logs/download?reportId=xxx&iteration=yyy */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const reportId = searchParams.get('reportId');
    const iteration = searchParams.get('iteration');

    if (!reportId || !iteration) {
      return NextResponse.json(
        { success: false, message: '缺少必要参数' },
        { status: 400 }
      );
    }

    // 校验 reportId 格式
    if (!/^report-[-_a-zA-Z0-9]+$/.test(reportId)) {
      return NextResponse.json(
        { success: false, message: '非法的报告ID' },
        { status: 400 }
      );
    }

    // 校验 iteration 为纯数字
    if (!/^\d+$/.test(iteration)) {
      return NextResponse.json(
        { success: false, message: '非法的迭代序号' },
        { status: 400 }
      );
    }

    const logsDir = path.join(process.cwd(), '.data', 'reports', reportId, 'logs');

    // 支持 .tar.gz（新）和 .zip（旧）两种格式
    const candidates = [
      path.join(logsDir, `iteration-${iteration}.tar.gz`),
      path.join(logsDir, `iteration-${iteration}.zip`),
    ];

    let resolvedPath: string | undefined;
    let ext = '.tar.gz';
    for (const candidate of candidates) {
      const rp = path.resolve(candidate);
      const resolvedLogsDir = path.resolve(logsDir);
      if (!rp.startsWith(resolvedLogsDir + path.sep) && rp !== resolvedLogsDir) {
        continue;
      }
      if (fs.existsSync(rp) && fs.statSync(rp).isFile()) {
        resolvedPath = rp;
        ext = candidate.endsWith('.tar.gz') ? '.tar.gz' : '.zip';
        break;
      }
    }

    if (!resolvedPath) {
      return NextResponse.json(
        { success: false, message: '日志文件不存在' },
        { status: 404 }
      );
    }

    const stat = fs.statSync(resolvedPath);
    const fileBuffer = fs.readFileSync(resolvedPath);

    const contentType = ext === '.tar.gz' ? 'application/gzip' : 'application/zip';
    const downloadName = `iteration-${iteration}-logs${ext}`;

    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${downloadName}"`,
        'Content-Length': String(stat.size),
      },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : '下载失败';
    console.error('[Reports Logs Download API] Error:', msg);
    return NextResponse.json(
      { success: false, message: msg },
      { status: 500 }
    );
  }
}
