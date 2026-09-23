/** 共享存储 - 使用文件系统持久化 - 支持多拓扑管理 */
import fs from 'fs';
import path from 'path';
import type { TopologyNode, TopologyExportData, BMCConfig } from '../../../src/types/topology';

/** 全局监控状态 */
export interface GlobalMonitorState {
  isPolling: boolean;
  pollInterval: number;
  updatedAt: string;
  updatedBy: string;
}

/** 版本历史类型 */
export interface TopologyVersion {
  id: string;
  label: string;
  notes?: string;
  timestamp: string;
  isAuto: boolean;
  data: TopologyExportData;
}

/** 拓扑元数据 */
export interface TopologyMeta {
  id: string;           // 唯一标识（文件夹名）
  name: string;         // 显示名称
  description?: string; // 描述
  createdAt: string;    // 创建时间
  updatedAt: string;    // 最后更新时间
  isDefault: boolean;   // 是否默认（不可删除）
  nodeCount: number;    // 节点数量
}

/** 拓扑列表索引 */
export interface TopologiesIndex {
  currentId: string;
  topologies: TopologyMeta[];
}

// ========== 路径配置 ==========
const DATA_DIR = path.join(process.cwd(), '.data');
const TOPOLOGIES_FILE = path.join(DATA_DIR, 'topologies.json');
const CURRENT_TOPOLOGY_FILE = path.join(DATA_DIR, 'current.txt');
const MONITOR_FILE = path.join(DATA_DIR, 'monitor.json');

// 旧文件路径（用于迁移）
const LEGACY_TOPOLOGY_FILE = path.join(DATA_DIR, 'topology.json');
const LEGACY_VERSIONS_FILE = path.join(DATA_DIR, 'versions.json');

// 默认拓扑ID
const DEFAULT_TOPOLOGY_ID = 'default';

// 确保数据目录存在
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

// 获取拓扑文件夹路径
function getTopologyDir(topologyId: string): string {
  return path.join(DATA_DIR, topologyId);
}

// 确保拓扑文件夹存在
function ensureTopologyDir(topologyId: string) {
  const dir = getTopologyDir(topologyId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// 获取拓扑文件路径
function getTopologyFilePath(topologyId: string): string {
  return path.join(getTopologyDir(topologyId), 'topology.json');
}

// 获取拓扑BMC配置文件路径
function getBMCConfigFilePath(topologyId: string): string {
  return path.join(getTopologyDir(topologyId), 'bmc-config.json');
}

// 获取版本文件路径
function getVersionsFilePath(topologyId: string): string {
  return path.join(getTopologyDir(topologyId), 'versions.json');
}

// 文件存储辅助函数
function loadJsonFile<T>(filePath: string, defaultValue: T): T {
  try {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(data);
    }
  } catch {
    console.error(`Failed to load ${filePath}`);
  }
  return defaultValue;
}

function saveJsonFile(filePath: string, data: unknown): void {
  ensureDataDir();
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch {
    console.error(`Failed to save ${filePath}`);
  }
}

function loadTextFile(filePath: string, defaultValue: string): string {
  try {
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf-8').trim();
    }
  } catch {
    console.error(`Failed to load ${filePath}`);
  }
  return defaultValue;
}

function saveTextFile(filePath: string, content: string): void {
  ensureDataDir();
  try {
    fs.writeFileSync(filePath, content);
  } catch {
    console.error(`Failed to save ${filePath}`);
  }
}

