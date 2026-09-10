/** BMC Sensor 数据获取 - 通过 SSH 执行 ipmcget -t sensor -d list 并解析输出 */
import { NextRequest, NextResponse } from 'next/server';
import { topologyStore } from '../../lib/store';
import type { BMCConfig } from '../../../../src/types/topology';

/** Sensor 数据项 */
export interface SensorData {
  sensorId: string;
  sensorName: string;
  value: number | null;
  unit: string;
  status: string;
  lnr: string | null;
  lc: string | null;
  lnc: string | null;
  unc: string | null;
  uc: string | null;
  unr: string | null;
  phys: string | null;
  nhys: string | null;
}

/** 解析 ipmcget -t sensor -d list 输出 */
function parseSensorOutput(output: string): SensorData[] {
  const sensors: SensorData[] = [];
  const lines = output.split('\n');
  
  // 跳过表头，找到数据行
  let headerPassed = false;
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // 跳过空行
    if (!trimmed) continue;
    
    // 检测表头行（以 sensor id 开头）
    if (trimmed.startsWith('sensor id') || trimmed.startsWith('sensorid')) {
      headerPassed = true;
      continue;
    }
    
    // 跳过分隔线（如果有的话）
    if (trimmed.includes('|--')) {
      continue;
    }
    
    // 如果还没过表头，继续跳过
    if (!headerPassed) continue;
    
    // 解析数据行
    // 格式: 0x5 | 1712 Core Temp | 37.000 | degrees C | ok | na | na | na | 105.000 | na | na | 2.000 | 2.000
    const parts = trimmed.split('|').map(p => p.trim());
    
    // 数据行至少有5列（sensor id, name, value, unit, status）
    if (parts.length >= 5 && parts[0].startsWith('0x')) {
      const parseValue = (v: string): number | null => {
        if (!v || v === 'na' || v === 'na ') return null;
        const num = parseFloat(v);
        return isNaN(num) ? null : num;
      };
      
      const sensorName = parts[1] || '';
      const rawValue = parts[2];
      const parsedValue = parseValue(rawValue);
      
      // 调试特定 sensor
      if (sensorName.includes('CPU0 PWR') || sensorName.includes('DIMM')) {
        console.log(`[BMC Parse] ${sensorName}: raw='${rawValue}' -> parsed=${parsedValue}`);
      }
      
      sensors.push({
        sensorId: parts[0] || '',
        sensorName: sensorName,
        value: parsedValue,
        unit: parts[3] || '',
        status: parts[4] || '',
        lnr: parts[5] || null,
        lc: parts[6] || null,
        lnc: parts[7] || null,
        unc: parts[8] || null,
        uc: parts[9] || null,
        unr: parts[10] || null,
        phys: parts[11] || null,
        nhys: parts[12] || null,
      });
    }
  }
  
  console.log(`[BMC] Parsed ${sensors.length} sensors from output`);
  return sensors;
}

/** 使用 Node.js 内置模块通过 SSH 连接到 BMC 执行命令 */
async function executeSSHCommand(config: BMCConfig, command: string): Promise<string> {
  // 使用动态导入避免在构建时加载模块
  const { NodeSSH } = await import('node-ssh');
  
  const ssh = new NodeSSH();
  
  try {
    // 连接到 BMC
    await ssh.connect({
      host: config.ip,
      port: config.port || 22,
      username: config.username,
      password: config.password,
      // 如果 BMC 使用密钥认证，可以在这里配置
      // privateKey: ...
      readyTimeout: 20000, // 20秒超时
    });
    
    // 执行命令
    const result = await ssh.execCommand(command);
    
    if (result.stderr) {
      console.warn('[BMC] SSH stderr:', result.stderr);
    }
    
    return result.stdout;
  } finally {
    ssh.dispose();
  }
}

/** 通过 SSH 获取 BMC Sensor 数据 */
async function fetchBMCSensors(config: BMCConfig): Promise<SensorData[]> {
  try {
    // 执行 ipmcget 命令获取 sensor 数据（使用 bash -l -c 加载环境变量）
    console.log('[BMC] Executing sensor list command...');
    const output = await executeSSHCommand(config, "bash -l -c 'ipmcget -t sensor -d list'");
    
    if (!output || output.trim().length === 0) {
      throw new Error('BMC returned empty response');
    }
    
    console.log('[BMC] Raw output length:', output.length);
    console.log('[BMC] First 200 chars:', output.substring(0, 200));
    
    const sensors = parseSensorOutput(output);
    console.log(`[BMC] Successfully parsed ${sensors.length} sensors`);
    
    return sensors;
  } catch (error) {
    console.error('[BMC] Failed to fetch sensors via SSH:', error);
    throw error;
  }
}

