# Tauri + React + Typescript

This template should help get you started developing with Tauri, React and Typescript in Vite.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-analyzer.rust-analyzer)

## 如何联调（云端 + 桌面）

桌面通过 `config.toml` 的 `cloud_base_url` 连接本地云端 `andromeda`（默认 `http://127.0.0.1:8082`）。请保证云端 `listen` 与该 URL 一致。

云端对接细节见 andromeda 仓库的 `docs/desktop-integration.md` / `docs/api-client.md`。

### 1. 启动云端

```bash
cd ../andromeda   # 或你的 andromeda 仓库路径
cargo run
```

确认日志中监听地址与桌面配置一致（如 `127.0.0.1:8082`）。云端示例配置见该仓库的 `config.toml` / `config.example.toml` 中的 `listen`。

### 2. 配置桌面

仓库根目录 `config.toml`（可参考 `config.example.toml`）：

```toml
cloud_base_url = "http://127.0.0.1:8082"
# default_plan_mode = false
# default_subagents = false
```

缺失时回退默认 `http://127.0.0.1:8082`。

输入框旁可点：

- **任务计划**：`options.plan_mode=true`，云端推送 `todos.updated` 时显示待办
- **子代理**：`options.subagents=true`，云端可拉起子代理并推送 `task.*`；本地 tool（如天气）已标 `readonly: true` 供 explore 过滤

回复进行中可继续输入：消息进入本地队列（非用户气泡）。当前任务正常结束后自动发送队列首项；首项也可点中断图标立刻 `cancel` 并重开；每项可删除。SSE 意外断开时自动 `GET /v1/runs/{id}/events` 续订（最多 3 次）。

### 3. 启动桌面

```bash
cd andromeda-desktop
npm run tauri dev
```

### 验收清单

- [ ] 发送「你好」→ 流式出现回复 → 结束后定稿
- [ ] 云端未启动时，UI 报错且不永久卡在「正在思考…」
- [ ] 连续两轮对话均成功
- [ ] Plan Mode：待办列表随 `todos.updated` 更新
- [ ] 子代理：开启后能看到 `task.started/completed` 提示；子代理 tool 仍回传到父 run
- [ ] 回复中追问 → 进入队列；任务正常结束后自动发首项；首项中断 → cancel + 新 run；删除可从队列移除
- [ ] 断 SSE / 杀连接后能自动续订并收完 `run.finished`
- [ ] 回复中点停止 / Esc → `POST .../cancel` → `run.finished reason=cancelled`
