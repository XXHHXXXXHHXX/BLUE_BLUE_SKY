/** 自动保存版本 API - 覆盖最新版本而不是新增 */
import { NextRequest, NextResponse } from 'next/server';
import { topologiesStore, versionsStore } from '../../../../lib/store';
import type { TopologyVersion } from '../../../../lib/store';
import type { TopologyExportData } from '@/src/types/topology';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// POST /api/topologies/:id/versions/auto
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { data }: { data: TopologyExportData } = body;

    if (!data) {
      return NextResponse.json(
        { success: false, message: 'Data is required' },
        { status: 400 }
      );
    }

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

    if (versions.length > 0) {
      // 覆盖最新版本（直接替换 versions[0] 的数据和时间戳）
      versions[0].data = data;
      versions[0].timestamp = new Date().toISOString();
      // label 保持原样，如果是首次自动保存且原标签为空，设为自动保存
      if (!versions[0].label) {
        versions[0].label = '自动保存';
      }
    } else {
      // 没有版本时新建一个自动保存版本
      const newVersion: TopologyVersion = {
        id: `v-auto-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        label: '自动保存',
        timestamp: new Date().toISOString(),
        isAuto: true,
        data,
      };
      versions.unshift(newVersion);
    }

    versionsStore.saveVersions(id, versions);

    console.log('[Versions] Auto saved for topology:', id);
    return NextResponse.json({
      success: true,
      data: versions[0],
    });
  } catch (error) {
    console.error('[Versions] Auto save error:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to auto save version' },
      { status: 500 }
    );
  }
}
