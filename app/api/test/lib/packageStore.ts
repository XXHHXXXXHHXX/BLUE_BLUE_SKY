/** 测试用例包存储 - 服务器端共享模块（用例包只保存在服务器，不经过浏览器下载） */
import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';

const DATA_DIR = path.join(process.cwd(), '.data');
const PACKAGES_DIR = path.join(DATA_DIR, 'test-packages');
const PACKAGES_INDEX_FILE = path.join(DATA_DIR, 'test-packages.json');

export interface TestPackageMeta {
  id: string;
  name: string;
  description: string;
  filename: string;
  size: string;
  createdAt: string;
  updatedAt: string;
  /** 上传时强制指定的必填环境变量名列表 */
  requiredEnvVars?: string[];
}

/** 确保目录存在 */
export function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(PACKAGES_DIR)) {
    fs.mkdirSync(PACKAGES_DIR, { recursive: true });
  }
}

/** 读取索引 */
export function loadIndex(): TestPackageMeta[] {
  try {
    if (fs.existsSync(PACKAGES_INDEX_FILE)) {
      return JSON.parse(fs.readFileSync(PACKAGES_INDEX_FILE, 'utf-8'));
    }
  } catch {
    console.error('Failed to load test-packages index');
  }
  return [];
}

/** 获取包的存储目录 */
export function getPackageDir(id: string): string {
  return path.join(PACKAGES_DIR, id);
}

/** 获取包的文件路径 */
export function getPackageFilePath(id: string, filename: string): string {
  return path.join(getPackageDir(id), filename);
}

// ========== Demo 测试包内容 ==========
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

// ========== 多分数演示用例包内容 ==========
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

1. 接收功耗值参数（\$1）
2. 模拟测试耗时（1 秒）
3. 分别计算三个维度的分数，功耗越高分数越低：
   - CPU性能 = 10000 - 功耗 × 15
   - 内存带宽 = 8000 - 功耗 × 10
   - IO吞吐   = 6000 - 功耗 × 8
4. 最后一行输出命名多分数 JSON

## 输出格式

\`\`\`json
{"scores": {"CPU性能": 9850, "内存带宽": 7900, "IO吞吐": 5920}}
\`\`\`

系统会把每个名称解析为独立指标，并在以下位置展示：

- 测试主面板结果表「分数」列（彩色标签）
- 任务中心列表「分数」列（各分数取迭代最大值）
- 任务详情与报告的趋势图（每个分数一条曲线）
- 报告明细表与 Excel / AI 报告导出（按分数名展开独立列）
- 数据分析 / 基线对比 / 自定义 XY 图表的指标下拉（「分数: 名称」）

## 使用方法

1. 在用例包库下载本包，或直接在功耗遍历测试中选择「多分数演示用例包」
2. 设置起始功耗、终止功耗和步长
3. 开始测试后即可看到多个分数

## 兼容说明

若只需要单个分数，仍可使用 \`{"score": 1234}\`；
也可以同时给出主分数与明细：\`{"score": 9850, "scores": {...}}\`。
`;

/** 将用例包解析为服务器端 buffer + 文件名
 *  内置 demo 动态生成，其余从服务器文件系统读取，文件不会传输到浏览器
 */
export async function resolvePackage(id: string): Promise<{ buffer: Buffer; filename: string } | null> {
  if (id === 'demo-power-test') {
    const zip = new JSZip();
    zip.file('run.sh', DEMO_RUN_SH);
    zip.file('README.md', DEMO_README);
    const zipContent = await zip.generateAsync({ type: 'nodebuffer' });
    return { buffer: Buffer.from(zipContent), filename: 'demo_power_test.zip' };
  }

  if (id === 'demo-multi-score') {
    const zip = new JSZip();
    zip.file('run.sh', MULTI_SCORE_RUN_SH);
    zip.file('README.md', MULTI_SCORE_README);
    const zipContent = await zip.generateAsync({ type: 'nodebuffer' });
    return { buffer: Buffer.from(zipContent), filename: 'demo_multi_score.zip' };
  }

  ensureDirs();
  const index = loadIndex();
  const pkg = index.find((p) => p.id === id);
  if (!pkg) return null;

  const filePath = getPackageFilePath(id, pkg.filename);
  if (!fs.existsSync(filePath)) return null;

  return { buffer: fs.readFileSync(filePath), filename: pkg.filename };
}
