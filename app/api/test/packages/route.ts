/** 测试用例包 API - 服务器端存储 */
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';

// ========== 数据目录配置 ==========
const DATA_DIR = path.join(process.cwd(), '.data');
const PACKAGES_DIR = path.join(DATA_DIR, 'test-packages');
const PACKAGES_INDEX_FILE = path.join(DATA_DIR, 'test-packages.json');

// 确保目录存在
function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(PACKAGES_DIR)) {
    fs.mkdirSync(PACKAGES_DIR, { recursive: true });
  }
}

// 读取索引
function loadIndex(): TestPackageMeta[] {
  try {
    if (fs.existsSync(PACKAGES_INDEX_FILE)) {
      return JSON.parse(fs.readFileSync(PACKAGES_INDEX_FILE, 'utf-8'));
    }
  } catch {
    console.error('Failed to load test-packages index');
  }
  return [];
}

// 保存索引
function saveIndex(index: TestPackageMeta[]) {
  ensureDirs();
  fs.writeFileSync(PACKAGES_INDEX_FILE, JSON.stringify(index, null, 2));
}

// 获取包的存储目录
function getPackageDir(id: string): string {
  return path.join(PACKAGES_DIR, id);
}

// 获取包的文件路径
function getPackageFilePath(id: string, filename: string): string {
  return path.join(getPackageDir(id), filename);
}

interface TestPackageMeta {
  id: string;
  name: string;
  description: string;
  filename: string;
  size: string;
  createdAt: string;
  updatedAt: string;
  /** 上传时强制指定的必填环境变量名列表 */
  requiredEnvVars?: string[];
  // 旧数据兼容字段
  testSuite?: string;
}

// Demo测试包的内容
const DEMO_RUN_SH = `#!/bin/bash
# Demo功耗测试脚本
# 参数 $1: 当前功耗值（W）

POWER=$1

echo "=========================================="
echo "Blue Sky Demo 功耗测试"
echo "当前功耗: \${POWER}W"
echo "开始执行测试..."
echo "=========================================="

# 模拟测试耗时
sleep 1

# 模拟计算得分
# 在实际场景中，这里应该执行真实的性能测试
# 例如：运行压力测试工具、收集性能指标等

# 模拟：功耗越高，基础分数越低，但有随机波动
BASE_SCORE=$((10000 - POWER * 15))
RANDOM_FACTOR=$((RANDOM % 200 - 100))
SCORE=$((BASE_SCORE + RANDOM_FACTOR))

# 确保分数为正数
if [ $SCORE -lt: 0 ]; then
    SCORE=0
fi

echo "测试完成"
echo "得分: \${SCORE}"

# 输出 JSON 格式结果（必需）
echo "{\\"score\\": \${SCORE}, \\"power\\": \${POWER}}"
`;

const DEMO_README = `# Demo 功耗测试包

这是 Blue Sky 系统的演示用例包。

## 文件说明

- run.sh: 测试执行脚本
- README.md: 本说明文件

## 测试逻辑

本Demo脚本模拟了一个简单的性能测试：
1. 接收功耗值参数
2. 模拟测试耗时（1秒）
3. 计算得分：基础分数10000减去功耗的15倍，再加上随机波动
4. 输出JSON格式结果

## 使用方法

在功耗遍历测试中：
1. 从用例包库选择"Demo功耗测试包"
2. 或直接上传本压缩包
3. 设置起始功耗、终止功耗和步长
4. 点击"开始功耗遍历测试"

## 预期结果

- 功耗越高，得分越低（线性递减关系）
- 每个功耗点会有 ±100 分的随机波动
`;

/** 迁移旧数据：删除 testSuite 字段 */
function migratePackages() {
  const index = loadIndex();
  let changed = false;
  for (const pkg of index) {
    if ('testSuite' in pkg) {
      delete (pkg as any).testSuite;
      changed = true;
    }
  }
  if (changed) {
    saveIndex(index);
  }
}

