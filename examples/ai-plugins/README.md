# AI 插件开发指南

AI 分析助手的能力由「插件」组成。插件是一组工具的集合，可按插件整体启停。

- **内置插件**（`src/server/ai/builtinPlugins.ts`）：报告查询、智能分析、联网检索、通用工具、报告导出。
- **声明式插件**（`.data/ai-plugins/*.json`）：用 JSON 描述 HTTP 工具，**无需改代码、无需重启**，保存文件后点 AI 助手里的「插件 → 重新加载」即可生效。

## 快速开始

1. 把本目录的 `hardware.json` 复制到 `.data/ai-plugins/`：

   ```bash
   mkdir -p .data/ai-plugins
   cp examples/ai-plugins/hardware.json .data/ai-plugins/
   ```

2. 打开 AI 助手 → 点「插件」→ 看到「硬件规格查询（示例）」→ 确认开关为开。
3. 直接问：「查一下 CPU 规格」，模型会调用 `getCpuSpec`。

## 插件文件结构

```jsonc
{
  "id": "example.hardware",          // 唯一标识，必填
  "name": "硬件规格查询",             // 展示名，必填
  "description": "……",               // 可选
  "promptHint": "……",                // 可选：追加到 system prompt，引导模型何时用这些工具
  "tools": [                         // 必填，非空
    {
      "name": "getCpuSpec",          // 工具名，全局唯一（与内置工具重名会被跳过）
      "description": "……",           // 必填：模型据此决定是否调用
      "parameters": {                // JSON Schema（object 类型）
        "type": "object",
        "properties": { "host": { "type": "string", "description": "主机 IP" } },
        "required": []
      },
      "request": {
        "url": "http://127.0.0.1:8080/api/cpu?host={{host}}",
        "method": "GET",             // GET/POST/PUT/PATCH/DELETE，默认 GET
        "headers": { "Authorization": "Bearer {{env.MY_KEY}}" },
        "body": { "q": "{{question}}" },   // 非 GET 时使用，支持深度模板
        "timeoutMs": 15000
      },
      "responsePath": "data.items"   // 可选：从响应里取子路径，支持数组下标 data.list.0.v
    }
  ]
}
```

### 模板占位符

| 写法 | 含义 |
|---|---|
| `{{参数名}}` | 替换为模型传入的参数值（对象会序列化为 JSON） |
| `{{env.环境变量名}}` | 替换为服务端环境变量（密钥不要写进 JSON，走 env） |

占位符可用于 `url`、`headers` 的每个值、`body` 的任意层级（对象/数组递归替换）。

### parameters 支持的 JSON Schema 子集

`object` / `string` / `number` / `integer` / `boolean` / `array` / `enum`，以及
`required`、`description`、`minimum`、`maximum`、`minLength`、`maxLength`、`minItems`、`maxItems`。
其他类型会退化为「任意值」，插件仍可加载。

## 行为约定

- **工具重名**：与已启用插件（先加载内置插件）重名的工具会被跳过，并在插件面板的 `skipped` 里体现。因此内置工具不会被 JSON 插件覆盖。
- **加载失败**：JSON 语法错误或结构不合法时，该插件在面板里显示红色「加载失败」与原因，不影响其他插件。
- **启用状态**：存 `.data/ai-plugin-state.json`，只记录被禁用的插件 id（新插件默认启用）。
- **超时**：默认 15 秒，可用 `timeoutMs` 覆盖；超时/连接失败返回 `{ error }` 给模型，不会抛异常中断对话。
- **响应处理**：优先按 JSON 解析，非 JSON 原样返回文本；`responsePath` 未命中时返回 `{ note, raw }`。

## 调试

- 服务端日志：`[AI Agent] 工具调用: <name> <args>` 与 `[AI Agent] <name> 错误: ...`。
- 插件列表接口：`GET /api/ai/plugins` 返回 `plugins`、`pluginsDir`、`activeToolCount`、`skipped`。
- 启停接口：`POST /api/ai/plugins`，body `{ "id": "...", "enabled": true }`。

## 安全提示

- 声明式插件能发起任意 HTTP 请求，等同于服务端代码权限。只放可信来源的 JSON 到 `.data/ai-plugins/`。
- 密钥通过 `{{env.XXX}}` 注入，不要硬编码在 JSON 里（该目录不在 git 中，但仍建议走环境变量）。
