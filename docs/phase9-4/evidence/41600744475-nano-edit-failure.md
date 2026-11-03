# Run 41600744475 — nano-edit 失败证据

> 不是冷启动失败；这是 shell-probe bootstrap 配置探测超时。
> 保存原文的关键行，避免把这次失败从统计分母里丢掉。

```text
run: 41600744475
sha: e44d7abe
job: macOS real SSH matrix
step: Run the real Tauri shell interaction matrix
case: local/bash/nano-edit
```

应用日志：

```text
2026-11-03T08:18:34.878269Z INFO terminal_lib::input_probe: input_probe_config invoked
2026-11-03T08:18:34.881580Z INFO startup: stage=frontend-boot detail=main.tsx evaluated
2026-11-03T08:18:34.960862Z INFO startup: stage=bootstrap-gates
  detail=bootstrap mode=app gates:
  smoke=timed-out(1006ms) remotePrompt=timed-out(1006ms)
  inputProbe=timed-out(1006ms) rawProbe=timed-out(1006ms)
  shellProbe=timed-out(1006ms)
2026-11-03T08:18:35.674609Z INFO startup: stage=ready detail=connection cached
2026-11-03T08:18:42.494503Z INFO startup: stage=terminal-mounted
  detail=local-1793693921773@33b743e5-e04b-4acc-8c5f-12c960be2a08
2026-11-03T08:18:42.734782Z INFO startup: stage=session-create-requested detail=local
2026-11-03T08:18:42.775704Z INFO startup: stage=session-created
2026-11-03T08:19:33.124534Z FAILED: nano-edit shell probe result timed out after 60000 ms:
  the app never wrote result.json, so the case neither passed nor reported its own failure
```

`input_probe_config invoked` 已到达 Rust，但前端五个 gate 在同一次冷 WebView
首轮 IPC 中全部超过 1 秒，bootstrap 回落到普通 app，probe 从未渲染。

分类：**bootstrap config starvation（测试入口）**，不是
`frontend-boot` 失败、`terminal-mounted` 失败或 SSH 会话失败。
