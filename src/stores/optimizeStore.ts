import { create } from 'zustand';

export interface VariableRange {
  name: string;
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
  current: number;
}

export interface ObjectiveConfig {
  name: string;
  label: string;
  weight: number;
  direction: 'minimize' | 'maximize';
  unit: string;
}

export interface AlgorithmConfig {
  name: string;
  label: string;
  params: Record<string, number | string>;
}

export interface Constraint {
  id: string;
  variable: string;
  operator: '<=' | '>=' | '=' | '<' | '>';
  value: number;
  enabled: boolean;
}

export interface OptimizationTask {
  id: string;
  name: string;
  status: 'idle' | 'running' | 'paused' | 'completed' | 'failed';
  algorithm: string;
  progress: number;
  currentIteration: number;
  maxIterations: number;
  startTime?: number;
  endTime?: number;
  bestFitness: number;
  objectives: string[];
  optimalPoint?: Record<string, number>;
}

export interface ParetoPoint {
  power: number;
  performance: number;
  efficiency: number;
  params: Record<string, number>;
  isSelected?: boolean;
}

export interface ConvergencePoint {
  iteration: number;
  bestFitness: number;
  avgFitness: number;
  diversity: number;
}

interface OptimizeStore {
  // 变量配置
  inputVariables: VariableRange[];
  outputObjectives: ObjectiveConfig[];
  setInputVariables: (vars: VariableRange[]) => void;
  setOutputObjectives: (objs: ObjectiveConfig[]) => void;
  updateVariableRange: (name: string, updates: Partial<VariableRange>) => void;

  // 算法配置
  selectedAlgorithm: string;
  algorithmParams: Record<string, number | string>;
  setSelectedAlgorithm: (algo: string) => void;
  setAlgorithmParam: (key: string, value: number | string) => void;

  // 约束条件
  constraints: Constraint[];
  setConstraints: (c: Constraint[]) => void;
  addConstraint: (c: Constraint) => void;
  removeConstraint: (id: string) => void;

  // 任务管理
  tasks: OptimizationTask[];
  currentTaskId: string | null;
  addTask: (task: OptimizationTask) => void;
  updateTask: (id: string, updates: Partial<OptimizationTask>) => void;
  setCurrentTask: (id: string | null) => void;
  removeTask: (id: string) => void;

  // 寻优过程数据
  convergenceHistory: ConvergencePoint[];
  paretoFront: ParetoPoint[];
  addConvergencePoint: (p: ConvergencePoint) => void;
  setParetoFront: (p: ParetoPoint[]) => void;
  clearHistory: () => void;

  // 寻优控制
  isRunning: boolean;
  startOptimization: () => void;
  pauseOptimization: () => void;
  stopOptimization: () => void;

  // 选中的帕累托点
  selectedParetoIndex: number | null;
  setSelectedParetoIndex: (idx: number | null) => void;
}

const defaultInputVars: VariableRange[] = [
  { name: 'voltage', label: '核心电压', min: 0.8, max: 1.4, step: 0.01, unit: 'V', current: 1.05 },
  { name: 'frequency', label: '工作频率', min: 1.2, max: 4.5, step: 0.1, unit: 'GHz', current: 3.2 },
  { name: 'fanSpeed', label: '风扇转速', min: 800, max: 4000, step: 100, unit: 'RPM', current: 1800 },
  { name: 'cacheRatio', label: '缓存倍频', min: 8, max: 24, step: 1, unit: 'x', current: 16 },
  { name: 'uncoreVoltage', label: 'uncore电压', min: 0.9, max: 1.3, step: 0.01, unit: 'V', current: 1.1 },
];

const defaultObjectives: ObjectiveConfig[] = [
  { name: 'power', label: '整机功耗', weight: 0.3, direction: 'minimize', unit: 'W' },
  { name: 'performance', label: '综合性能', weight: 0.4, direction: 'maximize', unit: '分' },
  { name: 'efficiency', label: '能效比', weight: 0.3, direction: 'maximize', unit: '分/W' },
];

