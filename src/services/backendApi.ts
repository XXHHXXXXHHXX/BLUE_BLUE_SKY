/** 后端API服务 - 支持每个拓扑独立BMC配置和用户级拓扑选择 */
import type { TopologyNode, TopologyEdge, TopologyExportData } from '../types/topology';
import type { BMCConfig } from '../types/topology';

// 同域 API 路径（使用 Next.js API Routes）
const API_BASE_URL = '/api';

/** 全局监控状态 */
export interface GlobalMonitorState {
  isPolling: boolean;
  pollInterval: number;
  updatedAt: string;
  updatedBy: string;
}

/** 数据轮询结果 */
export interface PollResult {
  success: boolean;
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  timestamp: string;
  error?: string;
}

/** 后端响应格式 */
interface BackendResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

/** 版本历史类型 */
export interface TopologyVersion {
  id: string;
  label: string;
  notes?: string;
  timestamp: string;
  isAuto: boolean;
  data: TopologyExportData;
}

/** 拓扑元数据 */
export interface TopologyMeta {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  isDefault: boolean;
  nodeCount: number;
}

/** 拓扑列表响应 */
export interface TopologiesResponse {
  topologies: TopologyMeta[];
  // 移除 currentId，改为用户本地存储
}

// ==================== 全局监控状态 API ====================

/** 获取全局监控状态 */
export async function fetchGlobalMonitorState(): Promise<GlobalMonitorState | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/monitor/state`);
    if (!response.ok) throw new Error('Failed to fetch monitor state');
    const result: BackendResponse<GlobalMonitorState> = await response.json();
    return result.success ? result.data : null;
  } catch (error) {
    console.error('Fetch global monitor state failed:', error);
    return null;
  }
}

/** 更新全局监控状态 */
export async function updateGlobalMonitorState(
  state: Partial<GlobalMonitorState>
): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE_URL}/monitor/state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state),
    });
    if (!response.ok) throw new Error('Failed to update monitor state');
    const result: BackendResponse<void> = await response.json();
    return result.success;
  } catch (error) {
    console.error('Update global monitor state failed:', error);
    return false;
  }
}

// ==================== 数据轮询 API ====================

/** 
 * 轮询获取所有节点和边的数据（改为 POST，携带 BMC 配置）
 */
export async function pollAllData(topologyId?: string | null, bmcConfig?: BMCConfig | null): Promise<PollResult> {
  try {
    const response = await fetch(`${API_BASE_URL}/data/poll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topologyId, bmcConfig }),
    });
    
    const result: BackendResponse<{
      nodes: TopologyNode[];
      edges: TopologyEdge[];
      timestamp: string;
    }> & { error?: string; message?: string } = await response.json();
    
    // 处理 BMC 错误（400 或 503 状态码）
    if (!response.ok || !result.success) {
      return {
        success: false,
        nodes: result.data?.nodes || [],
        edges: result.data?.edges || [],
        timestamp: result.data?.timestamp || new Date().toISOString(),
        error: result.error || result.message || `HTTP error! status: ${response.status}`,
      };
    }
    
    if (result.data) {
      return {
        success: true,
        nodes: result.data.nodes,
        edges: result.data.edges,
        timestamp: result.data.timestamp,
      };
    }
    
    return {
      success: false,
      nodes: [],
      edges: [],
      timestamp: new Date().toISOString(),
      error: result.message || 'Unknown error',
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('Poll all data failed:', error);
    return {
      success: false,
      nodes: [],
      edges: [],
      timestamp: new Date().toISOString(),
      error: errorMsg,
    };
  }
}

/** 
 * 发送控制命令到后端
 */
