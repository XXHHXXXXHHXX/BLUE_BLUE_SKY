/**
 * 拓扑持久化服务 — 基于 localStorage 实现自动保存、手动保存和版本管理
 */
import type { TopologyExportData } from '../types/topology';

const STORAGE_KEY = 'topology_current';
const VERSIONS_KEY = 'topology_versions';
const MAX_VERSIONS = 50;

/** 版本记录 */
export interface TopologyVersion {
  id: string;
  timestamp: string;
  label: string;       // 版本名称（可改）
  notes?: string;      // 备注（可选）
  isAutoSave?: boolean; // 标记是否为自动保存
  data: TopologyExportData;
}

/** 保存当前拓扑到 localStorage */
export function saveCurrentTopology(data: TopologyExportData): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.warn('保存拓扑失败:', e);
  }
}

/** 从 localStorage 加载当前拓扑 */
export function loadCurrentTopology(): TopologyExportData | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as TopologyExportData;
    if (!Array.isArray(data.nodes) || !Array.isArray(data.edges)) return null;
    return data;
  } catch {
    return null;
  }
}

/** 保存一个新版本快照（手动保存时使用） */
export function saveVersion(data: TopologyExportData, label: string): TopologyVersion {
  const versions = loadVersions();
  const version: TopologyVersion = {
    id: `v-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
    label,
    isAutoSave: false,
    data,
  };
  versions.unshift(version);
  if (versions.length > MAX_VERSIONS) {
    versions.length = MAX_VERSIONS;
  }
  persistVersions(versions);
  return version;
}

/**
 * 自动保存：覆盖最新的自动保存记录，而不是不停新增。
 * 如果历史中最新一条是自动保存，直接覆盖它；否则新建一条自动保存记录。
 */
export function saveAutoVersion(data: TopologyExportData): void {
  const versions = loadVersions();
  if (versions.length > 0 && versions[0].isAutoSave) {
    // 覆盖最新的自动保存记录
    versions[0].data = data;
    versions[0].timestamp = new Date().toISOString();
  } else {
    // 新建一条自动保存记录
    const version: TopologyVersion = {
      id: `v-auto-${Date.now()}`,
      timestamp: new Date().toISOString(),
      label: '自动保存',
      isAutoSave: true,
      data,
    };
    versions.unshift(version);
    if (versions.length > MAX_VERSIONS) {
      versions.length = MAX_VERSIONS;
    }
  }
  persistVersions(versions);
}

/** 更新版本的名称和备注 */
export function updateVersionMeta(versionId: string, label: string, notes?: string): boolean {
  const versions = loadVersions();
  const version = versions.find(v => v.id === versionId);
  if (!version) return false;
  version.label = label;
  version.notes = notes;
  persistVersions(versions);
  return true;
}

/** 加载所有版本历史 */
export function loadVersions(): TopologyVersion[] {
  try {
    const raw = localStorage.getItem(VERSIONS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as TopologyVersion[];
  } catch {
    return [];
  }
}

/** 删除指定版本 */
export function deleteVersion(versionId: string): void {
  const versions = loadVersions().filter(v => v.id !== versionId);
  persistVersions(versions);
}

/** 清空所有版本历史 */
export function clearVersions(): void {
  localStorage.removeItem(VERSIONS_KEY);
}

/** 内部：写入版本列表 */
function persistVersions(versions: TopologyVersion[]): void {
  try {
    localStorage.setItem(VERSIONS_KEY, JSON.stringify(versions));
  } catch (e) {
    console.warn('保存版本失败:', e);
    versions.length = Math.floor(MAX_VERSIONS / 2);
    try {
      localStorage.setItem(VERSIONS_KEY, JSON.stringify(versions));
    } catch {
      console.error('无法保存版本历史');
    }
  }
}
