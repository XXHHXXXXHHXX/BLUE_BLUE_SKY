# 蓝天系统后端示例

这是蓝天系统的前端配套后端示例，使用 Node.js + Express 实现。

## 功能特性

- ✅ 全局监控状态同步（所有用户共享监控开关）
- ✅ 统一数据轮询（等待所有模块完成后返回）
- ✅ 拓扑结构持久化（所有用户共享同一拓扑）
- ✅ 版本历史管理
- ✅ 控制命令处理

## 快速开始

### 1. 安装依赖

```bash
cd backend-example
npm install
```

### 2. 启动服务

```bash
npm start
```

或使用 nodemon 开发模式：
```bash
npm run dev
```

### 3. 验证服务

```bash
curl http://localhost:8080/api/health
```

## API 接口

### 监控状态
- `GET /api/monitor/state` - 获取全局监控状态
- `POST /api/monitor/state` - 更新全局监控状态

### 数据轮询
- `GET /api/data/poll` - 轮询获取所有模块数据

### 控制命令
- `POST /api/control` - 发送控制命令（调速/调压）

### 拓扑管理
- `GET /api/topology` - 获取当前拓扑
- `POST /api/topology` - 保存拓扑
- `POST /api/topology/reset` - 重置为默认拓扑

### 版本历史
- `GET /api/topology/versions` - 获取版本列表
- `POST /api/topology/versions` - 保存新版本
- `POST /api/topology/versions/:id/rollback` - 回滚版本
- `PATCH /api/topology/versions/:id` - 更新版本信息
- `DELETE /api/topology/versions/:id` - 删除版本
- `DELETE /api/topology/versions` - 清空版本

## 配置

修改前端环境变量以指向此后端：

在项目根目录创建 `.env.local`：
```
NEXT_PUBLIC_BACKEND_URL=http://localhost:8080/api
```

## 生产环境建议

当前示例使用内存存储，生产环境建议：

1. **数据库**: 使用 MongoDB/PostgreSQL/MySQL 存储拓扑和版本
2. **缓存**: 使用 Redis 存储监控状态
3. **消息队列**: 使用 RabbitMQ/Kafka 处理实时数据推送
4. **WebSocket**: 使用 Socket.io 实现数据实时推送
5. **认证**: 添加 JWT 或 Session 认证
6. **限流**: 添加 API 限流保护

## 项目结构

```
backend-example/
├── server.js          # 主入口
├── package.json       # 依赖配置
└── README.md          # 说明文档
```
