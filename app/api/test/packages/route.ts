/** 测试用例包 API - 服务器端存储 */
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';

// ========== 数据目录配置 ==========
const DATA_DIR = path.join(process.cwd(), '.data');
const PACKAGES_DIR = path.join(DATA_DIR, 'test-packages');
const PACKAGES_INDEX_FILE = path.join(DATA_DIR, 'test-packages.json');
const PACKAGE_GROUPS_FILE = path.join(DATA_DIR, 'test-package-groups.json');

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
  /** 所属分组 ID；为空表示未分组 */
  groupId?: string | null;
  // 旧数据兼容字段
  testSuite?: string;
}

/** 用例包分组 */
interface TestPackageGroup {
  id: string;
  name: string;
  createdAt: string;
}

/** 分组数据：分组列表 + 包到分组的归属（内置包也可分组，故单独存归属） */
interface PackageGroupData {
  groups: TestPackageGroup[];
  assignments: Record<string, string | null>;
}

// 读取分组数据
function loadGroupData(): PackageGroupData {
  try {
    if (fs.existsSync(PACKAGE_GROUPS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(PACKAGE_GROUPS_FILE, 'utf-8'));
      if (Array.isArray(parsed)) {
        // 兼容早期仅存分组数组的格式
        return { groups: parsed, assignments: {} };
      }
      return {
        groups: Array.isArray(parsed.groups) ? parsed.groups : [],
        assignments: parsed.assignments || {},
      };
    }
  } catch {
    console.error('Failed to load test-package-groups');
  }
  return { groups: [], assignments: {} };
}

// 保存分组数据
function saveGroupData(data: PackageGroupData) {
  ensureDirs();
  fs.writeFileSync(PACKAGE_GROUPS_FILE, JSON.stringify(data, null, 2));
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

// 多分数演示用例包的内容
const MULTI_SCORE_RUN_SH = `#!/bin/bash
# 多分数演示用例包 - run.sh
# 参数 $1: 当前功耗值（W）
# 输出：命名多分数 {"scores": {"CPU性能": n, "内存带宽": n, "IO吞吐": n}}

POWER=$1

echo "=========================================="
echo "Blue Sky 多分数演示用例包"
echo "当前功耗: \${POWER}W"
echo "开始执行测试..."
echo "=========================================="

# 模拟测试耗时
sleep 1

# 模拟三个维度的性能分数：功耗越高，分数越低
CPU_SCORE=$((10000 - POWER * 15 + RANDOM % 100))
MEM_SCORE=$((8000 - POWER * 10 + RANDOM % 100))
IO_SCORE=$((6000 - POWER * 8 + RANDOM % 100))

# 保证分数非负
[ \${CPU_SCORE} -lt 0 ] && CPU_SCORE=0
[ \${MEM_SCORE} -lt 0 ] && MEM_SCORE=0
[ \${IO_SCORE} -lt 0 ] && IO_SCORE=0

echo "CPU性能: \${CPU_SCORE}"
echo "内存带宽: \${MEM_SCORE}"
echo "IO吞吐: \${IO_SCORE}"

# 最后一行输出 JSON（必需）：命名多分数格式
echo "{\\"scores\\": {\\"CPU性能\\": \${CPU_SCORE}, \\"内存带宽\\": \${MEM_SCORE}, \\"IO吞吐\\": \${IO_SCORE}}}"
`;

const MULTI_SCORE_README = `# 多分数演示用例包

这是 Blue Sky 系统的多分数（命名分数）演示用例包。

## 文件说明

- run.sh: 测试执行脚本
- README.md: 本说明文件

## 测试逻辑

1. 接收功耗值参数（$1）
2. 模拟测试耗时（1 秒）
3. 分别计算三个维度的分数，功耗越高分数越低：
   - CPU性能 = 10000 - 功耗 × 15
   - 内存带宽 = 8000 - 功耗 × 10
   - IO吞吐   = 6000 - 功耗 × 8
4. 最后一行输出命名多分数 JSON

## 输出格式

{"scores": {"CPU性能": 9850, "内存带宽": 7900, "IO吞吐": 5920}}

系统会把每个名称解析为独立指标，并在测试面板、任务中心、报告、导出、
数据分析等位置展示。

## 兼容说明

若只需要单个分数，仍可使用 {"score": 1234}；
也可以同时给出主分数与明细：{"score": 9850, "scores": {...}}。
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
    if (id === 'demo-power-test' || id === 'demo-multi-score') {
      // 动态生成并返回内置压缩包
      const isMultiScore = id === 'demo-multi-score';
      const zip = new JSZip();
      zip.file('run.sh', isMultiScore ? MULTI_SCORE_RUN_SH : DEMO_RUN_SH);
      zip.file('README.md', isMultiScore ? MULTI_SCORE_README : DEMO_README);
      const zipContent = await zip.generateAsync({ type: 'nodebuffer' });
      const filename = isMultiScore ? 'demo_multi_score.zip' : 'demo_power_test.zip';
      return new NextResponse(new Uint8Array(zipContent), {
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${filename}"`,
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
  const groupData = loadGroupData();
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
    {
      id: 'demo-multi-score',
      name: '多分数演示用例包',
      description: '演示 run.sh 返回命名多分数 {"scores": {"CPU性能": n, "内存带宽": n, "IO吞吐": n}}，可同时展示多个指标',
      filename: 'demo_multi_score.zip',
      size: '约 2KB',
      createdAt: '2026-11-05',
      updatedAt: '2026-11-05',
      builtin: true,
    },
    ...index.map((p) => ({ ...p, builtin: false })),
  ].map((p) => ({ ...p, groupId: groupData.assignments[p.id] ?? null }));

  return NextResponse.json({ success: true, packages, groups: groupData.groups });
}