const defaultAlgorithmParams: Record<string, Record<string, number | string>> = {
  ga: { populationSize: 50, crossoverRate: 0.8, mutationRate: 0.05, eliteCount: 5 },
  pso: { swarmSize: 40, inertiaWeight: 0.7, cognitiveCoeff: 1.5, socialCoeff: 1.5 },
  sa: { initialTemp: 100, coolingRate: 0.995, minTemp: 0.001 },
  bo: { initPoints: 10, acquisition: 'ei', kappa: 2.576, xi: 0.01 },
  de: { populationSize: 50, crossoverProb: 0.7, differentialWeight: 0.8 },
  cmaes: { populationSize: 50, sigma: 0.3 },
};

export const algorithmOptions = [
  { value: 'ga', label: '遗传算法 (GA)' },
  { value: 'pso', label: '粒子群优化 (PSO)' },
  { value: 'sa', label: '模拟退火 (SA)' },
  { value: 'bo', label: '贝叶斯优化 (BO)' },
  { value: 'de', label: '差分进化 (DE)' },
  { value: 'cmaes', label: 'CMA-ES' },
];

export const useOptimizeStore = create<OptimizeStore>((set, get) => ({
  inputVariables: defaultInputVars,
  outputObjectives: defaultObjectives,
  setInputVariables: (vars) => set({ inputVariables: vars }),
  setOutputObjectives: (objs) => set({ outputObjectives: objs }),
  updateVariableRange: (name, updates) =>
    set((state) => ({
      inputVariables: state.inputVariables.map((v) =>
        v.name === name ? { ...v, ...updates } : v
      ),
    })),

  selectedAlgorithm: 'ga',
  algorithmParams: defaultAlgorithmParams['ga'],
  setSelectedAlgorithm: (algo) =>
    set({
      selectedAlgorithm: algo,
      algorithmParams: defaultAlgorithmParams[algo] || {},
    }),
  setAlgorithmParam: (key, value) =>
    set((state) => ({
      algorithmParams: { ...state.algorithmParams, [key]: value },
    })),

  constraints: [
    { id: 'c1', variable: 'temperature', operator: '<=', value: 85, enabled: true },
    { id: 'c2', variable: 'power', operator: '<=', value: 200, enabled: true },
  ],
  setConstraints: (c) => set({ constraints: c }),
  addConstraint: (c) => set((state) => ({ constraints: [...state.constraints, c] })),
  removeConstraint: (id) =>
    set((state) => ({ constraints: state.constraints.filter((c) => c.id !== id) })),

  tasks: [],
  currentTaskId: null,
  addTask: (task) => set((state) => ({ tasks: [task, ...state.tasks] })),
  updateTask: (id, updates) =>
    set((state) => ({
      tasks: state.tasks.map((t) => (t.id === id ? { ...t, ...updates } : t)),
    })),
  setCurrentTask: (id) => set({ currentTaskId: id }),
  removeTask: (id) =>
    set((state) => ({
      tasks: state.tasks.filter((t) => t.id !== id),
      currentTaskId: state.currentTaskId === id ? null : state.currentTaskId,
    })),

  convergenceHistory: [],
  paretoFront: [],
  addConvergencePoint: (p) =>
    set((state) => ({
      convergenceHistory: [...state.convergenceHistory, p],
    })),
  setParetoFront: (p) => set({ paretoFront: p }),
  clearHistory: () => set({ convergenceHistory: [], paretoFront: [] }),

  isRunning: false,
  startOptimization: () => set({ isRunning: true }),
  pauseOptimization: () => set({ isRunning: false }),
  stopOptimization: () => {
    const currentTaskId = get().currentTaskId;
    if (currentTaskId) {
      set((state) => ({
        isRunning: false,
        tasks: state.tasks.map((t) =>
          t.id === currentTaskId ? { ...t, status: 'completed' as const } : t
        ),
      }));
    } else {
      set({ isRunning: false });
    }
  },

  selectedParetoIndex: null,
  setSelectedParetoIndex: (idx) => set({ selectedParetoIndex: idx }),
}));
