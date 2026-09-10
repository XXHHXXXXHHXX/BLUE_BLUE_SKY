/** 功耗遍历测试执行 API */
import { NextRequest, NextResponse } from 'next/server';
import { NodeSSH } from 'node-ssh';
import { writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

interface PowerTestConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  startPower: number;
  endPower: number;
}

/** 执行功耗遍历测试 */
async function executePowerTest(
  config: PowerTestConfig,
  fileBuffer: Buffer,
  fileName: string
): Promise<{ success: boolean; message: string; output?: string }> {
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
    
    const remoteDir = `/tmp/power_test_${Date.now()}`;
    const remoteFilePath = `${remoteDir}/${fileName}`;
    
    // 创建远程目录
    await ssh.execCommand(`mkdir -p ${remoteDir}`);
    
    // 上传文件到临时位置再传输到远程
    const tempLocalPath = join(tmpdir(), fileName);
    await writeFile(tempLocalPath, fileBuffer);
    
    // 上传文件到远程主机
    await ssh.putFile(tempLocalPath, remoteFilePath);
    
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
    
    // 检查 run.sh 是否存在
    const checkScript = await ssh.execCommand(`ls -la ${remoteDir}/run.sh`);
    if (checkScript.code !== 0) {
      // 可能在子目录中
      const findScript = await ssh.execCommand(`find ${remoteDir} -name "run.sh" -type f | head -1`);
      if (!findScript.stdout.trim()) {
        throw new Error('压缩包中未找到 run.sh 脚本');
      }
    }
    
    // 执行测试脚本
    const step = 50; // 默认步长50W
    const runCmd = `cd ${remoteDir} && chmod +x run.sh && ./run.sh ${config.startPower} ${config.endPower} ${step}`;
    
    const runResult = await ssh.execCommand(runCmd, {
      execOptions: {
        env: {
          ...process.env,
          POWER_TEST_START: config.startPower.toString(),
          POWER_TEST_END: config.endPower.toString(),
          POWER_TEST_STEP: step.toString(),
        } as NodeJS.ProcessEnv,
      },
    });
    
    // 清理临时文件
    await ssh.execCommand(`rm -rf ${remoteDir}`);
    
    return {
      success: runResult.code === 0,
      message: runResult.code === 0 ? '测试执行成功' : `测试执行失败: ${runResult.stderr}`,
      output: runResult.stdout + (runResult.stderr ? `\n[错误输出]\n${runResult.stderr}` : ''),
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[Power Test] Error:', errorMessage);
    
    return {
      success: false,
      message: errorMessage,
    };
  } finally {
    ssh.dispose();
  }
}

/** POST /api/test/power-test - 执行功耗遍历测试 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    
    const file = formData.get('file') as File;
    const host = formData.get('host') as string;
    const port = parseInt(formData.get('port') as string) || 22;
    const username = formData.get('username') as string;
    const password = formData.get('password') as string;
    const startPower = parseInt(formData.get('startPower') as string) || 100;
    const endPower = parseInt(formData.get('endPower') as string) || 500;
    
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
    
    const config: PowerTestConfig = {
      host,
      port,
      username,
      password,
      startPower,
      endPower,
    };
    
    const result = await executePowerTest(config, fileBuffer, file.name);
    
    return NextResponse.json({
      success: result.success,
      message: result.message,
      output: result.output,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[Power Test] API Error:', error);
    return NextResponse.json(
      { 
        success: false, 
        message: error instanceof Error ? error.message : '执行测试时发生错误' 
      },
      { status: 500 }
    );
  }
}
