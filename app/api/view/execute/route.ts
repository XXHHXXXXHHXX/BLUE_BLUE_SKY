/** 查看组件执行 API - 通过 SSH 到已连接 BMC 执行查询命令并返回结果 */
import { NextRequest, NextResponse } from 'next/server';
import type { BMCConfig } from '../../../../src/types/topology';
import { renderCommand } from '../../../../src/utils/commandParams';

interface ViewExecuteBody {
  /** 已连接 BMC 的配置（来自监控页会话） */
  config: BMCConfig;
  /** 查询命令模板，包含 {paramName} 占位符（如 ssh {user}@{ip}:{password} hello） */
  command: string;
  /** 用户在前端填写的参数值，key 为参数名 */
  paramValues: Record<string, string>;
}

/** POST /api/view/execute - 在已连接 BMC 上执行查看命令 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Partial<ViewExecuteBody>;
    const { config, command, paramValues } = body;

    if (!config) {
      return NextResponse.json(
        { success: false, message: '缺少 BMC 配置信息' },
        { status: 400 }
      );
    }
    if (!config.ip || !config.username || !config.password) {
      return NextResponse.json(
        { success: false, message: 'BMC 配置不完整，请检查连接配置' },
        { status: 400 }
      );
    }
    if (!command || !command.trim()) {
      return NextResponse.json(
        { success: false, message: '查看命令未配置' },
        { status: 400 }
      );
    }

    const cmd = renderCommand(command.trim(), paramValues || {});
    console.log(`[View] Executing on ${config.ip}: ${cmd}`);

    const { NodeSSH } = await import('node-ssh');
    const ssh = new NodeSSH();
    let stdout = '';
    let stderr = '';

    try {
      await ssh.connect({
        host: config.ip,
        port: config.port || 22,
        username: config.username,
        password: config.password,
        readyTimeout: 20000,
      });

      const result = await ssh.execCommand(cmd, { timeout: 30000 });
      stdout = result.stdout || '';
      stderr = result.stderr || '';

      if (stderr) {
        console.warn('[View] SSH stderr:', stderr);
      }
    } finally {
      ssh.dispose();
    }

    return NextResponse.json({
      success: true,
      message: '命令执行成功',
      command: cmd,
      stdout,
      stderr,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[View] Execute error:', errorMessage);
    return NextResponse.json(
      {
        success: false,
        message: `命令执行失败: ${errorMessage}`,
      },
      { status: 500 }
    );
  }
}
