/** 功耗遍历测试 - 部署测试包 API */
import { NextRequest, NextResponse } from 'next/server';
import { NodeSSH } from 'node-ssh';
import { writeFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

interface DeployConfig {
  host: string;
  port: number;
  username: string;
  password: string;
}

/** 部署测试包到远程主机 */
async function deployTestPackage(
  config: DeployConfig,
  fileBuffer: Buffer,
  fileName: string
): Promise<{ success: boolean; message: string; remotePath?: string }> {
  const ssh = new NodeSSH();
  
  try {
    // 连接SSH
    await ssh.connect({
      host: config.host,
      port: config.port || 22,
      username: config.username,
      password: config.password,
      readyTimeout: 30000,
    });
    
    const remoteDir = `/tmp/blue_sky_power_test_${Date.now()}`;
    const remoteFilePath = `${remoteDir}/${fileName}`;
    
    // 创建远程目录
    const mkdirResult = await ssh.execCommand(`mkdir -p ${remoteDir}`);
    if (mkdirResult.code !== 0) {
      throw new Error(`创建目录失败: ${mkdirResult.stderr}`);
    }
    
    // 保存到临时文件
    const tempLocalPath = join(tmpdir(), fileName);
    await writeFile(tempLocalPath, fileBuffer);
    
    // 上传文件到远程主机
    await ssh.putFile(tempLocalPath, remoteFilePath);
    
    // 删除本地临时文件
    await unlink(tempLocalPath);
    
    // 解压文件
    let extractCmd: string;
    if (fileName.endsWith('.zip')) {
      extractCmd = `cd ${remoteDir} && unzip -o ${fileName}`;
    } else if (fileName.endsWith('.tar.gz')) {
      extractCmd = `cd ${remoteDir} && tar -xzf ${fileName}`;
    } else if (fileName.endsWith('.tar')) {
      extractCmd = `cd ${remoteDir} && tar -xf ${fileName}`;
    } else {
      throw new Error('不支持的文件格式');
    }
    
    const extractResult = await ssh.execCommand(extractCmd);
    if (extractResult.code !== 0) {
      throw new Error(`解压失败: ${extractResult.stderr}`);
    }
    
    // 查找 run.sh
    const findResult = await ssh.execCommand(`find ${remoteDir} -name "run.sh" -type f | head -1`);
    const runShPath = findResult.stdout.trim();
    
    if (!runShPath) {
      throw new Error('压缩包中未找到 run.sh 脚本');
    }
    
    // 给 run.sh 添加执行权限
    await ssh.execCommand(`chmod +x ${runShPath}`);
    
    return {
      success: true,
      message: '部署成功',
      remotePath: remoteDir,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[Power Test Deploy] Error:', errorMessage);
    
    return {
      success: false,
      message: errorMessage,
    };
  } finally {
    ssh.dispose();
  }
}

/** POST /api/test/power-test-deploy - 部署测试包 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    
    const file = formData.get('file') as File;
    const host = formData.get('host') as string;
    const port = parseInt(formData.get('port') as string) || 22;
    const username = formData.get('username') as string;
    const password = formData.get('password') as string;
    
    // 验证参数
    if (!file || !host || !username || !password) {
      return NextResponse.json(
        { success: false, message: '缺少必要参数' },
        { status: 400 }
      );
    }
    
    // 验证文件类型
    const validExtensions = ['.zip', '.tar', '.tar.gz'];
    const hasValidExt = validExtensions.some(ext => file.name.endsWith(ext));
    if (!hasValidExt) {
      return NextResponse.json(
        { success: false, message: '只支持 .zip, .tar, .tar.gz 格式的压缩包' },
        { status: 400 }
      );
    }
    
    // 读取文件
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    
    const config: DeployConfig = {
      host,
      port,
      username,
      password,
    };
    
    const result = await deployTestPackage(config, fileBuffer, file.name);
    
    return NextResponse.json({
      success: result.success,
      message: result.message,
      remotePath: result.remotePath,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[Power Test Deploy] API Error:', error);
    return NextResponse.json(
      { 
        success: false, 
        message: error instanceof Error ? error.message : '部署测试包时发生错误' 
      },
      { status: 500 }
    );
  }
}
