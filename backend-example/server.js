/**
 * 蓝天系统后端示例 (Node.js + Express)
 * 
 * 安装依赖:
 * npm install express cors body-parser
 * 
 * 启动:
 * node server.js
 */

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const PORT = 3001;

// 中间件
app.use(cors());
app.use(bodyParser.json());

// 内存存储（生产环境应使用数据库）
const state = {
  monitor: {
    isPolling: false,
    pollInterval: 2000,
    updatedAt: new Date().toISOString(),
    updatedBy: 'system'
  },
  topology: null,
  versions: []
};

// 默认拓扑数据
const defaultTopology = {
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
        sourceData: { inputVoltage: 220, outputVoltage: 12, current: 30, inputCurrent: 30, outputCurrent: 30, inputPower: 400, outputPower: 376, efficiency: 94, temperature: 48 }
      }
    },
    {
      id: 'fan-1',
      type: 'fan',
      position: { x: 200, y: 300 },
      data: {
        nodeType: 'fan',
        label: '风扇1',
        fanData: { power: 15, rpm: 5000, speedPercent: 60, temperature: 40 }
      }
    },
    {
      id: 'cpu-1',
      type: 'cpu',
      position: { x: 400, y: 300 },
      data: {
        nodeType: 'cpu',
        label: 'CPU0',
        cpuData: { power: 150, temperature: 72, powerDomains: [], amuEvents: [] }
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

// 初始化拓扑
state.topology = JSON.parse(JSON.stringify(defaultTopology));

// ==================== API 路由 ====================

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ success: true, data: { status: 'ok', timestamp: new Date().toISOString() } });
});

// ==================== 监控状态 API ====================

// 获取监控状态
app.get('/api/monitor/state', (req, res) => {
  res.json({ success: true, data: state.monitor });
});

// 更新监控状态
app.post('/api/monitor/state', (req, res) => {
  const { isPolling, pollInterval } = req.body;
  
  if (typeof isPolling === 'boolean') {
    state.monitor.isPolling = isPolling;
  }
  if (typeof pollInterval === 'number') {
    state.monitor.pollInterval = pollInterval;
  }
  state.monitor.updatedAt = new Date().toISOString();
  state.monitor.updatedBy = 'client';
  
  console.log(`[Monitor] State updated: isPolling=${state.monitor.isPolling}`);
  res.json({ success: true });
});

// ==================== 数据轮询 API ====================

// 生成随机波动数据
function generateFluctuation(baseValue, percent = 5) {
  const fluctuation = (Math.random() - 0.5) * 2 * (baseValue * percent / 100);
  return Math.max(0, baseValue + fluctuation);
}

// 更新节点数据（模拟）
function updateNodeData(nodes) {
  return nodes.map(node => {
    const newNode = JSON.parse(JSON.stringify(node));
    const data = newNode.data;
    
    switch (data.nodeType) {
      case 'fan':
        if (data.fanData) {
          data.fanData.rpm = Math.round(generateFluctuation(data.fanData.rpm, 3));
          data.fanData.power = generateFluctuation(data.fanData.power, 5);
        }
        break;
      case 'cpu':
        if (data.cpuData) {
          data.cpuData.power = generateFluctuation(data.cpuData.power, 10);
          data.cpuData.temperature = generateFluctuation(data.cpuData.temperature, 5);
        }
        break;
      case 'psu':
      case 'ac':
        if (data.sourceData) {
          data.sourceData.outputPower = generateFluctuation(data.sourceData.outputPower, 5);
          data.sourceData.efficiency = generateFluctuation(data.sourceData.efficiency, 2);
          data.sourceData.temperature = generateFluctuation(data.sourceData.temperature, 3);
        }
        break;
    }
    
    return newNode;
  });
}

// 轮询数据
app.get('/api/data/poll', async (req, res) => {
  console.log('[Poll] Data request received');
  
  // 模拟数据获取延迟（等待所有模块数据）
  await new Promise(resolve => setTimeout(resolve, 500));
  
  // 更新数据
  const updatedNodes = updateNodeData(state.topology.nodes);
  state.topology.nodes = updatedNodes;
  
  res.json({
    success: true,
    data: {
      nodes: updatedNodes,
      edges: state.topology.edges,
      timestamp: new Date().toISOString()
    }
  });
});