// 默认字段映射配置（与前端 mockData.ts 保持一致，使用 fieldKey）
const defaultFieldMappings: Record<string, Array<{ fieldKey: string; bmcField: string }>> = {
  ac: [
    { fieldKey: 'outputVoltage', bmcField: 'AC输出电压' },
    { fieldKey: 'current', bmcField: 'AC输出电流' },
    { fieldKey: 'outputPower', bmcField: 'AC输出功率' },
  ],
  busbar: [
    { fieldKey: 'busbarVoltage', bmcField: '母线电压' },
    { fieldKey: 'busbarCurrent', bmcField: '母线电流' },
    { fieldKey: 'busbarPower', bmcField: '母线功耗' },
  ],
  psu: [
    { fieldKey: 'inputVoltage', bmcField: 'PSU输入电压' },
    { fieldKey: 'inputCurrent', bmcField: 'PSU输入电流' },
    { fieldKey: 'inputPower', bmcField: 'PSU输入功率' },
    { fieldKey: 'outputVoltage', bmcField: 'PSU输出电压' },
    { fieldKey: 'outputCurrent', bmcField: 'PSU输出电流' },
    { fieldKey: 'outputPower', bmcField: 'PSU输出功率' },
    { fieldKey: 'psuIntakeTemp', bmcField: 'PSU(入风口)温度' },
    { fieldKey: 'psuMosTemp', bmcField: 'PSU(主功率MOS)温度' },
    { fieldKey: 'psuRearIntakeTemp', bmcField: '后扩PSU位置(PSU入风)温度' },
  ],
  vr: [
    { fieldKey: 'inputVoltage', bmcField: 'VR输入电压' },
    { fieldKey: 'inputCurrent', bmcField: 'VR输入电流' },
    { fieldKey: 'inputPower', bmcField: 'VR输入功率' },
    { fieldKey: 'outputVoltage', bmcField: 'VR输出电压' },
    { fieldKey: 'outputCurrent', bmcField: 'VR输出电流' },
    { fieldKey: 'outputPower', bmcField: 'VR输出功率' },
    { fieldKey: 'vrOutputVoltageControl', bmcField: 'VR输出电压调节接口' },
    { fieldKey: 'efficiency', bmcField: 'VR Efficiency' },
    { fieldKey: 'temperature', bmcField: 'VR Temperature' },
  ],
  psip: [
    { fieldKey: 'inputVoltage', bmcField: 'psip输入电压' },
    { fieldKey: 'inputCurrent', bmcField: 'psip输入电流' },
    { fieldKey: 'inputPower', bmcField: 'psip输入功率' },
    { fieldKey: 'psipOutputVoltageUnionsVtt', bmcField: 'psip输出电压 - Unions VTT' },
    { fieldKey: 'psipOutputVoltageUnionsHvcc', bmcField: 'psip输出电压 - Unions HVCC' },
    { fieldKey: 'psipOutputVoltageNimbusHvcc', bmcField: 'psip输出电压 - Nimbus HVCC' },
    { fieldKey: 'psipOutputVoltageUnionsLvcc', bmcField: 'psip输出电压 - Unions LVCC' },
    { fieldKey: 'psipOutputVoltageNimbusLvcc', bmcField: 'psip输出电压 - Nimbus LVCC' },
    { fieldKey: 'psipOutputVoltage3v3Drmos', bmcField: 'psip输出电压 - 3.3 DRMOS' },
    { fieldKey: 'psipOutputVoltage1v8Gpio', bmcField: 'psip输出电压 - 1V8 GPIO' },
    { fieldKey: 'psipOutputCurrentUnionsVtt', bmcField: 'psip输出电流 - Unions VTT' },
    { fieldKey: 'psipOutputCurrentUnionsHvcc', bmcField: 'psip输出电流 - Unions HVCC' },
    { fieldKey: 'psipOutputCurrentNimbusHvcc', bmcField: 'psip输出电流 - Nimbus HVCC' },
    { fieldKey: 'psipOutputCurrentUnionsLvcc', bmcField: 'psip输出电流 - Unions LVCC' },
    { fieldKey: 'psipOutputCurrentNimbusLvcc', bmcField: 'psip输出电流 - Nimbus LVCC' },
    { fieldKey: 'psipOutputCurrent3v3Drmos', bmcField: 'psip输出电流 - 3.3 DRMOS' },
    { fieldKey: 'psipOutputCurrent1v8Gpio', bmcField: 'psip输出电流 - 1V8 GPIO' },
    { fieldKey: 'psipOutputPowerUnionsVtt', bmcField: 'psip输出功率 - Unions VTT' },
    { fieldKey: 'psipOutputPowerUnionsHvcc', bmcField: 'psip输出功率 - Unions HVCC' },
    { fieldKey: 'psipOutputPowerNimbusHvcc', bmcField: 'psip输出功率 - Nimbus HVCC' },
    { fieldKey: 'psipOutputPowerUnionsLvcc', bmcField: 'psip输出功率 - Unions LVCC' },
    { fieldKey: 'psipOutputPowerNimbusLvcc', bmcField: 'psip输出功率 - Nimbus LVCC' },
    { fieldKey: 'psipOutputPower3v3Drmos', bmcField: 'psip输出功率 - 3.3 DRMOS' },
    { fieldKey: 'psipOutputPower1v8Gpio', bmcField: 'psip输出功率 - 1V8 GPIO' },
    { fieldKey: 'psipOutputVoltageControl', bmcField: 'psip输出电压调节接口' },
    { fieldKey: 'efficiency', bmcField: 'PSIP Efficiency' },
    { fieldKey: 'temperature', bmcField: 'PSIP Temperature' },
  ],
  fan: [
    { fieldKey: 'fanInputVoltage', bmcField: '风扇输入电压' },
    { fieldKey: 'fanInputCurrent', bmcField: '风扇输入电流' },
    { fieldKey: 'power', bmcField: '风扇总功耗' },
    { fieldKey: 'rpm', bmcField: '风扇风速' },
  ],
  cpu: [
    { fieldKey: 'power', bmcField: 'CPU功耗' },
  ],
  memory: [
    { fieldKey: 'dimmInputVoltage', bmcField: '内存输入电压' },
    { fieldKey: 'dimmInputCurrent', bmcField: '内存输入电流' },
    { fieldKey: 'power', bmcField: '内存功耗' },
    { fieldKey: 'temperature', bmcField: '内存条温度' },
    { fieldKey: 'dimmThermalTarget', bmcField: 'DIMM控温目标' },
  ],
  disk: [
    { fieldKey: 'diskInputVoltage', bmcField: '硬盘背板输入电压' },
    { fieldKey: 'diskInputCurrent', bmcField: '硬盘背板输入电流' },
    { fieldKey: 'power', bmcField: '硬盘背板功耗' },
    { fieldKey: 'temperature', bmcField: '硬盘背板温度' },
    { fieldKey: 'nvmeInternalTemp', bmcField: 'NVMe盘内置温度' },
    { fieldKey: 'nvmeMaxTemp', bmcField: '所有NVMe盘最大温度' },
  ],
  card: [
    { fieldKey: 'cardInputVoltage', bmcField: '标卡输入电压' },
    { fieldKey: 'cardInputCurrent', bmcField: '标卡输入电流' },
    { fieldKey: 'power', bmcField: '标卡功耗' },
    { fieldKey: 'ocpMainChipTemp', bmcField: 'OCP卡主芯片温度' },
    { fieldKey: 'ocpOpticalMaxTemp', bmcField: 'OCP卡光模块最高温度' },
  ],
  sensor: [
    { fieldKey: 'temperature', bmcField: '板级其他温度监测点温度' },
    { fieldKey: 'location', bmcField: 'Sensor Location' },
  ],
  mgmtBoard: [
    { fieldKey: 'temperature', bmcField: 'MGMT Temp' },
    { fieldKey: 'status', bmcField: 'MGMT Status' },
  ],
  custom: [
    { fieldKey: 'power', bmcField: '自定义模块功耗' },
  ],
};

