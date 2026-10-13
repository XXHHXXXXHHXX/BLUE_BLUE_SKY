/**
 * 用例测试 Store - 管理多标签页测试流程、SSH连接、Shell输出等
 */
import { create } from 'zustand';

export interface SSHConfig {
  host: string;
  port: number;
  username: string;
  password: string;
}

/** 迭代参数 */
export interface IterationParameter {
  id: string;
  name: string;
  mode: 'range' | 'custom';
  start: number;
  end: number;
  step: number;
  values: string[];
}

/** 调整命令 */
export interface AdjustmentCommand {
  id: string;
  name: string;
  target: 'host' | 'bmc';
  sessionId: string | null;
  command: string;
  parameterName: string;
  paramId: string; // 关联的迭代参数ID，一一对应
}

export interface TestResult {
  iteration: number;
  power: number;
  score: number;
  status: 'running' | 'success' | 'error';
  message?: string;
  timestamp: string;
  iterationValues?: Record<string, string>;
  iterationLabel?: string;
  monitorResults?: Record<string, MonitorResult>;
  /** 本轮迭代的日志压缩包本地路径 */
  logArchivePath?: string;
  /** 所属流水线阶段 */
  stageId?: string;
  stageName?: string;
}

export interface MonitorDataPoint {
  timestamp: string;
  value: number;
  raw: string;
}

export interface MonitorResult {
  commandId: string;
  commandName: string;
  dataPoints: MonitorDataPoint[];
  dataPointsCount?: number;
  averageValue: number;
}

export interface MonitorCommand {
  id: string;
  name: string;
  command: string;
  target: 'host' | 'bmc';
  sessionId: string | null;
  interval: number;
  enabled: boolean;
  /** 监控模式：single=单值，list=多值列表（逗号分隔） */
  mode?: 'single' | 'list';
  /** list 模式下每列的名称 */
  columns?: string[];
  /** 跳变阈值数值。相邻采样点变化超过此值记为一次跳变 */
  jumpThreshold?: number;
  /** 跳变阈值类型：percent=相对百分比，absolute=绝对幅度 */
  jumpThresholdType?: 'percent' | 'absolute';
  /** 跳过前 N 次跳变。从第 N+1 次跳变开始的数据计入平均值（0 表示不跳过） */
  skipJumps?: number;
  /** 直接跳过前 N 个采样点（无论值是多少）。与跳变检测独立 */
  skipFirst?: number;
  /** 只保留最后 N 个采样点（0 或 undefined 表示不限制）。与 skipFirst 叠加 */
  takeLast?: number;
  /** 屏蔽（跳过）最后 N 个采样点（0 或 undefined 表示不限制）。与 skipFirst / takeLast 叠加 */
  skipLast?: number;
  /** 排除数值为 0 的采样点，不纳入平均值计算 */
  excludeZero?: boolean;
}

/** 日志监控配置 */
export interface LogMonitorConfig {
  enabled: boolean;
  command: string;
  interval: number;
  target: 'host' | 'bmc';
  sessionId: string | null;
}

/** 流水线阶段 */
export interface PipelineStage {
  id: string;
  name: string;
  order: number;
  packageSource: 'upload' | 'library';
  packageLibraryId?: string;
  packageFileName: string;
  packageFile?: File;
  configTemplateId?: string | null;
  /** 阶段独立的监控命令；未设置时沿用配置模板或当前标签页配置 */
  monitorCommands?: MonitorCommand[];
  /** 阶段独立的环境变量；未设置时沿用配置模板或当前标签页配置 */
  envVars?: Array<{ key: string; value: string }>;
  remotePath?: string;
  jobId?: string;
  status?: 'pending' | 'running' | 'completed' | 'error' | 'skipped';
  /** 用例包要求的必填环境变量及其当前填写值 */
  requiredEnvVarValues?: Record<string, string>;
}

export interface TestTab {
  id: string;
  name: string;
  sshConfig: SSHConfig;
  isSSHConnected: boolean;
  isTestingConnection: boolean;
  testStatus: 'idle' | 'connecting' | 'connected' | 'disconnected' | 'testing' | 'completed' | 'error';
  testError: string | null;
  shellOutput: string[];
  muteMonitorOutput: boolean;
  
  // 迭代测试配置（保留powerTestConfig字段名以最小化改动）
  powerTestConfig: {
    iterationParams: IterationParameter[];
    adjustmentCommands: AdjustmentCommand[];
    packageFile: File | null;
    envVars: Array<{ key: string; value: string }>;
    monitorCommands: MonitorCommand[];
    // 心跳检测配置
    heartbeatEnabled: boolean;
    heartbeatInterval: number; // 秒
    heartbeatMaxFailures: number;
    // 告警配置
    alertWebhook: string;
    // 日志监控配置
    logMonitorConfig: LogMonitorConfig;
    // 统一 BMC 会话选择
    globalBmcSessionId: string | null;
    // 自定义任务名称
    jobName?: string;
  };
  
