/** 功耗遍历测试 - 部署测试包 API */
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { resolvePackage } from '../lib/packageStore';
import { deployTestPackage, type DeployConfig } from '../lib/deployPackage';

const DATA_DIR = path.join(process.cwd(), '.data');
const DEPLOY_ARCHIVES_DIR = path.join(DATA_DIR, 'deploy-archives');

/** 归档本次上传的测试包，便于任务恢复时重新部署（远程 /tmp 会随重启清空） */
function archiveUploadedPackage(fileBuffer: Buffer, fileName: string): string | null {
  try {
    const dir = path.join(DEPLOY_ARCHIVES_DIR, `pkg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, fileName);
    fs.writeFileSync(filePath, fileBuffer);
    return filePath;
  } catch (err) {
    console.error('[Power Test Deploy] Failed to archive package:', err);
    return null;
  }
}

/** POST /api/test/power-test-deploy - 部署测试包 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();

    const file = formData.get('file') as File | null;
    const packageId = formData.get('packageId') as string | null;
    const host = formData.get('host') as string;
    const port = parseInt(formData.get('port') as string) || 22;
    const username = formData.get('username') as string;
    const password = formData.get('password') as string;

    // 验证参数
    if (!host || !username || !password) {
      return NextResponse.json(
        { success: false, message: '缺少必要参数' },
        { status: 400 }
      );
    }

    let fileBuffer: Buffer | null = null;
    let fileName = '';
    let archivePath: string | null = null;

    if (packageId) {
      // 用例包来自服务器存储：按 ID 直接在服务器端读取，不经过浏览器下载
      const resolved = await resolvePackage(packageId);
      if (!resolved) {
        return NextResponse.json(
          { success: false, message: '用例包不存在或文件缺失' },
          { status: 404 }
        );
      }
      fileBuffer = resolved.buffer;
      fileName = resolved.filename;
    } else if (file) {
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
      fileBuffer = Buffer.from(await file.arrayBuffer());
      fileName = file.name;
      // 上传的包在服务端归档一份，恢复任务时若远程 /tmp 已清空可重新部署
      archivePath = archiveUploadedPackage(fileBuffer, fileName);
    } else {
      return NextResponse.json(
        { success: false, message: '缺少测试包文件' },
        { status: 400 }
      );
    }

    const config: DeployConfig = {
      host,
      port,
      username,
      password,
    };

    const result = await deployTestPackage(config, fileBuffer, fileName);

    return NextResponse.json({
      success: result.success,
      message: result.message,
      remotePath: result.remotePath,
      // 用例包来源：恢复任务时据此重新部署
      packageLibraryId: packageId || undefined,
      packageArchivePath: archivePath || undefined,
      packageFileName: fileName,
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