// CPU电源域默认字段映射配置（用于"电源域详情"弹窗内的固定字段）
const defaultPowerDomainFieldMappings: Array<{ fieldKey: string; bmcField: string }> = [
  { fieldKey: 'cpuDomainTaCoreDvfsOutputVoltage', bmcField: 'CPU电源域TA_CORE_DVFS输出电压' },
  { fieldKey: 'cpuDomainTaCoreDvfsOutputCurrent', bmcField: 'CPU电源域TA_CORE_DVFS输出电流' },
  { fieldKey: 'cpuDomainTaCoreDvfsOutputPower', bmcField: 'CPU电源域TA_CORE_DVFS输出功率' },
  { fieldKey: 'cpuDomainDdrioOutputVoltage', bmcField: 'CPU电源域DDRIO输出电压' },
  { fieldKey: 'cpuDomainDdrioOutputCurrent', bmcField: 'CPU电源域DDRIO输出电流' },
  { fieldKey: 'cpuDomainDdrioOutputPower', bmcField: 'CPU电源域DDRIO输出功率' },
  { fieldKey: 'cpuDomainTbCoreDvfsOutputVoltage', bmcField: 'CPU电源域TB_CORE_DVFS输出电压' },
  { fieldKey: 'cpuDomainTbCoreDvfsOutputCurrent', bmcField: 'CPU电源域TB_CORE_DVFS输出电流' },
  { fieldKey: 'cpuDomainTbCoreDvfsOutputPower', bmcField: 'CPU电源域TB_CORE_DVFS输出功率' },
  { fieldKey: 'cpuDomainIoNbAvsOutputVoltage', bmcField: 'CPU电源域IO_NB_AVS输出电压' },
  { fieldKey: 'cpuDomainIoNbAvsOutputCurrent', bmcField: 'CPU电源域IO_NB_AVS输出电流' },
  { fieldKey: 'cpuDomainIoNbAvsOutputPower', bmcField: 'CPU电源域IO_NB_AVS输出功率' },
  { fieldKey: 'cpuDomainUncoreDvfsOutputVoltage', bmcField: 'CPU电源域UNCORE_DVFS输出电压' },
  { fieldKey: 'cpuDomainUncoreDvfsOutputCurrent', bmcField: 'CPU电源域UNCORE_DVFS输出电流' },
  { fieldKey: 'cpuDomainUncoreDvfsOutputPower', bmcField: 'CPU电源域UNCORE_DVFS输出功率' },
  { fieldKey: 'cpuDomainIoNaAvsOutputVoltage', bmcField: 'CPU电源域IO_NA_AVS输出电压' },
  { fieldKey: 'cpuDomainIoNaAvsOutputCurrent', bmcField: 'CPU电源域IO_NA_AVS输出电流' },
  { fieldKey: 'cpuDomainIoNaAvsOutputPower', bmcField: 'CPU电源域IO_NA_AVS输出功率' },
  { fieldKey: 'cpuDomainSerdesOutputVoltage', bmcField: 'CPU电源域SERDES输出电压' },
  { fieldKey: 'cpuDomainSerdesOutputCurrent', bmcField: 'CPU电源域SERDES输出电流' },
  { fieldKey: 'cpuDomainSerdesOutputPower', bmcField: 'CPU电源域SERDES输出功率' },
];