  // 测试结果
  testResults: TestResult[];
  currentIteration: number;
  isRunningTest: boolean;
  // 流水线模式
  pipelineMode?: boolean;
  pipelineStages?: PipelineStage[];
  pipelineCurrentStageIndex?: number;
}

interface TestState {
  // 多标签页管理
  tabs: TestTab[];
  activeTabId: string | null;
  
  // 全局Shell终端状态
  isShellVisible: boolean;
  
  // Actions
  addTab: () => void;
  removeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  updateTabName: (tabId: string, name: string) => void;
  
  setSSHConfig: (tabId: string, config: Partial<SSHConfig>) => void;
  setSSHConnected: (tabId: string, connected: boolean) => void;
  setTestingConnection: (tabId: string, testing: boolean) => void;
  
  setTestStatus: (tabId: string, status: TestTab['testStatus']) => void;
  setTestError: (tabId: string, error: string | null) => void;
  
  addShellOutput: (tabId: string, output: string) => void;
  appendShellOutput: (tabId: string, outputs: string[]) => void;
  clearShellOutput: (tabId: string) => void;
  setShellVisible: (visible: boolean) => void;
  setMuteMonitorOutput: (tabId: string, muted: boolean) => void;
  
  setPowerTestConfig: (tabId: string, config: Partial<TestTab['powerTestConfig']>) => void;
  setMonitorCommands: (tabId: string, commands: MonitorCommand[]) => void;
  setHeartbeatConfig: (tabId: string, config: Partial<Pick<TestTab['powerTestConfig'], 'heartbeatEnabled' | 'heartbeatInterval' | 'heartbeatMaxFailures'>>) => void;
  setAlertWebhook: (tabId: string, webhook: string) => void;
  setLogMonitorConfig: (tabId: string, config: Partial<LogMonitorConfig>) => void;
  setGlobalBmcSessionId: (tabId: string, sessionId: string | null) => void;
  
  // 测试结果相关
  addTestResult: (tabId: string, result: TestResult) => void;
  clearTestResults: (tabId: string) => void;
  setCurrentIteration: (tabId: string, iteration: number) => void;
  setIsRunningTest: (tabId: string, isRunning: boolean) => void;

  // 流水线相关
  setPipelineMode: (tabId: string, enabled: boolean) => void;
  setPipelineStages: (tabId: string, stages: PipelineStage[]) => void;
  addPipelineStage: (tabId: string, stage: PipelineStage) => void;
  removePipelineStage: (tabId: string, stageId: string) => void;
  updatePipelineStage: (tabId: string, stageId: string, partial: Partial<PipelineStage>) => void;
  setPipelineCurrentStageIndex: (tabId: string, index: number) => void;
  
  // 测试SSH连接
  testSSHConnection: (tabId: string) => Promise<boolean>;
}

const defaultSSHConfig: SSHConfig = {
  host: '',
  port: 22,
  username: '',
  password: '',
};

const createNewTab = (id: string, name: string): TestTab => ({
  id,
  name,
  sshConfig: { ...defaultSSHConfig },
  isSSHConnected: false,
  isTestingConnection: false,
  testStatus: 'idle',
  testError: null,
  shellOutput: [],
  muteMonitorOutput: false,
  powerTestConfig: {
    iterationParams: [
      { id: `param-${Date.now()}`, name: '功耗', mode: 'range', start: 100, end: 500, step: 50, values: [] },
    ],
    adjustmentCommands: [
      {
        id: `cmd-${Date.now()}`,
        name: 'BMC功耗调整',
        target: 'bmc',
        sessionId: null,
        parameterName: '功耗',
        paramId: `param-${Date.now()}`,
        command: `bash -l -c 'mdbctl call Smc_CpuBrdSMC_010101 bmc.kepler.Chip.BlockIO Write 0 0x00008A00 1 0x4 && (printf "powerCap 1 {{功耗}}\\r\\n"; sleep 5) | ipmcset -t sol -d activate -v 1 0; mdbctl call Smc_CpuBrdSMC_010101 bmc.kepler.Chip.BlockIO Write 0 0x00008A00 1 0x9 && (printf "powerCap 1 {{功耗}}\\r\\n"; sleep 5) | ipmcset -t sol -d activate -v 1 0'`,
      },
    ],
    packageFile: null,
    envVars: [],
    monitorCommands: [],
    heartbeatEnabled: true,
    heartbeatInterval: 10,
    heartbeatMaxFailures: 3,
    alertWebhook: '',
    logMonitorConfig: {
      enabled: false,
      command: '',
      interval: 10,
      target: 'host',
      sessionId: null,
    },
    globalBmcSessionId: null,
  },
  testResults: [],
  currentIteration: 0,
  isRunningTest: false,
  pipelineMode: false,
  pipelineStages: [],
  pipelineCurrentStageIndex: 0,
});

