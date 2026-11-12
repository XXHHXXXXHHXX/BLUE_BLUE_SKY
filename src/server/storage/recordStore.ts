/**
 * 通用记录存储引擎
 *
 * 目标：把「单个大 JSON 文件全量读 + 全量写」换成「单条记录文件 + 内存索引」，
 * 让列表、分页、搜索的复杂度从 O(全量解析) 降到 O(索引扫描) + O(页大小)，
 * 同时保持与旧版本的数据格式兼容。
 *
 * 目录结构（collection = 'reports' 为例）：
 *   .data/test-reports.json                聚合快照（格式不变，旧版本直接读）
 *   .data/records/reports/<shard>/<hash>.json   单条记录
 *   .data/.index/reports.json              内存索引的持久化副本
 *
 * 兼容策略：
 * - 索引里记录快照的 mtime+size 指纹。指纹一致 → 信任索引与记录文件（新版本写入的）。
 * - 指纹不一致 → 快照被外部（旧版本）改过，从快照重建记录与索引。
 * - 快照不存在但记录文件存在 → 从记录文件重建索引。
 * - 旧版本忽略 records/ 与 .index/，继续读写快照，功能不受影响。
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const DATA_DIR = path.join(process.cwd(), '.data');
const RECORDS_ROOT = path.join(DATA_DIR, 'records');
const INDEX_ROOT = path.join(DATA_DIR, '.index');

const INDEX_VERSION = 1;

export interface RecordIndexEntry {
  id: string;
  /** 排序键（通常为 createdAt 的毫秒数），倒序排列 */
  sortKey: number;
  /** 可过滤字段（如 folderId），值为字符串 */
  filter: Record<string, string>;
  /** 参与搜索的字段原文（小写），逐个用 includes 校验 */
  searchFields: string[];
}

interface IndexFile {
  version: number;
  collection: string;
  /** 生成索引时快照文件的指纹；null 表示快照不存在 */
  snapshot: { mtimeMs: number; size: number } | null;
  entries: RecordIndexEntry[];
}

export interface RecordStoreOptions<T> {
  /** 集合名，决定 records/ 与 .index/ 下的子目录与文件名 */
  collection: string;
  /** 聚合快照文件绝对路径（旧版本读写的那个 JSON） */
  snapshotFile: string;
  /** 取记录 ID */
  idOf: (record: T) => string;
  /** 取排序键（毫秒时间戳），列表按此倒序 */
  sortKeyOf: (record: T) => number;
  /** 取可过滤字段 */
  filterOf?: (record: T) => Record<string, string | undefined>;
  /** 取参与搜索的字段（返回原文，内部会转小写） */
  searchFieldsOf: (record: T) => Array<string | undefined>;
  /** 读取时的归一化（如补齐默认 folderId） */
  normalize?: (record: T) => T;
  /** 落盘前的转换（如剔除大字段）；内存中仍保留原始记录 */
  serialize?: (record: T) => unknown;
  /** 自定义快照构建（如从内存 Map 直接生成），避免重建快照时逐条读文件 */
  buildSnapshot?: () => unknown[];
  /** 快照重建防抖（毫秒），默认 1500 */
  snapshotDebounceMs?: number;
  /** 索引落盘防抖（毫秒），默认 0 表示立即落盘 */
  indexDebounceMs?: number;
}

export interface RecordQuery {
  /** 过滤条件：字段名 → 允许值集合；未提供的字段不参与过滤 */
  filter?: Record<string, Set<string>>;
  /** 搜索关键词（子串匹配，语义与原先的 includes 一致） */
  keyword?: string;
  offset?: number;
  limit?: number;
}

export interface RecordQueryResult<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
}