// 默认拓扑数据
export const defaultTopology: TopologyExportData = {
  version: '1.0.0',
  exportTime: new Date().toISOString(),
  nodes: [
    {
      id: 'ac-1',
      type: 'ac',
      position: { x: 400, y: 50 },
      data: {
        nodeType: 'ac',
        label: '交流电源',
        category: 'source',
        apiConfig: { fieldMappings: defaultFieldMappings.ac },
        sourceData: { inputVoltage: 220, outputVoltage: 220, current: 30, inputCurrent: 30, outputCurrent: 30, inputPower: 850, outputPower: 803, efficiency: 94.5, temperature: 45 }
      }
    },
    {
      id: 'psu-1',
      type: 'psu',
      position: { x: 400, y: 150 },
      data: {
        nodeType: 'psu',
        label: '电源模块1',
        category: 'source',
        apiConfig: { fieldMappings: defaultFieldMappings.psu },
        sourceData: { inputVoltage: 220, outputVoltage: 12, current: 30, inputCurrent: 30, outputCurrent: 30, inputPower: 400, outputPower: 376, efficiency: 94, temperature: 48, psuIntakeTemp: 35, psuMosTemp: 55, psuRearIntakeTemp: 38 }
      }
    },
    {
      id: 'fan-1',
      type: 'fan',
      position: { x: 200, y: 300 },
      data: {
        nodeType: 'fan',
        label: '风扇1',
        category: 'load',
        apiConfig: { fieldMappings: defaultFieldMappings.fan },
        fanData: { power: 15, rpm: 5000, speedPercent: 60, temperature: 40, fanInputVoltage: 12, fanInputCurrent: 1.25 }
      }
    },
    {
      id: 'cpu-1',
      type: 'cpu',
      position: { x: 400, y: 300 },
      data: {
        nodeType: 'cpu',
        label: 'CPU0',
        category: 'load',
        apiConfig: { fieldMappings: defaultFieldMappings.cpu, powerDomainFieldMappings: defaultPowerDomainFieldMappings },
        cpuData: { 
          power: 150, 
          temperature: 72, 
          powerDomains: [
            { name: 'TA_CORE_DVFS', voltage: 0.85, current: 80, power: 68 },
            { name: 'DDRIO', voltage: 1.1, current: 15, power: 16.5 },
            { name: 'TB_CORE_DVFS', voltage: 0.85, current: 75, power: 63.75 },
            { name: 'IO_NB_AVS', voltage: 0.95, current: 10, power: 9.5 },
            { name: 'UNCORE_DVFS', voltage: 0.9, current: 25, power: 22.5 },
            { name: 'IO_NA_AVS', voltage: 0.95, current: 8, power: 7.6 },
            { name: 'SERDES', voltage: 0.9, current: 12, power: 10.8 }
          ], 
          amuEvents: [
            { id: 'amu-1', timestamp: new Date(Date.now() - 60000).toISOString(), type: 'info', domain: 'TA_CORE_DVFS', message: '电源域功耗正常', value: 68 },
            { id: 'amu-2', timestamp: new Date(Date.now() - 120000).toISOString(), type: 'warning', domain: 'DDRIO', message: '功耗接近阈值', value: 16.5 },
            { id: 'amu-3', timestamp: new Date(Date.now() - 180000).toISOString(), type: 'info', domain: 'TB_CORE_DVFS', message: '电源域功耗正常', value: 63.75 },
            { id: 'amu-4', timestamp: new Date(Date.now() - 240000).toISOString(), type: 'error', domain: 'IO_NB_AVS', message: '检测到功耗尖峰', value: 9.5 },
            { id: 'amu-5', timestamp: new Date(Date.now() - 300000).toISOString(), type: 'warning', domain: 'UNCORE_DVFS', message: '电压波动检测', value: 22.5 }
          ] 
        }
      }
    }
  ],
  edges: [
    { id: 'e-ac-psu', source: 'ac-1', target: 'psu-1', type: 'powerEdge', data: { loss: 47, lossPercent: 5.5, animated: true } },
    { id: 'e-psu-fan', source: 'psu-1', target: 'fan-1', type: 'powerEdge', data: { loss: 2, lossPercent: 0.5, animated: true } },
    { id: 'e-psu-cpu', source: 'psu-1', target: 'cpu-1', type: 'powerEdge', data: { loss: 5, lossPercent: 1.3, animated: true } }
  ],
  nodeScales: {}
};

