/** 监控状态 API */
import { NextRequest, NextResponse } from 'next/server';
import { monitorStore } from '../../lib/store';

// GET /api/monitor/state
export async function GET() {
  return NextResponse.json({
    success: true,
    data: monitorStore.data
  });
}

// POST /api/monitor/state
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const current = monitorStore.data;
    
    if (typeof body.isPolling === 'boolean') {
      current.isPolling = body.isPolling;
    }
    if (typeof body.pollInterval === 'number') {
      current.pollInterval = body.pollInterval;
    }
    
    current.updatedAt = new Date().toISOString();
    current.updatedBy = 'client';
    
    monitorStore.data = current;
    
    console.log(`[Monitor] State updated: isPolling=${current.isPolling}`);
    
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { success: false, message: 'Invalid request' },
      { status: 400 }
    );
  }
}
