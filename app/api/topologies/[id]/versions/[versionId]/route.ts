/** 单个版本管理 API */
import { NextRequest, NextResponse } from 'next/server';
import { versionsStore } from '../../../../lib/store';

interface RouteParams {
  params: Promise<{ id: string; versionId: string }>;
}

// PATCH /api/topologies/:id/versions/:versionId - 更新版本元数据
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { id, versionId } = await params;
    const body = await request.json();
    const { label, notes } = body;
    
    const versions = versionsStore.getVersions(id);
    const version = versions.find(v => v.id === versionId);
    
    if (!version) {
      return NextResponse.json(
        { success: false, message: 'Version not found' },
        { status: 404 }
      );
    }
    
    if (label) version.label = label;
    if (notes !== undefined) version.notes = notes;
    
    versionsStore.saveVersions(id, versions);
    
    console.log('[Versions] Updated meta:', versionId);
    return NextResponse.json({
      success: true,
      data: version
    });
  } catch (error) {
    console.error('[Versions] PATCH error:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to update version' },
      { status: 500 }
    );
  }
}

// DELETE /api/topologies/:id/versions/:versionId - 删除版本
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id, versionId } = await params;
    
    let versions = versionsStore.getVersions(id);
    versions = versions.filter(v => v.id !== versionId);
    versionsStore.saveVersions(id, versions);
    
    console.log('[Versions] Deleted:', versionId);
    return NextResponse.json({
      success: true
    });
  } catch (error) {
    console.error('[Versions] DELETE error:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to delete version' },
      { status: 500 }
    );
  }
}