// ========== 迁移逻辑 ==========
function migrateLegacyData(): void {
  // 检查是否需要迁移
  if (fs.existsSync(LEGACY_TOPOLOGY_FILE)) {
    console.log('[Migration] 检测到旧数据，开始迁移...');
    
    // 创建默认拓扑
    ensureTopologyDir(DEFAULT_TOPOLOGY_ID);
    
    // 迁移拓扑数据
    const legacyTopology = loadJsonFile<TopologyExportData>(LEGACY_TOPOLOGY_FILE, defaultTopology);
    saveJsonFile(getTopologyFilePath(DEFAULT_TOPOLOGY_ID), legacyTopology);
    
    // 迁移版本历史
    if (fs.existsSync(LEGACY_VERSIONS_FILE)) {
      const legacyVersions = loadJsonFile<TopologyVersion[]>(LEGACY_VERSIONS_FILE, []);
      saveJsonFile(getVersionsFilePath(DEFAULT_TOPOLOGY_ID), legacyVersions);
      // 删除旧版本文件
      try {
        fs.unlinkSync(LEGACY_VERSIONS_FILE);
      } catch {
        // ignore
      }
    }
    
    // 删除旧拓扑文件
    try {
      fs.unlinkSync(LEGACY_TOPOLOGY_FILE);
    } catch {
      // ignore
    }
    
    // 初始化 topologies.json
    const index: TopologiesIndex = {
      currentId: DEFAULT_TOPOLOGY_ID,
      topologies: [{
        id: DEFAULT_TOPOLOGY_ID,
        name: '默认拓扑',
        description: '系统默认拓扑',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isDefault: true,
        nodeCount: legacyTopology.nodes.length
      }]
    };
    saveJsonFile(TOPOLOGIES_FILE, index);
    saveTextFile(CURRENT_TOPOLOGY_FILE, DEFAULT_TOPOLOGY_ID);
    
    console.log('[Migration] 迁移完成');
  }
}

