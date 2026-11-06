/** BMC SOL 串口监控 - 通过 BMC SSH 打开 SOL 会话，按 UART 周期下发 LiteOS 命令并采集电源域功耗
 *
 * 与既有持续模式（nohup + kill）的区别：SOL 会话是本进程持有的双工流，
 * 结束时先发 Ctrl-C / deactivate 再销毁通道，不依赖远端信号继承行为。
 *
 * 采集模型：
 *   - send 模式：写命令 → 正则匹配提示符（空闲补空行催提示符）→ 解析 → 立即发下一条
 *   - observe 模式（AP 串口，无 LiteOS 提示符）：只读流，按窗口聚合，从不写入
 *
 * 串口流只有一个常驻 data 监听器：所有输出先进入 buffer，
 * 由当前 pending 请求判断是否命中提示符，避免每条命令反复增删监听器。
 */

import fs from 'fs';
import path from 'path';
import { NodeSSH } from 'node-ssh';
import type { ClientChannel } from 'ssh2';
import {
  DEFAULT_SERIAL_PROMPT,
  DEFAULT_SERIAL_UART_REGISTER,
  SERIAL_SOL_ACTIVATE,
  SERIAL_SOL_DEACTIVATE,
  SERIAL_UART_PRESETS,
  isCommandAllowedOnUart,
  serialCommandPreset,
  type SerialCommandKind,
  type SerialMonitorConfig,
  type SerialUartId,
} from '../../../../../src/types/serial';
import {
  getPower0Metric,
  listPower0Metrics,
  parsePower0,
  type Power0Snapshot,
} from '../../../../../src/utils/power0Parser';
import {
  POWERCAP_METRICS,
  parsePowerCap,
} from '../../../../../src/utils/powerCapParser';

export interface SerialMonitorBmcConfig {
  host: string;
  port: number;
  username: string;
  password: string;
}

export interface SerialMonitorOptions {
  jobId: string;
  commandId: string;
  commandName: string;
  config: SerialMonitorConfig;
  bmcConfig: SerialMonitorBmcConfig;
  /** 服务器本地日志目录（.data/logs/<jobId>/[<stageId>/]iteration-<n>） */
  logDir: string;
  onLog?: (level: 'info' | 'warning' | 'error', message: string) => void;
}

/** 采集样本：无 raw（原始输出不落盘，仅保留解析结果） */
export interface SerialDataPoint {
  timestamp: string;
  value: number;
  raw: string;
}

export interface SerialMetricSeries {
  /** 指标 id（board / sN.total / sN.<domain>） */
  metric: string;
  points: SerialDataPoint[];
}

interface SendResult {
  text: string;
  /** prompt=命中提示符；fallback=预算耗尽（输出可能被截断） */
  via: 'prompt' | 'fallback';
}

interface PendingSend {
  seq: number;
  mark: number;
  expectRe: RegExp;
  /** 命令下发后是否已收到任何输出（未收到前不补空行，避免催出上一轮残留提示符） */
  sawOutput: boolean;
  resolve: (result: SendResult) => void;
  reject: (err: Error) => void;
}

const IDLE_NUDGE_MS = 300;
const MAX_NUDGES = 3;
const SEND_BUDGET_MS = 5000;
/** 连续解析失败多少次后停止采集（命令配置错误时避免空转占用串口） */
const MAX_PARSE_FAILURES = 50;

/** 命令结束符：LiteOS 串口只需 CR。
 * 用 `\r\n` 时 `\n` 会被当作下一行的首个输入，命令变成 `\npower 0\r`，
 * LiteOS 将 `power` 与参数拆开执行，输出 `power:command not found`。 */
const SERIAL_LINE_ENDING = '\r';

export class SerialMonitor {
  private readonly options: SerialMonitorOptions;
  /** 采集指标；null 表示自动发现（按首轮输出决定），发现后固定下来 */
  private metrics: string[] | null;

  private ssh: NodeSSH | null = null;
  private stream: ClientChannel | null = null;

