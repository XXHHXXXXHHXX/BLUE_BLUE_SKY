/** 单个版本操作 API - 针对当前拓扑 */
import { NextRequest, NextResponse } from 'next/server';
import { versionsStore, topologiesStore } from '@/app/api/lib/store';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// PATCH /api/topology/versions/:id - 更新版本元数据
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const currentId = topologiesStore.getCurrentId();
    const versions = versionsStore.getVersions(currentId);
    const version = versions.find(v => v.id === id);
    
    if (version) {
      const { label, notes } = await request.json();
      if (label) version.label = label;
      if (notes !== undefined) version.notes = notes;
      versionsStore.saveVersions(currentId, versions);
      return NextResponse.json({ success: true });
    } else {
      return NextResponse.json(
        { success: false, message: 'Version not found' },
        { status: 404 }
      );
    }
  } catch (error) {
    console.error('[Version] PATCH error:', error);
    return NextResponse.json(
      { success: false, message: 'Invalid request' },
      { status: 400 }
    );
  }
}

// DELETE /api/topology/versions/:id - 删除版本
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const currentId = topologiesStore.getCurrentId();
    const filteredVersions = versionsStore.getVersions(currentId).filter(v => v.id !== id);
    versionsStore.saveVersions(currentId, filteredVersions);
    console.log(`[Version] Deleted ${id} from ${currentId}`);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Version] DELETE error:', error);
    return NextResponse.json(
      { success: false, message: 'Invalid request' },
      { status: 400 }
    );
  }
}
