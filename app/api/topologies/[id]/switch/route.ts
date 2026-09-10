/** 切换拓扑 API */
import { NextRequest, NextResponse } from 'next/server';
import { topologiesStore, topologyStore, monitorStore } from '../../../lib/store';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// POST /api/topologies/:id/switch - 切换到指定拓扑
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    
    // 检查拓扑是否存在
    const index = topologiesStore.data;
    const meta = index.topologies.find(t => t.id === id);
    
    if (!meta) {
      return NextResponse.json(
        { success: false, message: 'Topology not found' },
        { status: 404 }
      );
    }
    
    // 检查监控状态 - 切换拓扑时必须关闭监控
    const monitorState = monitorStore.data;
    if (monitorState.isPolling) {
      return NextResponse.json(
        { 
          success: false, 
          message: 'Cannot switch topology while monitoring is active. Please stop monitoring first.' 
        },
        { status: 403 }
      );
    }
    
    // 执行切换
    topologiesStore.setCurrentId(id);
    
    // 获取新拓扑的数据
    const topologyData = topologyStore.getTopology(id);
    
    console.log('[Topologies] Switched to:', id, meta.name);
    return NextResponse.json({
      success: true,
      data: {
        meta,
        topology: topologyData
      }
    });
  } catch (error) {
    console.error('[Topologies] Switch error:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to switch topology' },
      { status: 500 }
    );
  }
}