// ========== TopologiesIndex 管理 ==========
export const topologiesStore = {
  get data(): TopologiesIndex {
    // 首次加载时检查迁移
    if (fs.existsSync(LEGACY_TOPOLOGY_FILE)) {
      migrateLegacyData();
    }
    
    const defaultIndex: TopologiesIndex = {
      currentId: DEFAULT_TOPOLOGY_ID,
      topologies: []
    };
    
    const index = loadJsonFile<TopologiesIndex>(TOPOLOGIES_FILE, defaultIndex);
    
    // 如果没有拓扑列表，初始化默认拓扑
    if (index.topologies.length === 0) {
      ensureTopologyDir(DEFAULT_TOPOLOGY_ID);
      saveJsonFile(getTopologyFilePath(DEFAULT_TOPOLOGY_ID), defaultTopology);
      saveJsonFile(getVersionsFilePath(DEFAULT_TOPOLOGY_ID), []);
      
      index.topologies.push({
        id: DEFAULT_TOPOLOGY_ID,
        name: '默认拓扑',
        description: '系统默认拓扑',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isDefault: true,
        nodeCount: defaultTopology.nodes.length
      });
      index.currentId = DEFAULT_TOPOLOGY_ID;
      saveJsonFile(TOPOLOGIES_FILE, index);
      saveTextFile(CURRENT_TOPOLOGY_FILE, DEFAULT_TOPOLOGY_ID);
    }
    
    return index;
  },
  
  set data(value: TopologiesIndex) {
    saveJsonFile(TOPOLOGIES_FILE, value);
  },
  
  // 获取当前拓扑ID
  getCurrentId(): string {
    return loadTextFile(CURRENT_TOPOLOGY_FILE, DEFAULT_TOPOLOGY_ID);
  },
  
  // 设置当前拓扑ID
  setCurrentId(id: string): void {
    saveTextFile(CURRENT_TOPOLOGY_FILE, id);
    const index = this.data;
    index.currentId = id;
    this.data = index;
  },
  
  // 更新拓扑元数据
  updateMeta(id: string, updates: Partial<TopologyMeta>): void {
    const index = this.data;
    const meta = index.topologies.find(t => t.id === id);
    if (meta) {
      Object.assign(meta, updates, { updatedAt: new Date().toISOString() });
      this.data = index;
    }
  },
  
  // 添加新拓扑
  addMeta(meta: TopologyMeta): void {
    const index = this.data;
    index.topologies.push(meta);
    this.data = index;
  },
  
  // 删除拓扑
  removeMeta(id: string): void {
    const index = this.data;
    index.topologies = index.topologies.filter(t => t.id !== id);
    this.data = index;
  }
};

