# Desktop ↔ Cloud Bridge（对话 + SSE）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 andromeda-desktop 中经 Tauri Rust 连接云端 andromeda 的 `POST /v1/runs` SSE，在聊天 UI 流式展示纯文本回复（无 tool）。

**Architecture:** React `invoke("start_run")` → Rust `reqwest` 读 SSE → `app.emit("agent://sse", event)` → React `listen` 更新气泡。云端地址来自桌面 `config.toml` 的 `cloud_base_url`。

**Tech Stack:** Tauri 2、React 19、TypeScript、`reqwest`（stream）、`serde`/`serde_json`、`tokio`、`@tauri-apps/api`。

## Global Constraints

- 规格：`docs/superpowers/specs/2026-09-18-desktop-cloud-bridge-design.md`
- 云端协议：`andromeda/docs/api-client.md`；事件 JSON 与云端 `SseEvent` 对齐
- v1：`tools: []`；不实现桌面 tool_results / steer UI
- 桌面不存放模型 API Key
- 默认 `cloud_base_url = "http://127.0.0.1:8082"`
- 仓库若无 git：跳过 commit 步骤或先 `git init`（由执行者按环境处理）
- TDD：Rust 纯函数（SSE 行解析）先写测试；UI 以手动联调为主

## File Structure

| File | Responsibility |
|------|----------------|
| `config.toml` / `config.example.toml` | `cloud_base_url` |
| `src-tauri/src/config.rs` | 加载桌面配置 |
| `src-tauri/src/cloud/wire.rs` | 与云端对齐的 request/SSE 类型 |
| `src-tauri/src/cloud/sse.rs` | 解析 SSE 字节流 → 事件 |
| `src-tauri/src/cloud/client.rs` | `start_run` HTTP + 读流 + emit |
| `src-tauri/src/lib.rs` | 注册 commands、spawn |
| `src-tauri/capabilities/default.json` | 允许 event emit/listen（若需） |
| `src/lib/cloud-events.ts` | TS 事件类型 |
| `src/components/chat/agent-chat.tsx` | 接线 invoke + listen |
| `src/components/chat/types.ts` | 必要时扩展 message id |

---

### Task 1: 桌面配置加载

**Files:**
- Create: `config.toml`, `config.example.toml`, `src-tauri/src/config.rs`
- Modify: `src-tauri/src/lib.rs`, `src-tauri/Cargo.toml`（若需 `toml` crate）

**Interfaces:**
- Produces: `DesktopConfig { cloud_base_url: String }`，`DesktopConfig::load() -> Result<Self, String>`，默认 URL `http://127.0.0.1:8082`
- Produces: `#[tauri::command] fn get_cloud_config() -> Result<DesktopConfig, String>`

- [ ] **Step 1: 添加依赖与示例配置**

`config.example.toml`:

```toml
cloud_base_url = "http://127.0.0.1:8082"
```

`Cargo.toml` 增加：`toml = "0.8"`（或与云端一致的版本）、`thiserror` 可选。

- [ ] **Step 2: 写配置测试（失败）**

在 `config.rs`：

```rust
#[test]
fn missing_file_uses_default_url() {
    let cfg = DesktopConfig::load_from_str("").unwrap_or_default();
    // 或测试 load 在文件不存在时返回 default
    assert_eq!(cfg.cloud_base_url, "http://127.0.0.1:8082");
}

#[test]
fn parses_cloud_base_url() {
    let cfg = DesktopConfig::from_toml(r#"cloud_base_url = "http://127.0.0.1:9000""#).unwrap();
    assert_eq!(cfg.cloud_base_url, "http://127.0.0.1:9000");
}
```

- [ ] **Step 3: 实现 `DesktopConfig` + `get_cloud_config` command 并注册**

查找配置文件顺序建议：`CWD/config.toml` → 可执行文件旁 `config.toml`。

- [ ] **Step 4: `cargo test` 通过**

- [ ] **Step 5: Commit（若有 git）**

```bash
git commit -m "feat: 加载桌面 cloud_base_url 配置"
```

---

### Task 2: SSE 行解析（纯 Rust）

**Files:**
- Create: `src-tauri/src/cloud/mod.rs`, `src-tauri/src/cloud/wire.rs`, `src-tauri/src/cloud/sse.rs`

**Interfaces:**
- Produces: `SseEvent` 枚举（字段名与云端 JSON `type` 一致）
- Produces: `fn push_sse_line(buf: &mut SseParseState, line: &str) -> Option<SseEvent>`
- 或：`fn parse_sse_block(block: &str) -> Result<SseEvent, ParseError>`

- [ ] **Step 1: 写失败测试**

