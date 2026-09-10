/** 拓扑列表管理 API */
import { NextRequest, NextResponse } from 'next/server';
import { topologiesStore, topologyStore } from '../lib/store';

// GET /api/topologies - 获取所有拓扑列表
// 注意：不再返回 currentId，改为用户本地存储选择的拓扑
export async function GET() {
  try {
    const index = topologiesStore.data;
    return NextResponse.json({
      success: true,
      data: {
        // 移除 currentId，让用户自己决定选择哪个拓扑
        topologies: index.topologies
      }
    });
  } catch (error) {
    console.error('[Topologies] GET error:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to fetch topologies' },
      { status: 500 }
    );
  }
}

// POST /api/topologies - 新建拓扑
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, description, copyFromId } = body;
    
    if (!name || typeof name !== 'string') {
      return NextResponse.json(
        { success: false, message: 'Name is required' },
        { status: 400 }
      );
    }
    
    // 生成唯一ID（使用时间和随机数）
    const id = `topo-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // 创建拓扑
    const meta = topologyStore.createTopology(id, name, description, copyFromId);
    
    console.log('[Topologies] Created:', id, name);
    return NextResponse.json({
      success: true,
      data: meta
    });
  } catch (error) {
    console.error('[Topologies] POST error:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to create topology' },
      { status: 500 }
    );
  }
}