/** 文件名安全化：用 id 的哈希做文件名，避免非法字符与超长路径 */
function hashId(id: string): string {
  return crypto.createHash('sha1').update(id).digest('hex').slice(0, 16);
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/** 原子写：先写临时文件再 rename，避免写到一半崩溃留下损坏文件 */
function writeFileAtomic(filePath: string, content: string): void {
  ensureDir(path.dirname(filePath));
  const tmp = `${filePath}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, filePath);
}

/** 小写化，非字符串统一转空串 */
function lower(value: unknown): string {
  return typeof value === 'string' ? value.toLowerCase() : '';
}

/** 提取检索 token：ASCII 词（长度≥2）与 CJK 二元组 */
function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const lowerText = text.toLowerCase();
  const ascii = lowerText.match(/[a-z0-9_]{2,}/g);
  if (ascii) tokens.push(...ascii);
  // CJK 二元组：覆盖中文子串搜索
  const cjk = lowerText.match(/[\u4e00-\u9fff]+/g);
  if (cjk) {
    for (const run of cjk) {
      if (run.length === 1) {
        tokens.push(run);
        continue;
      }
      for (let i = 0; i + 1 < run.length; i++) {
        tokens.push(run.slice(i, i + 2));
      }
    }
  }
  return tokens;
}

export class RecordStore<T> {
  private readonly options: Required<Pick<RecordStoreOptions<T>, 'snapshotDebounceMs'>> & RecordStoreOptions<T>;
  private readonly recordsDir: string;
  private readonly indexPath: string;

  private entries = new Map<string, RecordIndexEntry>();
  private postings = new Map<string, Set<string>>();
  private loaded = false;

  /** 待重建快照标记 */
  private snapshotDirty = false;
  private snapshotTimer: ReturnType<typeof setTimeout> | null = null;
  /** 索引是否需要重新落盘 */
  private indexDirty = false;
  private indexTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: RecordStoreOptions<T>) {
    this.options = { snapshotDebounceMs: 1500, indexDebounceMs: 0, ...options };
    this.recordsDir = path.join(RECORDS_ROOT, options.collection);
    this.indexPath = path.join(INDEX_ROOT, `${options.collection}.json`);
  }

  // ==================== 加载 / 迁移 ====================

  private snapshotFingerprint(): { mtimeMs: number; size: number } | null {
    try {
      const stat = fs.statSync(this.options.snapshotFile);
      return { mtimeMs: stat.mtimeMs, size: stat.size };
    } catch {
      return null;
    }
  }

  private sameFingerprint(
    a: { mtimeMs: number; size: number } | null,
    b: { mtimeMs: number; size: number } | null
  ): boolean {
    if (a === null && b === null) return true;
    if (a === null || b === null) return false;
    return a.mtimeMs === b.mtimeMs && a.size === b.size;
  }

  private readIndexFile(): IndexFile | null {
    try {
      if (!fs.existsSync(this.indexPath)) return null;
      const parsed = JSON.parse(fs.readFileSync(this.indexPath, 'utf-8')) as IndexFile;
      if (parsed?.version !== INDEX_VERSION || parsed.collection !== this.options.collection) return null;
      if (!Array.isArray(parsed.entries)) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  private readSnapshot(): T[] | null {
    try {
      if (!fs.existsSync(this.options.snapshotFile)) return null;
      const raw = fs.readFileSync(this.options.snapshotFile, 'utf-8');
      if (!raw.trim()) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as T[]) : null;
    } catch {
      return null;
    }
  }

  private recordPath(id: string): string {
    const hash = hashId(id);
    return path.join(this.recordsDir, hash.slice(0, 2), `${hash}.json`);
  }

  private writeRecord(record: T): void {
    const payload = this.options.serialize ? this.options.serialize(record) : record;
    writeFileAtomic(this.recordPath(this.options.idOf(record)), JSON.stringify(payload));
  }

  private readRecord(id: string): T | null {
    try {
      const filePath = this.recordPath(id);
      if (!fs.existsSync(filePath)) return null;
      return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
    } catch {
      return null;
    }
  }

  private buildEntry(record: T): RecordIndexEntry {
    const rawFilter = this.options.filterOf?.(record) || {};
    const filter: Record<string, string> = {};
    for (const [key, value] of Object.entries(rawFilter)) {
      if (typeof value === 'string' && value) filter[key] = value;
    }
    const searchFields = (this.options.searchFieldsOf(record) || [])
      .map((v) => lower(v))
      .filter((v) => v.length > 0);
    return {
      id: this.options.idOf(record),
      sortKey: this.options.sortKeyOf(record),
      filter,
      searchFields,
    };
  }

  private buildPostings(): void {
    this.postings = new Map();
    for (const entry of this.entries.values()) {
      const seen = new Set<string>();
      for (const field of entry.searchFields) {
        for (const token of tokenize(field)) {
          if (seen.has(token)) continue;
          seen.add(token);
          let set = this.postings.get(token);
          if (!set) {
            set = new Set();
            this.postings.set(token, set);
          }
          set.add(entry.id);
        }
      }
    }
  }

  /** 增量更新倒排索引：移除旧条目的 token，加入新条目的 token */
  private setEntry(id: string, entry: RecordIndexEntry): void {
    const previous = this.entries.get(id);
    if (previous) {
      for (const field of previous.searchFields) {
        for (const token of tokenize(field)) {
          const posting = this.postings.get(token);
          if (!posting) continue;
          posting.delete(id);
          if (posting.size === 0) this.postings.delete(token);
        }
      }
    }
    this.entries.set(id, entry);
    const seen = new Set<string>();
    for (const field of entry.searchFields) {
      for (const token of tokenize(field)) {
        if (seen.has(token)) continue;
        seen.add(token);
        let posting = this.postings.get(token);
        if (!posting) {
          posting = new Set();
          this.postings.set(token, posting);
        }
        posting.add(id);
      }
    }
  }

  /** 增量删除条目及其倒排索引 */
  private dropEntry(id: string): void {
    const previous = this.entries.get(id);
    this.entries.delete(id);
    if (!previous) return;
    for (const field of previous.searchFields) {
      for (const token of tokenize(field)) {
        const posting = this.postings.get(token);
        if (!posting) continue;
        posting.delete(id);
        if (posting.size === 0) this.postings.delete(token);
      }
    }
  }

  /** 从快照重建记录文件与索引（旧数据迁移 / 外部改动后同步） */
  private rebuildFromSnapshot(records: T[]): void {
    this.entries.clear();
    // 清空旧记录文件，避免残留已删除的条目
    try {
      if (fs.existsSync(this.recordsDir)) {
        fs.rmSync(this.recordsDir, { recursive: true, force: true });
      }
    } catch {
      // ignore
    }
    for (const raw of records) {
      const record = this.options.normalize ? this.options.normalize(raw) : raw;
      const id = this.options.idOf(record);
      if (!id) continue;
      this.entries.set(id, this.buildEntry(record));
      this.writeRecord(record);
    }
    this.buildPostings();
    this.indexDirty = true;
    this.snapshotDirty = false;
    this.flushIndex();
  }

  /** 快照缺失时，从已有记录文件重建索引 */
  private rebuildFromRecordFiles(): void {
    this.entries.clear();
    if (!fs.existsSync(this.recordsDir)) {
      this.buildPostings();
      this.indexDirty = true;
      this.flushIndex();
      return;
    }
    const walk = (dir: string) => {
      let names: string[] = [];
      try {
        names = fs.readdirSync(dir);
      } catch {
        return;
      }
      for (const name of names) {
        const full = path.join(dir, name);
        let stat: fs.Stats;
        try {
          stat = fs.statSync(full);
        } catch {
          continue;
        }
        if (stat.isDirectory()) {
          walk(full);
          continue;
        }
        if (!name.endsWith('.json')) continue;
        try {
          const record = JSON.parse(fs.readFileSync(full, 'utf-8')) as T;
          const id = this.options.idOf(record);
          if (id) this.entries.set(id, this.buildEntry(record));
        } catch {
          // 跳过损坏文件
        }
      }
    };
    walk(this.recordsDir);
    this.buildPostings();
    this.indexDirty = true;
    this.flushIndex();
  }

  private ensureLoaded(): void {
    if (this.loaded) return;

    const indexFile = this.readIndexFile();
    const currentFingerprint = this.snapshotFingerprint();

    if (indexFile && this.sameFingerprint(indexFile.snapshot, currentFingerprint)) {
      // 快照未被外部改动：信任索引（记录文件由本引擎维护）
      this.entries = new Map(indexFile.entries.map((e) => [e.id, e]));
      this.buildPostings();
      this.loaded = true;
      return;
    }

    // 快照被外部改动或索引缺失：以快照为权威重建
    const snapshot = this.readSnapshot();
    if (snapshot !== null) {
      this.rebuildFromSnapshot(snapshot);
    } else {
      this.rebuildFromRecordFiles();
    }
    this.loaded = true;
  }

  // ==================== 索引 / 快照落盘 ====================

  /** 标记索引脏；配置了防抖则延后落盘，否则立即落盘 */
  private markIndexDirty(): void {
    this.indexDirty = true;
    const debounce = this.options.indexDebounceMs;
    if (!debounce) {
      this.flushIndex();
      return;
    }
    if (this.indexTimer) return;
    this.indexTimer = setTimeout(() => {
      this.indexTimer = null;
      this.flushIndex();
    }, debounce);
    if (typeof this.indexTimer.unref === 'function') this.indexTimer.unref();
  }

  private flushIndex(): void {
    if (!this.indexDirty) return;
    this.indexDirty = false;
    const payload: IndexFile = {
      version: INDEX_VERSION,
      collection: this.options.collection,
      snapshot: this.snapshotFingerprint(),
      entries: Array.from(this.entries.values()),
    };
    try {
      writeFileAtomic(this.indexPath, JSON.stringify(payload));
    } catch (err) {
      console.error(`[RecordStore:${this.options.collection}] Failed to save index:`, err);
    }
  }

  private writeSnapshotNow(): void {
    this.snapshotDirty = false;
    try {
      const records = this.options.buildSnapshot ? this.options.buildSnapshot() : this.readAllRecords();
      writeFileAtomic(this.options.snapshotFile, JSON.stringify(records, null, 2));
      // 快照指纹变化后需重写索引，否则下次加载会误判为「外部改动」而重建
      this.indexDirty = true;
      this.flushIndex();
    } catch (err) {
      console.error(`[RecordStore:${this.options.collection}] Failed to save snapshot:`, err);
    }
  }

  private scheduleSnapshot(): void {
    this.snapshotDirty = true;
    if (this.snapshotTimer) return;
    this.snapshotTimer = setTimeout(() => {
      this.snapshotTimer = null;
      if (this.snapshotDirty) this.writeSnapshotNow();
    }, this.options.snapshotDebounceMs);
    // 不阻止进程退出
    if (typeof this.snapshotTimer.unref === 'function') this.snapshotTimer.unref();
  }

  private readAllRecords(): T[] {
    const result: T[] = [];
    for (const entry of this.sortedEntries()) {
      const record = this.readRecord(entry.id);
      if (record) result.push(record);
    }
    return result;
  }

  private sortedEntries(): RecordIndexEntry[] {
    return Array.from(this.entries.values()).sort((a, b) => b.sortKey - a.sortKey);
  }

  /** 立即落盘索引与快照（删除、批量替换等关键操作后调用） */
  flush(): void {
    if (this.snapshotTimer) {
      clearTimeout(this.snapshotTimer);
      this.snapshotTimer = null;
    }
    this.flushIndex();
    if (this.snapshotDirty) this.writeSnapshotNow();
  }

  /** 仅落盘索引（记录已单条写入） */
  flushIndexOnly(): void {
    this.flushIndex();
  }

  // ==================== 读 ====================

  getAll(): T[] {
    this.ensureLoaded();
    return this.readAllRecords();
  }

  getById(id: string): T | undefined {
    this.ensureLoaded();
    if (!this.entries.has(id)) return undefined;
    return this.readRecord(id) ?? undefined;
  }

  has(id: string): boolean {
    this.ensureLoaded();
    return this.entries.has(id);
  }

  count(): number {
    this.ensureLoaded();
    return this.entries.size;
  }

  /** 按字段统计数量（如每个目录下的报告数），无需读取记录正文 */
  countBy(field: string): Record<string, number> {
    this.ensureLoaded();
    const counts: Record<string, number> = {};
    for (const entry of this.entries.values()) {
      const value = entry.filter[field];
      if (!value) continue;
      counts[value] = (counts[value] || 0) + 1;
    }
    return counts;
  }

  /** 分页查询：过滤 → 搜索 → 排序 → 切片，只读取当前页的记录文件 */
  query(params: RecordQuery = {}): RecordQueryResult<T> {
    this.ensureLoaded();
    const { filter, keyword, offset = 0, limit } = params;

    let candidates: RecordIndexEntry[] | null = null;

    // 过滤字段：取交集
    if (filter) {
      for (const [field, allowed] of Object.entries(filter)) {
        const matched = new Set<string>();
        for (const entry of this.entries.values()) {
          const value = entry.filter[field];
          if (value && allowed.has(value)) matched.add(entry.id);
        }
        if (candidates === null) {
          candidates = Array.from(matched).map((id) => this.entries.get(id)!);
        } else {
          candidates = candidates.filter((e) => matched.has(e.id));
        }
      }
    }

    // 搜索：先用倒排索引缩小候选，再用 includes 精确校验（保证与旧语义一致）
    const normalizedKeyword = (keyword || '').trim().toLowerCase();
    if (normalizedKeyword) {
      const postingCandidates = this.postingsLookup(normalizedKeyword);
      const base = candidates ?? Array.from(this.entries.values());
      candidates = base.filter((entry) => {
        if (postingCandidates && !postingCandidates.has(entry.id)) return false;
        return entry.searchFields.some((field) => field.includes(normalizedKeyword));
      });
    }

    const matchedEntries = (candidates ?? Array.from(this.entries.values()))
      .sort((a, b) => b.sortKey - a.sortKey);

    const total = matchedEntries.length;
    const safeOffset = Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0;
    const safeLimit = Number.isFinite(limit) && (limit as number) > 0 ? Math.floor(limit as number) : undefined;
    const pageEntries = safeLimit !== undefined
      ? matchedEntries.slice(safeOffset, safeOffset + safeLimit)
      : matchedEntries.slice(safeOffset);

    const items: T[] = [];
    for (const entry of pageEntries) {
      const record = this.readRecord(entry.id);
      if (record) items.push(record);
    }

    return { items, total, offset: safeOffset, limit: safeLimit ?? total };
  }

  /** 倒排索引查询：所有 token 都有 posting 时返回交集，否则返回 null（退化为全量扫描） */
  private postingsLookup(keyword: string): Set<string> | null {
    const tokens = tokenize(keyword);
    if (tokens.length === 0) return null;
    let result: Set<string> | null = null;
    for (const token of tokens) {
      const posting = this.postings.get(token);
      if (!posting) return null;
      if (result === null) {
        result = new Set(posting);
      } else {
        for (const id of Array.from(result)) {
          if (!posting.has(id)) result.delete(id);
        }
      }
      if (result.size === 0) return result;
    }
    return result;
  }

  // ==================== 写 ====================

  /** 新增或更新单条记录（只写这一条文件 + 防抖重建快照） */
  put(record: T): void {
    this.ensureLoaded();
    const normalized = this.options.normalize ? this.options.normalize(record) : record;
    const id = this.options.idOf(normalized);
    if (!id) return;
    this.writeRecord(normalized);
    this.setEntry(id, this.buildEntry(normalized));
    this.markIndexDirty();
    this.scheduleSnapshot();
  }

  /** 批量写入（如导入、合并），逐条落盘后统一刷新索引与快照 */
  putMany(records: T[]): void {
    this.ensureLoaded();
    for (const record of records) {
      const normalized = this.options.normalize ? this.options.normalize(record) : record;
      const id = this.options.idOf(normalized);
      if (!id) continue;
      this.writeRecord(normalized);
      this.setEntry(id, this.buildEntry(normalized));
    }
    this.markIndexDirty();
    this.scheduleSnapshot();
  }

  /** 删除单条记录 */
  remove(id: string): boolean {
    this.ensureLoaded();
    if (!this.entries.has(id)) return false;
    this.dropEntry(id);
    try {
      const filePath = this.recordPath(id);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch {
      // ignore
    }
    this.markIndexDirty();
    this.scheduleSnapshot();
    return true;
  }

  removeMany(ids: string[]): number {
    this.ensureLoaded();
    let removed = 0;
    for (const id of ids) {
      if (!this.entries.has(id)) continue;
      this.dropEntry(id);
      try {
        const filePath = this.recordPath(id);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch {
        // ignore
      }
      removed++;
    }
    if (removed > 0) {
      this.markIndexDirty();
      this.scheduleSnapshot();
    }
    return removed;
  }

  /** 整体替换（导入、合并等全量操作），会立即落盘快照 */
  replaceAll(records: T[]): void {
    this.ensureLoaded();
    this.entries.clear();
    try {
      if (fs.existsSync(this.recordsDir)) {
        fs.rmSync(this.recordsDir, { recursive: true, force: true });
      }
    } catch {
      // ignore
    }
    for (const record of records) {
      const normalized = this.options.normalize ? this.options.normalize(record) : record;
      const id = this.options.idOf(normalized);
      if (!id) continue;
      this.writeRecord(normalized);
      this.setEntry(id, this.buildEntry(normalized));
    }
    this.markIndexDirty();
    this.snapshotDirty = true;
    this.writeSnapshotNow();
  }
}

/** 创建（并缓存）一个记录存储实例，避免同一集合重复加载索引。
 *  用 globalThis 保存，确保 Next.js 模块热重载后仍复用同一份内存索引。 */
const REGISTRY_KEY = '__blue_sky_record_stores__';
const globalRegistry = (globalThis as Record<string, unknown>)[REGISTRY_KEY] as
  | Map<string, RecordStore<unknown>>
  | undefined;
const storeRegistry = globalRegistry || new Map<string, RecordStore<unknown>>();
(globalThis as Record<string, unknown>)[REGISTRY_KEY] = storeRegistry;

export function getRecordStore<T>(options: RecordStoreOptions<T>): RecordStore<T> {
  const key = options.collection;
  const existing = storeRegistry.get(key);
  if (existing) return existing as RecordStore<T>;
  const store = new RecordStore<T>(options);
  storeRegistry.set(key, store as RecordStore<unknown>);
  return store;
}
