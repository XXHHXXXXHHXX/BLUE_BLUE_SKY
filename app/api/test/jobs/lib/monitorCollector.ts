/** 监控命令采集器 - 供火眼模式等非 run.sh 执行路径复用
 *
 * 与 jobRunner 内的监控逻辑保持一致：
 *  - SSH 轮询（单值 / list 多列）
 *  - 持续模式（迭代前启动命令，结束后先终止进程再执行获取命令）
 *  - 串口（BMC SOL）采集
 *  - 采样点过滤（跳过前 N / 只取最后 M / 跳过最后 K / 跳变过滤 / 排除 0）
 */
import { NodeSSH } from 'node-ssh';
import { SerialMonitor } from './serialMonitor';
import { templateSnapshotOf } from '../../../../../src/types/serial';
import { loadUserSerialTemplates } from '../../../../../src/server/storage/serialTemplateStore';
import { compileTemplateSnapshot } from '../../../../../src/server/serialTemplateCompiler';
import type { CompiledSerialTemplate } from '../../../../../src/utils/serialTemplateContract';
import type { JobConfig } from './jobStore';

type MonitorCommand = NonNullable<JobConfig['monitorCommands']>[number];

export interface MonitorDataPoint {
  timestamp: string;
  value: number;
  raw: string;
}

export interface MonitorResultValue {
  commandId: string;
  commandName: string;
  dataPoints: MonitorDataPoint[];
  averageValue: number;
}

interface MonitorState {
  dataPoints: MonitorDataPoint[];
  columnDataPoints?: MonitorDataPoint[][];
  intervalId: ReturnType<typeof setInterval> | null;
  ssh?: NodeSSH;
  remotePid?: string | null;
  serialMonitor?: SerialMonitor;
  /** 串口采集使用的解析模板（用于指标显示名） */
  serialCompiled?: CompiledSerialTemplate;
}