  /** 串口原始输出缓冲（定界用） */
  private buffer = '';
  /** 每次 send 的序号，用于丢弃迟到输出 */
  private seq = 0;
  private pending: PendingSend | null = null;
  private streamClosed = false;

  private running = false;
  private currentUart: SerialUartId | null = null;

  private loopPromise: Promise<void> | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  /** 列式存储：metric → { 时间偏移(ms), 值 } */
  private columns = new Map<string, { t: number[]; v: number[] }>();
  private startTs = 0;
  private sinceSnapshot = 0;
  private lastSnapshot: Power0Snapshot | null = null;
  /** 命令类型：power0/powerCap 解析入库；custom 仅原样记录日志 */
  private readonly kind: SerialCommandKind;
  /** custom 命令的原始输出流（仅在 custom 模式下创建） */
  private rawLogStream: fs.WriteStream | null = null;
  private rawLogChunks = 0;
  /** 连续解析失败计数与上次告警时间（日志限流用） */
  private parseFailureCount = 0;
  private lastParseFailureLogAt = 0;

  constructor(options: SerialMonitorOptions) {
    this.options = options;
    this.metrics = options.config.metrics && options.config.metrics.length > 0
      ? options.config.metrics
      : null;
    this.kind = options.config.kind
      ?? (/^\s*powercap\b/i.test(options.config.command ?? '') ? 'powerCap' : 'power0');
  }

  private log(level: 'info' | 'warning' | 'error', message: string) {
    this.options.onLog?.(level, message);
  }

  /** 解析失败日志限流：背靠背采集下每秒数十条会刷满任务日志上限 */
  private logParseFailure(kind: string, text: string, via: SendResult['via']) {
    this.parseFailureCount++;
    const now = Date.now();
    const first = this.parseFailureCount === 1;
    // 首次立即输出（便于定位），之后每 30 秒汇总一次
    if (!first && now - this.lastParseFailureLogAt < 30_000) return;
    this.lastParseFailureLogAt = now;
    const detail = first ? `；输出片段: ${JSON.stringify(text.replace(/\s+/g, ' ').trim().slice(0, 120))}` : '';
    this.log(
      'warning',
      `串口监控未解析到${kind}数据（via=${via}，累计 ${this.parseFailureCount} 次${detail}）`
    );

    // 持续解析失败时直接终止，避免无意义地占用串口
    if (this.parseFailureCount >= MAX_PARSE_FAILURES) {
      this.log('error', `串口监控连续 ${this.parseFailureCount} 次解析失败，已停止采集，请检查命令是否正确`);
      this.running = false;
    }
  }

  private get logFilePath(): string {
    return path.join(this.options.logDir, `serial-${this.options.commandId}.json`);
  }

  /** 建立 SSH 连接、激活 SOL、切换到目标 UART，然后开始采集循环 */
  async start(): Promise<void> {
    const cfg = this.options.config;

    // 命令类型与 UART 的绑定关系在连接前校验，避免占用串口后才发现配置错误
    if (!isCommandAllowedOnUart(this.kind, cfg.uart)) {
      const forbidden = serialCommandPreset(this.kind);
      throw new Error(
        `命令「${forbidden.label}」不支持 ${uartLabel(cfg.uart)}，仅支持 ${forbidden.uarts.map(uartLabel).join(' / ')}`
      );
    }
    this.ssh = new NodeSSH();
    await withTimeout(
      this.ssh.connect({
        host: this.options.bmcConfig.host,
        port: this.options.bmcConfig.port || 22,
        username: this.options.bmcConfig.username,
        password: this.options.bmcConfig.password,
        readyTimeout: 30000,
      }),
      45000,
      '串口监控 SSH 连接'
    );

    fs.mkdirSync(this.options.logDir, { recursive: true });

    this.stream = await this.openExecStream(SERIAL_SOL_ACTIVATE, 30000, '串口 SOL 激活');
    this.attachStream();
    this.startTs = Date.now();
    this.log('info', `SOL 会话已激活（UART ${cfg.uart} / ${uartLabel(cfg.uart)}）`);

    await this.switchUart(cfg.uart);

    const preset = SERIAL_UART_PRESETS.find((p) => p.id === cfg.uart);
    if (preset?.mode === 'observe') {
      this.log('info', 'AP 串口为只读观察模式，不下发命令');
      this.running = true;
      this.startObserveLoop();
      return;
    }

    const command = (this.kind === 'custom'
      ? cfg.command
      : serialCommandPreset(this.kind).command)?.trim();
    if (!command) {
      throw new Error(this.kind === 'custom' ? '自定义串口命令不能为空' : `命令「${serialCommandPreset(this.kind).label}」缺少命令内容`);
    }

    // 连上后先发一个换行并等提示符回来，确认串口处于干净的行首：
    // 激活阶段的残字节（如未处理的按键）会让首条命令被拼接成非法形态。
    await this.syncPrompt();

    this.running = true;
    this.loopPromise = this.runSendLoop(command);
  }

