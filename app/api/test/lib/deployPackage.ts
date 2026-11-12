/** 测试包远程部署 - 服务器端共享模块
 *
 * 部署目录位于远程 /tmp，服务器重启后会被清空。
 * 因此任务配置里会记录用例包来源（用例包库 ID 或服务端归档路径），
 * 恢复任务时若目录已不存在，可据此重新部署。
 */
import { NodeSSH } from 'node-ssh';
import { writeFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

export interface DeployConfig {
  host: string;
  port: number;
  username: string;
  password: string;
}

/** 部署测试包到远程主机，返回远程目录 */
export async function deployTestPackage(
  config: DeployConfig,
  fileBuffer: Buffer,
  fileName: string
): Promise<{ success: boolean; message: string; remotePath?: string }> {
  const ssh = new NodeSSH();

  try {
    await ssh.connect({
      host: config.host,
      port: config.port || 22,
      username: config.username,
      password: config.password,
      readyTimeout: 30000,
    });

    const remoteDir = `/tmp/blue_sky_power_test_${Date.now()}`;
    const remoteFilePath = `${remoteDir}/${fileName}`;

    const mkdirResult = await ssh.execCommand(`mkdir -p ${remoteDir}`);
    if (mkdirResult.code !== 0) {
      throw new Error(`创建目录失败: ${mkdirResult.stderr}`);
    }

    const tempLocalPath = join(tmpdir(), `${Date.now()}-${fileName}`);
    await writeFile(tempLocalPath, fileBuffer);

    try {
      await ssh.putFile(tempLocalPath, remoteFilePath);
    } finally {
      await unlink(tempLocalPath).catch(() => { /* ignore */ });
    }

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

    const findResult = await ssh.execCommand(`find ${remoteDir} -name "run.sh" -type f | head -1`);
    const runShPath = findResult.stdout.trim();

    if (!runShPath) {
      throw new Error('压缩包中未找到 run.sh 脚本');
    }

    await ssh.execCommand(`chmod +x ${runShPath}`);

    return { success: true, message: '部署成功', remotePath: remoteDir };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[DeployPackage] Error:', errorMessage);
    return { success: false, message: errorMessage };
  } finally {
    ssh.dispose();
  }
}
