/** 数据分析 API - 调用 Python 分析引擎 */
import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';

const PYTHON_SCRIPT = path.join(process.cwd(), 'src', 'utils', 'analysis_engine.py');

// 根据平台选择 Python 命令：Windows 通常为 python，Linux/macOS 通常为 python3
const PYTHON_CMD = process.platform === 'win32' ? 'python' : 'python3';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { report, target, direction, rank } = body;

    if (!report || !report.results || report.results.length < 2) {
      return NextResponse.json(
        { success: false, message: '报告数据不足，至少需要 2 条结果' },
        { status: 400 }
      );
    }

    const inputData = JSON.stringify({
      report,
      target: target || 'score',
      direction: direction || 'max',
      rank: rank ?? 0,
    });

    const result = await new Promise<string>((resolve, reject) => {
      const python = spawn(PYTHON_CMD, [PYTHON_SCRIPT], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          PYTHONIOENCODING: 'utf-8',
        },
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
        } else {
          resolve(stdout);
        }
      });

      python.on('error', (err) => {
        reject(err);
      });

      // 30 秒超时
      setTimeout(() => {
        python.kill('SIGTERM');
        reject(new Error('Python 分析引擎超时'));
      }, 30000);
    });

    // 解析最后一行 JSON（防止有日志输出）
    const lines = result.trim().split('\n');
    const jsonLine = lines.find((l) => l.trim().startsWith('{')) || lines[lines.length - 1];
    const analysisResult = JSON.parse(jsonLine);

    if (analysisResult.error) {
      return NextResponse.json(
        { success: false, message: analysisResult.error },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true, data: analysisResult });
  } catch (error) {
    const msg = error instanceof Error ? error.message : '分析失败';
    console.error('[Analysis API] Error:', msg);
    return NextResponse.json(
      { success: false, message: msg },
      { status: 500 }
    );
  }
}
