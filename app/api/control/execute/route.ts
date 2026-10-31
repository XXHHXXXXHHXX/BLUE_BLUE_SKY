/** 控制命令下发 API - 通过 SSH 将控制命令下发到 BMC 执行 */
import { NextRequest, NextResponse } from 'next/server';
import type { BMCConfig } from '../../../../src/types/topology';
import { renderCommand } from '../../../../src/utils/commandParams';

interface ControlExecuteBody {
  config: BMCConfig;
  /** 控制 Shell 命令，包含 {value} 占位符（以及可选的 {ip}/{user}/{pass} 或自定义参数占位符） */
  shell: string;
  /** 要下发的调节值（将替换 {value} 占位符），可为数字或字符串 */
  value?: number | string;
  /** 自定义参数值（将替换命令中的 {参数名} 占位符），key 为参数名 */
  paramValues?: Record<string, string>;
}

/** POST /api/control/execute - 下发控制命令到 BMC */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Partial<ControlExecuteBody>;
    const { config, shell, value, paramValues } = body;

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
    if (!shell || !shell.trim()) {
      return NextResponse.json(
        { success: false, message: '控制命令未配置' },
        { status: 400 }
      );
    }
    // 传统模式要求 value；自定义参数模式显式携带 paramValues（前端已校验必填参数，
    // 允许空对象以支持“无参数、仅专属命令按钮”的固定命令下发）
    const hasValue = value !== undefined && value !== null && String(value).trim() !== '';
    const hasParams = paramValues !== undefined;
    if (!hasValue && !hasParams) {
      return NextResponse.json(
        { success: false, message: '调节值或参数无效' },
        { status: 400 }
      );
    }

    // 合并系统占位符与自定义参数，统一替换
    const merged: Record<string, string> = {
      value: value !== undefined && value !== null ? String(value) : '',
      ip: config.ip,
      user: config.username,
      pass: config.password,
      ...(paramValues || {}),
    };
    const command = renderCommand(shell.trim(), merged);
    console.log(`[Control] Executing on ${config.ip}: ${command}`);

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

      const result = await ssh.execCommand(command);
      stdout = result.stdout || '';
      stderr = result.stderr || '';

      if (stderr) {
        console.warn('[Control] SSH stderr:', stderr);
      }
    } finally {
      ssh.dispose();
    }

    return NextResponse.json({
      success: true,
      message: `命令已下发（值=${hasValue ? value : (paramValues ? Object.values(paramValues).join(',') : '')}）`,
      command,
      stdout,
      stderr,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[Control] Execute error:', errorMessage);
    return NextResponse.json(
      {
        success: false,
        message: `命令下发失败: ${errorMessage}`,
      },
      { status: 500 }
    );
  }
}