export interface MonitorCollectorOptions {
  jobId: string;
  host: string;
  port: number;
  username: string;
  password: string;
  /** 本轮采样点/串口日志落盘目录 */
  logDir: string;
  suppressMonitorLogs?: boolean;
  onLog: (type: string, message: string) => void;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label}超时（超过 ${Math.round(timeoutMs / 1000)} 秒）`));
    }, timeoutMs);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function buildContinuousStartCommand(pidFile: string, startCommand: string): string {
  const trimmed = startCommand.trim();
  const isSimpleCommand = !/[;|&()<>\n]/.test(trimmed);
  const inner = isSimpleCommand
    ? `echo $$ > ${pidFile}; exec ${trimmed}`
    : `echo $$ > ${pidFile}; ${trimmed}`;
  return `nohup bash -c ${shellQuote(inner)} > /dev/null 2>&1 &`;
}

const parseNumericOutput = (stdout: string): { value: number; raw: string } => {
  const raw = stdout.trim().split('\n')[0] || '';
  const numMatch = raw.match(/-?\d+(?:\.\d+)?/);
  return { value: numMatch ? parseFloat(numMatch[0]) : NaN, raw };
};

const parseListOutput = (stdout: string): { values: number[]; raw: string } => {
  const raw = stdout.trim().split('\n')[0] || '';
  const values = raw.split(',').map((s) => {
    const numMatch = s.trim().match(/-?\d+(?:\.\d+)?/);
    return numMatch ? parseFloat(numMatch[0]) : NaN;
  });
  return { values, raw };
};

const parseContinuousOutput = (
  stdout: string,
  mode: 'single' | 'list',
): { points: MonitorDataPoint[]; columnPoints: MonitorDataPoint[][] } => {
  const points: MonitorDataPoint[] = [];
  const columnPoints: MonitorDataPoint[][] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const timestamp = new Date().toISOString();
    if (mode === 'list') {
      const cells = trimmed.split(',').map((s) => s.trim());
      while (columnPoints.length < cells.length) columnPoints.push([]);
      cells.forEach((cell, ci) => {
        const numMatch = cell.match(/-?\d+(?:\.\d+)?/);
        columnPoints[ci].push({ timestamp, value: numMatch ? parseFloat(numMatch[0]) : NaN, raw: trimmed });
      });
    } else {
      const { value, raw } = parseNumericOutput(trimmed);
      points.push({ timestamp, value, raw });
    }
  }
  return { points, columnPoints };
};

const filterByPosition = (
  points: MonitorDataPoint[],
  skipFirst: number,
  takeLast: number,
  skipLast: number,
): MonitorDataPoint[] => {
  if (skipFirst <= 0 && takeLast <= 0 && skipLast <= 0) return points;
  let result = points;
  if (skipFirst > 0) result = result.slice(skipFirst);
  if (takeLast > 0 && result.length > takeLast) result = result.slice(-takeLast);
  if (skipLast > 0 && result.length > skipLast) result = result.slice(0, result.length - skipLast);
  return result;
};

const filterByJumps = (
  points: MonitorDataPoint[],
  threshold: number,
  thresholdType: 'percent' | 'absolute',
  skip: number,
): MonitorDataPoint[] => {
  if (points.length < 2 || threshold <= 0 || skip <= 0) return points;
  let jumpCount = 0;
  let startIndex = 0;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1].value;
    const curr = points[i].value;
    if (isNaN(prev) || isNaN(curr)) continue;
    const isJump = thresholdType === 'absolute'
      ? Math.abs(curr - prev) >= threshold
      : (prev === 0 ? Math.abs(curr) > 0.1 : Math.abs((curr - prev) / prev) * 100 >= threshold);
    if (isJump) {
      jumpCount++;
      if (jumpCount === skip + 1) {
        startIndex = i;
        break;
      }
    }
  }
  return points.slice(startIndex);
};

/** 监控采集器：start 启动全部启用命令，stop 汇总采样结果 */
export class MonitorCollector {
  private states = new Map<string, MonitorState>();
  private commands: MonitorCommand[] = [];

  constructor(private readonly options: MonitorCollectorOptions) {}

  private log(type: string, message: string) {
    this.options.onLog(type, message);
  }

  async start(commands: MonitorCommand[] | undefined): Promise<void> {
    const { host, port, username, password, jobId, logDir } = this.options;
    this.commands = (commands || []).filter((c) => c.enabled);

    for (const cmd of this.commands) {
      // ===== 串口（BMC SOL）监控 =====
      if (cmd.serial) {
        if (!cmd.bmcConfig) {
          this.log('warning', `监控 [${cmd.name}] 串口模式需要 BMC 会话，已跳过`);
          continue;
        }
        const userTemplates = loadUserSerialTemplates();
        let monitor: SerialMonitor;
        let compiled: CompiledSerialTemplate;
        try {
          const snapshot = templateSnapshotOf(cmd.serial, userTemplates);
          if (!snapshot) throw new Error('未选择串口解析模板');
          compiled = compileTemplateSnapshot(snapshot);
          monitor = new SerialMonitor({
            jobId,
            commandId: cmd.id,
            commandName: cmd.name,
            config: cmd.serial,
            bmcConfig: cmd.bmcConfig,
            logDir,
            userTemplates,
            onLog: (level, message) => this.log(level === 'error' ? 'error' : level, `监控 [${cmd.name}] ${message}`),
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.log('warning', `监控 [${cmd.name}]（串口模式）解析模板无效: ${msg}`);
          continue;
        }
        const state: MonitorState = {
          dataPoints: [],
          intervalId: null,
          serialMonitor: monitor,
          serialCompiled: compiled,
        };
        try {
          await monitor.start();
          this.states.set(cmd.id, state);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.log('warning', `监控 [${cmd.name}]（串口模式）启动失败: ${msg}`);
          await monitor.stop().catch(() => { /* ignore */ });
        }
        continue;
      }

      let monitorSsh: NodeSSH | null = null;
      try {
        monitorSsh = new NodeSSH();
        if (cmd.target === 'host') {
          await withTimeout(monitorSsh.connect({
            host,
            port: port || 22,
            username,
            password,
            readyTimeout: 30000,
          }), 45000, `监控 [${cmd.name}] SSH 连接`);
        } else if (cmd.target === 'bmc' && cmd.bmcConfig) {
          await withTimeout(monitorSsh.connect({
            host: cmd.bmcConfig.host,
            port: cmd.bmcConfig.port || 22,
            username: cmd.bmcConfig.username,
            password: cmd.bmcConfig.password,
            readyTimeout: 30000,
          }), 45000, `监控 [${cmd.name}] SSH 连接`);
        } else {
          monitorSsh.dispose();
          continue;
        }

        const isListMode = cmd.mode === 'list' && !!cmd.columns && cmd.columns.length > 0;
        const continuousStartCommand = cmd.continuous ? cmd.startCommand?.trim() : '';
        const state: MonitorState = {
          dataPoints: [],
          intervalId: null,
          ssh: monitorSsh,
          remotePid: null,
        };
        if (isListMode) {
          state.columnDataPoints = cmd.columns!.map(() => []);
        }

        if (continuousStartCommand) {
          try {
            const remotePidFile = `/tmp/blue_sky_monitor_${jobId}_${cmd.id}.pid`;
            const startCmd = buildContinuousStartCommand(remotePidFile, continuousStartCommand);
            const startResult = await withTimeout(monitorSsh.execCommand(startCmd), 30000, `监控 [${cmd.name}] 启动命令`);
            if (startResult.stderr && startResult.code !== 0) {
              throw new Error(startResult.stderr);
            }
            const pidRead = await withTimeout(monitorSsh.execCommand(`cat ${remotePidFile} 2>/dev/null`), 15000, `监控 [${cmd.name}] PID 读取`);
            state.remotePid = pidRead.stdout.trim() || null;
            this.log('info', `监控 [${cmd.name}]（持续模式）启动命令已后台运行${state.remotePid ? `（PID ${state.remotePid}）` : ''}`);
            this.states.set(cmd.id, state);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this.log('warning', `监控 [${cmd.name}]（持续模式）启动命令失败: ${msg}`);
            try { monitorSsh.dispose(); } catch { /* ignore */ }
          }
          continue;
        }

        const runMonitor = async () => {
          try {
            const result = await withTimeout(monitorSsh!.execCommand(cmd.command), 30000, `监控 [${cmd.name}] 采样`);
            const timestamp = new Date().toISOString();
            if (isListMode && state.columnDataPoints) {
              const { values, raw } = parseListOutput(result.stdout);
              for (let i = 0; i < state.columnDataPoints.length; i++) {
                state.columnDataPoints[i].push({ timestamp, value: values[i] ?? NaN, raw });
              }
              if (!this.options.suppressMonitorLogs) {
                this.log('monitor_sample', `监控 [${cmd.name}] 采样: ${raw}`);
              }
            } else {
              const { value, raw } = parseNumericOutput(result.stdout);
              state.dataPoints.push({ timestamp, value, raw });
              if (!this.options.suppressMonitorLogs) {
                this.log('monitor_sample', `监控 [${cmd.name}] 采样: ${raw}`);
              }
            }
          } catch {
            // 单次采样失败不影响主流程
          }
        };

        await runMonitor();
        state.intervalId = setInterval(runMonitor, cmd.interval * 1000);
        this.states.set(cmd.id, state);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.log('info', `监控命令 [${cmd.name}] 启动失败: ${msg}`);
        if (monitorSsh) {
          try { monitorSsh.dispose(); } catch { /* ignore */ }
        }
      }
    }
  }

  /** 终止持续模式监控的远程后台进程（SIGINT 优先，超时兜底 SIGKILL） */
  private async stopContinuousRemote(ssh: NodeSSH, remotePid: string | null | undefined, startCommand: string) {
    const pattern = (startCommand || '').split(/\s+/)[0];
    const pidTarget = remotePid || (pattern ? `$(pgrep -f "${pattern}" | head -1)` : '');
    if (!pidTarget) return;
    try {
      await withTimeout(ssh.execCommand(`kill -INT ${pidTarget} 2>/dev/null; pkill -INT -P ${pidTarget} 2>/dev/null; echo done`), 20000, '监控终止进程');
      for (let i = 0; i < 5; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        const alive = await withTimeout(ssh.execCommand(`kill -0 ${pidTarget} 2>/dev/null && echo alive || echo dead`), 15000, '监控进程存活检查');
        if (alive.stdout.trim() !== 'alive') return;
      }
      await withTimeout(ssh.execCommand(`kill -9 ${pidTarget} 2>/dev/null; pkill -9 -P ${pidTarget} 2>/dev/null; echo done`), 20000, '监控终止进程');
      this.log('warning', '监控（持续模式）进程未在超时内退出，已强制终止');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log('warning', `监控（持续模式）终止进程失败: ${msg}`);
    }
  }

  /** 停止全部监控并汇总采样结果 */
  async stop(): Promise<Record<string, MonitorResultValue>> {
    const results: Record<string, MonitorResultValue> = {};

    for (const [cmdId, state] of this.states) {
      try { if (state.intervalId) clearInterval(state.intervalId); } catch { /* ignore */ }
      const cmd = this.commands.find((c) => c.id === cmdId);
      if (!cmd) continue;

      const isContinuous = !!(cmd.continuous && cmd.startCommand && cmd.startCommand.trim());
      const isListMode = cmd.mode === 'list' && !!cmd.columns && cmd.columns.length > 0;

      if (state.serialMonitor) {
        await state.serialMonitor.stop().catch(() => { /* ignore */ });
        for (const { metric, points } of state.serialMonitor.results()) {
          let filtered = filterByPosition(points, cmd.skipFirst ?? 0, cmd.takeLast ?? 0, cmd.skipLast ?? 0);
          filtered = filterByJumps(filtered, cmd.jumpThreshold ?? 0, cmd.jumpThresholdType ?? 'percent', cmd.skipJumps ?? 0);
          const valid = filtered.filter((p) => !isNaN(p.value) && !(cmd.excludeZero && p.value === 0)).map((p) => p.value);
          const key = `${cmd.id}__serial__${metric}`;
          const label = state.serialCompiled ? state.serialCompiled.label(metric) : metric;
          results[key] = {
            commandId: key,
            commandName: `${cmd.name} - ${label}`,
            dataPoints: filtered,
            averageValue: valid.length > 0 ? valid.reduce((a, b) => a + b, 0) / valid.length : 0,
          };
        }
        if (state.serialMonitor.results().length === 0) {
          if (state.serialCompiled?.meta.raw) {
            this.log('info', `监控 [${cmd.name}]（串口模式）原始日志模板仅记录日志，无采样点`);
          } else {
            this.log('warning', `监控 [${cmd.name}]（串口模式）本轮未采集到数据`);
          }
        }
        continue;
      }

      if (isContinuous && state.ssh) {
        await this.stopContinuousRemote(state.ssh, state.remotePid, cmd.startCommand || '');
        await new Promise((r) => setTimeout(r, 1000));
        if (cmd.fetchCommand?.trim()) {
          try {
            const fetchResult = await withTimeout(state.ssh.execCommand(cmd.fetchCommand), 60000, `监控 [${cmd.name}] 结束命令`);
            const { points, columnPoints } = parseContinuousOutput(fetchResult.stdout || '', isListMode ? 'list' : 'single');
            if (isListMode && state.columnDataPoints) {
              for (let ci = 0; ci < state.columnDataPoints.length; ci++) {
                state.columnDataPoints[ci] = columnPoints[ci] || [];
              }
            } else {
              state.dataPoints = points;
            }
            this.log('info', `监控 [${cmd.name}]（持续模式）结束命令解析 ${isListMode ? (columnPoints[0]?.length || 0) : points.length} 个采样点`);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this.log('warning', `监控 [${cmd.name}]（持续模式）结束命令失败: ${msg}`);
          }
        }
      }

      try { state.ssh?.dispose(); } catch { /* ignore */ }

      if (isListMode && state.columnDataPoints) {
        for (let i = 0; i < cmd.columns!.length; i++) {
          const colPoints = state.columnDataPoints[i];
          let filtered = filterByPosition(colPoints, cmd.skipFirst ?? 0, cmd.takeLast ?? 0, cmd.skipLast ?? 0);
          filtered = filterByJumps(filtered, cmd.jumpThreshold ?? 0, cmd.jumpThresholdType ?? 'percent', cmd.skipJumps ?? 0);
          const valid = filtered.filter((p) => !isNaN(p.value) && !(cmd.excludeZero && p.value === 0)).map((p) => p.value);
          const key = `${cmd.id}__col__${i}`;
          results[key] = {
            commandId: key,
            commandName: `${cmd.name} - ${cmd.columns![i]}`,
            dataPoints: colPoints,
            averageValue: valid.length > 0 ? valid.reduce((a, b) => a + b, 0) / valid.length : 0,
          };
        }
      } else {
        const dataPoints = state.dataPoints;
        let filtered = filterByPosition(dataPoints, cmd.skipFirst ?? 0, cmd.takeLast ?? 0, cmd.skipLast ?? 0);
        filtered = filterByJumps(filtered, cmd.jumpThreshold ?? 0, cmd.jumpThresholdType ?? 'percent', cmd.skipJumps ?? 0);
        const valid = filtered.filter((p) => !isNaN(p.value) && !(cmd.excludeZero && p.value === 0)).map((p) => p.value);
        results[cmdId] = {
          commandId: cmd.id,
          commandName: cmd.name,
          dataPoints,
          averageValue: valid.length > 0 ? valid.reduce((a, b) => a + b, 0) / valid.length : 0,
        };
      }
    }

    this.states.clear();
    return results;
  }

  /** 中止：停止定时器、关闭串口会话、释放 SSH（不汇总） */
  async abort(): Promise<void> {
    const serialMonitors: SerialMonitor[] = [];
    for (const state of this.states.values()) {
      try { if (state.intervalId) clearInterval(state.intervalId); } catch { /* ignore */ }
      if (state.serialMonitor) serialMonitors.push(state.serialMonitor);
      try { state.ssh?.dispose(); } catch { /* ignore */ }
    }
    this.states.clear();
    await Promise.all(serialMonitors.map((m) => m.stop().catch(() => { /* ignore */ })));
  }
}
