/** 报告监控采样点按需读取 */
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const REPORTS_DATA_DIR = path.join(process.cwd(), '.data', 'reports');

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const iteration = parseInt(searchParams.get('iteration') || '1', 10);
    const commandId = searchParams.get('commandId') || '';
    const offset = parseInt(searchParams.get('offset') || '0', 10);
    const limit = Math.min(parseInt(searchParams.get('limit') || '5000', 10), 5000);

    const filePath = path.join(
      REPORTS_DATA_DIR,
      id,
      'dataPoints',
      `iteration-${iteration}-${commandId}.json`
    );

    if (!fs.existsSync(filePath)) {
      return NextResponse.json(
        { success: false, message: '数据不存在' },
        { status: 404 }
      );
    }

    const all = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Array<{
      timestamp: string;
      value: number;
      raw: string;
    }>;

    return NextResponse.json({
      success: true,
      data: {
        commandId,
        iteration,
        total: all.length,
        dataPoints: all.slice(offset, offset + limit),
      },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : '读取失败';
    console.error('[Reports Monitor Data] Error:', msg);
    return NextResponse.json({ success: false, message: msg }, { status: 500 });
  }
}