// ========== 拓扑数据管理 ==========
export const topologyStore = {
  // 获取指定拓扑的数据
  getTopology(topologyId: string): TopologyExportData {
    ensureTopologyDir(topologyId);
    return loadJsonFile<TopologyExportData>(
      getTopologyFilePath(topologyId), 
      defaultTopology
    );
  },
  
  // 保存指定拓扑的数据
  saveTopology(topologyId: string, data: TopologyExportData): void {
    ensureTopologyDir(topologyId);
    data.exportTime = new Date().toISOString();
    saveJsonFile(getTopologyFilePath(topologyId), data);
    
    // 更新元数据中的节点数
    topologiesStore.updateMeta(topologyId, { nodeCount: data.nodes.length });
  },
  
  // 获取当前拓扑的数据（向后兼容）
  get data(): TopologyExportData {
    return this.getTopology(topologiesStore.getCurrentId());
  },
  
  // 保存到当前拓扑（向后兼容）
  set data(value: TopologyExportData) {
    this.saveTopology(topologiesStore.getCurrentId(), value);
  },
  
  // 创建新拓扑
  createTopology(id: string, name: string, description?: string, copyFromId?: string): TopologyMeta {
    ensureTopologyDir(id);
    
    let data: TopologyExportData;
    if (copyFromId && fs.existsSync(getTopologyFilePath(copyFromId))) {
      // 复制现有拓扑
      data = JSON.parse(JSON.stringify(this.getTopology(copyFromId)));
    } else {
      // 创建空白拓扑（只有默认节点）
      data = {
        version: '1.0.0',
        exportTime: new Date().toISOString(),
        nodes: [],
        edges: [],
        nodeScales: {}
      };
    }
    
    saveJsonFile(getTopologyFilePath(id), data);
    saveJsonFile(getVersionsFilePath(id), []);
    
    const meta: TopologyMeta = {
      id,
      name,
      description,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isDefault: false,
      nodeCount: data.nodes.length
    };
    
    topologiesStore.addMeta(meta);
    return meta;
  },
  
  // 删除拓扑
  deleteTopology(id: string): boolean {
    const index = topologiesStore.data;
    const meta = index.topologies.find(t => t.id === id);
    if (!meta || meta.isDefault) {
      return false; // 不能删除默认拓扑或不存在的拓扑
    }
    
    // 删除文件夹
    const dir = getTopologyDir(id);
    if (fs.existsSync(dir)) {
      try {
        fs.rmSync(dir, { recursive: true });
      } catch {
        return false;
      }
    }
    
    // 更新索引
    topologiesStore.removeMeta(id);
    
    // 如果删除的是当前拓扑，切换到默认
    if (index.currentId === id) {
      topologiesStore.setCurrentId(DEFAULT_TOPOLOGY_ID);
    }
    
    return true;
  },

  // 获取拓扑的BMC配置
  getBMCConfig(topologyId: string): BMCConfig | undefined {
    const configPath = getBMCConfigFilePath(topologyId);
    if (fs.existsSync(configPath)) {
      return loadJsonFile<BMCConfig | undefined>(configPath, undefined);
    }
    // 向后兼容：从拓扑数据中读取（旧数据可能仍包含 bmcConfig）
    const topology = this.getTopology(topologyId) as unknown as Record<string, unknown>;
    return (topology.bmcConfig as BMCConfig | undefined) || undefined;
  },

  // 保存拓扑的BMC配置
  saveBMCConfig(topologyId: string, config: BMCConfig): void {
    ensureTopologyDir(topologyId);
    saveJsonFile(getBMCConfigFilePath(topologyId), config);
  },

  // 删除拓扑的BMC配置
  deleteBMCConfig(topologyId: string): void {
    const configPath = getBMCConfigFilePath(topologyId);
    if (fs.existsSync(configPath)) {
      try {
        fs.unlinkSync(configPath);
      } catch {
        // ignore
      }
    }
  }
};

// ========== 版本历史管理 ==========
export const versionsStore = {
  // 获取指定拓扑的版本
  getVersions(topologyId: string): TopologyVersion[] {
    ensureTopologyDir(topologyId);
    return loadJsonFile<TopologyVersion[]>(getVersionsFilePath(topologyId), []);
  },
  
  // 保存版本到指定拓扑
  saveVersions(topologyId: string, versions: TopologyVersion[]): void {
    ensureTopologyDir(topologyId);
    saveJsonFile(getVersionsFilePath(topologyId), versions);
  },
  
  // 向后兼容：当前拓扑的版本
  get data(): TopologyVersion[] {
    return this.getVersions(topologiesStore.getCurrentId());
  },
  
  set data(value: TopologyVersion[]) {
    this.saveVersions(topologiesStore.getCurrentId(), value);
  }
};

