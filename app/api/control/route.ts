/** 控制命令 API - 支持按拓扑ID和 BMC SSH Shell 命令下发 */
import { NextRequest, NextResponse } from 'next/server';
import { topologyStore } from '../lib/store';
import type { BMCConfig } from '../../../src/types/topology';

/** 使用 Node.js 内置模块通过 SSH 连接到 BMC 执行命令 */
async function executeSSHCommand(config: BMCConfig, command: string): Promise<string> {
  const { NodeSSH } = await import('node-ssh');
  const ssh = new NodeSSH();
  try {
    await ssh.connect({
      host: config.ip,
      port: config.port || 22,
      username: config.username,
      password: config.password,
      readyTimeout: 20000,
    });
    const result = await ssh.execCommand(command);
    if (result.stderr) {
      console.warn('[BMC] SSH stderr:', result.stderr);
    }
    return result.stdout;
  } finally {
    ssh.dispose();
  }
}

// POST /api/control
export async function POST(request: NextRequest) {
  try {
    const { nodeId, action, value, topologyId, bmcConfig } = await request.json() as {
      nodeId: string;
      action: 'setFanSpeed' | 'setVoltage';
      value: number;
      topologyId?: string;
      bmcConfig?: BMCConfig;
    };
    
    console.log(`[Control] ${action} for ${nodeId}: ${value} (topology: ${topologyId || 'default'})`);
    
    // 获取指定拓扑或当前拓扑
    const topology = topologyId 
      ? topologyStore.getTopology(topologyId)
      : topologyStore.data;
    
    // 更新节点数据
    const node = topology.nodes.find(n => n.id === nodeId);
    if (node) {
      const data = node.data as Record<string, unknown>;
      if (action === 'setFanSpeed' && data.fanData) {
        const fanData = data.fanData as { speedPercent: number; rpm: number };
        fanData.speedPercent = value;
        fanData.rpm = Math.round(5000 * (value / 100));
      } else if (action === 'setVoltage' && data.sourceData) {
        const sourceData = data.sourceData as { outputVoltage: number };
        sourceData.outputVoltage = value;
      }
      
      // 保存拓扑
      if (topologyId) {
        topologyStore.saveTopology(topologyId, topology);
      } else {
        topologyStore.data = topology;
      }
    }
    
    // 如果节点配置了控制 Shell 命令且提供了 BMC 配置，通过 SSH 执行
    const apiConfig = (node?.data as Record<string, unknown> | undefined)?.apiConfig as Record<string, unknown> | undefined;
    const controlShell = apiConfig?.controlShell as string | undefined;
    if (controlShell && bmcConfig?.enabled) {
      if (!bmcConfig.ip || !bmcConfig.username || !bmcConfig.password) {
        return NextResponse.json(
          { success: false, message: 'BMC 配置不完整，无法执行控制命令' },
          { status: 400 }
        );
      }
      
      // 替换 {value} 占位符
      const command = controlShell.replace(/\{value\}/g, String(value));
      console.log(`[Control] Executing SSH command: ${command}`);
      
      try {
        const output = await executeSSHCommand(bmcConfig, command);
        console.log(`[Control] SSH output: ${output}`);
      } catch (sshError) {
        const errMsg = sshError instanceof Error ? sshError.message : String(sshError);
        console.error('[Control] SSH execution failed:', sshError);
        return NextResponse.json(
          { success: false, message: `SSH 执行失败: ${errMsg}` },
          { status: 503 }
        );
      }
    }
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Control] Error:', error);
    return NextResponse.json(
      { success: false, message: 'Invalid request' },
      { status: 400 }
    );
  }
}
