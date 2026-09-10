/** 单个拓扑管理 API - 获取/更新/删除指定拓扑 */
import { NextRequest, NextResponse } from 'next/server';
import { topologiesStore, topologyStore } from '../../lib/store';
import type { TopologyExportData } from '../../../../src/types/topology';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/topologies/:id - 获取指定拓扑的数据
export async function GET(request: NextRequest, { params }: RouteParams) {
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
    
    const topologyData = topologyStore.getTopology(id);
    
    return NextResponse.json({
      success: true,
      data: topologyData
    });
  } catch (error) {
    console.error('[Topology] GET error:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to fetch topology' },
      { status: 500 }
    );
  }
}

// POST /api/topologies/:id - 保存指定拓扑的数据
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const body = await request.json();
    const topologyData: TopologyExportData = body;
    
    // 检查拓扑是否存在
    const index = topologiesStore.data;
    const meta = index.topologies.find(t => t.id === id);
    
    if (!meta) {
      return NextResponse.json(
        { success: false, message: 'Topology not found' },
        { status: 404 }
      );
    }
    
    topologyStore.saveTopology(id, topologyData);
    
    return NextResponse.json({
      success: true
    });
  } catch (error) {
    console.error('[Topology] POST error:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to save topology' },
      { status: 500 }
    );
  }
}

// PATCH /api/topologies/:id - 更新拓扑元数据
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { name, description } = body;
    
    topologiesStore.updateMeta(id, { name, description });
    
    console.log('[Topologies] Updated meta:', id, name);
    return NextResponse.json({
      success: true
    });
  } catch (error) {
    console.error('[Topologies] PATCH error:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to update topology' },
      { status: 500 }
    );
  }
}

// DELETE /api/topologies/:id - 删除拓扑
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    
    const success = topologyStore.deleteTopology(id);
    
    if (success) {
      console.log('[Topologies] Deleted:', id);
      return NextResponse.json({
        success: true
      });
    } else {
      return NextResponse.json(
        { success: false, message: 'Cannot delete default topology or topology not found' },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error('[Topologies] DELETE error:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to delete topology' },
      { status: 500 }
    );
  }
}