// ========== 监控状态管理 ==========
export const monitorStore = {
  get data(): GlobalMonitorState {
    return loadJsonFile(MONITOR_FILE, {
      isPolling: false,
      pollInterval: 2000,
      updatedAt: new Date().toISOString(),
      updatedBy: 'system'
    });
  },
  set data(value: GlobalMonitorState) {
    saveJsonFile(MONITOR_FILE, value);
  }
};

// ========== 兼容旧代码的 store 对象 ==========
export const store = {
  get monitor(): GlobalMonitorState {
    return monitorStore.data;
  },
  set monitor(value: GlobalMonitorState) {
    monitorStore.data = value;
  },
  get topology(): TopologyExportData {
    return topologyStore.data;
  },
  set topology(value: TopologyExportData) {
    topologyStore.data = value;
  },
  get versions(): TopologyVersion[] {
    return versionsStore.data;
  },
  set versions(value: TopologyVersion[]) {
    versionsStore.data = value;
  }
};

// ========== 工具函数 ==========
export function generateFluctuation(baseValue: number, percent = 5): number {
  const fluctuation = (Math.random() - 0.5) * 2 * (baseValue * percent / 100);
  return Math.max(0, baseValue + fluctuation);
}

export function updateNodeData(nodes: TopologyNode[]): TopologyNode[] {
  return nodes.map(node => {
    const newNode = JSON.parse(JSON.stringify(node));
    const data = newNode.data as Record<string, unknown>;
    const nodeType = data.nodeType as string;
    
    switch (nodeType) {
      case 'fan': {
        const fanData = data.fanData as { rpm: number; power: number } | undefined;
        if (fanData) {
          fanData.rpm = Math.round(generateFluctuation(fanData.rpm, 3));
          fanData.power = generateFluctuation(fanData.power, 5);
        }
        break;
      }
      case 'cpu': {
        const cpuData = data.cpuData as { 
          power: number; 
          temperature: number; 
          powerDomains?: Array<{ name: string; voltage: number; current: number; power: number }>;
          amuEvents?: unknown[];
        } | undefined;
        if (cpuData) {
          cpuData.power = generateFluctuation(cpuData.power, 10);
          cpuData.temperature = generateFluctuation(cpuData.temperature, 5);
          
          if (cpuData.powerDomains && cpuData.powerDomains.length > 0) {
            cpuData.powerDomains.forEach(domain => {
              domain.voltage = generateFluctuation(domain.voltage, 3);
              domain.current = generateFluctuation(domain.current, 5);
              domain.power = +(domain.voltage * domain.current).toFixed(2);
            });
            cpuData.power = +cpuData.powerDomains.reduce((sum, d) => sum + d.power, 0).toFixed(2);
          }
        }
        break;
      }
      case 'psu':
      case 'ac': {
        const sourceData = data.sourceData as { outputPower: number; efficiency: number; temperature: number } | undefined;
        if (sourceData) {
          sourceData.outputPower = generateFluctuation(sourceData.outputPower, 5);
          sourceData.efficiency = generateFluctuation(sourceData.efficiency, 2);
          sourceData.temperature = generateFluctuation(sourceData.temperature, 3);
        }
        break;
      }
      case 'busbar': {
        const sourceData = data.sourceData as { busbarPower: number } | undefined;
        if (sourceData) {
          sourceData.busbarPower = generateFluctuation(sourceData.busbarPower, 5);
        }
        break;
      }
    }
    
    return newNode;
  });
}

// 初始化时执行迁移
ensureDataDir();
if (fs.existsSync(LEGACY_TOPOLOGY_FILE)) {
  migrateLegacyData();
}
