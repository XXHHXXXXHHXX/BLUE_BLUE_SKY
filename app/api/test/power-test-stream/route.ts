/** 迭代测试 - 流式执行 API（实时输出） */
import { NextRequest } from 'next/server';
import { NodeSSH } from 'node-ssh';

interface IterationParameterConfig {
  id: string;
  name: string;
  mode: 'range' | 'custom';
  start: number;
  end: number;
  step: number;
  values: string[];
}

interface AdjustmentCommandConfig {
  id: string;
  name: string;
  target: 'host' | 'bmc';
  sessionId?: string;
  bmcConfig?: {
    host: string;
    port: number;
    username: string;
    password: string;
  };
  command: string;
  parameterName: string;
}

interface MonitorCommandConfig {
  id: string;
  name: string;
  command: string;
  target: 'host' | 'bmc';
  bmcConfig?: {
    host: string;
    port: number;
    username: string;
    password: string;
  };
  interval: number;
  enabled: boolean;
  mode?: 'single' | 'list';
  columns?: string[];
  jumpThreshold?: number;
  jumpThresholdType?: 'percent' | 'absolute';
  skipJumps?: number;
  skipFirst?: number;
  takeLast?: number;
  skipLast?: number;
}

interface StreamConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  iterationParams: IterationParameterConfig[];
  adjustmentCommands: AdjustmentCommandConfig[];
  envVars?: Array<{ key: string; value: string }>;
  monitorCommands?: MonitorCommandConfig[];
}

