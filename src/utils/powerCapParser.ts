/** LiteOS `powerCap <n>` 输出解析器
 *
 * 该命令返回最近几次功耗封顶计算的采样，每行一次：
 *   power: 436928, threshold: 440000, delta: 6, core: 2439, uncore: 2350
 *
 * 有用信息为 power（当前功耗）、core / uncore（算法给出的频率）。
 * threshold / delta 是判定依据，不是时间序列，默认丢弃。
 */

export interface PowerCapSample {
  power?: number;
  core?: number;
  uncore?: number;
  threshold?: number;
  delta?: number;
}

export interface PowerCapSnapshot {
  /** 按输出顺序排列的采样（通常为最近 N 次） */
  samples: PowerCapSample[];
  /** 是否解析到任何有效采样 */
  hasData: boolean;
}

/** 单行 `power: …, threshold: …, delta: …, core: …, uncore: …` */
const LINE_RE = /^power\s*:\s*(-?\d+(?:\.\d+)?)\s*,\s*threshold\s*:\s*(-?\d+(?:\.\d+)?)\s*,\s*delta\s*:\s*(-?\d+(?:\.\d+)?)\s*,\s*core\s*:\s*(-?\d+(?:\.\d+)?)\s*,\s*uncore\s*:\s*(-?\d+(?:\.\d+)?)/i;

/** 是否为 powerCap 输出（供自动识别） */
export function looksLikePowerCap(text: string): boolean {
  return LINE_RE.test(text.split(/\r?\n/).find((l) => l.trim().startsWith('power')) ?? '');
}

export function parsePowerCap(text: string): PowerCapSnapshot {
  const samples: PowerCapSample[] = [];
  for (const rawLine of (text || '').split(/\r?\n/)) {
    const m = rawLine.trim().match(LINE_RE);
    if (!m) continue;
    samples.push({
      power: Number(m[1]),
      threshold: Number(m[2]),
      delta: Number(m[3]),
      core: Number(m[4]),
      uncore: Number(m[5]),
    });
  }
  return { samples, hasData: samples.length > 0 };
}

/** 该命令可采集的指标 id */
export const POWERCAP_METRICS = ['power', 'core', 'uncore'] as const;

/** 指标 id 的可读名 */
export function powerCapMetricLabel(metric: string): string {
  switch (metric) {
    case 'power': return '功耗';
    case 'core': return 'core 频率';
    case 'uncore': return 'uncore 频率';
    case 'threshold': return '封顶阈值';
    case 'delta': return '偏差';
    default: return metric;
  }
}
