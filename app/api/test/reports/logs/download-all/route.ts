/** 报告日志一键下载 API - 整合报告所有轮次的日志为单个压缩包 */
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';

/** GET /api/test/reports/logs/download-all?reportId=xxx */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const reportId = searchParams.get('reportId');

    if (!reportId) {
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

    const logsDir = path.join(process.cwd(), '.data', 'reports', reportId, 'logs');
    if (!fs.existsSync(logsDir)) {
      return NextResponse.json(
        { success: false, message: '日志文件不存在' },
        { status: 404 }
      );
    }

    // 收集报告日志目录下所有轮次文件（iteration-N.zip / iteration-N.tar.gz）
    const files = fs.readdirSync(logsDir)
      .filter((f) => /^iteration-\d+\.(zip|tar\.gz)$/.test(f))
      .sort((a, b) => {
        const numA = parseInt(a.match(/^iteration-(\d+)/)?.[1] || '0', 10);
        const numB = parseInt(b.match(/^iteration-(\d+)/)?.[1] || '0', 10);
        return numA - numB;
      });

    if (files.length === 0) {
      return NextResponse.json(
        { success: false, message: '日志文件不存在' },
        { status: 404 }
      );
    }

    // 用 JSZip 把各轮次日志整合为一个压缩包，保留每轮文件名为 iteration-N.logs.zip
    const zip = new JSZip();
    for (const file of files) {
      const filePath = path.join(logsDir, file);
      const rp = path.resolve(filePath);
      const resolvedLogsDir = path.resolve(logsDir);
      if (!rp.startsWith(resolvedLogsDir + path.sep)) continue;
      if (fs.statSync(rp).isFile()) {
        // 统一命名为 iteration-N.logs.zip（.tar.gz 也保留原扩展名便于区分格式）
        const match = file.match(/^iteration-(\d+)(\.tar\.gz|\.zip)$/);
        const iterationNum = match?.[1] ?? file;
        const srcExt = match?.[2] ?? '.zip';
        const entryName = `iteration-${iterationNum}.logs${srcExt}`;
        zip.file(entryName, fs.readFileSync(rp));
      }
    }

    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    const buffer = Buffer.from(zipBuffer);
    const downloadName = `${reportId}-logs-all.zip`;

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${downloadName}"`,
        'Content-Length': String(buffer.length),
      },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : '下载失败';
    console.error('[Reports Logs Download-All API] Error:', msg);
    return NextResponse.json(
      { success: false, message: msg },
      { status: 500 }
    );
  }
}
