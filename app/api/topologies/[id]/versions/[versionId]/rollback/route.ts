/** 版本回滚 API */
import { NextRequest, NextResponse } from 'next/server';
import { versionsStore, topologyStore } from '../../../../../lib/store';

interface RouteParams {
  params: Promise<{ id: string; versionId: string }>;
}

// POST /api/topologies/:id/versions/:versionId/rollback - 回滚到指定版本
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id, versionId } = await params;
    
    const versions = versionsStore.getVersions(id);
    const version = versions.find(v => v.id === versionId);
    
    if (!version) {
      return NextResponse.json(
        { success: false, message: 'Version not found' },
        { status: 404 }
      );
    }
    
    // 恢复拓扑数据
    topologyStore.saveTopology(id, version.data);
    
    console.log('[Versions] Rollback to:', versionId, 'for topology:', id);
    return NextResponse.json({
      success: true,
      data: version
    });
  } catch (error) {
    console.error('[Versions] Rollback error:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to rollback version' },
      { status: 500 }
    );
  }
}
