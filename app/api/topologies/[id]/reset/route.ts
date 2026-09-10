/** 重置拓扑 API */
import { NextRequest, NextResponse } from 'next/server';
import { topologyStore, defaultTopology } from '../../../lib/store';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// POST /api/topologies/:id/reset - 重置指定拓扑为默认
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    
    // 重置为默认拓扑
    topologyStore.saveTopology(id, defaultTopology);
    
    console.log('[Topology] Reset to default:', id);
    return NextResponse.json({
      success: true
    });
  } catch (error) {
    console.error('[Topology] Reset error:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to reset topology' },
      { status: 500 }
    );
  }
}