export async function sendControlCommand(
  nodeId: string,
  action: 'setFanSpeed' | 'setVoltage',
  value: number,
  topologyId?: string | null,
  bmcConfig?: BMCConfig | null,
): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE_URL}/control`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodeId, action, value, topologyId, bmcConfig }),
    });
    
    if (!response.ok) throw new Error('Failed to send control command');
    const result: BackendResponse<void> = await response.json();
    return result.success;
  } catch (error) {
    console.error('Send control command failed:', error);
    return false;
  }
}

// ==================== 拓扑结构 API ====================

/** 获取指定拓扑结构 */
export async function fetchTopology(topologyId?: string | null): Promise<TopologyExportData | null> {
  try {
    const url = topologyId 
      ? `${API_BASE_URL}/topologies/${topologyId}`
      : `${API_BASE_URL}/topology`;
    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to fetch topology');
    const result: BackendResponse<TopologyExportData> = await response.json();
    return result.success ? result.data : null;
  } catch (error) {
    console.error('Fetch topology failed:', error);
    return null;
  }
}

/** 通过ID获取拓扑（用于切换拓扑） */
export async function fetchTopologyById(topologyId: string): Promise<TopologyExportData | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/topologies/${topologyId}`);
    if (!response.ok) throw new Error('Failed to fetch topology');
    const result: BackendResponse<TopologyExportData> = await response.json();
    return result.success ? result.data : null;
  } catch (error) {
    console.error('Fetch topology by id failed:', error);
    return null;
  }
}

/** 保存拓扑结构 */
export async function saveTopology(
  data: TopologyExportData,
  topologyId?: string | null
): Promise<boolean> {
  try {
    const url = topologyId 
      ? `${API_BASE_URL}/topologies/${topologyId}`
      : `${API_BASE_URL}/topology`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    
    if (!response.ok) throw new Error('Failed to save topology');
    const result: BackendResponse<void> = await response.json();
    return result.success;
  } catch (error) {
    console.error('Save topology failed:', error);
    return false;
  }
}

/** 重置拓扑为默认 */
export async function resetTopology(topologyId?: string | null): Promise<boolean> {
  try {
    const url = topologyId 
      ? `${API_BASE_URL}/topologies/${topologyId}/reset`
      : `${API_BASE_URL}/topology/reset`;
    const response = await fetch(url, {
      method: 'POST',
    });
    if (!response.ok) throw new Error('Failed to reset topology');
    const result: BackendResponse<void> = await response.json();
    return result.success;
  } catch (error) {
    console.error('Reset topology failed:', error);
    return false;
  }
}

// ==================== 版本历史 API ====================

/** 获取版本历史列表 */
export async function fetchVersions(topologyId?: string | null): Promise<TopologyVersion[]> {
  try {
    const url = topologyId 
      ? `${API_BASE_URL}/topologies/${topologyId}/versions`
      : `${API_BASE_URL}/topology/versions`;
    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to fetch versions');
    const result: BackendResponse<TopologyVersion[]> = await response.json();
    return result.success ? result.data : [];
  } catch (error) {
    console.error('Fetch versions failed:', error);
    return [];
  }
}

/** 保存新版本 */
export async function saveVersion(
  data: TopologyExportData,
  label: string,
  topologyId?: string | null,
  notes?: string
): Promise<boolean> {
  try {
    const url = topologyId 
      ? `${API_BASE_URL}/topologies/${topologyId}/versions`
      : `${API_BASE_URL}/topology/versions`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data, label, notes }),
    });
    
    if (!response.ok) throw new Error('Failed to save version');
    const result: BackendResponse<void> = await response.json();
    return result.success;
  } catch (error) {
    console.error('Save version failed:', error);
    return false;
  }
}

/** 自动保存版本（覆盖最新版本） */
export async function saveAutoVersion(
  data: TopologyExportData,
  topologyId?: string | null
): Promise<boolean> {
  try {
    const url = topologyId 
      ? `${API_BASE_URL}/topologies/${topologyId}/versions/auto`
      : `${API_BASE_URL}/topology/versions/auto`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data }),
    });
    
    if (!response.ok) throw new Error('Failed to auto save version');
    const result: BackendResponse<void> = await response.json();
    return result.success;
  } catch (error) {
    console.error('Auto save version failed:', error);
    return false;
  }
}

