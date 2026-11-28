/** 用例包在线文件编辑 API
 *
 * 直接操作服务器上的用例包压缩包：列出文件、读取、写入、新增、删除。
 * 每次写操作都会重新打包 zip 并更新索引中的大小与更新时间。
 *
 * 安全约束：
 * - 所有路径都做规范化，禁止 ../ 越界到包目录之外
 * - 只允许编辑 .zip 包（tar/tar.gz 不支持在线编辑，返回明确提示）
 * - 文本文件按 UTF-8 读写；二进制文件以 base64 传输
 * - 单文件与总包体积有上限，防止误传大文件撑爆内存
 */
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';
import { getPackageDir, getPackageFilePath, loadIndex, ensureDirs } from '../../lib/packageStore';

const PACKAGES_INDEX_FILE = path.join(process.cwd(), '.data', 'test-packages.json');

/** 单个文件大小上限（写入） */
const MAX_FILE_BYTES = 2 * 1024 * 1024;
/** 整个包解压后总大小上限 */
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;

/** 内置演示包不可编辑（内容由代码动态生成） */
const BUILTIN_IDS = new Set(['demo-power-test', 'demo-multi-score']);

/** 视为文本的扩展名（其余按二进制处理） */
const TEXT_EXTENSIONS = new Set([
  '.sh', '.bash', '.py', '.js', '.mjs', '.cjs', '.ts', '.json', '.yaml', '.yml',
  '.txt', '.md', '.conf', '.cfg', '.ini', '.toml', '.xml', '.html', '.css',
  '.c', '.h', '.cpp', '.hpp', '.java', '.go', '.rs', '.rb', '.pl', '.php',
  '.log', '.csv', '.env', '.service', '.timer', '.rules', '.spec', '.mk', '.cmake',
]);

function isTextFile(name: string): boolean {
  const ext = path.extname(name).toLowerCase();
  if (TEXT_EXTENSIONS.has(ext)) return true;
  // 无扩展名但常见脚本名
  const base = path.basename(name).toLowerCase();
  return ['makefile', 'dockerfile', 'run', 'readme', 'license', '.gitignore', '.gitattributes'].includes(base);
}

/** 规范化包内相对路径：拒绝绝对路径与 .. 越界 */
function normalizeEntryPath(raw: string): string | null {
  if (!raw) return null;
  let p = String(raw).replace(/\\/g, '/').trim();
  // 去掉开头的 ./ 与 /
  p = p.replace(/^\.\/+/, '').replace(/^\/+/, '');
  if (!p) return null;
  const parts = p.split('/');
  if (parts.some((seg) => seg === '..' || seg === '')) return null;
  if (p.includes('\0')) return null;
  return p;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

interface PackageContext {
  id: string;
  filename: string;
  zipPath: string;
  zip: JSZip;
}

/** 加载包并解析 zip；失败时返回错误响应 */
async function loadPackage(id: string): Promise<{ ctx?: PackageContext; error?: NextResponse }> {
  if (!id) {
    return { error: NextResponse.json({ success: false, message: '缺少包ID' }, { status: 400 }) };
  }
  if (BUILTIN_IDS.has(id)) {
    return {
      error: NextResponse.json(
        { success: false, message: '内置演示包由系统动态生成，不支持在线编辑' },
        { status: 400 },
      ),
    };
  }
  ensureDirs();
  const index = loadIndex();
  const pkg = index.find((p) => p.id === id);
  if (!pkg) {
    return { error: NextResponse.json({ success: false, message: '包不存在' }, { status: 404 }) };
  }
  if (!/\.zip$/i.test(pkg.filename)) {
    return {
      error: NextResponse.json(
        { success: false, message: '仅支持在线编辑 .zip 格式的用例包' },
        { status: 400 },
      ),
    };
  }
  const zipPath = getPackageFilePath(id, pkg.filename);
  if (!fs.existsSync(zipPath)) {
    return { error: NextResponse.json({ success: false, message: '包文件不存在' }, { status: 404 }) };
  }
  try {
    const zip = await JSZip.loadAsync(fs.readFileSync(zipPath));
    return { ctx: { id, filename: pkg.filename, zipPath, zip } };
  } catch (err) {
    return {
      error: NextResponse.json(
        {
          success: false,
          message: `压缩包解析失败：${err instanceof Error ? err.message : '未知错误'}`,
        },
        { status: 500 },
      ),
    };
  }
}

/** 重新打包并写回磁盘，同时更新索引中的大小与更新时间 */
async function savePackage(ctx: PackageContext): Promise<number> {
  const buffer = await ctx.zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
  fs.writeFileSync(ctx.zipPath, buffer);

  // 更新索引
  try {
    const index = loadIndex();
    const pkg = index.find((p) => p.id === ctx.id);
    if (pkg) {
      pkg.size = formatSize(buffer.length);
      pkg.updatedAt = new Date().toISOString();
      fs.writeFileSync(PACKAGES_INDEX_FILE, JSON.stringify(index, null, 2));
    }
  } catch (err) {
    console.error('[PackageFiles] 更新索引失败:', err);
  }
  return buffer.length;
}

/** GET /api/test/packages/files?id=xxx[&file=path] - 列出文件 或 读取单个文件 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id') || '';
  const file = searchParams.get('file');

  const { ctx, error } = await loadPackage(id);
  if (error || !ctx) return error!;

  // 读取单个文件
  if (file) {
    const entryPath = normalizeEntryPath(file);
    if (!entryPath) {
      return NextResponse.json({ success: false, message: '非法文件路径' }, { status: 400 });
    }
    const entry = ctx.zip.file(entryPath);
    if (!entry) {
      return NextResponse.json({ success: false, message: '文件不存在' }, { status: 404 });
    }
    const buf = await entry.async('nodebuffer');
    const text = isTextFile(entryPath);
    if (buf.length > MAX_FILE_BYTES) {
      return NextResponse.json(
        {
          success: false,
          message: `文件过大（${formatSize(buf.length)}），超过在线编辑上限 ${formatSize(MAX_FILE_BYTES)}`,
        },
        { status: 413 },
      );
    }
    return NextResponse.json({
      success: true,
      file: {
        path: entryPath,
        name: path.posix.basename(entryPath),
        size: buf.length,
        isText: text,
        // 文本直接给字符串；二进制给 base64
        content: text ? buf.toString('utf-8') : buf.toString('base64'),
        encoding: text ? 'utf8' : 'base64',
      },
    });
  }

  // 列出所有文件
  const entries: Array<{ path: string; name: string; size: number; dir: boolean; isText: boolean }> = [];
  ctx.zip.forEach((relativePath, zipEntry) => {
    if (zipEntry.dir) return;
    const size = (zipEntry as unknown as { _data?: { uncompressedSize?: number } })._data
      ?.uncompressedSize;
    entries.push({
      path: relativePath,
      name: path.posix.basename(relativePath),
      size: typeof size === 'number' ? size : 0,
      dir: false,
      isText: isTextFile(relativePath),
    });
  });
  entries.sort((a, b) => a.path.localeCompare(b.path));

  return NextResponse.json({
    success: true,
    packageId: ctx.id,
    filename: ctx.filename,
    files: entries,
  });
}

/** POST /api/test/packages/files - 写入文件（存在则覆盖，不存在则新增） */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      id?: string;
      path?: string;
      content?: string;
      encoding?: 'utf8' | 'base64';
    };
    const { ctx, error } = await loadPackage(body.id || '');
    if (error || !ctx) return error!;

    const entryPath = normalizeEntryPath(body.path || '');
    if (!entryPath) {
      return NextResponse.json({ success: false, message: '非法文件路径' }, { status: 400 });
    }

    const encoding = body.encoding === 'base64' ? 'base64' : 'utf8';
    const content = typeof body.content === 'string' ? body.content : '';
    const buf = Buffer.from(content, encoding);
    if (buf.length > MAX_FILE_BYTES) {
      return NextResponse.json(
        { success: false, message: `文件过大，超过上限 ${formatSize(MAX_FILE_BYTES)}` },
        { status: 413 },
      );
    }

    const existed = !!ctx.zip.file(entryPath);
    ctx.zip.file(entryPath, buf);

    const total = await savePackage(ctx);
    return NextResponse.json({
      success: true,
      message: existed ? '文件已保存' : '文件已创建',
      created: !existed,
      path: entryPath,
      size: buf.length,
      packageSize: formatSize(total),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '保存失败';
    console.error('[PackageFiles] 写入失败:', msg);
    return NextResponse.json({ success: false, message: msg }, { status: 500 });
  }
}