/** 生成笛卡尔积迭代组合（支持从高到低和自定义列表） */
function generateIterations(params: IterationParameterConfig[]): Array<Record<string, string>> {
  if (params.length === 0) return [];

  const valuesList = params.map((p) => {
    if (p.mode === 'custom') {
      return p.values.filter((v) => v.trim() !== '');
    }
    const values: string[] = [];
    if (p.step <= 0 || p.start === p.end) return values;
    if (p.start < p.end) {
      // 从低到高
      const count = Math.floor((p.end - p.start) / p.step) + 1;
      for (let i = 0; i < count; i++) {
        values.push(String(p.start + i * p.step));
      }
    } else {
      // 从高到低
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

/** POST /api/test/power-test-stream - 流式执行测试 */
export async function POST(request: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(data) + '\n'));
        } catch {
          // 流可能已关闭，忽略发送错误
        }
      };

      // 监控状态提升到外部，确保 finally 可以访问并清理
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

      // 监听客户端 abort 事件，立即清理监控定时器
      const onAbort = () => {
        cleanupMonitors();
      };
      request.signal.addEventListener('abort', onAbort);

      try {
        const body = await request.json();
        const { host, port, username, password, iterationParams, adjustmentCommands, envVars, monitorCommands } = body as StreamConfig;

        // 验证参数
        if (!host || !username || !password || !iterationParams || iterationParams.length === 0) {
          send({ type: 'error', message: '缺少必要参数' });
          controller.close();
          return;
        }

        // 生成笛卡尔积迭代组合
        const iterations = generateIterations(iterationParams);
        const totalIterations = iterations.length;

        if (totalIterations === 0) {
          send({ type: 'error', message: '没有有效的迭代组合，请检查参数配置' });
          controller.close();
          return;
        }

        send({
          type: 'start',
          message: '开始迭代测试',
          config: { totalIterations, iterationParams },
        });

        const ssh = new NodeSSH();

        // 辅助函数：解析命令输出中的数字
        const parseNumericOutput = (stdout: string): { value: number; raw: string } => {
          const raw = stdout.trim().split('\n')[0] || '';
          let value = NaN;
          const numMatch = raw.match(/-?\d+(?:\.\d+)?/);
          if (numMatch) {
            value = parseFloat(numMatch[0]);
          }
          return { value, raw };
        };

        // 辅助函数：解析 list 模式命令输出中的多个数字（逗号分隔）
        const parseListOutput = (stdout: string): { values: number[]; raw: string } => {
          const raw = stdout.trim().split('\n')[0] || '';
          const values = raw.split(',').map((s) => {
            const numMatch = s.trim().match(/-?\d+(?:\.\d+)?/);
            return numMatch ? parseFloat(numMatch[0]) : NaN;
          });
          return { values, raw };
        };

        // 检查是否已中止
        const isAborted = () => request.signal.aborted;

        try {
          // 连接SSH
          send({ type: 'info', message: `正在连接 ${host}:${port || 22}...` });

          await ssh.connect({
            host,
            port: port || 22,
            username,
            password,
            readyTimeout: 30000,
          });

          send({ type: 'info', message: 'SSH连接成功' });

          // 查找最新的测试目录
          send({ type: 'info', message: '查找测试包...' });

          const findDirResult = await ssh.execCommand(`ls -td /tmp/blue_sky_power_test_* | head -1`);

          if (findDirResult.code !== 0 || !findDirResult.stdout.trim()) {
            send({ type: 'error', message: '未找到已部署的测试包，请先部署' });
            controller.close();
            return;
          }

          const remotePath = findDirResult.stdout.trim();
          send({ type: 'info', message: `找到测试包: ${remotePath}` });

          // 查找 run.sh 路径
          const findResult = await ssh.execCommand(`find ${remotePath} -name "run.sh" -type f | head -1`);
          const runShPath = findResult.stdout.trim();

          if (!runShPath) {
            send({ type: 'error', message: '未找到 run.sh 脚本' });
            controller.close();
            return;
          }

          const scriptDir = runShPath.substring(0, runShPath.lastIndexOf('/'));

          // 执行每一轮测试
          for (let i = 0; i < totalIterations; i++) {
            if (isAborted()) {
              send({ type: 'info', message: '测试已中止' });
              break;
            }

            const currentValues = iterations[i];
            const iteration = i + 1;
            // 兼容：power 等于第一个参数的值
            const paramNames = iterationParams.map((p) => p.name);
            const power = parseFloat(currentValues[paramNames[0]] ?? '0') || 0;

            // 生成迭代标签，如 "功耗=100W, 电压=1.2V"
            const iterationLabel = paramNames.map((name) => `${name}=${currentValues[name]}`).join(', ');

            send({
              type: 'iteration_start',
              iteration,
              total: totalIterations,
              power,
              iterationValues: currentValues,
              iterationLabel,
            });

            // ========== 执行调整命令 ==========
            for (const adjCmd of adjustmentCommands || []) {
              send({ type: 'info', message: `正在执行调整命令 [${adjCmd.name}]...` });

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
                  send({ type: 'info', message: `调整命令 [${adjCmd.name}] 配置不完整，跳过` });
                  continue;
                }

                // 替换命令中的 {{参数名}}
                let replacedCommand = adjCmd.command;
                for (const paramName of paramNames) {
                  const placeholder = `{{${paramName}}}`;
                  replacedCommand = replacedCommand.replaceAll(placeholder, String(currentValues[paramName]));
                }

                send({ type: 'info', message: `[${adjCmd.name}] 命令: ${replacedCommand.substring(0, 100)}...` });

                const adjResult = await adjSsh.execCommand(replacedCommand);

                if (adjResult.stdout) {
                  send({ type: 'info', message: `[${adjCmd.name}] 输出: ${adjResult.stdout.trim()}` });
                }
                if (adjResult.stderr) {
                  send({ type: 'info', message: `[${adjCmd.name}] 错误输出: ${adjResult.stderr.trim()}` });
                }
                if (adjResult.code !== 0) {
                  throw new Error(`调整命令 [${adjCmd.name}] 执行失败，退出码: ${adjResult.code}`);
                }
                send({ type: 'info', message: `调整命令 [${adjCmd.name}] 完成` });
              } catch (adjError) {
                const adjErrorMsg = adjError instanceof Error ? adjError.message : String(adjError);
                send({ type: 'error', message: `调整命令 [${adjCmd.name}] 失败: ${adjErrorMsg}` });
                ssh.dispose();
                controller.close();
                return;
              } finally {
                adjSsh.dispose();
              }
            }

            // ========== 启动监控命令 ==========
            const activeMonitors = (monitorCommands || []).filter((c) => c.enabled);
            // 每轮开始前清空上一轮可能残留的监控状态（正常情况下每轮结束已清理）
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
                      send({
                        type: 'monitor_sample',
                        iteration,
                        commandId: cmd.id,
                        commandName: cmd.name,
                        point: { timestamp, value: values[0] ?? NaN, raw },
                      });
                    } else {
                      const { value, raw } = parseNumericOutput(result.stdout);
                      const point = {
                        timestamp,
                        value,
                        raw,
                      };
                      state.dataPoints.push(point);
                      send({
                        type: 'monitor_sample',
                        iteration,
                        commandId: cmd.id,
                        commandName: cmd.name,
                        point,
                      });
                    }
                  } catch {
                    // 单个采样失败不影响主流程
                  }
                };

                // 立即执行一次，然后定时执行
                await runMonitor();
                state.intervalId = setInterval(runMonitor, cmd.interval * 1000);
                monitorStates.set(cmd.id, state);
              } catch (monitorErr) {
                const errMsg = monitorErr instanceof Error ? monitorErr.message : String(monitorErr);
                send({ type: 'info', message: `监控命令 [${cmd.name}] 启动失败: ${errMsg}` });
              }
            }

            // ========== 执行主测试脚本 ==========
            // 收集本轮测试的所有输出
            let roundOutput = '';

            // 构建环境变量：所有参数 + BLUE_SKY_ITERATION + BLUE_SKY_POWER（兼容）
            const paramEnvExports = paramNames.map((name) => `${name}=${shellQuote(currentValues[name])}`);
            const envExports = [
              `BLUE_SKY_POWER=${shellQuote(power.toString())}`,
              `BLUE_SKY_ITERATION=${shellQuote(iteration.toString())}`,
              ...paramEnvExports,
              ...(envVars || []).map((e) => `${e.key}=${shellQuote(e.value)}`),
            ].map((e) => `export ${e}`).join(' && ');

            // 位置参数：按参数顺序传递
            const positionalArgs = paramNames.map((name) => currentValues[name]).join(' ');

            // 构建 execOptions env
            const execEnv: Record<string, string> = {
              BLUE_SKY_POWER: power.toString(),
              BLUE_SKY_ITERATION: iteration.toString(),
              ...Object.fromEntries(paramNames.map((name) => [name, String(currentValues[name])])),
              ...Object.fromEntries((envVars || []).map((e) => [e.key, e.value])),
            };

            const result = await ssh.exec(
              `${envExports} && cd ${scriptDir} && ./run.sh ${positionalArgs}`,
              [],
              {
                stream: 'both',
                cwd: scriptDir,
                execOptions: {
                  env: execEnv as unknown as NodeJS.ProcessEnv,
                },
                onStdout: (chunk) => {
                  const chunkStr = chunk.toString();
                  roundOutput += chunkStr;
                  const lines = chunkStr.split('\n').filter((line: string) => line.trim());
                  lines.forEach((line: string) => {
                    send({ type: 'stdout', iteration, power, line });
                  });
                },
                onStderr: (chunk) => {
                  const chunkStr = chunk.toString();
                  roundOutput += chunkStr;
                  const lines = chunkStr.split('\n').filter((line: string) => line.trim());
                  lines.forEach((line: string) => {
                    send({ type: 'stderr', iteration, power, line });
                  });
                },
              }
            );

            // 等待命令执行完成
            const response = result as unknown as { code: number | null; stdout: string; stderr: string };
            const exitCode = response.code ?? 0;

            // ========== 停止监控命令并汇总 ==========
            const monitorResults: Record<
              string,
              {
                commandId: string;
                commandName: string;
                dataPoints: Array<{ timestamp: string; value: number; raw: string }>;
                averageValue: number;
              }
            > = {};

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
                  // percent 模式（默认）
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
              // 如果未检测到足够的跳变，回退到全部数据
              return points.slice(startIndex);
            };

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
                  const validValues = filteredPoints.filter((p) => !isNaN(p.value)).map((p) => p.value);
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
                let filteredPoints = filterByPosition(
                  dataPoints,
                  cmd.skipFirst ?? 0,
                  cmd.takeLast ?? 0,
                  cmd.skipLast ?? 0
                );
                filteredPoints = filterByJumps(
                  filteredPoints,
                  cmd.jumpThreshold ?? 0,
                  cmd.jumpThresholdType ?? 'percent',
                  cmd.skipJumps ?? 0
                );
                const validValues = filteredPoints.filter((p) => !isNaN(p.value)).map((p) => p.value);
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

            // 解析score
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
              send({
                type: 'iteration_error',
                iteration,
                power,
                iterationValues: currentValues,
                iterationLabel,
                message: `脚本退出码: ${exitCode}`,
              });
              continue;
            }

            // 发送完成信号，包含解析出的score和监控结果
            send({
              type: 'iteration_end',
              iteration,
              power,
              iterationValues: currentValues,
              iterationLabel,
              score,
              monitorResults,
              message: '本轮测试完成',
            });
          }

          send({ type: 'complete', message: '所有测试完成' });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          send({ type: 'error', message: errorMessage });
        } finally {
          cleanupMonitors();
          request.signal.removeEventListener('abort', onAbort);
          ssh.dispose();
          controller.close();
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : '执行测试时发生错误';
        send({ type: 'error', message: errorMessage });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