/** GET /api/bmc/sensors - 获取所有 sensor 数据 */
export async function GET(request: NextRequest) {
  try {
    // 从查询参数获取拓扑 ID
    const { searchParams } = new URL(request.url);
    const topologyId = searchParams.get('topologyId');
    
    if (!topologyId) {
      return NextResponse.json(
        { success: false, error: 'Missing topologyId parameter' },
        { status: 400 }
      );
    }
    
    // 获取拓扑的 BMC 配置
    const bmcConfig = topologyStore.getBMCConfig(topologyId);
    
    if (!bmcConfig?.enabled) {
      return NextResponse.json(
        { success: false, error: 'BMC_NOT_CONFIGURED', message: 'BMC 未配置或未启用' },
        { status: 400 }
      );
    }
    
    // 验证 BMC 配置完整性
    if (!bmcConfig.ip || !bmcConfig.username || !bmcConfig.password) {
      return NextResponse.json(
        { success: false, error: 'BMC_CONFIG_INCOMPLETE', message: 'BMC 配置不完整，请检查 IP、用户名和密码' },
        { status: 400 }
      );
    }
    
    // 获取 sensor 数据
    const sensors = await fetchBMCSensors(bmcConfig);
    
    return NextResponse.json({
      success: true,
      data: sensors,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Failed to fetch BMC sensors:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    // 根据错误类型返回不同的错误码
    if (errorMessage.includes('ECONNREFUSED')) {
      return NextResponse.json(
        { success: false, error: 'BMC_CONNECTION_REFUSED', message: '无法连接到 BMC，请检查 IP 和端口' },
        { status: 503 }
      );
    }
    
    if (errorMessage.includes('authentication') || errorMessage.includes('Authentication')) {
      return NextResponse.json(
        { success: false, error: 'BMC_AUTH_FAILED', message: 'BMC 认证失败，请检查用户名和密码' },
        { status: 401 }
      );
    }
    
    if (errorMessage.includes('timeout') || errorMessage.includes('Timeout')) {
      return NextResponse.json(
        { success: false, error: 'BMC_TIMEOUT', message: '连接 BMC 超时，请检查网络' },
        { status: 504 }
      );
    }
    
    return NextResponse.json(
      { 
        success: false, 
        error: 'BMC_ERROR',
        message: errorMessage 
      },
      { status: 500 }
    );
  }
}

/** POST /api/bmc/sensors - 根据 sensor name 获取特定数据，或直接使用传入的 bmcConfig 获取全部 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { topologyId, sensorName, bmcConfig: bodyBmcConfig } = body;
    
    // 优先使用 body 中传入的 bmcConfig（用于新解耦流程）
    let bmcConfig: BMCConfig | undefined = bodyBmcConfig;
    
    // 兼容旧流程：如果没有传 bmcConfig，尝试从 topologyStore 读取
    if (!bmcConfig && topologyId) {
      bmcConfig = topologyStore.getBMCConfig(topologyId) || undefined;
    }
    
    if (!bmcConfig?.enabled) {
      return NextResponse.json(
        { success: false, error: 'BMC_NOT_CONFIGURED', message: 'BMC 未配置或未启用' },
        { status: 400 }
      );
    }
    
    // 验证 BMC 配置完整性
    if (!bmcConfig.ip || !bmcConfig.username || !bmcConfig.password) {
      return NextResponse.json(
        { success: false, error: 'BMC_CONFIG_INCOMPLETE', message: 'BMC 配置不完整' },
        { status: 400 }
      );
    }
    
    // 获取所有 sensor 数据
    const sensors = await fetchBMCSensors(bmcConfig);
    
    // 如果传了 sensorName，返回匹配的单个 sensor；否则返回全部
    if (sensorName) {
      const matchedSensor = sensors.find(
        s => s.sensorName.toLowerCase() === sensorName.toLowerCase()
      );
      
      if (!matchedSensor) {
        return NextResponse.json({
          success: false,
          error: 'SENSOR_NOT_FOUND',
          message: `未找到 Sensor '${sensorName}'`,
          availableSensors: sensors.map(s => s.sensorName),
        }, { status: 404 });
      }
      
      return NextResponse.json({
        success: true,
        data: matchedSensor,
        timestamp: new Date().toISOString(),
      });
    }
    
    return NextResponse.json({
      success: true,
      data: sensors,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Failed to fetch BMC sensor:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: 'BMC_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    );
  }
}
