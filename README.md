# Tauri + React + Typescript

This template should help get you started developing with Tauri, React and Typescript in Vite.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## 如何联调（云端 + 桌面）

桌面通过 `config.toml` 的 `cloud_base_url` 连接本地云端 `andromeda`（默认 `http://127.0.0.1:8082`）。请保证云端 `listen` 与该 URL 一致。

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
```

缺失时回退默认 `http://127.0.0.1:8082`。

### 3. 启动桌面

```bash
cd andromeda-desktop
npm run tauri dev
```

### 验收清单

- [ ] 发送「你好」→ 流式出现回复 → 结束后定稿
- [ ] 云端未启动时，UI 报错且不永久卡在「正在思考…」
- [ ] 连续两轮对话均成功