let tabCounter = 0;

const MAX_SHELL_OUTPUT_LINES = 10000;

const capShellOutput = (lines: string[]): string[] => {
  if (lines.length <= MAX_SHELL_OUTPUT_LINES) return lines;
  return lines.slice(-MAX_SHELL_OUTPUT_LINES);
};

export const useTestStore = create<TestState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  isShellVisible: true,

  addTab: () => {
    tabCounter++;
    const newTab = createNewTab(`tab-${Date.now()}`, `测试 ${tabCounter}`);
    set((state) => ({
      tabs: [...state.tabs, newTab],
      activeTabId: newTab.id,
    }));
    return newTab.id;
  },

  removeTab: (tabId) => {
    const { tabs, activeTabId } = get();
    if (tabs.length <= 1) {
      // 至少保留一个标签页
      return;
    }
    
    const newTabs = tabs.filter(t => t.id !== tabId);
    let newActiveId = activeTabId;
    
    if (activeTabId === tabId) {
      // 如果关闭的是当前标签，切换到相邻的标签
      const closedIndex = tabs.findIndex(t => t.id === tabId);
      const newIndex = Math.max(0, closedIndex - 1);
      newActiveId = newTabs[newIndex]?.id || null;
    }
    
    set({ tabs: newTabs, activeTabId: newActiveId });
  },

  setActiveTab: (tabId) => {
    set({ activeTabId: tabId });
  },

  updateTabName: (tabId, name) => {
    set((state) => ({
      tabs: state.tabs.map(tab =>
        tab.id === tabId ? { ...tab, name } : tab
      ),
    }));
  },

  setSSHConfig: (tabId, config) => {
    set((state) => ({
      tabs: state.tabs.map(tab =>
        tab.id === tabId
          ? { ...tab, sshConfig: { ...tab.sshConfig, ...config } }
          : tab
      ),
    }));
  },

  setSSHConnected: (tabId, connected) => {
    set((state) => ({
      tabs: state.tabs.map(tab =>
        tab.id === tabId ? { ...tab, isSSHConnected: connected } : tab
      ),
    }));
  },

  setTestingConnection: (tabId, testing) => {
    set((state) => ({
      tabs: state.tabs.map(tab =>
        tab.id === tabId ? { ...tab, isTestingConnection: testing } : tab
      ),
    }));
  },

  setTestStatus: (tabId, status) => {
    set((state) => ({
      tabs: state.tabs.map(tab =>
        tab.id === tabId ? { ...tab, testStatus: status } : tab
      ),
    }));
  },

  setTestError: (tabId, error) => {
    set((state) => ({
      tabs: state.tabs.map(tab =>
        tab.id === tabId ? { ...tab, testError: error } : tab
      ),
    }));
  },

  addShellOutput: (tabId, output) => {
    set((state) => ({
      tabs: state.tabs.map(tab =>
        tab.id === tabId
          ? { ...tab, shellOutput: capShellOutput([...tab.shellOutput, output]) }
          : tab
      ),
    }));
  },

  appendShellOutput: (tabId, outputs) => {
    set((state) => ({
      tabs: state.tabs.map(tab =>
        tab.id === tabId
          ? { ...tab, shellOutput: capShellOutput([...tab.shellOutput, ...outputs]) }
          : tab
      ),
    }));
  },

  clearShellOutput: (tabId) => {
    set((state) => ({
      tabs: state.tabs.map(tab =>
        tab.id === tabId ? { ...tab, shellOutput: [] } : tab
      ),
    }));
  },

  setShellVisible: (visible) => {
    set({ isShellVisible: visible });
  },

  setMuteMonitorOutput: (tabId, muted) => {
    set((state) => ({
      tabs: state.tabs.map(tab =>
        tab.id === tabId ? { ...tab, muteMonitorOutput: muted } : tab
      ),
    }));
  },

  setPowerTestConfig: (tabId, config) => {
    set((state) => ({
      tabs: state.tabs.map(tab =>
        tab.id === tabId
          ? { ...tab, powerTestConfig: { ...tab.powerTestConfig, ...config } }
          : tab
      ),
    }));
  },

  setMonitorCommands: (tabId, commands) => {
    set((state) => ({
      tabs: state.tabs.map(tab =>
        tab.id === tabId
          ? { ...tab, powerTestConfig: { ...tab.powerTestConfig, monitorCommands: commands } }
          : tab
      ),
    }));
  },

  setHeartbeatConfig: (tabId, config) => {
    set((state) => ({
      tabs: state.tabs.map(tab =>
        tab.id === tabId
          ? { ...tab, powerTestConfig: { ...tab.powerTestConfig, ...config } }
          : tab
      ),
    }));
  },

  setAlertWebhook: (tabId, webhook) => {
    set((state) => ({
      tabs: state.tabs.map(tab =>
        tab.id === tabId
          ? { ...tab, powerTestConfig: { ...tab.powerTestConfig, alertWebhook: webhook } }
          : tab
      ),
    }));
  },

  setLogMonitorConfig: (tabId, config) => {
    set((state) => ({
      tabs: state.tabs.map(tab =>
        tab.id === tabId
          ? { ...tab, powerTestConfig: { ...tab.powerTestConfig, logMonitorConfig: { ...tab.powerTestConfig.logMonitorConfig, ...config } } }
          : tab
      ),
    }));
  },

  setGlobalBmcSessionId: (tabId, sessionId) => {
    set((state) => ({
      tabs: state.tabs.map(tab =>
        tab.id === tabId
          ? { ...tab, powerTestConfig: { ...tab.powerTestConfig, globalBmcSessionId: sessionId } }
          : tab
      ),
    }));
  },

  addTestResult: (tabId, result) => {
    set((state) => ({
      tabs: state.tabs.map(tab =>
        tab.id === tabId
          ? { ...tab, testResults: [...tab.testResults, result] }
          : tab
      ),
    }));
  },

  clearTestResults: (tabId) => {
    set((state) => ({
      tabs: state.tabs.map(tab =>
        tab.id === tabId ? { ...tab, testResults: [], currentIteration: 0 } : tab
      ),
    }));
  },

  setCurrentIteration: (tabId, iteration) => {
    set((state) => ({
      tabs: state.tabs.map(tab =>
        tab.id === tabId ? { ...tab, currentIteration: iteration } : tab
      ),
    }));
  },

  setIsRunningTest: (tabId, isRunning) => {
    set((state) => ({
      tabs: state.tabs.map(tab =>
        tab.id === tabId ? { ...tab, isRunningTest: isRunning } : tab
      ),
    }));
  },

  setPipelineMode: (tabId, enabled) => {
    set((state) => ({
      tabs: state.tabs.map(tab =>
        tab.id === tabId ? { ...tab, pipelineMode: enabled } : tab
      ),
    }));
  },

  setPipelineStages: (tabId, stages) => {
    set((state) => ({
      tabs: state.tabs.map(tab =>
        tab.id === tabId ? { ...tab, pipelineStages: stages } : tab
      ),
    }));
  },

  addPipelineStage: (tabId, stage) => {
    set((state) => ({
      tabs: state.tabs.map(tab =>
        tab.id === tabId
          ? { ...tab, pipelineStages: [...(tab.pipelineStages || []), stage] }
          : tab
      ),
    }));
  },

  removePipelineStage: (tabId, stageId) => {
    set((state) => ({
      tabs: state.tabs.map(tab =>
        tab.id === tabId
          ? { ...tab, pipelineStages: (tab.pipelineStages || []).filter((s) => s.id !== stageId) }
          : tab
      ),
    }));
  },

  updatePipelineStage: (tabId, stageId, partial) => {
    set((state) => ({
      tabs: state.tabs.map(tab =>
        tab.id === tabId
          ? {
              ...tab,
              pipelineStages: (tab.pipelineStages || []).map((s) =>
                s.id === stageId ? { ...s, ...partial } : s
              ),
            }
          : tab
      ),
    }));
  },

  setPipelineCurrentStageIndex: (tabId, index) => {
    set((state) => ({
      tabs: state.tabs.map(tab =>
        tab.id === tabId ? { ...tab, pipelineCurrentStageIndex: index } : tab
      ),
    }));
  },

  testSSHConnection: async (tabId) => {
    const { tabs } = get();
    const tab = tabs.find(t => t.id === tabId);
    if (!tab) return false;

    const { sshConfig } = tab;
    get().setTestingConnection(tabId, true);
    get().setTestError(tabId, null);

    try {
      const response = await fetch('/api/test/ssh-connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sshConfig),
      });

      const result = await response.json();

      if (result.success) {
        get().setSSHConnected(tabId, true);
        get().setTestStatus(tabId, 'connected');
        get().setTestError(tabId, null);
        return true;
      } else {
        get().setSSHConnected(tabId, false);
        get().setTestStatus(tabId, 'error');
        get().setTestError(tabId, result.message);
        return false;
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : '连接测试失败';
      get().setSSHConnected(tabId, false);
      get().setTestStatus(tabId, 'error');
      get().setTestError(tabId, errorMsg);
      return false;
    } finally {
      get().setTestingConnection(tabId, false);
    }
  },
}));
