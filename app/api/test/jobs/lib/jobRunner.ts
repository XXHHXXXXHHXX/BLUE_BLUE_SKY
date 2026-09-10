/** 后台测试任务执行器 - 从 power-test-stream 解耦 */
import { NodeSSH } from 'node-ssh';
import fs from 'fs';
import path from 'path';
import {
  getJob,
  updateJob,
  addJobLog,
  appendJobResult,
  registerJobRunner,
  unregisterJobRunner,
  requestAbortJob,
  forceSaveJobs,
  type JobConfig,
  type JobResult,
  type PipelineStage,
} from './jobStore';

/** 生成笛卡尔积迭代组合（支持从高到低和自定义列表） */
function generateIterations(
  params: JobConfig['iterationParams']
): Array<Record<string, string>> {
  if (params.length === 0) return [];

  const valuesList = params.map((p) => {
    if (p.mode === 'custom') {
      return p.values.filter((v) => v.trim() !== '');
    }
    const values: string[] = [];
    if (p.step <= 0 || p.start === p.end) return values;
    if (p.start < p.end) {
      const count = Math.floor((p.end - p.start) / p.step) + 1;
      for (let i = 0; i < count; i++) {
        values.push(String(p.start + i * p.step));
      }
    } else {
      const count = Math.floor((p.start - p.end) / p.step) + 1;
      for (let i = 0; i < count; i++) {
        values.push(String(p.start - i * p.step));
      }
    }
    return values;
  });

  const result: Array<Record<string, string>> = [];
  function cartesian(index: number, current: Record<string, string>) {
    if (index === params.length) {
      result.push({ ...current });
      return;
    }
    for (const val of valuesList[index]) {
      current[params[index].name] = val;
      cartesian(index + 1, current);
    }
  }
  cartesian(0, {});
  return result;
}

/** 对字符串做单引号包裹，防止 shell 解析空格/特殊字符 */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/** 解析命令输出中的数字 */
const parseNumericOutput = (stdout: string): { value: number; raw: string } => {
  const raw = stdout.trim().split('\n')[0] || '';
  let value = NaN;
  const numMatch = raw.match(/-?\d+(?:\.\d+)?/);
  if (numMatch) {
    value = parseFloat(numMatch[0]);
  }
  return { value, raw };
};

/** 解析 list 模式命令输出中的多个数字（逗号分隔） */
const parseListOutput = (stdout: string): { values: number[]; raw: string } => {
  const raw = stdout.trim().split('\n')[0] || '';
  const values = raw.split(',').map((s) => {
    const numMatch = s.trim().match(/-?\d+(?:\.\d+)?/);
    return numMatch ? parseFloat(numMatch[0]) : NaN;
  });
  return { values, raw };
};

/** 固定数量过滤：跳过前 N 个，只保留最后 M 个，再屏蔽最后 K 个 */
const filterByPosition = (
  points: Array<{ timestamp: string; value: number; raw: string }>,
  skipFirst: number,
  takeLast: number,
  skipLast: number
): Array<{ timestamp: string; value: number; raw: string }> => {
  if (skipFirst <= 0 && takeLast <= 0 && skipLast <= 0) return points;
  let result = points;
  if (skipFirst > 0) {
    result = result.slice(skipFirst);
  }
  if (takeLast > 0 && result.length > takeLast) {
    result = result.slice(-takeLast);
  }
  if (skipLast > 0 && result.length > skipLast) {
    result = result.slice(0, result.length - skipLast);
  }
  return result;
};

/** 基于跳变检测过滤采样点 */
const filterByJumps = (
  points: Array<{ timestamp: string; value: number; raw: string }>,
  threshold: number,
  thresholdType: 'percent' | 'absolute',
  skip: number
): Array<{ timestamp: string; value: number; raw: string }> => {
  if (points.length < 2 || threshold <= 0 || skip <= 0) return points;
  let jumpCount = 0;
  let startIndex = 0;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1].value;
    const curr = points[i].value;
    if (isNaN(prev) || isNaN(curr)) continue;
    let isJump = false;
    if (thresholdType === 'absolute') {
      isJump = Math.abs(curr - prev) >= threshold;
    } else {
      if (prev === 0) {
        isJump = Math.abs(curr) > 0.1;
      } else {
        isJump = Math.abs((curr - prev) / prev) * 100 >= threshold;
      }
    }
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

interface RunJobOptions {
  resumeFromIteration?: number;
}

/** 将无流水线配置的旧任务 config 归一化为单个 Stage（向后兼容） */
function configToStage(config: JobConfig): PipelineStage {
  return {
    id: 'default',
    name: '默认阶段',
    order: 0,
    remotePath: config.remotePath || '',
    iterationParams: config.iterationParams,
    adjustmentCommands: config.adjustmentCommands,
    monitorCommands: config.monitorCommands,
    envVars: config.envVars,
    heartbeatEnabled: config.heartbeatEnabled,
    heartbeatInterval: config.heartbeatInterval,
    heartbeatMaxFailures: config.heartbeatMaxFailures,
    alertWebhook: config.alertWebhook,
    logMonitorConfig: config.logMonitorConfig,
    globalBmcSessionId: config.globalBmcSessionId,
  };
}

