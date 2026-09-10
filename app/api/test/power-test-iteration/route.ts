/** 功耗遍历测试 - 单轮测试 API */
import { NextRequest, NextResponse } from 'next/server';
import { NodeSSH } from 'node-ssh';

interface IterationConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  power: number;
  iteration: number;
}

interface TestResult {
  score: number;
  power?: number;
  [key: string]: unknown;
}

/** 执行单轮测试 */
async function runIteration(
  config: IterationConfig,
  remotePath: string
): Promise<{ success: boolean; message: string; score?: number; rawOutput?: string }> {
  const ssh = new NodeSSH();
  
  try {
    // 连接SSH
    await ssh.connect({
      host: config.host,
      port: config.port || 22,
      username: config.username,
      password: config.password,
      readyTimeout: 60000, // 单轮测试最长60秒
    });
    
    // 查找 run.sh 路径
    const findResult = await ssh.execCommand(`find ${remotePath} -name "run.sh" -type f | head -1`);
    const runShPath = findResult.stdout.trim();
    
    if (!runShPath) {
      throw new Error('未找到 run.sh 脚本，可能已被清理');
    }
    
    // 获取脚本所在目录
    const scriptDir = runShPath.substring(0, runShPath.lastIndexOf('/'));
    
    // 执行 run.sh，传入功耗值参数
    const runCmd = `cd ${scriptDir} && ./run.sh ${config.power}`;
    
    const runResult = await ssh.execCommand(runCmd, {
      execOptions: {
        env: {
          ...process.env,
          BLUE_SKY_POWER: config.power.toString(),
          BLUE_SKY_ITERATION: config.iteration.toString(),
        } as NodeJS.ProcessEnv,
      },
    });
    
    if (runResult.code !== 0) {
      return {
        success: false,
        message: `脚本执行失败: ${runResult.stderr || '未知错误'}`,
        rawOutput: runResult.stdout + '\n' + runResult.stderr,
      };
    }
    
    // 解析输出中的 JSON
    const output = runResult.stdout;
    let result: TestResult | null = null;
    
    // 尝试从输出中提取 JSON
    // 支持多行输出，查找最后一行有效的 JSON
    const lines = output.trim().split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (line.startsWith('{') && line.endsWith('}')) {
        try {
          result = JSON.parse(line) as TestResult;
          break;
        } catch {
          // 继续尝试上一行
        }
      }
    }
    
    if (!result) {
      return {
        success: false,
        message: '无法解析测试结果，run.sh 必须输出 JSON 格式: {"score": number}',
        rawOutput: output,
      };
    }
    
    if (typeof result.score !== 'number') {
      return {
        success: false,
        message: '结果中缺少 score 字段或类型不正确',
        rawOutput: output,
      };
    }
    
    return {
      success: true,
      message: '测试完成',
      score: result.score,
      rawOutput: output,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[Power Test Iteration] Error:', errorMessage);
    
    return {
      success: false,
      message: errorMessage,
    };
  } finally {
    ssh.dispose();
  }
}

/** POST /api/test/power-test-iteration - 执行单轮测试 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { host, port, username, password, power, iteration } = body;
    
    // 验证参数
    if (!host || !username || !password || power === undefined || iteration === undefined) {
      return NextResponse.json(
        { success: false, message: '缺少必要参数' },
        { status: 400 }
      );
    }
    
    // 查找该主机最近的测试目录
    // 这里简化处理，假设前端会传递 remotePath，或者我们在服务器端维护状态
    // 为了简化，我们在这里通过 SSH 查找最近的测试目录
    const ssh = new NodeSSH();
    let remotePath: string | null = null;
    
    try {
      await ssh.connect({
        host,
        port: port || 22,
        username,
        password,
        readyTimeout: 15000,
      });
      
      // 查找最新的测试目录
      const findDirResult = await ssh.execCommand(
        `ls -td /tmp/blue_sky_power_test_* | head -1`
      );
      
      if (findDirResult.code === 0 && findDirResult.stdout.trim()) {
        remotePath = findDirResult.stdout.trim();
      }
    } catch {
      // 忽略查找错误
    } finally {
      ssh.dispose();
    }
    
    if (!remotePath) {
      return NextResponse.json(
        { success: false, message: '未找到已部署的测试包，请先部署' },
        { status: 400 }
      );
    }
    
    const config: IterationConfig = {
      host,
      port: port || 22,
      username,
      password,
      power,
      iteration,
    };
    
    const result = await runIteration(config, remotePath);
    
    return NextResponse.json({
      success: result.success,
      message: result.message,
      score: result.score,
      rawOutput: result.rawOutput,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[Power Test Iteration] API Error:', error);
    return NextResponse.json(
      { 
        success: false, 
        message: error instanceof Error ? error.message : '执行测试时发生错误' 
      },
      { status: 500 }
    );
  }
}