/** 回滚到指定版本 */
export async function rollbackToVersion(versionId: string, topologyId?: string | null): Promise<boolean> {
  try {
    const url = topologyId 
      ? `${API_BASE_URL}/topologies/${topologyId}/versions/${versionId}/rollback`
      : `${API_BASE_URL}/topology/versions/${versionId}/rollback`;
    const response = await fetch(url, {
      method: 'POST',
    });
    if (!response.ok) throw new Error('Failed to rollback version');
    const result: BackendResponse<void> = await response.json();
    return result.success;
  } catch (error) {
    console.error('Rollback version failed:', error);
    return false;
  }
}

/** 删除版本 */
export async function deleteVersion(versionId: string, topologyId?: string | null): Promise<boolean> {
  try {
    const url = topologyId 
      ? `${API_BASE_URL}/topologies/${topologyId}/versions/${versionId}`
      : `${API_BASE_URL}/topology/versions/${versionId}`;
    const response = await fetch(url, {
      method: 'DELETE',
    });
    if (!response.ok) throw new Error('Failed to delete version');
    const result: BackendResponse<void> = await response.json();
    return result.success;
  } catch (error) {
    console.error('Delete version failed:', error);
    return false;
  }
}

/** 更新版本元数据 */
export async function updateVersionMeta(
  versionId: string,
  label: string,
  notes?: string,
  topologyId?: string | null
): Promise<boolean> {
  try {
    const url = topologyId 
      ? `${API_BASE_URL}/topologies/${topologyId}/versions/${versionId}`
      : `${API_BASE_URL}/topology/versions/${versionId}`;
    const response = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label, notes }),
    });
    if (!response.ok) throw new Error('Failed to update version meta');
    const result: BackendResponse<void> = await response.json();
    return result.success;
  } catch (error) {
    console.error('Update version meta failed:', error);
    return false;
  }
}

/** 清空版本历史 */
export async function clearVersions(topologyId?: string | null): Promise<boolean> {
  try {
    const url = topologyId 
      ? `${API_BASE_URL}/topologies/${topologyId}/versions`
      : `${API_BASE_URL}/topology/versions`;
    const response = await fetch(url, {
      method: 'DELETE',
    });
    if (!response.ok) throw new Error('Failed to clear versions');
    const result: BackendResponse<void> = await response.json();
    return result.success;
  } catch (error) {
    console.error('Clear versions failed:', error);
    return false;
  }
}

// ==================== 多拓扑管理 API ====================

/** 获取所有拓扑列表 */
export async function fetchTopologies(): Promise<TopologiesResponse | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/topologies`);
    if (!response.ok) throw new Error('Failed to fetch topologies');
    const result: BackendResponse<TopologiesResponse> = await response.json();
    return result.success ? result.data : null;
  } catch (error) {
    console.error('Fetch topologies failed:', error);
    return null;
  }
}

/** 创建新拓扑 */
export async function createTopology(
  name: string,
  description?: string,
  copyFromId?: string
): Promise<TopologyMeta | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/topologies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description, copyFromId }),
    });
    if (!response.ok) throw new Error('Failed to create topology');
    const result: BackendResponse<TopologyMeta> = await response.json();
    return result.success ? result.data : null;
  } catch (error) {
    console.error('Create topology failed:', error);
    return null;
  }
}

/** 更新拓扑元数据（重命名） */
export async function updateTopology(
  id: string,
  name?: string,
  description?: string
): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE_URL}/topologies/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description }),
    });
    if (!response.ok) throw new Error('Failed to update topology');
    const result: BackendResponse<void> = await response.json();
    return result.success;
  } catch (error) {
    console.error('Update topology failed:', error);
    return false;
  }
}

/** 删除拓扑 */
export async function deleteTopology(id: string): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE_URL}/topologies/${id}`, {
      method: 'DELETE',
    });
    if (!response.ok) throw new Error('Failed to delete topology');
    const result: BackendResponse<void> = await response.json();
    return result.success;
  } catch (error) {
    console.error('Delete topology failed:', error);
    return false;
  }
}