  /** 停止采集并关闭 SOL 会话 */
  async stop(): Promise<void> {
    this.running = false;
    this.settlePending('fallback');

    try {
      await this.loopPromise;
    } catch {
      /* 循环内已记录 */
    }
    this.loopPromise = null;
    this.settlePending('fallback');

    // 尽力让通道退出交互态，再发 deactivate
    try {
      this.stream?.write('\u0003');
    } catch { /* ignore */ }

    this.persistSnapshot();

    try {
      if (this.ssh) {
        await withTimeout(this.ssh.execCommand(SERIAL_SOL_DEACTIVATE), 15000, '串口 SOL 关闭');
      }
    } catch (err) {
      this.log('warning', `SOL 会话关闭失败: ${err instanceof Error ? err.message : String(err)}`);
    }

    try {
      this.stream?.close();
    } catch { /* ignore */ }
    this.stream = null;
    this.streamClosed = true;

    try { this.ssh?.dispose(); } catch { /* ignore */ }
    this.ssh = null;

    if (this.rawLogStream) {
      const stream = this.rawLogStream;
      this.rawLogStream = null;
      await new Promise<void>((resolve) => stream.end(resolve));
      this.log('info', `串口原始日志已保存，共 ${this.rawLogChunks} 段`);
    }

    this.log('info', `串口监控已停止，共 ${this.sampleCount()} 个采样点`);
  }

  /** 采集结果：每个指标一条序列（指标集合在首轮输出后自动确定） */
  results(): SerialMetricSeries[] {
    const out: SerialMetricSeries[] = [];
    for (const [metric, col] of this.columns) {
      if (col.t.length === 0) continue;
      out.push({
        metric,
        points: col.t.map((offset, i) => ({
          timestamp: new Date(this.startTs + offset).toISOString(),
          value: col.v[i],
          raw: '',
        })),
      });
    }
    return out;
  }

  /** 最近一次解析的快照（调试/校验用） */
  lastPower0Snapshot(): Power0Snapshot | null {
    return this.lastSnapshot;
  }

  // ========== 流监听 ==========

