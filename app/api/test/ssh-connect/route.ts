/** 用例测试 SSH连接测试 API */
import { NextRequest, NextResponse } from 'next/server';
import { NodeSSH } from 'node-ssh';

export interface SSHConfig {
  host: string;
  port: number;
  username: string;
  password: string;
}

/** 测试 SSH 连接 */
async function testSSHConnection(config: SSHConfig): Promise<{ success: boolean; message: string }> {
  const ssh = new NodeSSH();
  
  try {
    await ssh.connect({
      host: config.host,
      port: config.port || 22,
      username: config.username,
      password: config.password,
      readyTimeout: 15000,
    });
    
    // 执行简单命令验证
    const result = await ssh.execCommand('echo "SSH connection test successful"');
    
    if (result.stderr) {
      console.warn('[SSH Test] stderr:', result.stderr);
    }
    
    return {
      success: true,
      message: `SSH 连接到 ${config.host}:${config.port || 22} 成功`,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[SSH Test] Connection failed:', errorMessage);
    
    if (errorMessage.includes('ECONNREFUSED')) {
      return {
        success: false,
        message: '无法连接到主机，请检查 IP 地址和端口是否正确',
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
        message: '连接超时，请检查网络或主机是否可访问',
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

/** POST /api/test/ssh-connect - 测试 SSH 连接 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { host, port, username, password } = body;
    
    // 验证参数
    if (!host || !username || !password) {
      return NextResponse.json(
        { success: false, message: '缺少必要参数：host, username, password' },
        { status: 400 }
      );
    }
    
    const config: SSHConfig = {
      host,
      port: port || 22,
      username,
      password,
    };
    
    const result = await testSSHConnection(config);
    
    return NextResponse.json({
      success: result.success,
      message: result.message,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[SSH Test] Error:', error);
    return NextResponse.json(
      { 
        success: false, 
        message: error instanceof Error ? error.message : '测试连接时发生错误' 
      },
      { status: 500 }
    );
  }
}
