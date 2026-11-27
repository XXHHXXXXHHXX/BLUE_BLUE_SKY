/** 数据分析流式接口 - 逐阶段推送建模过程事件（SSE）
 *
 * 与 /api/analysis 的区别：这里以 NDJSON 逐行读取 Python 引擎的中间步骤，
 * 转成 SSE 实时推给前端，用于「AI 实时建模可视化」逐帧渲染。
 */
import { NextRequest } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';
import { getReportById, stripReportForList } from '../../../../src/server/storage/reportStore';

const PYTHON_SCRIPT = path.join(process.cwd(), 'src', 'utils', 'analysis_engine.py');
const PYTHON_CMD = process.platform === 'win32' ? 'python' : 'python3';

export async function POST(request: NextRequest) {
  let body: {
    report?: unknown;
    reportId?: string;
    target?: string;
    direction?: string;
    rank?: number;
  };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ success: false, message: '请求体不是合法 JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 支持直接传 report 对象，或传 reportId 由服务端读取
  let report = body.report as { results?: unknown[] } | undefined;
  if (!report && body.reportId) {
    const loaded = getReportById(String(body.reportId));
    // 剥离采样点：分析引擎只用 iterationValues/score/averageValue，剥离可显著减小 stdin 体积
    report = loaded ? (stripReportForList(loaded) as unknown as { results?: unknown[] }) : undefined;
  }

  if (!report || !Array.isArray(report.results) || report.results.length < 2) {
    return new Response(
      JSON.stringify({ success: false, message: '报告数据不足，至少需要 2 条结果' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const inputData = JSON.stringify({
    report,
    target: body.target || 'score',
    direction: body.direction || 'max',
    rank: body.rank ?? 0,
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (obj: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch {
          closed = true;
        }
      };
      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          /* 已关闭 */
        }
      };

      const python = spawn(PYTHON_CMD, [PYTHON_SCRIPT, '--stream'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      });

      let stdoutBuf = '';
      let stderr = '';
      let finished = false;

      const timer = setTimeout(() => {
        if (finished) return;
        finished = true;
        python.kill('SIGTERM');
        send({ type: 'error', message: 'Python 分析引擎超时（30s）' });
        close();
      }, 30000);

      python.stdin.write(inputData);
      python.stdin.end();

      python.stdout.on('data', (chunk: Buffer) => {
        stdoutBuf += chunk.toString('utf-8');
        const lines = stdoutBuf.split('\n');
        stdoutBuf = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            send(JSON.parse(trimmed));
          } catch {
            // 非 JSON 日志行忽略
          }
        }
      });

      python.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf-8');
      });

      python.on('error', (err) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        send({ type: 'error', message: `无法启动 Python 分析引擎：${err.message}` });
        close();
      });

      python.on('close', (code) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        // 处理残留的最后一行
        const rest = stdoutBuf.trim();
        if (rest) {
          try {
            send(JSON.parse(rest));
          } catch {
            /* ignore */
          }
        }
        if (code !== 0) {
          send({
            type: 'error',
            message: `Python 进程退出码 ${code}${stderr ? `：${stderr.slice(0, 500)}` : ''}`,
          });
        }
        close();
      });

      // 客户端中断时终止子进程
      request.signal.addEventListener('abort', () => {
        if (!finished) {
          finished = true;
          clearTimeout(timer);
          python.kill('SIGTERM');
        }
        close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
