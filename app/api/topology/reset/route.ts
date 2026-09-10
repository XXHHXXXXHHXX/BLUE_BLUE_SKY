/** 拓扑重置 API - 重置当前拓扑为默认 */
import { NextResponse } from 'next/server';
import { topologyStore, defaultTopology, topologiesStore } from '../../lib/store';

// POST /api/topology/reset
export async function POST() {
  try {
    const currentId = topologiesStore.getCurrentId();
    topologyStore.saveTopology(currentId, JSON.parse(JSON.stringify(defaultTopology)));
    console.log('[Topology] Reset current to default:', currentId);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Topology] Reset error:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to reset topology' },
      { status: 500 }
    );
  }
}