/** DELETE /api/test/packages/files?id=xxx&file=path - 删除文件 */
export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id') || '';
  const file = searchParams.get('file') || '';

  const { ctx, error } = await loadPackage(id);
  if (error || !ctx) return error!;

  const entryPath = normalizeEntryPath(file);
  if (!entryPath) {
    return NextResponse.json({ success: false, message: '非法文件路径' }, { status: 400 });
  }
  if (!ctx.zip.file(entryPath)) {
    return NextResponse.json({ success: false, message: '文件不存在' }, { status: 404 });
  }

  // 不允许删空整个包：至少保留一个文件
  const fileCount = Object.values(ctx.zip.files).filter((f) => !f.dir).length;
  if (fileCount <= 1) {
    return NextResponse.json(
      { success: false, message: '不能删除包内最后一个文件' },
      { status: 400 },
    );
  }

  ctx.zip.remove(entryPath);
  const total = await savePackage(ctx);
  return NextResponse.json({
    success: true,
    message: '文件已删除',
    path: entryPath,
    packageSize: formatSize(total),
  });
}

/** PATCH /api/test/packages/files - 重命名 / 移动文件 */
export async function PATCH(request: NextRequest) {
  try {
    const body = (await request.json()) as { id?: string; from?: string; to?: string };
    const { ctx, error } = await loadPackage(body.id || '');
    if (error || !ctx) return error!;

    const from = normalizeEntryPath(body.from || '');
    const to = normalizeEntryPath(body.to || '');
    if (!from || !to) {
      return NextResponse.json({ success: false, message: '非法文件路径' }, { status: 400 });
    }
    if (!ctx.zip.file(from)) {
      return NextResponse.json({ success: false, message: '源文件不存在' }, { status: 404 });
    }
    if (ctx.zip.file(to)) {
      return NextResponse.json({ success: false, message: '目标文件已存在' }, { status: 409 });
    }

    const buf = await ctx.zip.file(from)!.async('nodebuffer');
    ctx.zip.remove(from);
    ctx.zip.file(to, buf);
    const total = await savePackage(ctx);
    return NextResponse.json({
      success: true,
      message: '已重命名',
      from,
      to,
      packageSize: formatSize(total),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '重命名失败';
    return NextResponse.json({ success: false, message: msg }, { status: 500 });
  }
}
