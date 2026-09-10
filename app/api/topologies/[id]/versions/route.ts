/** 拓扑版本历史 API - 每个拓扑独立的版本管理 */
import { NextRequest, NextResponse } from 'next/server';
import { topologiesStore, versionsStore } from '../../../lib/store';
import type { TopologyVersion } from '../../../lib/store';
import type { TopologyExportData } from '@/src/types/topology';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// GET /api/topologies/:id/versions - 获取指定拓扑的版本历史
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
    
    const versions = versionsStore.getVersions(id);
    
    return NextResponse.json({
      success: true,
      data: versions
    });
  } catch (error) {
    console.error('[Versions] GET error:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to fetch versions' },
      { status: 500 }
    );
  }
}

// POST /api/topologies/:id/versions - 保存新版本
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { data, label, notes }: { 
      data: TopologyExportData; 
      label: string; 
      notes?: string;
    } = body;
    
    if (!data || !label) {
      return NextResponse.json(
        { success: false, message: 'Data and label are required' },
        { status: 400 }
      );
    }
    
    const versions = versionsStore.getVersions(id);
    
    const newVersion: TopologyVersion = {
      id: `v-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      label,
      notes,
      timestamp: new Date().toISOString(),
      isAuto: false,
      data
    };
    
    versions.unshift(newVersion);
    
    // 只保留最近 50 个版本
    if (versions.length > 50) {
      versions.splice(50);
    }
    
    versionsStore.saveVersions(id, versions);
    
    console.log('[Versions] Saved for topology:', id, newVersion.id);
    return NextResponse.json({
      success: true,
      data: newVersion
    });
  } catch (error) {
    console.error('[Versions] POST error:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to save version' },
      { status: 500 }
    );
  }
}

// DELETE /api/topologies/:id/versions - 清空版本历史
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    
    versionsStore.saveVersions(id, []);
    
    console.log('[Versions] Cleared for topology:', id);
    return NextResponse.json({
      success: true
    });
  } catch (error) {
    console.error('[Versions] DELETE error:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to clear versions' },
      { status: 500 }
    );
  }
}
