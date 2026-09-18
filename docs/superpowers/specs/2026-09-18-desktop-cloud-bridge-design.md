# 桌面端对接云端 Agent（对话 + SSE）设计

日期：2026-09-18  
状态：已批准，待写实现计划  
范围：Phase A — 纯对话流式，暂不接 tool  

相关：

- 云端协议：兄弟仓库 `andromeda` 中的 `docs/api-client.md`
- 云端服务：`andromeda`（默认 `http://127.0.0.1:8082`）
- 桌面应用：`andromeda-desktop`（Tauri + React）

## 目标

让安装在用户电脑上的 **andromeda-desktop** 作为桌面端，把用户消息交给云端 **andromeda** 思考，并通过 SSE 在聊天 UI 中流式展示回复。

分工：

| 端 | 职责 |
|----|------|
| 云端 andromeda | LLM 思考、流式输出；持有模型 API Key |
| 桌面 andromeda-desktop | UI、本机配置、经 Tauri Rust 调用云端、渲染流式文本 |

## 非目标（本轮）

- 桌面执行 tool / `POST .../tool_results`
- Steer UI、取消按钮（command 可预留 `cancel_run`）
- 用户登录鉴权、会话云端持久化
- 抽出共享 `andromeda-wire` crate（桌面侧手写对齐 wire JSON）
- GIS 地图 tool

## 方案

**Rust 云端客户端 + Tauri Event 流（方案 A）**

```text
[React UI]  --invoke-->  [Tauri Rust]  --HTTP/SSE-->  [andromeda 云端]
     ^                        |
     +---- listen("agent://sse") ----+
```

前端不直连云端，避免 CORS / 打包后网络策略问题，并为后续本机 tool 执行留在 Rust 层。

---

## §1 配置

桌面仓库提供 `config.toml`（路径：应用运行时可发现的位置，实现时优先项目根或 `src-tauri/` 旁，文档写明）：

```toml
cloud_base_url = "http://127.0.0.1:8082"
```

- 缺失时：使用默认 `http://127.0.0.1:8082` 并打日志提示
- **不**在桌面配置中存放云端模型 API Key（仍只在云端 `config.toml`）

---

## §2 Tauri Command 与 SSE 契约

### Commands

| Command | 说明 |
|---------|------|
| `start_run { messages: [{ role, content }] }` | 启动后台任务：`POST {cloud_base_url}/v1/runs`，body 含 `messages` 与 `tools: []`；解析 SSE 并 `emit` |
| `cancel_run { run_id }` | `POST /v1/runs/{id}/cancel`（v1 UI 可不暴露） |
| `get_cloud_config`（可选） | 返回当前 `cloud_base_url` 供设置页/调试 |

`start_run` 应尽快返回；`run_id` 优先取响应头 `X-Run-Id`，并在随后的 `run.started` 事件中一致。

### 事件频道

- 频道名：`agent://sse`
- Payload：与云端 `SseEvent` JSON 对齐（含 `type` 字段）

关注事件（v1）：

- `run.started`
- `message.delta` — `{ run_id, message_id, delta }`
- `message.completed` — `{ run_id, message_id, role, content, ... }`
- `run.finished` — `{ run_id, reason }`
- `error` — `{ run_id, message, code? }`

若收到 `tool.request`：v1 Rust 层打 warn 并忽略（云端 `tools: []` 时通常不会出现）；不阻塞纯文本联调。

网络失败或非 200：向 UI `emit` 一条 `error`，前端结束「正在思考」状态。

---

## §3 前端聊天接线

替换 `AgentChat` 中的假 `setTimeout` 回复：

1. 用户发送 → 插入 user 气泡 → `isReplying = true` → `invoke("start_run", { messages })`
2. 组件挂载时 `listen("agent://sse", handler)`，卸载时 unlisten
3. 事件处理：
   - `message.delta`：按 `message_id` 新建或追加 assistant 气泡内容
   - `message.completed`：用完整 `content` 覆盖该气泡
   - `run.finished` / `error`：`isReplying = false`；error 时展示错误提示
4. 多轮：每次请求带上**本地完整对话历史**（`role` + `content`），因云端 v1 可不做会话持久化

可选状态：`activeRunId`，供后续取消使用。

---

## §4 验收与文件落点

### 手动验收

1. 云端 `cargo run` 监听配置端口（如 `8082`）
2. 桌面 `config.toml` 指向该地址
3. 发送「你好」→ 流式出现回复 → 结束后定稿
4. 云端未启动时，UI 报错且不永久卡在「正在思考…」
5. 连续两轮对话均成功

### 主要改动仓库

- **andromeda-desktop**：`src-tauri`（config、SSE client、commands）、`src/components/chat`（接线）
- **andromeda**：协议已具备；本轮预期无需改动

### 实现阶段建议

1. 桌面配置加载 + `get_cloud_config`
2. Rust SSE 客户端 + `start_run` / emit
3. React 订阅与流式气泡
4. 联调验收；预留 `cancel_run`

## 已决议事项

| 议题 | 决议 |
|------|------|
| 第一版范围 | 仅对话 + SSE，无 tool |
| SSE 消费位置 | Tauri Rust 中转 |
| 云端地址 | 桌面 `config.toml` 的 `cloud_base_url` |
| 架构 | 方案 A（Rust 客户端 + Event） |