  /** 为 SOL 通道挂常驻监听器（整个生命周期只挂一次） */
  private attachStream(): void {
    const stream = this.stream;
    if (!stream) return;

    stream.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString('utf8');
      const pending = this.pending;
      if (!pending) return;
      pending.sawOutput = true;
      const segment = this.buffer.slice(pending.mark);
      // 只对缓冲区尾部做正则，避免长输出反复扫描
      const tail = segment.length <= 128 ? segment : segment.slice(-128);
      if (pending.expectRe.test(tail)) this.settlePending('prompt');
    });

    stream.on('error', (err: Error) => {
      this.streamClosed = true;
      if (this.pending) {
        const pending = this.pending;
        this.pending = null;
        pending.reject(err);
      }
      this.log('warning', `SOL 通道错误: ${err.message}`);
    });

    stream.on('close', () => {
      this.streamClosed = true;
      if (this.pending) {
        const pending = this.pending;
        this.pending = null;
        pending.reject(new Error('SOL 通道已关闭'));
      }
    });
  }

  /** 完成当前 pending 请求（命中提示符、预算耗尽或停止） */
  private settlePending(via: SendResult['via']): void {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    pending.resolve({ text: this.buffer.slice(pending.mark), via });
  }

  // ========== 会话控制 ==========

  /** 用 NodeSSH 底层连接打开一个可读写的 exec 通道 */
  private openExecStream(command: string, timeoutMs: number, label: string): Promise<ClientChannel> {
    const connection = this.ssh?.connection;
    if (!connection) {
      return Promise.reject(new Error(`${label}: SSH 连接不可用`));
    }
    return new Promise<ClientChannel>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${label}超时`)), timeoutMs);
      connection.exec(command, (err: Error | undefined, stream: ClientChannel) => {
        clearTimeout(timer);
        if (err) reject(err);
        else resolve(stream);
      });
    });
  }

  /** 切换 UART：清空跨串口的残留缓冲并等待新串口就绪 */
  private async switchUart(target: SerialUartId): Promise<void> {
    if (this.currentUart === target) return;

    await withTimeout(
      this.ssh!.execCommand(
        `bash -l -c "source /etc/profile; mdbctl call Smc_CpuBrdSMC_010101 bmc.kepler.Chip.BlockIO Write 0 ${DEFAULT_SERIAL_UART_REGISTER} 1 0x${target.toString(16)}"`
      ),
      30000,
      '串口 UART 切换'
    );

    await sleep(this.options.config.uartSettleMs ?? 1000);

    // 丢弃切换过程中上一路串口的残留输出，作废在途请求
    this.settlePending('fallback');
    this.buffer = '';
    this.seq++;
    this.currentUart = target;
    this.log('info', `已切换 UART 至 0x${target.toString(16)}（${uartLabel(target)}）`);
  }

  // ========== 采集循环 ==========

  private async runSendLoop(command: string): Promise<void> {
    const minInterval = this.options.config.minIntervalMs ?? 0;
    const expect = this.options.config.expect ?? DEFAULT_SERIAL_PROMPT;

    while (this.running && !this.streamClosed) {
      const startedAt = Date.now();
      try {
        const result = await this.sendAndWait(command, expect);
        // 停止时被强制收尾的请求（输出为空）不计入统计
        if (this.running) this.handleSnapshot(result);
      } catch (err) {
        if (!this.running) break;
        this.log('warning', `串口命令 [${command}] 执行失败: ${err instanceof Error ? err.message : String(err)}`);
        await sleep(500);
      }

      if (minInterval > 0) {
        const wait = minInterval - (Date.now() - startedAt);
        if (wait > 0) await sleep(wait);
      }
    }
  }

  private startObserveLoop(): void {
    const windowMs = Math.max(500, this.options.config.minIntervalMs || 1000);
    this.loopPromise = (async () => {
      while (this.running && !this.streamClosed) {
        this.buffer = '';
        await sleep(windowMs);
        if (!this.running) break;
        const text = this.buffer;
        this.buffer = '';
        if (!text.trim()) continue;

        const matches = [...text.matchAll(/-?\d+(?:\.\d+)?/g)];
        if (matches.length === 0) continue;
        const value = Number(matches[matches.length - 1][0]);
        if (Number.isNaN(value)) continue;

        this.appendMetricAt('board', Date.now() - this.startTs, value);
        this.sinceSnapshot++;
        this.maybePersist();
      }
    })();
  }

  /** 发送空行并等回提示符，清掉上一阶段可能残留的输入，确保从干净行首开始 */
  private async syncPrompt(): Promise<void> {
    const expect = this.options.config.expect ?? DEFAULT_SERIAL_PROMPT;
    try {
      const result = await this.sendAndWait('', expect);
      if (result.via !== 'prompt') {
        this.log('warning', '串口首行同步未收到提示符，可能仍有残留输入');
      }
      // 丢弃同步阶段的输出，避免被当作第一条命令的结果
      this.buffer = '';
    } catch (err) {
      this.log('warning', `串口首行同步失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** 写入命令并等待提示符（事件驱动 + 空闲补空行催提示符） */
  private sendAndWait(command: string, expect: string): Promise<SendResult> {
    const stream = this.stream;
    if (!stream || this.streamClosed) {
      return Promise.reject(new Error('SOL 通道未就绪'));
    }

    const seq = this.seq + 1;
    this.seq = seq;
    // 上一条若仍未结束，先按 fallback 收尾，保证只有一个 pending
    this.settlePending('fallback');

    const mark = this.buffer.length;
    stream.write(`${command}${SERIAL_LINE_ENDING}`);

    return new Promise<SendResult>((resolve, reject) => {
      const pending: PendingSend = {
        seq,
        mark,
        expectRe: new RegExp(expect),
        sawOutput: false,
        resolve,
        reject,
      };
      this.pending = pending;

      let lastActivity = Date.now();
      let nudges = 0;

      // 补空行：仅在命令已产生输出后触发，避免提前催出残留提示符
      const nudgeTimer = setInterval(() => {
        if (this.pending !== pending) return;
        if (!pending.sawOutput) return;
        if (Date.now() - lastActivity < IDLE_NUDGE_MS) return;
        if (nudges >= MAX_NUDGES) {
          this.settlePending('fallback');
          return;
        }
        nudges++;
        try {
          stream.write(SERIAL_LINE_ENDING);
        } catch {
          /* ignore */
        }
        lastActivity = Date.now();
      }, 50);

      const budgetTimer = setTimeout(() => {
        if (this.pending === pending) this.settlePending('fallback');
      }, SEND_BUDGET_MS);

      const originalResolve = pending.resolve;
      pending.resolve = (result) => {
        clearInterval(nudgeTimer);
        clearTimeout(budgetTimer);
        originalResolve(result);
      };
      const originalReject = pending.reject;
      pending.reject = (err) => {
        clearInterval(nudgeTimer);
        clearTimeout(budgetTimer);
        originalReject(err);
      };
    });
  }

  // ========== 采样落库 ==========

  /** 按命令类型分发：custom 只记录原始输出，不解析 */
  private handleSnapshot(result: SendResult) {
    const text = stripEcho(result.text);
    if (this.kind === 'custom') {
      this.appendRawLog(text);
    } else if (this.kind === 'powerCap') {
      this.handlePowerCap(text, result.via);
    } else {
      this.handlePower0(text, result.via);
    }
  }

  /** 解析一次 power 0 输出，按指标追加采样点 */
  private handlePower0(text: string, via: SendResult['via']) {
    const snapshot = parsePower0(text);
    this.lastSnapshot = snapshot;

    if (!snapshot.hasData) {
      this.logParseFailure(' power 0 ', text, via);
      return;
    }
    if (snapshot.consistent === false) {
      this.log(
        'warning',
        `串口监控完整性校验失败：socket 合计 ${snapshot.sockets.map((s) => s.totalPwr ?? '-').join('+')} ≠ 整板 ${snapshot.boardTotal}`
      );
      return;
    }

    // 未显式配置指标时，用首轮快照的实际指标集合（不同机型域名/ socket 数差异很大）
    if (this.metrics === null) {
      this.metrics = listPower0Metrics(snapshot);
      if (this.metrics.length === 0) {
        this.log('warning', '串口监控解析到数据，但未发现可用指标');
        return;
      }
      this.log('info', `串口监控自动发现 ${this.metrics.length} 个指标: ${this.metrics.join(', ')}`);
    }

    const offset = Date.now() - this.startTs;
    let appended = 0;
    for (const metric of this.metrics) {
      const value = getPower0Metric(snapshot, metric);
      if (value === undefined) continue;
      this.appendMetricAt(metric, offset, value);
      appended++;
    }
    if (appended === 0) {
      this.log('warning', '串口监控解析到数据，但所选指标均无值，请检查指标配置');
      return;
    }

    this.parseFailureCount = 0;
    this.sinceSnapshot++;
    this.maybePersist();
  }

  /** 解析一次 powerCap 输出：每行一次采样，默认只取最后一行（最新结果） */
  private handlePowerCap(text: string, via: SendResult['via']) {
    const snapshot = parsePowerCap(text);
    if (!snapshot.hasData) {
      this.logParseFailure(' powerCap ', text, via);
      return;
    }

    if (this.metrics === null) {
      this.metrics = [...POWERCAP_METRICS];
      this.log('info', `串口监控采集 powerCap 指标: ${this.metrics.join(', ')}`);
    }

    // 默认取全部行：powerCap 窗口刷新远快于命令往返，各行均为新数据
    const take = this.options.config.samples ?? 0;
    const picked = take > 0 ? snapshot.samples.slice(-take) : snapshot.samples;
    // 同一次输出的多行按 1 秒等间隔回溯，最后一行对齐当前时刻
    const now = Date.now() - this.startTs;
    let appended = 0;
    picked.forEach((sample, i) => {
      const offset = now - (picked.length - 1 - i) * 1000;
      for (const metric of this.metrics!) {
        const value = (sample as Record<string, number | undefined>)[metric];
        if (typeof value !== 'number') continue;
        this.appendMetricAt(metric, offset, value);
        appended++;
      }
    });
    if (appended === 0) {
      this.log('warning', '串口监控解析到 powerCap 数据，但所选指标均无值，请检查指标配置');
      return;
    }

    this.parseFailureCount = 0;
    this.sinceSnapshot++;
    this.maybePersist();
  }

  /** custom 命令：原始输出按时间戳追加到 .log，不解析、不产采样点 */
  private appendRawLog(text: string) {
    if (!text.trim()) return;
    try {
      if (!this.rawLogStream) {
        fs.mkdirSync(this.options.logDir, { recursive: true });
        this.rawLogStream = fs.createWriteStream(
          path.join(this.options.logDir, `serial-${this.options.commandId}.log`),
          { flags: 'a' }
        );
      }
      const stamp = new Date().toISOString();
      this.rawLogStream.write(`===== ${stamp} =====\n${text.trimEnd()}\n`);
      this.rawLogChunks++;
    } catch (err) {
      this.log('warning', `串口原始日志写入失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private appendMetricAt(metric: string, offsetMs: number, value: number) {
    let col = this.columns.get(metric);
    if (!col) {
      col = { t: [], v: [] };
      this.columns.set(metric, col);
    }
    col.t.push(offsetMs);
    col.v.push(value);
  }

  private sampleCount(): number {
    let n = 0;
    for (const col of this.columns.values()) n = Math.max(n, col.t.length);
    return n;
  }

  private maybePersist() {
    const every = this.options.config.snapshotEvery ?? 500;
    if (every > 0 && this.sinceSnapshot >= every) {
      this.persistSnapshot();
    }
  }

  /** 列式快照落盘：异常中止时最多丢失 snapshotEvery 个样本 */
  private persistSnapshot() {
    this.sinceSnapshot = 0;
    if (this.columns.size === 0) return;
    try {
      const series: Record<string, { t: number[]; v: number[] }> = {};
      for (const [metric, col] of this.columns) series[metric] = col;
      const payload = {
        commandId: this.options.commandId,
        commandName: this.options.commandName,
        uart: this.options.config.uart,
        unit: 'mW',
        startedAt: new Date(this.startTs).toISOString(),
        updatedAt: new Date().toISOString(),
        series,
      };
      fs.writeFileSync(this.logFilePath, JSON.stringify(payload), 'utf-8');
    } catch (err) {
      this.log('warning', `串口监控落盘失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

function uartLabel(id: SerialUartId): string {
  return SERIAL_UART_PRESETS.find((p) => p.id === id)?.label ?? `UART ${id}`;
}

/** 去掉命令回显与尾部提示符（定界用的 `Huawei LiteOS #` 会带进输出段） */
function stripEcho(text: string): string {
  const lines = text.split(/\r?\n/);
  const first = lines.findIndex((l) => l.trim() !== '');
  if (first >= 0 && /LiteOS\s*#/.test(lines[first])) {
    lines.splice(first, 1);
  }
  while (lines.length > 0) {
    const last = lines[lines.length - 1];
    if (!/LiteOS\s*#/.test(last) && last.trim() !== '') break;
    lines.pop();
  }
  return lines.join('\n');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}超时（超过 ${Math.round(timeoutMs / 1000)} 秒）`)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}
