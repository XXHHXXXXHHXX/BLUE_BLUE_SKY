# 蓝天系统后端API规范

## 基础信息

- 基础URL: `http://localhost:8080/api`
- 数据格式: JSON
- 响应格式统一为: `{ success: boolean, data?: T, message?: string }`

---

## 1. 全局监控状态 API

### 获取监控状态
```
GET /monitor/state
```

**响应:**
```json
{
  "success": true,
  "data": {
    "isPolling": true,
    "pollInterval": 2000,
    "updatedAt": "2024-01-15T10:30:00Z",
    "updatedBy": "user123"
  }
}
```

### 更新监控状态
```
POST /monitor/state
```

**请求体:**
```json
{
  "isPolling": true,
  "pollInterval": 2000
}
```

**响应:**
```json
{
  "success": true
}
```

---

## 2. 数据轮询 API

### 轮询获取所有数据
```
GET /data/poll
```

**说明:**
- 后端需要等待所有模块数据都获取完成后才返回
- 如果某个模块获取失败，应在 2 秒超时后返回已获取的数据
- 所有模块数据获取时间限制在 2 秒内

**响应:**
```json
{
  "success": true,
  "data": {
    "nodes": [
      {
        "id": "fan-1",
        "type": "fan",
        "position": { "x": 100, "y": 200 },
        "data": {
          "nodeType": "fan",
          "label": "风扇1",
          "fanData": {
            "power": 15,
            "rpm": 5000,
            "speedPercent": 60,
            "temperature": 40
          }
        }
      }
      // ... 更多节点
    ],
    "edges": [
      {
        "id": "e-1",
        "source": "psu-1",
        "target": "fan-1",
        "type": "powerEdge",
        "data": {
          "loss": 5,
          "lossPercent": 2.5,
          "animated": true
        }
      }
    ],
    "timestamp": "2024-01-15T10:30:00Z"
  }
}
```

---

## 3. 控制命令 API

### 发送控制命令
```
POST /control
```

**请求体:**
```json
{
  "nodeId": "fan-1",
  "action": "setFanSpeed",
  "value": 80
}
```

或

```json
{
  "nodeId": "vr-1",
  "action": "setVoltage",
  "value": 1.2
}
```

**响应:**
```json
{
  "success": true
}
```

---

## 4. 拓扑结构 API

### 获取当前拓扑
```
GET /topology
```

**响应:**
```json
{
  "success": true,
  "data": {
    "version": "1.0.0",
    "exportTime": "2024-01-15T10:30:00Z",
    "nodes": [...],
    "edges": [...],
    "nodeScales": {
      "node-1": 1.2
    }
  }
}
```

### 保存拓扑
```
POST /topology
```

**请求体:**
```json
{
  "version": "1.0.0",
  "exportTime": "2024-01-15T10:30:00Z",
  "nodes": [...],
  "edges": [...],
  "nodeScales": {}
}
```

**响应:**
```json
{
  "success": true
}
```

### 重置拓扑为默认
```
POST /topology/reset
```

**响应:**
```json
{
  "success": true
}
```

---

## 5. 版本历史 API

### 获取版本列表
```
GET /topology/versions
```

**响应:**
```json
{
  "success": true,
  "data": [
    {
      "id": "v-1",
      "label": "初始版本",
      "notes": "系统默认拓扑",
      "timestamp": "2024-01-15T10:00:00Z",
      "isAuto": false,
      "data": { ... }
    }
  ]
}
```

### 保存新版本
```
POST /topology/versions
```

**请求体:**
```json
{
  "label": "手动保存",
  "notes": "修改了风扇配置",
  "data": { ... }
}
```

**响应:**
```json
{
  "success": true
}
```

### 回滚到指定版本
```
POST /topology/versions/{versionId}/rollback
```

**响应:**
```json
{
  "success": true
}
```

### 更新版本元数据
```
PATCH /topology/versions/{versionId}
```

**请求体:**
```json
{
  "label": "新标签",
  "notes": "新备注"
}
```

**响应:**
```json
{
  "success": true
}
```

### 删除版本
```
DELETE /topology/versions/{versionId}
```

**响应:**
```json
{
  "success": true
}
```

### 清空版本历史
```
DELETE /topology/versions
```

**响应:**
```json
{
  "success": true
}
```

---

## 数据模型

### TopologyNode
```typescript
interface TopologyNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: {
    nodeType: HardwareNodeType;
    label: string;
    displayAlias?: string;
    customIcon?: string;
    customIconUrl?: string;
    controlRange?: { min: number; max: number };
    apiConfig?: {
      monitorApi?: { url: string; method: string };
      controlApi?: { url: string; method: string };
    };
    // 模块数据
    fanData?: { power: number; rpm: number; speedPercent: number; temperature?: number };
    cpuData?: { power: number; temperature?: number; powerDomains: any[]; amuEvents: any[] };
    memoryData?: { power: number; temperature?: number; thermalThrottle: boolean };
    sourceData?: { inputVoltage: number; outputVoltage: number; current: number; inputPower: number; outputPower: number; efficiency: number; temperature?: number };
    diskData?: { power: number; temperature?: number; status: 'normal' | 'warning' | 'error' };
    ioData?: { power: number; temperature?: number; linkSpeed: string };
    cardData?: { power: number; temperature?: number; slotId: string };
    sensorData?: { temperature: number; location: string };
    mgmtData?: { status: 'online' | 'offline'; temperature: number };
  };
}
```

### TopologyEdge
```typescript
interface TopologyEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  type: string;
  data: {
    loss: number;
    lossPercent: number;
    animated: boolean;
    label?: string;
    arrowType?: string;
  };
}
```

### HardwareNodeType
```typescript
type HardwareNodeType = 
  | 'ac' | 'psu' | 'vr' | 'psip' | 'busbar'
  | 'cpu' | 'memory' | 'fan' | 'disk' 
  | 'io' | 'card' | 'sensor' | 'mgmtBoard' | 'chassis';
```

---

## 状态同步说明

### 全局监控状态
- 所有客户端共享同一个 `isPolling` 状态
- 当一个用户开启/关闭监控时，所有其他用户都会同步
- 状态存储在后端，建议用 Redis 或数据库

### 拓扑结构
- 所有客户端共享同一个拓扑结构
- 保存后立即对所有用户可见
- 建议用数据库持久化

### 实时数据
- 只有监控开启时才轮询数据
- 后端需要等待所有模块数据获取完成后才返回（2秒限制）
- 如果超时，返回已获取的数据

---

## 环境变量

前端配置（.env.local）:
```
NEXT_PUBLIC_BACKEND_URL=http://localhost:8080/api
```