/** GET /api/test/packages - 获取测试包列表或下载 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');
  const id = searchParams.get('id');

  migratePackages();

  if (action === 'download' && id) {
    if (id === 'demo-power-test') {
      // 动态生成并返回demo压缩包
      const zip = new JSZip();
      zip.file('run.sh', DEMO_RUN_SH);
      zip.file('README.md', DEMO_README);
      const zipContent = await zip.generateAsync({ type: 'nodebuffer' });
      return new NextResponse(new Uint8Array(zipContent), {
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': 'attachment; filename="demo_power_test.zip"',
        },
      });
    }

    // 从服务器文件系统下载用户上传的包
    const index = loadIndex();
    const pkg = index.find((p) => p.id === id);
    if (!pkg) {
      return NextResponse.json({ success: false, message: '包不存在' }, { status: 404 });
    }

    const filePath = getPackageFilePath(id, pkg.filename);
    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ success: false, message: '包文件不存在' }, { status: 404 });
    }

    const fileBuffer = fs.readFileSync(filePath);
    return new NextResponse(fileBuffer, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(pkg.filename)}"`,
      },
    });
  }

  // 返回测试包列表（内置 + 服务器存储）
  const index = loadIndex();
  const packages = [
    {
      id: 'demo-power-test',
      name: 'Demo功耗测试包',
      description: '演示用的功耗遍历测试包，包含示例run.sh脚本，可模拟性能测试并输出分数',
      filename: 'demo_power_test.zip',
      size: '约 2KB',
      createdAt: '2026-04-13',
      updatedAt: '2026-04-13',
      builtin: true,
    },
    ...index.map((p) => ({ ...p, builtin: false })),
  ];

  return NextResponse.json({ success: true, packages });
}

/** POST /api/test/packages - 上传测试包 */
export async function POST(request: NextRequest) {
  try {
    ensureDirs();
    const formData = await request.formData();

    const name = formData.get('name') as string;
    const description = (formData.get('description') as string) || '';
    const file = formData.get('file') as File;
    const requiredEnvVarsStr = (formData.get('requiredEnvVars') as string) || '';

    if (!name || !file) {
      return NextResponse.json({ success: false, message: '缺少必要参数' }, { status: 400 });
    }

    const requiredEnvVars = requiredEnvVarsStr
      ? requiredEnvVarsStr.split(',').map((s) => s.trim()).filter(Boolean)
      : [];

    const id = `pkg-${Date.now()}`;
    const now = new Date().toISOString();

    // 格式化文件大小
    const bytes = file.size;
    let sizeStr: string;
    if (bytes < 1024) sizeStr = bytes + ' B';
    else if (bytes < 1024 * 1024) sizeStr = (bytes / 1024).toFixed(1) + ' KB';
    else sizeStr = (bytes / (1024 * 1024)).toFixed(1) + ' MB';

    const pkgDir = getPackageDir(id);
    fs.mkdirSync(pkgDir, { recursive: true });

    // 写入文件
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    fs.writeFileSync(path.join(pkgDir, file.name), buffer);

    // 更新索引
    migratePackages();
    const index = loadIndex();
    const newPackage: TestPackageMeta = {
      id,
      name,
      description,
      filename: file.name,
      size: sizeStr,
      createdAt: now,
      updatedAt: now,
      requiredEnvVars,
    };
    index.push(newPackage);
    saveIndex(index);

    return NextResponse.json({ success: true, package: newPackage });
  } catch (error) {
    const msg = error instanceof Error ? error.message : '上传失败';
    console.error('[Packages API] Upload error:', msg);
    return NextResponse.json({ success: false, message: msg }, { status: 500 });
  }
}

/** DELETE /api/test/packages - 删除测试包 */
export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json({ success: false, message: '缺少包ID' }, { status: 400 });
  }

  migratePackages();
  const index = loadIndex();
  const pkgIndex = index.findIndex((p) => p.id === id);
  if (pkgIndex === -1) {
    return NextResponse.json({ success: false, message: '包不存在' }, { status: 404 });
  }

  // 删除文件和目录
  const pkgDir = getPackageDir(id);
  if (fs.existsSync(pkgDir)) {
    try {
      fs.rmSync(pkgDir, { recursive: true, force: true });
    } catch {
      console.error(`[Packages API] Failed to delete directory: ${pkgDir}`);
    }
  }

  // 更新索引
  index.splice(pkgIndex, 1);
  saveIndex(index);

  return NextResponse.json({ success: true, message: '已删除' });
}