```rust
#[test]
fn parses_message_delta_block() {
    let block = "event: message.delta\ndata: {\"type\":\"message.delta\",\"run_id\":\"r1\",\"message_id\":\"m1\",\"delta\":\"你\"}\n\n";
    let ev = parse_sse_block(block).unwrap();
    match ev {
        SseEvent::MessageDelta { delta, .. } => assert_eq!(delta, "你"),
        _ => panic!(),
    }
}
```

另测：`run.started`、`run.finished`、`error`；忽略未知 `tool.request` 可返回 `Ok(None)` 或单独 variant。

- [ ] **Step 2: 实现 wire + parser；测试 PASS**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat: 解析云端 SSE 事件块"
```

---

### Task 3: Rust `start_run` / `cancel_run` + emit

**Files:**
- Create: `src-tauri/src/cloud/client.rs`
- Modify: `src-tauri/src/lib.rs`, `src-tauri/Cargo.toml`
- Modify: `src-tauri/capabilities/default.json`（确保 core event 权限）

**Interfaces:**
- Consumes: `DesktopConfig`, `parse_sse_block`
- Produces:
  - `start_run(app: AppHandle, messages: Vec<ChatWireMessage>) -> Result<StartRunResponse, String>`
  - `StartRunResponse { run_id: String }`
  - 后台 task 内对每个事件：`app.emit("agent://sse", &event)`
  - `cancel_run(run_id: String) -> Result<(), String>`

**依赖：** `reqwest = { version = "0.12", features = ["json", "stream"] }`，`futures-util`，`tokio`（Tauri 已带 runtime）。

- [ ] **Step 1: 实现 client**

伪代码：

```rust
let url = format!("{}/v1/runs", config.cloud_base_url);
let resp = client.post(&url)
  .header("Accept", "text/event-stream")
  .json(&CreateRunRequest { messages, tools: vec![], session_id: None })
  .send().await?;
let run_id = resp.headers().get("x-run-id")...;
// spawn: 读 bytes_stream，按行拆分，parse，emit
```

失败时 emit：

```json
{ "type": "error", "run_id": "", "message": "..." }
```

- [ ] **Step 2: 注册 commands；移除或保留 greet**

- [ ] **Step 3: 用本地云端手动冒烟（curl 级）：** `cargo run` 桌面后看日志；或写 `#[ignore]` 集成测试

- [ ] **Step 4: Commit**

```bash
git commit -m "feat: Tauri start_run 转发云端 SSE 事件"
```

---

### Task 4: React 聊天接线

**Files:**
- Create: `src/lib/cloud-events.ts`
- Modify: `src/components/chat/agent-chat.tsx`, `src/components/chat/types.ts`（可选 `serverMessageId`）

**Interfaces:**
- Consumes: `invoke("start_run")`, `listen("agent://sse")`
- 每次发送：本地 history → `{ role, content }[]`（含刚插入的 user）

- [ ] **Step 1: 定义 TS 类型与事件 handler 纯函数（可单测）**

```ts
export type CloudSseEvent =
  | { type: "run.started"; run_id: string }
  | { type: "message.delta"; run_id: string; message_id: string; delta: string }
  | { type: "message.completed"; run_id: string; message_id: string; role: string; content: string }
  | { type: "run.finished"; run_id: string; reason: string }
  | { type: "error"; run_id: string; message: string; code?: string };
```

- [ ] **Step 2: 改 `AgentChat`**

- 删除假 `setTimeout` 回复
- `useEffect` 里 `listen("agent://sse", ...)`
- `sendMessage`：`invoke("start_run", { messages: wireMessages })`
- delta / completed / finished / error 按规格 §3 更新 state

- [ ] **Step 3: `npm run build`（tsc）通过**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat: 聊天 UI 订阅云端流式回复"
```

---

### Task 5: 端到端联调验收

**Files:**
- Modify: README（桌面）简短「如何联调」小节

- [ ] **Step 1: 启动云端** `cd andromeda && cargo run`（确认 `listen` 与桌面 URL 一致）

- [ ] **Step 2: 启动桌面** `cd andromeda-desktop && npm run tauri dev`

- [ ] **Step 3: 按规格验收清单打勾**（你好 / 断云端报错 / 两轮对话）

- [ ] **Step 4: README 补充联调步骤；Commit**

```bash
git commit -m "docs: 补充桌面与云端联调说明"
```

---

## Spec coverage

| 规格项 | 任务 |
|--------|------|
| config.toml cloud_base_url | Task 1 |
| SSE 解析对齐 | Task 2 |
| start_run / emit / cancel | Task 3 |
| React 流式气泡 | Task 4 |
| 手动验收 | Task 5 |
| 无 tool | 全任务遵守 |

## Placeholder scan

无 TBD；配置文件查找路径在 Task 1 已给出顺序。
