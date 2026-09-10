/** 当前拓扑管理 API */
import { NextRequest, NextResponse } from 'next/server';
import { topologyStore, topologiesStore } from '../lib/store';

// GET /api/topology - 获取当前拓扑
export async function GET() {
  try {
    const topologyData = topologyStore.data;
    const currentId = topologiesStore.getCurrentId();
    
    return NextResponse.json({
      success: true,
      data: topologyData,
      meta: {
        currentId
      }
    });
  } catch (error) {
    console.error('[Topology] GET error:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to fetch topology' },
      { status: 500 }
    );
  }
}

// POST /api/topology - 保存到当前拓扑
export async function POST(request: NextRequest) {
  try {
    const data = await request.json();
    data.exportTime = new Date().toISOString();
    
    topologyStore.data = data;
    
    console.log('[Topology] Saved to current');
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { success: false, message: 'Invalid request' },
      { status: 400 }
    );
  }
}