/** PATCH /api/test/packages - 分组管理：创建分组 / 批量分组 / 重命名 / 重命名分组 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, name, ids, groupId, groupName } = body as {
      action?: string;
      name?: string;
      ids?: string[];
      groupId?: string | null;
      groupName?: string;
    };

    const data = loadGroupData();

    // 创建分组
    if (action === 'createGroup') {
      if (!name || !name.trim()) {
        return NextResponse.json({ success: false, message: '分组名称不能为空' }, { status: 400 });
      }
      const group: TestPackageGroup = {
        id: `pkg-group-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: name.trim(),
        createdAt: new Date().toISOString(),
      };
      data.groups.push(group);
      saveGroupData(data);
      return NextResponse.json({ success: true, group });
    }

    // 重命名分组
    if (groupId && groupName !== undefined) {
      const group = data.groups.find((g) => g.id === groupId);
      if (!group) {
        return NextResponse.json({ success: false, message: '分组不存在' }, { status: 404 });
      }
      if (!groupName.trim()) {
        return NextResponse.json({ success: false, message: '分组名称不能为空' }, { status: 400 });
      }
      group.name = groupName.trim();
      saveGroupData(data);
      return NextResponse.json({ success: true, group });
    }

    // 批量设置所属分组（groupId 为 null 表示移出分组）
    if (Array.isArray(ids)) {
      for (const id of ids) {
        data.assignments[id] = groupId ?? null;
      }
      saveGroupData(data);
      return NextResponse.json({ success: true, updated: ids.length });
    }

    // 重命名用例包
    if (name !== undefined && groupId === undefined) {
      const id = (body as { id?: string }).id;
      if (!id) {
        return NextResponse.json({ success: false, message: '缺少包ID' }, { status: 400 });
      }
      if (!name.trim()) {
        return NextResponse.json({ success: false, message: '名称不能为空' }, { status: 400 });
      }
      const index = loadIndex();
      const pkg = index.find((p) => p.id === id);
      if (!pkg) {
        return NextResponse.json({ success: false, message: '内置用例包不支持改名' }, { status: 400 });
      }
      pkg.name = name.trim();
      pkg.updatedAt = new Date().toISOString();
      saveIndex(index);
      return NextResponse.json({ success: true, package: pkg });
    }

    return NextResponse.json({ success: false, message: '缺少必要参数' }, { status: 400 });
  } catch (error) {
    const msg = error instanceof Error ? error.message : '更新失败';
    console.error('[Packages API] Patch error:', msg);
    return NextResponse.json({ success: false, message: msg }, { status: 500 });
  }
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

/** DELETE /api/test/packages - 删除测试包；带 groupId 时删除分组（组内包变为未分组） */
export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  const groupId = searchParams.get('groupId');

  // 删除分组：组内包解绑，包本身保留
  if (groupId) {
    const data = loadGroupData();
    const idx = data.groups.findIndex((g) => g.id === groupId);
    if (idx === -1) {
      return NextResponse.json({ success: false, message: '分组不存在' }, { status: 404 });
    }
    data.groups.splice(idx, 1);
    let unbound = 0;
    for (const [pkgId, gid] of Object.entries(data.assignments)) {
      if (gid === groupId) {
        data.assignments[pkgId] = null;
        unbound++;
      }
    }
    saveGroupData(data);
    return NextResponse.json({ success: true, message: '已删除分组', unbound });
  }

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

  // 清理分组归属
  const groupData = loadGroupData();
  if (id in groupData.assignments) {
    delete groupData.assignments[id];
    saveGroupData(groupData);
  }

  return NextResponse.json({ success: true, message: '已删除' });
}