/** 执行后台任务 */
export async function runJob(jobId: string, options?: RunJobOptions): Promise<void> {
  const { resumeFromIteration } = options || {};
  const job = getJob(jobId);
  if (!job) {
    console.error(`[JobRunner] Job ${jobId} not found`);
    return;
  }

  updateJob(jobId, { status: 'running' });
  addJobLog(jobId, 'info', '任务开始执行');

  // 确定流水线阶段
  const isPipelineMode = !!(job.config.stages && job.config.stages.length > 0);
  const stages: PipelineStage[] = isPipelineMode
    ? job.config.stages!.slice().sort((a, b) => a.order - b.order)
    : [configToStage(job.config)];

  const startStageIndex = job.config.currentStageIndex || 0;
  if (startStageIndex >= stages.length) {
    addJobLog(jobId, 'info', '所有阶段已执行完毕');
    updateJob(jobId, { status: 'completed' });
    return;
  }

  const { host, port, username, password } = job.config;

  // 监控状态管理
  const monitorStates = new Map<
    string,
    {
      dataPoints: Array<{ timestamp: string; value: number; raw: string }>;
      columnDataPoints?: Array<Array<{ timestamp: string; value: number; raw: string }>>;
      intervalId: ReturnType<typeof setInterval>;
      ssh: NodeSSH;
    }
  >();

  const cleanupMonitors = () => {
    for (const state of monitorStates.values()) {
      clearInterval(state.intervalId);
      state.ssh.dispose();
    }
    monitorStates.clear();
  };

  // ========== 日志监控（数据全部存在服务器本地） ==========
  let logMonitorSsh: NodeSSH | null = null;
  let logMonitorIntervalId: ReturnType<typeof setInterval> | null = null;
  let logMonitorLocalDir = '';

  const cleanupLogMonitor = () => {
    if (logMonitorIntervalId) {
      clearInterval(logMonitorIntervalId);
      logMonitorIntervalId = null;
    }
    if (logMonitorSsh) {
      try { logMonitorSsh.dispose(); } catch { /* ignore */ }
      logMonitorSsh = null;
    }
  };

  const getLogBaseDir = (stage: PipelineStage) =>
    isPipelineMode
      ? path.join(process.cwd(), '.data', 'logs', jobId, stage.id)
      : path.join(process.cwd(), '.data', 'logs', jobId);

  const startLogMonitor = async (iteration: number, stage: PipelineStage) => {
    const logConfig = stage.logMonitorConfig;
    if (!logConfig || !logConfig.enabled || !logConfig.command.trim()) return;

    // 重置状态
    logMonitorLocalDir = '';
    logMonitorSsh = new NodeSSH();
    try {
      if (logConfig.target === 'host') {
        await logMonitorSsh.connect({
          host,
          port: port || 22,
          username,
          password,
          readyTimeout: 30000,
        });
      } else if (logConfig.target === 'bmc' && logConfig.bmcConfig) {
        await logMonitorSsh.connect({
          host: logConfig.bmcConfig.host,
          port: logConfig.bmcConfig.port || 22,
          username: logConfig.bmcConfig.username,
          password: logConfig.bmcConfig.password,
          readyTimeout: 30000,
        });
      } else {
        logMonitorSsh.dispose();
        logMonitorSsh = null;
        return;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addJobLog(jobId, 'warning', `日志监控 SSH 连接失败: ${msg}`);
      logMonitorSsh = null;
      return;
    }

    // 在服务器本地创建日志目录
    logMonitorLocalDir = path.join(getLogBaseDir(stage), `iteration-${iteration}`);
    try {
      fs.mkdirSync(logMonitorLocalDir, { recursive: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addJobLog(jobId, 'warning', `日志监控创建本地目录失败: ${msg}`);
      cleanupLogMonitor();
      return;
    }

    const runLogCommand = async () => {
      try {
        const result = await logMonitorSsh!.execCommand(logConfig.command);
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `${timestamp}.log`;
        const content = (result.stdout || '') + (result.stderr ? `\n[stderr]\n${result.stderr}` : '');
        const filePath = path.join(logMonitorLocalDir, filename);
        fs.writeFileSync(filePath, content, 'utf-8');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        addJobLog(jobId, 'warning', `日志监控采样异常: ${msg}`);
      }
    };

    await runLogCommand();
    logMonitorIntervalId = setInterval(runLogCommand, logConfig.interval * 1000);
    addJobLog(jobId, 'info', `日志监控已启动，间隔 ${logConfig.interval} 秒，本地目录: ${logMonitorLocalDir}`);
  };

  const stopAndArchiveLogs = async (iteration: number, stage: PipelineStage): Promise<string | undefined> => {
    // 停止定时器
    if (logMonitorIntervalId) {
      clearInterval(logMonitorIntervalId);
      logMonitorIntervalId = null;
    }

    const logConfig = stage.logMonitorConfig;
    if (!logConfig || !logConfig.enabled || !logMonitorLocalDir) {
      cleanupLogMonitor();
      return undefined;
    }

    try {
      // 释放 SSH 连接（不再需要）
      if (logMonitorSsh) {
        try { logMonitorSsh.dispose(); } catch { /* ignore */ }
        logMonitorSsh = null;
      }

      // 检查本地是否有日志文件
      if (!fs.existsSync(logMonitorLocalDir)) {
        addJobLog(jobId, 'warning', `日志本地目录不存在，跳过打包: ${logMonitorLocalDir}`);
        return undefined;
      }
      const files = fs.readdirSync(logMonitorLocalDir);
      if (files.length === 0) {
        addJobLog(jobId, 'warning', `日志本地目录为空，跳过打包: ${logMonitorLocalDir}`);
        fs.rmdirSync(logMonitorLocalDir);
        return undefined;
      }

      // 在服务器本地打包（使用 archiver，不依赖远程系统命令）
      const localDir = getLogBaseDir(stage);
      fs.mkdirSync(localDir, { recursive: true });
      const localPath = path.join(localDir, `iteration-${iteration}.zip`);

      const archiver = (await import('archiver')).default;
      const output = fs.createWriteStream(localPath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      await new Promise<void>((resolve, reject) => {
        output.on('close', () => resolve());
        archive.on('error', (err: Error) => reject(err));
        archive.on('warning', (err: Error) => {
          if (err.message) addJobLog(jobId, 'warning', `打包警告: ${err.message}`);
        });
        archive.pipe(output);
        archive.directory(logMonitorLocalDir, false);
        archive.finalize();
      });

      // 打包完成后清理本地临时目录
      fs.rmSync(logMonitorLocalDir, { recursive: true, force: true });

      addJobLog(jobId, 'info', `第 ${iteration} 轮日志已打包: iteration-${iteration}.zip（含 ${files.length} 个文件）`);
      return localPath;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addJobLog(jobId, 'warning', `日志打包失败: ${msg}`);
      return undefined;
    }
  };

  // ========== 心跳检测 ==========
  let heartbeatSsh: NodeSSH | null = null;
  let heartbeatIntervalId: ReturnType<typeof setInterval> | null = null;
  let heartbeatFailureCount = 0;

  const cleanupHeartbeat = () => {
    if (heartbeatIntervalId) {
      clearInterval(heartbeatIntervalId);
      heartbeatIntervalId = null;
    }
    if (heartbeatSsh) {
      try { heartbeatSsh.dispose(); } catch { /* ignore */ }
      heartbeatSsh = null;
    }
  };

  const startHeartbeat = async (
    stage: Pick<PipelineStage, 'heartbeatEnabled' | 'heartbeatInterval' | 'heartbeatMaxFailures' | 'alertWebhook'>
  ) => {
    if (!stage.heartbeatEnabled) return;
    const interval = stage.heartbeatInterval || 10;
    const maxFailures = stage.heartbeatMaxFailures || 3;

    heartbeatSsh = new NodeSSH();
    try {
      await heartbeatSsh.connect({
        host,
        port: port || 22,
        username,
        password,
        readyTimeout: 10000,
      });
    } catch (err) {
      addJobLog(jobId, 'error', `心跳检测 SSH 连接失败: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    heartbeatFailureCount = 0;
    heartbeatIntervalId = setInterval(async () => {
      if (isAborted()) {
        cleanupHeartbeat();
        return;
      }
      try {
        const result = await heartbeatSsh!.execCommand('echo blue_sky_heartbeat');
        if (result.code === 0 && result.stdout.trim() === 'blue_sky_heartbeat') {
          heartbeatFailureCount = 0;
        } else {
          heartbeatFailureCount++;
          addJobLog(jobId, 'warning', `心跳检测失败 (${heartbeatFailureCount}/${maxFailures})`);
        }
      } catch {
        heartbeatFailureCount++;
        addJobLog(jobId, 'warning', `心跳检测失败 (${heartbeatFailureCount}/${maxFailures})`);
      }

      if (heartbeatFailureCount >= maxFailures) {
        addJobLog(jobId, 'error', `心跳检测连续失败 ${maxFailures} 次，服务器可能已失联，强制中止测试`);
        if (stage.alertWebhook) {
          addJobLog(jobId, 'warning', `[告警] 将触发告警通知 webhook: ${stage.alertWebhook}（当前为预留功能，未实际发送）`);
        }
        cleanupHeartbeat();
        requestAbortJob(jobId);
      }
    }, interval * 1000);
  };

  const isAborted = () => !!getJob(jobId)?.abortRequested;

  const ssh = new NodeSSH();
  let scriptDir = '';

  // abortPromise：用于立即中断正在执行的 SSH 命令
  let abortRejectFn: (() => void) | null = null;
  const abortPromise = new Promise<never>((_, reject) => {
    abortRejectFn = () => reject(new Error('ABORTED_BY_USER'));
  });

  // 注册立即中止处理器
  const abortHandler = () => {
    addJobLog(jobId, 'info', '正在执行立即中止...');
    cleanupMonitors();
    cleanupLogMonitor();
    cleanupHeartbeat();
    try { ssh.dispose(); } catch { /* ignore */ }

    // 触发 abortPromise，让正在执行的 ssh.exec / ssh.execCommand 立即退出
    if (abortRejectFn) {
      abortRejectFn();
      abortRejectFn = null;
    }

    // 通过独立 SSH 连接远程 kill run.sh 进程及其所有子进程，然后执行 stop.sh（如果存在）
    const jobConfig = getJob(jobId)?.config;
    const knownScriptDir = jobConfig?.activeScriptDir || '';
    if (host && username && password) {
      (async () => {
        try {
          addJobLog(jobId, 'info', '正在连接远程主机终止进程...');
          const killSsh = new NodeSSH();
          await killSsh.connect({
            host,
            port: port || 22,
            username,
            password,
            readyTimeout: 10000,
          });

          addJobLog(jobId, 'info', '正在查找并终止 run.sh 进程...');
          const killScript = `pkill -9 -f "run.sh"; sleep 1; pkill -9 -P $(pgrep -f "run.sh" 2>/dev/null || echo ""); echo "run.sh and children killed"`;
          const killResult = await killSsh.execCommand(killScript);
          if (killResult.stdout) {
            killResult.stdout.split('\n').forEach(line => {
              if (line.trim()) addJobLog(jobId, 'info', `[终止] ${line}`);
            });
          }
          if (killResult.stderr) {
            killResult.stderr.split('\n').forEach(line => {
              if (line.trim()) addJobLog(jobId, 'warning', `[终止-错误] ${line}`);
            });
          }

          addJobLog(jobId, 'info', '正在执行 stop.sh 清理脚本...');
          const targetDir = knownScriptDir || '/tmp/blue_sky_power_test_0';
          const stopShCheck = `test -f "${targetDir}/stop.sh" && echo "found" || echo "not_found"`;
          const checkResult = await killSsh.execCommand(stopShCheck);
          if (checkResult.stdout.trim() === 'found') {
            addJobLog(jobId, 'info', `执行 stop.sh: ${targetDir}/stop.sh`);
            const stopScript = `chmod +x "${targetDir}/stop.sh" && cd "${targetDir}" && ./stop.sh`;
            const stopResult = await killSsh.execCommand(stopScript);
            if (stopResult.stdout) {
              stopResult.stdout.split('\n').forEach(line => {
                if (line.trim()) addJobLog(jobId, 'info', `[stop.sh] ${line}`);
              });
            }
            if (stopResult.stderr) {
              stopResult.stderr.split('\n').forEach(line => {
                if (line.trim()) addJobLog(jobId, 'warning', `[stop.sh-错误] ${line}`);
              });
            }
            addJobLog(jobId, 'info', 'stop.sh 执行完成');
          } else {
            addJobLog(jobId, 'info', '未找到 stop.sh，跳过清理脚本');
          }
          addJobLog(jobId, 'info', '远程进程已终止');
          killSsh.dispose();
        } catch (err) {
          addJobLog(jobId, 'warning', `远程终止失败: ${err instanceof Error ? err.message : String(err)}`);
        }
      })();
    }
  };

  // 执行单个 Stage
  const runStage = async (
    stage: PipelineStage,
    resumeFromIter?: number
  ): Promise<{ success: boolean; results: JobResult[]; errorMessage?: string }> => {
    const stageResults: JobResult[] = [];

    const {
      iterationParams,
      adjustmentCommands,
      envVars,
      monitorCommands,
    } = stage;

    // 验证参数
    addJobLog(jobId, 'info', `阶段 [${stage.name}] 验证参数: iterationParams=${JSON.stringify(iterationParams)}`);
    if (!iterationParams || iterationParams.length === 0) {
      addJobLog(jobId, 'error', `缺少必要参数: 阶段 [${stage.name}] 的 iterationParams 为空`);
      return { success: false, results: stageResults, errorMessage: '缺少必要参数: iterationParams为空' };
    }

    // 生成笛卡尔积迭代组合
    const iterations = generateIterations(iterationParams);
    const totalIterations = iterations.length;

    if (totalIterations === 0) {
      addJobLog(jobId, 'error', '没有有效的迭代组合，请检查参数配置');
      return { success: false, results: stageResults, errorMessage: '没有有效的迭代组合' };
    }

    const startIteration = resumeFromIter && resumeFromIter > 0 ? resumeFromIter : 1;
    const startIndex = startIteration - 1;

    if (startIndex > 0) {
      addJobLog(jobId, 'info', `阶段 [${stage.name}] 从第 ${startIteration} 轮恢复执行，总迭代次数: ${totalIterations}`);
    } else {
      addJobLog(jobId, 'start', `阶段 [${stage.name}] 开始迭代测试，总迭代次数: ${totalIterations}`);
    }

    updateJob(jobId, {
      progress: { currentIteration: startIndex, totalIterations, currentLabel: '' },
    });

    // 启动阶段心跳检测
    cleanupHeartbeat();
    await startHeartbeat(stage);

    // 查找测试目录：优先使用 Stage 配置的远程路径，否则查找最新部署目录
    let remotePath = stage.remotePath;
    if (!remotePath) {
      addJobLog(jobId, 'info', '查找测试包...');
      const findDirResult = await ssh.execCommand(`ls -td /tmp/blue_sky_power_test_* | head -1`);

      if (findDirResult.code !== 0 || !findDirResult.stdout.trim()) {
        addJobLog(jobId, 'error', '未找到已部署的测试包，请先部署');
        return { success: false, results: stageResults, errorMessage: '未找到已部署的测试包' };
      }

      remotePath = findDirResult.stdout.trim();
    }
    addJobLog(jobId, 'info', `找到测试包: ${remotePath}`);

    // 查找 run.sh 路径
    const findResult = await ssh.execCommand(`find ${remotePath} -name "run.sh" -type f | head -1`);
    const runShPath = findResult.stdout.trim();

    if (!runShPath) {
      addJobLog(jobId, 'error', '未找到 run.sh 脚本');
      return { success: false, results: stageResults, errorMessage: '未找到 run.sh 脚本' };
    }

    scriptDir = runShPath.substring(0, runShPath.lastIndexOf('/'));
    const existingConfig = getJob(jobId)?.config;
    if (existingConfig) {
      updateJob(jobId, { config: { ...existingConfig, activeScriptDir: scriptDir } });
    }
    const paramNames = iterationParams.map((p) => p.name);

    // 执行每一轮测试
    for (let i = startIndex; i < totalIterations; i++) {
      if (isAborted()) {
        addJobLog(jobId, 'info', '测试已中止');
        return { success: false, results: stageResults, errorMessage: '测试已中止' };
      }

      const currentValues = iterations[i];
      const iteration = i + 1;
      const power = parseFloat(currentValues[paramNames[0]] ?? '0') || 0;
      const iterationLabel = paramNames.map((name) => `${name}=${currentValues[name]}`).join(', ');

      updateJob(jobId, {
        progress: { currentIteration: iteration, totalIterations, currentLabel: iterationLabel },
      });
      addJobLog(jobId, 'iteration_start', `阶段 [${stage.name}] 第 ${iteration}/${totalIterations} 轮测试 - ${iterationLabel}`);

      // ========== 执行调整命令 ==========
      for (const adjCmd of adjustmentCommands || []) {
        if (isAborted()) {
          addJobLog(jobId, 'info', '测试已中止');
          return { success: false, results: stageResults, errorMessage: '测试已中止' };
        }

        addJobLog(jobId, 'info', `正在执行调整命令 [${adjCmd.name}]...`);

        const adjSsh = new NodeSSH();
        try {
          if (adjCmd.target === 'host') {
            await adjSsh.connect({
              host,
              port: port || 22,
              username,
              password,
              readyTimeout: 30000,
            });
          } else if (adjCmd.target === 'bmc' && adjCmd.bmcConfig) {
            await adjSsh.connect({
              host: adjCmd.bmcConfig.host,
              port: adjCmd.bmcConfig.port || 22,
              username: adjCmd.bmcConfig.username,
              password: adjCmd.bmcConfig.password,
              readyTimeout: 30000,
            });
          } else {
            addJobLog(jobId, 'info', `调整命令 [${adjCmd.name}] 配置不完整，跳过`);
            continue;
          }

          let replacedCommand = adjCmd.command;
          for (const paramName of paramNames) {
            const placeholder = `{{${paramName}}}`;
            replacedCommand = replacedCommand.replaceAll(placeholder, String(currentValues[paramName]));
          }

          addJobLog(jobId, 'info', `[${adjCmd.name}] 命令: ${replacedCommand.substring(0, 100)}...`);

          const adjResult = await adjSsh.execCommand(replacedCommand);

          if (isAborted()) {
            addJobLog(jobId, 'info', '测试已中止');
            return { success: false, results: stageResults, errorMessage: '测试已中止' };
          }

          if (adjResult.stdout) {
            addJobLog(jobId, 'stdout', `[${adjCmd.name}] 输出: ${adjResult.stdout.trim()}`);
          }
          if (adjResult.stderr) {
            addJobLog(jobId, 'stderr', `[${adjCmd.name}] 错误输出: ${adjResult.stderr.trim()}`);
          }
          if (adjResult.code !== 0) {
            throw new Error(`调整命令 [${adjCmd.name}] 执行失败，退出码: ${adjResult.code}`);
          }
          addJobLog(jobId, 'info', `调整命令 [${adjCmd.name}] 完成`);
        } catch (adjError) {
          if (isAborted()) {
            addJobLog(jobId, 'info', '测试已中止');
            return { success: false, results: stageResults, errorMessage: '测试已中止' };
          }
          const adjErrorMsg = adjError instanceof Error ? adjError.message : String(adjError);
          addJobLog(jobId, 'error', `调整命令 [${adjCmd.name}] 失败: ${adjErrorMsg}`);
          return { success: false, results: stageResults, errorMessage: adjErrorMsg };
        } finally {
          adjSsh.dispose();
        }
      }

      // ========== 启动日志监控 ==========
      await startLogMonitor(iteration, stage);

      // ========== 启动监控命令 ==========
      const activeMonitors = (monitorCommands || []).filter((c) => c.enabled);
      monitorStates.clear();

      for (const cmd of activeMonitors) {
        try {
          const monitorSsh = new NodeSSH();
          if (cmd.target === 'host') {
            await monitorSsh.connect({
              host,
              port: port || 22,
              username,
              password,
              readyTimeout: 30000,
            });
          } else if (cmd.target === 'bmc' && cmd.bmcConfig) {
            await monitorSsh.connect({
              host: cmd.bmcConfig.host,
              port: cmd.bmcConfig.port || 22,
              username: cmd.bmcConfig.username,
              password: cmd.bmcConfig.password,
              readyTimeout: 30000,
            });
          } else {
            continue;
          }

          const isListMode = cmd.mode === 'list' && cmd.columns && cmd.columns.length > 0;

          const state: {
            dataPoints: Array<{ timestamp: string; value: number; raw: string }>;
            columnDataPoints?: Array<Array<{ timestamp: string; value: number; raw: string }>>;
            intervalId: ReturnType<typeof setInterval>;
            ssh: NodeSSH;
          } = {
            dataPoints: [],
            intervalId: null as unknown as ReturnType<typeof setInterval>,
            ssh: monitorSsh,
          };

          if (isListMode) {
            state.columnDataPoints = cmd.columns!.map(() => []);
          }

          const runMonitor = async () => {
            try {
              const result = await monitorSsh.execCommand(cmd.command);
              const timestamp = new Date().toISOString();

              if (isListMode && state.columnDataPoints) {
                const { values, raw } = parseListOutput(result.stdout);
                for (let i = 0; i < state.columnDataPoints.length; i++) {
                  state.columnDataPoints[i].push({
                    timestamp,
                    value: values[i] ?? NaN,
                    raw,
                  });
                }
                // 只有在未屏蔽监控输出时才记录日志到终端
                if (!stage.suppressMonitorLogs) {
                  addJobLog(jobId, 'monitor_sample', `监控 [${cmd.name}] 采样: ${raw}`);
                }
              } else {
                const { value, raw } = parseNumericOutput(result.stdout);
                const point = {
                  timestamp,
                  value,
                  raw,
                };
                state.dataPoints.push(point);
                // 只有在未屏蔽监控输出时才记录日志到终端
                if (!stage.suppressMonitorLogs) {
                  addJobLog(jobId, 'monitor_sample', `监控 [${cmd.name}] 采样: ${raw}`);
                }
              }
            } catch {
              // 单个采样失败不影响主流程
            }
          };

          await runMonitor();
          state.intervalId = setInterval(runMonitor, cmd.interval * 1000);
          monitorStates.set(cmd.id, state);
        } catch (monitorErr) {
          const errMsg = monitorErr instanceof Error ? monitorErr.message : String(monitorErr);
          addJobLog(jobId, 'info', `监控命令 [${cmd.name}] 启动失败: ${errMsg}`);
        }
      }

      // ========== 执行主测试脚本 ==========
      let roundOutput = '';

      const paramEnvExports = paramNames.map((name) => `${name}=${shellQuote(currentValues[name])}`);
      const envExports = [
        `BLUE_SKY_POWER=${shellQuote(power.toString())}`,
        `BLUE_SKY_ITERATION=${shellQuote(iteration.toString())}`,
        ...paramEnvExports,
        ...(envVars || []).map((e) => `${e.key}=${shellQuote(e.value)}`),
      ].map((e) => `export ${e}`).join(' && ');

      const positionalArgs = paramNames.map((name) => currentValues[name]).join(' ');

      const execEnv: Record<string, string> = {
        BLUE_SKY_POWER: power.toString(),
        BLUE_SKY_ITERATION: iteration.toString(),
        ...Object.fromEntries(paramNames.map((name) => [name, String(currentValues[name])])),
        ...Object.fromEntries((envVars || []).map((e) => [e.key, e.value])),
      };

      if (isAborted()) {
        addJobLog(jobId, 'info', '测试已中止');
        return { success: false, results: stageResults, errorMessage: '测试已中止' };
      }

      const result = await Promise.race([
        ssh.exec(
          `${envExports} && cd ${scriptDir} && ./run.sh ${positionalArgs}`,
          [],
          {
            stream: 'both',
            cwd: scriptDir,
            execOptions: {
              env: execEnv as unknown as NodeJS.ProcessEnv,
            },
            onStdout: (chunk) => {
              if (isAborted()) {
                try { ssh.dispose(); } catch { /* ignore */ }
                return;
              }
              const chunkStr = chunk.toString();
              roundOutput += chunkStr;
              const lines = chunkStr.split('\n').filter((line: string) => line.trim());
              lines.forEach((line: string) => {
                addJobLog(jobId, 'stdout', line);
              });
            },
            onStderr: (chunk) => {
              if (isAborted()) {
                try { ssh.dispose(); } catch { /* ignore */ }
                return;
              }
              const chunkStr = chunk.toString();
              roundOutput += chunkStr;
              const lines = chunkStr.split('\n').filter((line: string) => line.trim());
              lines.forEach((line: string) => {
                addJobLog(jobId, 'stderr', line);
              });
            },
          }
        ),
        abortPromise,
      ]);

      const response = result as unknown as { code: number | null; stdout: string; stderr: string };
      const exitCode = response.code ?? 0;

      // ========== 停止监控命令并汇总 ==========
      const monitorResults: Record<string, {
        commandId: string;
        commandName: string;
        dataPoints: Array<{ timestamp: string; value: number; raw: string }>;
        averageValue: number;
      }> = {};

      for (const [cmdId, state] of monitorStates) {
        clearInterval(state.intervalId);
        state.ssh.dispose();
        const cmd = activeMonitors.find((c) => c.id === cmdId);
        if (!cmd) continue;

        const isListMode = cmd.mode === 'list' && cmd.columns && cmd.columns.length > 0;

        if (isListMode && state.columnDataPoints) {
          // list 模式：为每个列生成独立的 monitorResult
          for (let i = 0; i < cmd.columns!.length; i++) {
            const colPoints = state.columnDataPoints[i];
            let filteredPoints = filterByPosition(colPoints, cmd.skipFirst ?? 0, cmd.takeLast ?? 0, cmd.skipLast ?? 0);
            filteredPoints = filterByJumps(
              filteredPoints,
              cmd.jumpThreshold ?? 0,
              cmd.jumpThresholdType ?? 'percent',
              cmd.skipJumps ?? 0
            );
            const validValues = filteredPoints
              .filter((p) => !isNaN(p.value) && !(cmd.excludeZero && p.value === 0))
              .map((p) => p.value);
            const averageValue = validValues.length > 0 ? validValues.reduce((a, b) => a + b, 0) / validValues.length : 0;
            const colKey = `${cmd.id}__col__${i}`;
            monitorResults[colKey] = {
              commandId: colKey,
              commandName: `${cmd.name} - ${cmd.columns![i]}`,
              dataPoints: colPoints,
              averageValue,
            };
          }
        } else {
          // single 模式：原有逻辑
          const dataPoints = state.dataPoints;
          let filteredPoints = filterByPosition(dataPoints, cmd.skipFirst ?? 0, cmd.takeLast ?? 0, cmd.skipLast ?? 0);
          filteredPoints = filterByJumps(
            filteredPoints,
            cmd.jumpThreshold ?? 0,
            cmd.jumpThresholdType ?? 'percent',
            cmd.skipJumps ?? 0
          );
          const validValues = filteredPoints
            .filter((p) => !isNaN(p.value) && !(cmd.excludeZero && p.value === 0))
            .map((p) => p.value);
          const averageValue = validValues.length > 0 ? validValues.reduce((a, b) => a + b, 0) / validValues.length : 0;
          monitorResults[cmdId] = {
            commandId: cmd.id,
            commandName: cmd.name,
            dataPoints,
            averageValue,
          };
        }
      }
      monitorStates.clear();

      // ========== 停止日志监控并打包 ==========
      const logArchivePath = await stopAndArchiveLogs(iteration, stage);

      // 解析 score
      let score = 0;
      if (exitCode === 0) {
        const lines = roundOutput.trim().split('\n');
        for (let i = lines.length - 1; i >= 0; i--) {
          const line = lines[i].trim();
          if (line.startsWith('{') && line.endsWith('}')) {
            try {
              const parsed = JSON.parse(line);
              if (typeof parsed.score === 'number') {
                score = parsed.score;
                break;
              }
            } catch {
              // 继续尝试上一行
            }
          }
        }
      }

      if (exitCode !== 0) {
        const resultItem: JobResult = {
          iteration,
          power,
          score: 0,
          status: 'error',
          iterationValues: currentValues,
          iterationLabel,
          message: `脚本退出码: ${exitCode}`,
          timestamp: new Date().toISOString(),
          logArchivePath,
          stageId: stage.id,
          stageName: stage.name,
        };
        appendJobResult(jobId, resultItem);
        stageResults.push(resultItem);
        addJobLog(jobId, 'iteration_error', `阶段 [${stage.name}] 第 ${iteration} 轮测试失败: 脚本退出码 ${exitCode}`);
        // 迭代失败后立即保存，避免内存累积
        forceSaveJobs();
        continue;
      }

      const resultItem: JobResult = {
        iteration,
        power,
        score,
        status: 'success',
        iterationValues: currentValues,
        iterationLabel,
        monitorResults,
        timestamp: new Date().toISOString(),
        logArchivePath,
        stageId: stage.id,
        stageName: stage.name,
      };
      appendJobResult(jobId, resultItem);
      stageResults.push(resultItem);
      addJobLog(jobId, 'iteration_end', `阶段 [${stage.name}] 第 ${iteration} 轮测试完成 - Score: ${score}`);

      // 迭代完成后执行 stop.sh 清理（如存在）
      try {
        const stopShPath = `${scriptDir}/stop.sh`;
        const checkResult = await ssh.execCommand(`test -f "${stopShPath}" && echo "exists" || echo "not_found"`);
        if (checkResult.stdout.trim() === 'exists') {
          addJobLog(jobId, 'info', `执行 stop.sh 清理脚本...`);
          const stopResult = await ssh.execCommand(`chmod +x "${stopShPath}" && cd "${scriptDir}" && ./stop.sh`);
          if (stopResult.stdout) {
            stopResult.stdout.split('\n').forEach(line => {
              if (line.trim()) addJobLog(jobId, 'info', `[stop.sh] ${line}`);
            });
          }
          if (stopResult.stderr) {
            stopResult.stderr.split('\n').forEach(line => {
              if (line.trim()) addJobLog(jobId, 'warning', `[stop.sh-错误] ${line}`);
            });
          }
          addJobLog(jobId, 'info', 'stop.sh 执行完成');
        }
      } catch (stopErr) {
        addJobLog(jobId, 'warning', `执行 stop.sh 失败: ${stopErr instanceof Error ? stopErr.message : String(stopErr)}`);
      }

      // 迭代成功后立即保存到磁盘，避免内存累积
      forceSaveJobs();
    }

    return { success: true, results: stageResults };
  };

  try {
    registerJobRunner(jobId, abortHandler);

    // 验证主机参数
    if (!host || !username || !password) {
      addJobLog(jobId, 'error', `缺少必要参数: host=${!!host}, username=${!!username}, password=${!!password}`);
      updateJob(jobId, { status: 'error', errorMessage: '缺少必要参数' });
      return;
    }

    // 连接 SSH
    addJobLog(jobId, 'info', `正在连接 ${host}:${port || 22}...`);
    await ssh.connect({
      host,
      port: port || 22,
      username,
      password,
      readyTimeout: 30000,
    });
    addJobLog(jobId, 'info', 'SSH连接成功');

    let finalErrorMessage: string | undefined;

    for (let stageIndex = startStageIndex; stageIndex < stages.length; stageIndex++) {
      if (isAborted()) {
        updateJob(jobId, { status: 'aborted' });
        return;
      }

      const stage = stages[stageIndex];
      addJobLog(jobId, 'info', `开始执行阶段 [${stage.name}]（${stageIndex + 1}/${stages.length}）`);

      // 更新当前阶段索引
      updateJob(jobId, {
        config: { ...job.config, currentStageIndex: stageIndex },
      });

      // 初始化/更新阶段结果状态为 running
      const prevStageResults = job.stageResults || {};
      updateJob(jobId, {
        stageResults: {
          ...prevStageResults,
          [stage.id]: {
            stageId: stage.id,
            stageName: stage.name,
            status: 'running' as const,
            results: prevStageResults[stage.id]?.results || [],
          },
        },
      });

      const resumeFromIter = stageIndex === startStageIndex ? resumeFromIteration : undefined;
      const stageOutcome = await runStage(stage, resumeFromIter);

      // 若已中止，不覆盖阶段状态，由外层统一处理
      if (isAborted()) {
        break;
      }

      // 更新阶段结果
      const currentStageResults = job.stageResults || {};
      updateJob(jobId, {
        stageResults: {
          ...currentStageResults,
          [stage.id]: {
            stageId: stage.id,
            stageName: stage.name,
            status: stageOutcome.success ? ('completed' as const) : ('error' as const),
            results: stageOutcome.results,
            errorMessage: stageOutcome.errorMessage,
          },
        },
      });

      if (!stageOutcome.success) {
        finalErrorMessage = stageOutcome.errorMessage;
        addJobLog(jobId, 'error', `阶段 [${stage.name}] 执行失败: ${finalErrorMessage}`);
        break;
      }

      addJobLog(jobId, 'info', `阶段 [${stage.name}] 执行完成`);

      // 阶段结束后清理监控和日志监控
      cleanupMonitors();
      cleanupLogMonitor();

      // 更新当前阶段索引为下一阶段
      if (stageIndex < stages.length - 1) {
        updateJob(jobId, {
          config: { ...job.config, currentStageIndex: stageIndex + 1 },
        });
      }
    }

    if (isAborted()) {
      updateJob(jobId, { status: 'aborted' });
      return;
    }

    if (finalErrorMessage) {
      updateJob(jobId, { status: 'error', errorMessage: finalErrorMessage });
      return;
    }

    addJobLog(jobId, 'complete', '所有测试完成');
    updateJob(jobId, { status: 'completed' });
  } catch (error) {
    if (isAborted() || (error instanceof Error && error.message === 'ABORTED_BY_USER')) {
      addJobLog(jobId, 'info', '测试已中止');
      updateJob(jobId, { status: 'aborted' });
      return;
    }
    const errorMessage = error instanceof Error ? error.message : String(error);
    addJobLog(jobId, 'error', errorMessage);
    updateJob(jobId, { status: 'error', errorMessage });
  } finally {
    unregisterJobRunner(jobId);
    cleanupHeartbeat();
    cleanupMonitors();
    cleanupLogMonitor();
    ssh.dispose();
  }
}
