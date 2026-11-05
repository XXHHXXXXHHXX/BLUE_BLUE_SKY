/** 测试分数解析（前后端共用）
 *
 * run.sh 允许在最后输出一行 JSON 来返回分数，支持两种形态：
 *
 * 1. 单分数（向后兼容）：
 *      {"score": 1234}
 *
 * 2. 命名多分数：
 *      {"scores": {"CPU性能": 1234, "内存带宽": 980, "IO吞吐": 512}}
 *
 * 也允许同时给出（`score` 作为主分数，`scores` 作为明细）：
 *      {"score": 1234, "scores": {"CPU性能": 1234, "内存带宽": 980}}
 *
 * 解析规则：
 * - 从输出中自下而上寻找第一行可解析的 JSON 对象；
 * - `scores` 中的数值型条目按出现顺序保留，名称即分数名；
 * - `score` 为数值时作为主分数；若未提供 `score`，取 `scores` 的第一个值作为主分数，
 *   保证旧 UI（只认 score）仍能展示；
 * - 全部无效时主分数为 0、`scores` 为空对象。
 */

export interface ParsedScore {
  /** 主分数（兼容只展示单一分数的旧逻辑） */
  score: number;
  /** 命名分数：名称 → 数值；无命名分数时为空对象 */
  scores: Record<string, number>;
}

/** 解析单行 JSON 对象中的分数信息；不是有效分数对象时返回 null */
function parseScoreObject(value: unknown): ParsedScore | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;

  const scores: Record<string, number> = {};
  const rawScores = obj.scores;
  if (rawScores && typeof rawScores === 'object' && !Array.isArray(rawScores)) {
    Object.entries(rawScores as Record<string, unknown>).forEach(([name, v]) => {
      const num = typeof v === 'number' ? v : Number(v);
      if (name.trim() && v !== null && v !== '' && Number.isFinite(num)) {
        scores[name.trim()] = num;
      }
    });
  }

  const hasPrimary = typeof obj.score === 'number' && Number.isFinite(obj.score);
  if (!hasPrimary && Object.keys(scores).length === 0) return null;

  const score = hasPrimary
    ? (obj.score as number)
    : Object.values(scores)[0] ?? 0;

  return { score, scores };
}

/** 从脚本输出中解析分数（自下而上寻找最后一行有效 JSON） */
export function parseScoreFromOutput(output: string): ParsedScore {
  const empty: ParsedScore = { score: 0, scores: {} };
  const text = (output || '').trim();
  if (!text) return empty;

  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line.startsWith('{') || !line.endsWith('}')) continue;
    try {
      const parsed = parseScoreObject(JSON.parse(line));
      if (parsed) return parsed;
    } catch {
      // 继续尝试上一行
    }
  }
  return empty;
}

/** 取命名分数列表（名称 + 数值），按插入顺序 */
export function scoreEntries(scores: Record<string, number> | undefined): Array<{ name: string; value: number }> {
  if (!scores) return [];
  return Object.entries(scores).map(([name, value]) => ({ name, value }));
}

/** 收集多条结果中出现过的所有分数名（按首次出现顺序），用于图表/表头 */
export function collectScoreNames(results: Array<{ scores?: Record<string, number> }>): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  results.forEach((r) => {
    Object.keys(r.scores || {}).forEach((name) => {
      if (!seen.has(name)) {
        seen.add(name);
        names.push(name);
      }
    });
  });
  return names;
}

/** 构建命名分数序列：分数名 → 每轮数值（缺失为 null）；无命名分数时返回 undefined */
export function buildScoreSeries(
  results: Array<{ scores?: Record<string, number> }>,
): Record<string, Array<number | null>> | undefined {
  const names = collectScoreNames(results);
  if (names.length === 0) return undefined;
  const series: Record<string, Array<number | null>> = {};
  names.forEach((name) => {
    series[name] = results.map((r) => r.scores?.[name] ?? null);
  });
  return series;
}
