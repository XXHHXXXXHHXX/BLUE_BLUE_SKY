/** LiteOS `power 0` 输出解析器
 *
 * 输出结构（一次命令返回整机快照）：
 *   the Psocket num = 2
 *   --------------------Psocket : 0--------------------
 *   power domain TA_CORE_DVFS   : on the chip
 *         volt      =     871 mV
 *         curr      =    8036 mA
 *         power     =    7000 mW
 *         temp      =      77.2 ceLsius(3502 Kelvin)
 *   ...
 *   the total real power domain num = 6, psocket totalPwr = 168846 mW
 *   ...
 *   the board all cpu power consumption is 289464 mW
 *
 * 只取 power（mW），其余测量项（volt/curr/temp）与静态属性（type/die）丢弃。
 * 任何缺失指标不产出采样点（不写 0 / NaN）。
 */

export interface Power0Domain {
  /** 域功耗，单位 mW；该域未出现在输出中时为 undefined */
  power?: number;
}

export interface Power0Socket {
  index: number;
  /** psocket totalPwr（mW） */
  totalPwr?: number;
  domains: Record<string, Power0Domain>;
}

export interface Power0Snapshot {
  /** 输出声明的 socket 数 */
  socketCount?: number;
  /** 整板合计功耗（mW） */
  boardTotal?: number;
  sockets: Power0Socket[];
  /** 是否解析到任何有效功耗数据 */
  hasData: boolean;
  /** 完整性校验：Σ(socket.totalPwr) 与 boardTotal 是否一致；数据不全时为 undefined */
  consistent?: boolean;
}

const NUM_RE = /-?\d+(?:\.\d+)?/;

function pickNumber(text: string): number | undefined {
  const m = text.match(NUM_RE);
  if (!m) return undefined;
  const n = Number(m[0]);
  return Number.isNaN(n) ? undefined : n;
}

/** 解析一次 `power 0` 的完整输出 */
export function parsePower0(text: string): Power0Snapshot {
  const snapshot: Power0Snapshot = { sockets: [], hasData: false };
  let socket: Power0Socket | null = null;
  let domain: Power0Domain | null = null;

  for (const rawLine of (text || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    let m: RegExpMatchArray | null;

    // 顶部：socket 数量
    if ((m = line.match(/the Psocket num\s*=\s*(\d+)/i))) {
      snapshot.socketCount = Number(m[1]);
      continue;
    }

    // 新 socket 段
    if ((m = line.match(/^-+Psocket\s*:\s*(\d+)-*$/i))) {
      socket = { index: Number(m[1]), domains: {} };
      snapshot.sockets.push(socket);
      domain = null;
      continue;
    }

    // 新电源域段
    if ((m = line.match(/^power domain\s+(\S+)\s*:/i))) {
      domain = {};
      if (socket) socket.domains[m[1]] = domain;
      continue;
    }

    // socket 合计（必须先于域内字段判定，否则会被 domain 上下文吞掉）
    if (socket && (m = line.match(/psocket totalPwr\s*=\s*(\d+)\s*mW/i))) {
      socket.totalPwr = Number(m[1]);
      domain = null;
      continue;
    }

    // 整板合计
    if ((m = line.match(/the board all cpu power consumption is\s*(\d+)\s*mW/i))) {
      snapshot.boardTotal = Number(m[1]);
      domain = null;
      continue;
    }

    // 域内测量项：只关心 power
    if (domain) {
      if ((m = line.match(/^power\s*=\s*(.+)$/i))) {
        const v = pickNumber(m[1]);
        if (v !== undefined) domain.power = v;
      }
      // 其它字段（type/die/volt/curr/temp/pmbusErr/avsbusErr）忽略
    }
  }

  // 清理空 socket（例如仅有分隔线无域数据）
  snapshot.sockets = snapshot.sockets.filter((s) => s.totalPwr !== undefined || Object.keys(s.domains).length > 0);

  snapshot.hasData = snapshot.boardTotal !== undefined
    || snapshot.sockets.some((s) => s.totalPwr !== undefined || Object.values(s.domains).some((d) => d.power !== undefined));

  const totals = snapshot.sockets.map((s) => s.totalPwr);
  if (snapshot.boardTotal !== undefined && totals.length > 0 && totals.every((t) => t !== undefined)) {
    const sum = totals.reduce<number>((a, b) => a + (b as number), 0);
    // 允许极小误差（设备侧为整数 mW，理论上严格相等）
    snapshot.consistent = Math.abs(sum - snapshot.boardTotal) <= 1;
  }

  return snapshot;
}

/** 从快照中按指标 id 取值
 * 指标 id：'board' | `s${index}.total` | `s${index}.${domain}`
 */
export function getPower0Metric(snapshot: Power0Snapshot, metric: string): number | undefined {
  if (metric === 'board') return snapshot.boardTotal;
  const m = metric.match(/^s(\d+)\.(.+)$/);
  if (!m) return undefined;
  const socketIdx = Number(m[1]);
  const rest = m[2];
  const socket = snapshot.sockets.find((s) => s.index === socketIdx);
  if (!socket) return undefined;
  if (rest === 'total') return socket.totalPwr;
  return socket.domains[rest]?.power;
}

/** 列出快照中实际出现的全部指标 id（供 UI「全部指标」选项） */
export function listPower0Metrics(snapshot: Power0Snapshot): string[] {
  const metrics: string[] = [];
  if (snapshot.boardTotal !== undefined) metrics.push('board');
  for (const socket of snapshot.sockets) {
    if (socket.totalPwr !== undefined) metrics.push(`s${socket.index}.total`);
    for (const name of Object.keys(socket.domains)) {
      if (socket.domains[name].power !== undefined) metrics.push(`s${socket.index}.${name}`);
    }
  }
  return metrics;
}
