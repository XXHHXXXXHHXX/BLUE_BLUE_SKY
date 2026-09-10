/** 当前拓扑的版本历史 API */
import { NextRequest, NextResponse } from 'next/server';
import { versionsStore, topologiesStore, type TopologyVersion } from '../../lib/store';

// GET /api/topology/versions - 获取当前拓扑的版本列表
export async function GET() {
  try {
    const currentId = topologiesStore.getCurrentId();
    const versions = versionsStore.getVersions(currentId);
    
    return NextResponse.json({
      success: true,
      data: versions,
      meta: {
        topologyId: currentId
      }
    });
  } catch (error) {
    console.error('[Versions] GET error:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to fetch versions' },
      { status: 500 }
    );
  }
}

// POST /api/topology/versions - 保存新版本到当前拓扑
export async function POST(request: NextRequest) {
  try {
    const { label, notes, data } = await request.json();
    const currentId = topologiesStore.getCurrentId();
    
    const versions = versionsStore.getVersions(currentId);
    
    const version: TopologyVersion = {
      id: 'v-' + Date.now(),
      label: label || '未命名版本',
      notes: notes || '',
      timestamp: new Date().toISOString(),
      isAuto: false,
      data: data
    };
    
    versions.unshift(version);
    versionsStore.saveVersions(currentId, versions);
    
    console.log(`[Version] Created for ${currentId}: ${version.label}`);
    
    return NextResponse.json({ success: true, data: version });
  } catch (error) {
    console.error('[Versions] POST error:', error);
    return NextResponse.json(
      { success: false, message: 'Invalid request' },
      { status: 400 }
    );
  }
}

// DELETE /api/topology/versions - 清空当前拓扑的版本
export async function DELETE() {
  try {
    const currentId = topologiesStore.getCurrentId();
    versionsStore.saveVersions(currentId, []);
    console.log('[Version] All cleared for', currentId);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Versions] DELETE error:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to clear versions' },
      { status: 500 }
    );
  }
}
