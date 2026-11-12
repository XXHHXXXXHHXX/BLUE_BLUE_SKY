/** 报告目录 API - 支持层级分类管理 */
import { NextRequest, NextResponse } from 'next/server';
import {
  DEFAULT_FOLDER_ID,
  getReportStore,
  putReport,
  loadFolders,
  saveFolders,
  type ReportFolderData,
} from '../../../../src/server/storage/reportStore';

function isDefaultFolder(id: string) {
  return id === DEFAULT_FOLDER_ID;
}

/** 将旧测试套后缀的默认目录 ID 统一迁移为 uncategorized */
function migrateData() {
  let folders = loadFolders();
  let foldersChanged = false;
  const oldDefaultIds = new Set<string>();

  for (const folder of folders) {
    if (folder.id && folder.id.startsWith('uncategorized-') && folder.id !== DEFAULT_FOLDER_ID) {
      oldDefaultIds.add(folder.id);
    }
  }

  if (oldDefaultIds.size > 0) {
    foldersChanged = true;
    for (const folder of folders) {
      if (folder.id.startsWith('uncategorized-')) {
        folder.id = DEFAULT_FOLDER_ID;
      }
      if (folder.parentId && folder.parentId.startsWith('uncategorized-')) {
        folder.parentId = DEFAULT_FOLDER_ID;
      }
    }
  }

  for (const folder of folders) {
    if ('testSuite' in folder) {
      delete (folder as any).testSuite;
      foldersChanged = true;
    }
  }

  if (foldersChanged) {
    const seen = new Set<string>();
    folders = folders.filter((f) => {
      if (seen.has(f.id)) return false;
      seen.add(f.id);
      return true;
    });
    saveFolders(folders);
  }

  // 报告侧的 folderId / testSuite 归一化由记录存储引擎在加载时完成
}

function ensureDefaultFolder() {
  const folders = loadFolders();
  migrateData();
  if (!folders.some((f) => f.id === DEFAULT_FOLDER_ID)) {
    const now = new Date().toISOString();
    folders.push({
      id: DEFAULT_FOLDER_ID,
      name: '未分类',
      parentId: null,
      createdAt: now,
      updatedAt: now,
    });
    saveFolders(folders);
  }
}

/** GET /api/test/report-folders */
export async function GET() {
  try {
    ensureDefaultFolder();
    const folders = loadFolders();
    return NextResponse.json({ success: true, folders });
  } catch (error) {
    const msg = error instanceof Error ? error.message : '加载目录失败';
    console.error('[Report Folders API] GET error:', msg);
    return NextResponse.json({ success: false, message: msg }, { status: 500 });
  }
}

/** POST /api/test/report-folders - 创建目录 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { parentId, name } = body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return NextResponse.json({ success: false, message: '缺少目录名称' }, { status: 400 });
    }

    ensureDefaultFolder();
    const folders = loadFolders();

    // 校验 parentId
    if (parentId) {
      const parent = folders.find((f) => f.id === parentId);
      if (!parent) {
        return NextResponse.json({ success: false, message: '父目录不存在' }, { status: 400 });
      }
    }

    // 同一父目录下不可重名
    if (folders.some((f) => f.parentId === (parentId || null) && f.id !== DEFAULT_FOLDER_ID && f.name === name.trim())) {
      return NextResponse.json({ success: false, message: '同一目录下已存在同名文件夹' }, { status: 400 });
    }

    // 保护默认目录名
    if (name.trim() === '未分类') {
      return NextResponse.json({ success: false, message: '目录名“未分类”为系统保留' }, { status: 400 });
    }

    const now = new Date().toISOString();
    const newFolder: ReportFolderData = {
      id: `folder-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: name.trim(),
      parentId: parentId || null,
      createdAt: now,
      updatedAt: now,
    };

    folders.push(newFolder);
    saveFolders(folders);

    return NextResponse.json({ success: true, folder: newFolder });
  } catch (error) {
    const msg = error instanceof Error ? error.message : '创建目录失败';
    console.error('[Report Folders API] POST error:', msg);
    return NextResponse.json({ success: false, message: msg }, { status: 500 });
  }
}

/** PATCH /api/test/report-folders - 重命名目录 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, name } = body;

    if (!id || !name || !name.trim()) {
      return NextResponse.json({ success: false, message: '缺少目录ID或名称' }, { status: 400 });
    }

    ensureDefaultFolder();
    const folders = loadFolders();

    const folder = folders.find((f) => f.id === id);
    if (!folder) {
      return NextResponse.json({ success: false, message: '目录不存在' }, { status: 404 });
    }

    if (isDefaultFolder(id)) {
      return NextResponse.json({ success: false, message: '默认目录不可重命名' }, { status: 400 });
    }

    if (name.trim() === '未分类') {
      return NextResponse.json({ success: false, message: '目录名“未分类”为系统保留' }, { status: 400 });
    }

    if (folders.some((f) => f.parentId === folder.parentId && f.id !== id && f.name === name.trim())) {
      return NextResponse.json({ success: false, message: '同一目录下已存在同名文件夹' }, { status: 400 });
    }

    folder.name = name.trim();
    folder.updatedAt = new Date().toISOString();
    saveFolders(folders);

    return NextResponse.json({ success: true, folder });
  } catch (error) {
    const msg = error instanceof Error ? error.message : '重命名目录失败';
    console.error('[Report Folders API] PATCH error:', msg);
    return NextResponse.json({ success: false, message: msg }, { status: 500 });
  }
}

/** DELETE /api/test/report-folders - 删除目录 */
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ success: false, message: '缺少目录ID' }, { status: 400 });
    }

    ensureDefaultFolder();
    let folders = loadFolders();
    const folder = folders.find((f) => f.id === id);
    if (!folder) {
      return NextResponse.json({ success: false, message: '目录不存在' }, { status: 404 });
    }

    if (isDefaultFolder(id)) {
      return NextResponse.json({ success: false, message: '默认目录不可删除' }, { status: 400 });
    }

    // 收集所有需要删除的目录（自身及子目录），visited 防循环引用
    const idsToDelete = new Set<string>();
    const visited = new Set<string>();
    const collect = (folderId: string) => {
      if (visited.has(folderId)) return;
      visited.add(folderId);
      idsToDelete.add(folderId);
      for (const f of folders) {
        if (f.parentId === folderId) {
          collect(f.id);
        }
      }
    };
    collect(id);

    // 把受影响报告移到未分类：按索引过滤，只读取并改写受影响的记录
    const store = getReportStore();
    const affected = store.query({ filter: { folderId: idsToDelete } });
    let movedCount = 0;
    for (const report of affected.items) {
      report.folderId = DEFAULT_FOLDER_ID;
      putReport(report);
      movedCount++;
    }

    // 删除目录及子目录
    folders = folders.filter((f) => !idsToDelete.has(f.id));
    saveFolders(folders);

    return NextResponse.json({ success: true, message: '目录已删除', movedReports: movedCount });
  } catch (error) {
    const msg = error instanceof Error ? error.message : '删除目录失败';
    console.error('[Report Folders API] DELETE error:', msg);
    return NextResponse.json({ success: false, message: msg }, { status: 500 });
  }
}