// ==================== 控制命令 API ====================

app.post('/api/control', (req, res) => {
  const { nodeId, action, value } = req.body;
  console.log(`[Control] ${action} for ${nodeId}: ${value}`);
  
  // 更新节点数据
  const node = state.topology.nodes.find(n => n.id === nodeId);
  if (node) {
    if (action === 'setFanSpeed' && node.data.fanData) {
      node.data.fanData.speedPercent = value;
      node.data.fanData.rpm = Math.round(5000 * (value / 100));
    } else if (action === 'setVoltage' && node.data.sourceData) {
      node.data.sourceData.outputVoltage = value;
    }
  }
  
  res.json({ success: true });
});

// ==================== 拓扑 API ====================

// 获取拓扑
app.get('/api/topology', (req, res) => {
  res.json({ success: true, data: state.topology });
});

// 保存拓扑
app.post('/api/topology', (req, res) => {
  state.topology = req.body;
  state.topology.exportTime = new Date().toISOString();
  console.log('[Topology] Saved');
  res.json({ success: true });
});

// 重置拓扑
app.post('/api/topology/reset', (req, res) => {
  state.topology = JSON.parse(JSON.stringify(defaultTopology));
  console.log('[Topology] Reset to default');
  res.json({ success: true });
});

// ==================== 版本历史 API ====================

// 获取版本列表
app.get('/api/topology/versions', (req, res) => {
  res.json({ success: true, data: state.versions });
});

// 保存新版本
app.post('/api/topology/versions', (req, res) => {
  const { label, notes, data } = req.body;
  const version = {
    id: 'v-' + Date.now(),
    label: label || '未命名版本',
    notes: notes || '',
    timestamp: new Date().toISOString(),
    isAuto: false,
    data: data
  };
  state.versions.unshift(version);
  console.log(`[Version] Created: ${version.label}`);
  res.json({ success: true });
});

// 回滚版本
app.post('/api/topology/versions/:versionId/rollback', (req, res) => {
  const version = state.versions.find(v => v.id === req.params.versionId);
  if (version) {
    state.topology = JSON.parse(JSON.stringify(version.data));
    console.log(`[Version] Rolled back to: ${version.label}`);
    res.json({ success: true });
  } else {
    res.status(404).json({ success: false, message: 'Version not found' });
  }
});

// 更新版本元数据
app.patch('/api/topology/versions/:versionId', (req, res) => {
  const version = state.versions.find(v => v.id === req.params.versionId);
  if (version) {
    const { label, notes } = req.body;
    if (label) version.label = label;
    if (notes) version.notes = notes;
    res.json({ success: true });
  } else {
    res.status(404).json({ success: false, message: 'Version not found' });
  }
});

// 删除版本
app.delete('/api/topology/versions/:versionId', (req, res) => {
  state.versions = state.versions.filter(v => v.id !== req.params.versionId);
  console.log(`[Version] Deleted: ${req.params.versionId}`);
  res.json({ success: true });
});

// 清空版本
app.delete('/api/topology/versions', (req, res) => {
  state.versions = [];
  console.log('[Version] All cleared');
  res.json({ success: true });
});

// ==================== 启动服务 ====================

app.listen(PORT, () => {
  console.log(`
========================================
  蓝天系统后端服务已启动
========================================
  端口: ${PORT}
  API地址: http://localhost:${PORT}/api
  
  可用接口:
  - GET  /api/health          健康检查
  - GET  /api/monitor/state   获取监控状态
  - POST /api/monitor/state   更新监控状态
  - GET  /api/data/poll       轮询数据
  - POST /api/control         发送控制命令
  - GET  /api/topology        获取拓扑
  - POST /api/topology        保存拓扑
  - POST /api/topology/reset  重置拓扑
========================================
  `);
});
