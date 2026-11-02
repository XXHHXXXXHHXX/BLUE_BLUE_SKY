/** 版本回滚 API - 针对当前拓扑 */
import { NextResponse } from 'next/server';
import { versionsStore, topologyStore, topologiesStore } from '@/app/api/lib/store';
import { sanitizeTopologyData } from '@/src/utils/topologySanitize';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// POST /api/topology/versions/:id/rollback
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const { id } = await params;
    const currentId = topologiesStore.getCurrentId();
    const versions = versionsStore.getVersions(currentId);
    const version = versions.find(v => v.id === id);
    
    if (version) {
      // 剔除版本中可能残留的画布运行时字段，防止回滚后监控页误判设计模式
      const clean = sanitizeTopologyData(version.data);
      topologyStore.saveTopology(currentId, JSON.parse(JSON.stringify(clean)));
      console.log(`[Version] Rolled back ${currentId} to: ${version.label}`);
      return NextResponse.json({ success: true });
    } else {
      return NextResponse.json(
        { success: false, message: 'Version not found' },
        { status: 404 }
      );
    }
  } catch (error) {
    console.error('[Version] Rollback error:', error);
    return NextResponse.json(
      { success: false, message: 'Invalid request' },
      { status: 400 }
    );
  }
}
