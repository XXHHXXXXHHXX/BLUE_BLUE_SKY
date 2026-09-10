/** 拓扑BMC配置 API - 每个拓扑独立的BMC配置 */
import { NextRequest, NextResponse } from 'next/server';
import { topologyStore } from '../../../lib/store';
import type { BMCConfig } from '../../../../../src/types/topology';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/topologies/:id/bmc - 获取指定拓扑的BMC配置
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const config = topologyStore.getBMCConfig(id);
    
    return NextResponse.json({
      success: true,
      data: config || null
    });
  } catch (error) {
    console.error('[BMC Config] GET error:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to fetch BMC config' },
      { status: 500 }
    );
  }
}

// POST /api/topologies/:id/bmc - 保存指定拓扑的BMC配置
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { config }: { config: BMCConfig } = body;
    
    if (!config) {
      return NextResponse.json(
        { success: false, message: 'Config is required' },
        { status: 400 }
      );
    }
    
    topologyStore.saveBMCConfig(id, config);
    
    console.log('[BMC Config] Saved for topology:', id);
    return NextResponse.json({
      success: true,
      data: config
    });
  } catch (error) {
    console.error('[BMC Config] POST error:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to save BMC config' },
      { status: 500 }
    );
  }
}

// DELETE /api/topologies/:id/bmc - 删除指定拓扑的BMC配置
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    topologyStore.deleteBMCConfig(id);
    
    console.log('[BMC Config] Deleted for topology:', id);
    return NextResponse.json({
      success: true
    });
  } catch (error) {
    console.error('[BMC Config] DELETE error:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to delete BMC config' },
      { status: 500 }
    );
  }
}
