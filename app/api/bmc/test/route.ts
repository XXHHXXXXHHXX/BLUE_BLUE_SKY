/** BMC SSH 连接测试 API */
import { NextRequest, NextResponse } from 'next/server';
import { NodeSSH } from 'node-ssh';
import type { BMCConfig } from '../../../../src/types/topology';

/** 测试 SSH 连接到 BMC */
async function testSSHConnection(config: BMCConfig): Promise<{ success: boolean; message: string }> {
  const ssh = new NodeSSH();
  
  try {
    // 连接到 BMC
    await ssh.connect({
      host: config.ip,
      port: config.port || 22,
      username: config.username,
      password: config.password,
      readyTimeout: 15000, // 15秒超时
    });
    
    // 尝试执行一个简单的命令来验证连接
    const result = await ssh.execCommand('echo "SSH connection test successful"');
    
    if (result.stderr) {
      console.warn('[BMC Test] SSH stderr:', result.stderr);
    }
    
    return {
      success: true,
      message: `SSH 连接到 ${config.ip}:${config.port || 22} 成功`,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[BMC Test] SSH connection failed:', errorMessage);
    
    if (errorMessage.includes('ECONNREFUSED')) {
      return {
        success: false,
        message: '无法连接到 BMC，请检查 IP 地址和端口是否正确',
      };
    }
    
    if (errorMessage.includes('authentication') || errorMessage.includes('Authentication') || errorMessage.includes('All configured authentication methods failed')) {
      return {
        success: false,
        message: '认证失败，请检查用户名和密码是否正确',
      };
    }
    
    if (errorMessage.includes('timeout') || errorMessage.includes('Timeout')) {
      return {
        success: false,
        message: '连接超时，请检查网络或 BMC 是否可访问',
      };
    }
    
    if (errorMessage.includes('ENOTFOUND') || errorMessage.includes('getaddrinfo')) {
      return {
        success: false,
        message: '无法解析主机名，请检查 IP 地址是否正确',
      };
    }
    
    return {
      success: false,
      message: `SSH 连接失败: ${errorMessage}`,
    };
  } finally {
    ssh.dispose();
  }
}

/** POST /api/bmc/test - 测试 BMC SSH 连接 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { config } = body;
    
    if (!config) {
      return NextResponse.json(
        { success: false, message: '缺少配置信息' },
        { status: 400 }
      );
    }
    
    // 验证配置完整性
    if (!config.ip || !config.username || !config.password) {
      return NextResponse.json(
        { success: false, message: '配置不完整，请填写 IP、用户名和密码' },
        { status: 400 }
      );
    }
    
    // 测试 SSH 连接
    const result = await testSSHConnection(config as BMCConfig);
    
    return NextResponse.json({
      success: result.success,
      message: result.message,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[BMC Test] Error:', error);
    return NextResponse.json(
      { 
        success: false, 
        message: error instanceof Error ? error.message : '测试连接时发生错误' 
      },
      { status: 500 }
    );
  }
}
