# 终端可靠性重建规格

> 状态：macOS 本地核心链路完成，外部实机矩阵待验证  
> 日期：2026-08-20  
> 范围：本地 PTY、SSH 交互终端、共用 xterm.js 前端链路  
> 不替代：[`terminal-workbench-rebuild.md`](terminal-workbench-rebuild.md) 的布局与焦点规格

## 1. 前置假设

1. 首要目标是恢复标准终端语义：shell/readline、vim、nano、tmux、fzf 等程序收到的字节必须与 xterm.js `onData` 产生的字节一致。
2. 当前前端命令历史和 Tab 补全会破坏 PTY 状态，本轮允许先移除其输入拦截；历史记录改为旁路采集，智能补全只有在不修改或吞掉 PTY 输入时才能重新启用。
3. 本轮覆盖 local、SSH 和 serial 共用的前端输入/输出与生命周期，但 Rust 串口协议本身不重写；串口只修复关闭和错误处理。
4. 本机可自动验证 macOS 本地 PTY。Windows/Linux 编译与单测必须通过，真实 ConPTY/Linux PTY/Pageant/串口交互仍作为明确实机门禁，不能用构建成功冒充实机通过。
5. 采用开源项目的协议设计与调度模式并在本项目内重新实现；若后续复制了具有实质性的 MIT/Apache 源码片段，必须增加对应版权和许可证通知。
6. 当前工作区已有 Agent forwarding、Jump certificate、Team Server 等未提交改动。本轮只在必要的终端文件上增量修改，不覆盖或回滚这些改动。

## 2. 目标

把当前“能创建会话但交互容易失真、卡顿或泄漏”的终端链路修成可长期使用的终端：

- 用户输入逐字节、按顺序送达 PTY/SSH；Tab、方向键、控制键、IME、粘贴不被前端伪终端状态机篡改。
- xterm 实际列行数与本地/SSH PTY 始终一致，首次 prompt 出现前也使用有效尺寸。
- 本地 PTY 保留操作系统 line discipline 和回显语义，使用登录 shell 与合理环境。
- ANSI/VT 流不做逐块正则改写；UTF-8 跨读取边界不产生替换字符。
- 高频输出有明确的有界队列、批处理与 xterm 消费完成信号，不因大输出无限堆积主线程或 Tokio 任务。
- 输入、resize、断开和重连具有确定顺序；旧连接输出不能污染新连接。
- EOF、取消、串口断开和重复重连都能释放前后端会话资源。
- 终端设置真实作用于 xterm；核心运行时与 CSS 精确固定为带 WKWebView 重叠按键补丁的 `@baicie/xterm@0.1.7`，官方 addons 保持独立。

## 3. 参考实现与采用边界

### 3.1 主参考：Nyaterm

- 仓库：<https://github.com/nyakang/nyaterm>
- 固定提交：`70306b5c83e9f58c85a4f86a00440cd2be2cd57a`
- 许可证：MIT
- 同构性：Tauri 2 + React/Vite + xterm.js + Rust + Tokio

| 参考机制 | 固定链接 | 本项目采用方式 |
| --- | --- | --- |
| 输出事件携带 UTF-8 byte count，维护 pending/unacked bytes | [`output.rs#L11-L58`](https://github.com/nyakang/nyaterm/blob/70306b5c83e9f58c85a4f86a00440cd2be2cd57a/src-tauri/src/core/output.rs#L11-L58) | `SessionOutput.bytes` 与每 session 输出控制器在本项目内重新实现 |
| 1 MiB pause / 128 KiB resume 高低水位 | [`output.rs#L147-L174`](https://github.com/nyakang/nyaterm/blob/70306b5c83e9f58c85a4f86a00440cd2be2cd57a/src-tauri/src/core/output.rs#L147-L174) | 后端停止消费有界队列，让 local/SSH reader 最终背压；ACK 后恢复 |
| `xterm.write` callback 后才 ACK，单写入在途 | [`terminalOutputDrain.ts#L322-L352`](https://github.com/nyakang/nyaterm/blob/70306b5c83e9f58c85a4f86a00440cd2be2cd57a/src/components/terminal/terminalOutputDrain.ts#L322-L352) | 独立 `TerminalOutputScheduler` 每帧最多写 32 KiB，超大事件按 UTF-8 边界拆分，旧 generation callback 不 ACK |
| local PTY pause/resume 控制 reader | [`session.rs#L516-L530`](https://github.com/nyakang/nyaterm/blob/70306b5c83e9f58c85a4f86a00440cd2be2cd57a/src-tauri/src/core/terminal_session/local/session.rs#L516-L530) | 使用本项目现有 bounded `mpsc` 与 ACK 控制通道实现，不复制其 command loop |

采用边界：只采用协议不变量和调度模式，代码按本项目 SessionManager/Tauri event 架构独立实现；未复制 Nyaterm 的 ZMODEM、hibernation、frame gate 或其他产品功能。

### 3.2 补充参考：FileTerm

- 仓库：<https://github.com/St0ff3l/fileterm>
- 固定提交：`98e9ef8cda57745e07feb3d1e9879c8e00178119`
- 许可证：MIT
- 同构性：Tauri 2 + React/Vite + xterm.js + Rust + russh

| 参考机制 | 固定链接 | 本项目采用方式 |
| --- | --- | --- |
| 每帧限量写入并等待 `xterm.write(..., callback)` | [`TerminalView.tsx#L903-L939`](https://github.com/St0ff3l/fileterm/blob/98e9ef8cda57745e07feb3d1e9879c8e00178119/apps/tauri/src/renderer/components/TerminalView.tsx#L903-L939) | 实现独立输出调度器；限制单帧预算并串行排空 |
| `proposeDimensions` 后同步 resize xterm 与后端 | [`TerminalView.tsx#L1013-L1077`](https://github.com/St0ff3l/fileterm/blob/98e9ef8cda57745e07feb3d1e9879c8e00178119/apps/tauri/src/renderer/components/TerminalView.tsx#L1013-L1077) | 只参考尺寸同步入口；本项目另行实现创建前有效尺寸和 latest-wins，FileTerm 本身不能作为 latest-wins 证据 |
| xterm 输入事件接入后端 | [`TerminalView.tsx#L1523-L1617`](https://github.com/St0ff3l/fileterm/blob/98e9ef8cda57745e07feb3d1e9879c8e00178119/apps/tauri/src/renderer/components/TerminalView.tsx#L1523-L1617) | FileTerm 在部分模式下会拦截或改写输入；本项目不采用这些分支，独立保证 `onData`/`onBinary` 原样进入 FIFO |
| 高频实时流与低频状态分离 | [`TerminalView.tsx#L1625-L1694`](https://github.com/St0ff3l/fileterm/blob/98e9ef8cda57745e07feb3d1e9879c8e00178119/apps/tauri/src/renderer/components/TerminalView.tsx#L1625-L1694) | 输出走单一 Tauri Channel；状态/退出仍走低频事件或命令结果 |
| local reader、解码与退出前 drain | [`local_terminal.rs#L424-L667`](https://github.com/St0ff3l/fileterm/blob/98e9ef8cda57745e07feb3d1e9879c8e00178119/apps/tauri/src-tauri/src/sessions/local_terminal.rs#L424-L667) | 只参考读取与解码边界；FileTerm 队列满时可丢输出，本项目另行实现有界阻塞背压且不静默丢数据 |
| 共享控制 FIFO 与生命周期处理 | [`local_terminal.rs#L779-L930`](https://github.com/St0ff3l/fileterm/blob/98e9ef8cda57745e07feb3d1e9879c8e00178119/apps/tauri/src-tauri/src/sessions/local_terminal.rs#L779-L930) | FileTerm 的 input/resize/shutdown 共用 FIFO 且 resize 不是 latest-wins；本项目独立实现输入单写者、resize latest-wins 和 generation 隔离 |
| SSH 建链与 writer loop | [`ssh.rs#L4025-L4115`](https://github.com/St0ff3l/fileterm/blob/98e9ef8cda57745e07feb3d1e9879c8e00178119/apps/tauri/src-tauri/src/sessions/ssh.rs#L4025-L4115) | FileTerm writer 使用无界队列且存在共享 writer 旁路；本项目另行实现有界串行 writer、全路径 deadline 且禁止旁路 |
| 终端回归约束与命令 | [`terminal-regression-checklist.md#L131-L231`](https://github.com/St0ff3l/fileterm/blob/98e9ef8cda57745e07feb3d1e9879c8e00178119/docs/quality/terminal-regression-checklist.md#L131-L231) | 纳入本规格的真实终端验收矩阵 |

FileTerm 不提供 renderer 到 Rust 的消费 ACK，无损背压也不是其保证；本项目的 ACK、高低水位和 pause/resume 只归因于 Nyaterm，并在本项目架构内独立实现。

### 3.3 其他补充参考

- Nyala Studio，MIT，公开提交 `ffb13b9866c2ade51d14e30027306ba21a59ab56`：仅作监听注册顺序、resize 与 xterm 接线的概念对照；不把它作为可靠首屏缓冲、消费 ACK 或背压来源，也不迁移 VS Code Workbench 基础设施。
- sshx，MIT，提交 `dd42496be83da6a7cbb963aee54ba9402f0ddd98`：采用流式 UTF-8 decoder 与有界恢复窗口概念；不采用依赖 xterm 私有 `_core` 的 typeahead。
- warpgate，Apache-2.0，提交 `7f28ac06ad0995c881aecab8c3819abd5daedc9e`：只参考 Input/Resize/Output/EOF/ExitStatus 显式分离；不搬 WebSocket JSON/Base64 或可丢弃所有输出的策略。
- Kerminal（GPL-3.0）与 VibeShell（无许可证）只做概念对照，不复制代码。

## 4. 已确认缺陷

| 优先级 | 缺陷 | 当前证据 | 目标行为 |
| --- | --- | --- | --- |
| P0 | Tab、上/下方向键被前端吞掉并用 `term.write()` 伪造历史 | `terminal-input-registration.ts` | 所有 `onData` 数据原样进入会话 FIFO |
| P0 | 补全只改 xterm 屏幕，PTY 完全不知情 | `use-terminal-completion.ts` | 禁用破坏性补全；后续只允许 shell integration 或显式向 PTY发送编辑序列 |
| P0 | Unix PTY 主端关闭 `ECHO*` | `session/local.rs` | 保留 PTY 默认 termios，由 shell/readline 负责回显 |
| P0 | 会话固定 80x24 创建，首次 fit 的 resize 被丢弃 | `use-terminal-instance.ts`、`use-terminal.ts` | 创建前使用有效尺寸；连接期间保存最新值；ready 后发送最终值 |
| P1 | 输入/resize 每次 fire-and-forget，顺序不确定 | `terminal-session-manager.ts` | 输入单写者 FIFO；resize latest-wins 且最终值必达 |
| P1 | 实时 VT 数据按任意 IPC chunk 正则清洗 | `terminal-session-helpers.ts` | 原始 VT 流零改写交给 xterm |
| P1 | 输出逐事件直写 xterm，无消费 ACK | `use-terminal.ts` | 有界批处理，`write` callback 后再排下一批 |
| P1 | local/SSH 每块独立 `from_utf8_lossy` | `local.rs`、`ssh.rs` | 流式 UTF-8 或二进制传输，跨块字符完整 |
| P1 | EOF 后 Rust manager 保留死 session | `session/manager.rs` | 终止路径幂等移除 session、meta、channel |
| P1 | connecting 无法取消，快速重连可产生旧会话 | 前端 session manager | abort/generation 使旧启动结果立即关闭且不再发布状态/输出 |
| P1 | serial close/disconnect 未调用 `serial_disconnect` | 前端 session manager | 所有关闭入口按 tab 类型释放正确后端资源 |
| P1 | 结构化 Tauri 错误变为 `[object Object]` | 前端 session manager | 统一使用 `formatIpcError` |
| P1 | 设置读取错误键名且遗漏 cursorStyle | `terminal-container/container.tsx` | 使用 `AppSettings` 正确字段并实时更新 xterm |
| P2 | 隐藏标签长期持有 WebGL context | `use-terminal-instance.ts` | 默认 renderer 或仅活动终端按需启用 WebGL，context loss 可恢复 |
| P0 | 可靠性重构误把 WebKit 兼容 fork 当作异常来源并迁回官方 core，移除了 macOS WKWebView 重叠按键修复 | `packages/frontend/package.json`、`CoreBrowserTerminal` 审计 | 恢复并精确固定 `@baicie/xterm@0.1.7`；保留类型桥接并增加依赖/分包契约测试 |

## 5. 技术栈与目录

- 前端：React 19、TypeScript 6、Vite 8、Vitest 4、`@baicie/xterm@0.1.7`（xterm 6 开发主线的 WKWebView 兼容分支）与官方 xterm addons
- 桌面端：Tauri 2、Rust 2021、Tokio、portable-pty、russh
- 前端终端表面：`packages/frontend/src/features/terminal/components/terminal-container/`
- 前端会话编排：`packages/frontend/src/features/terminal/services/`
- 前端绑定：`packages/frontend/src/hooks/`
- Rust 会话：`src-tauri/src/session/`
- Tauri 命令：`src-tauri/src/commands.rs`、`src-tauri/src/lib.rs`
- 前端测试：与源码同目录的 `*.test.ts(x)`
- Rust 单元测试：对应模块的 `#[cfg(test)]`
- 规格与结果：`docs/plans/`、`docs/project.md`、`docs/issue.md`、`docs/todo.md`、`docs/xterm.md`

## 6. 目标协议与状态模型

```text
xterm.onData
    -> per-tab input FIFO
    -> one in-flight Tauri write
    -> Local PTY writer / russh channel writer

ResizeObserver + FitAddon.proposeDimensions
    -> latest dimensions cache
    -> xterm.resize(cols, rows)
    -> session create(cols, rows) OR latest-wins resize after ready

PTY / SSH byte stream
    -> streaming decoder or binary payload
    -> bounded Rust output pump
    -> one Tauri Channel subscription
    -> bounded frontend frame scheduler
    -> xterm.write(batch, completion callback)

EOF / close / reconnect
    -> generation invalidation
    -> stop input/output pumps
    -> close backend resource once
    -> remove session + metadata + channel
    -> publish final state once
```

关键不变量：

1. 单个会话的输入顺序等于 xterm `onData` 顺序。
2. `Ctrl+C`、Tab、方向键、Bracketed Paste 和 IME 数据不做命令层解释。
3. 实时输出数据不做 ANSI/VT 正则替换。
4. 任意时刻后端 PTY 尺寸等于最近一次已应用的 xterm 尺寸。
5. 每个 tab 最多有一个当前 generation；旧 generation 不得发出 connected/output 状态。
6. 数据队列有明确容量；结构事件（EOF、ExitStatus、Error）永不静默丢弃。
7. 同一输出批次必须在 xterm parser callback 完成后才开始下一批。

## 7. 分阶段范围

### Phase A：输入透明与本地 PTY 基线

- 为真实 `registerTerminalInput` 写失败测试，覆盖普通字符、Tab、方向键、Ctrl、IME/多字符和粘贴原样下发。
- 删除前端伪历史行编辑器与破坏性补全提交路径。
- 保留命令历史入口，但只允许旁路记录；无法可靠识别完整命令时不猜测。
- 删除 Unix `ECHO*` 篡改；补登录 shell 参数与常用终端环境变量，保持 Windows 分支兼容。
- 增加 Unix PTY 集成测试，验证输入回显、`read`/`cat` 和请求尺寸。

### Phase B：尺寸与设置

- xterm `open()` 后用 `proposeDimensions()`/有效 `cols,rows` 建立初始尺寸，不使用固定 80x24 覆盖有效值。
- session manager 在 connecting 阶段缓存最新尺寸；connected 后只提交最终尺寸。
- 高频 resize 使用 latest-wins 合并，拖动结束保证最终 resize。
- 改用强类型 `AppSettings` 字段：`fontSize`、`fontFamily`、`cursorStyle`、`cursorBlink`、`scrollback`、`allowProposedApi`。
- 验证动态字体变化触发 fit 和后端最终 resize。

### Phase C：有序控制与生命周期

- 每会话输入使用有界 FIFO 和单一 drain，不并发调用 Tauri/Rust writer。
- resize 使用单独 latest-value 通道，不阻塞输入。
- disconnect/reconnect/close 使用 generation 或 AbortController 隔离旧启动结果。
- serial 关闭调用 `serial_disconnect`；所有错误走 `formatIpcError`。
- Rust EOF/错误/主动 close 使用同一幂等清理路径，移除 session、meta 和输出 channel。
- 增加测试证明十次 EOF/重连后 session 数量不增长。

### Phase D：输出完整性与背压

- 删除 `sanitizeTerminalOutput()` 在实时流中的调用和相关错误测试。
- 前端增加可独立测试的 xterm 输出调度器：有界字节预算、每帧批量、一次只允许一个 `write` callback 在途。
- Rust local/SSH 输出统一进入有界泵，使用流式 UTF-8 decoder；decoder 在 EOF 时 flush。
- 以一个 Tauri Channel 承载高频终端输出；close、exit、error 与 generation 明确编码。
- 明确过载策略：暂停生产者或合并数据，不丢 ANSI/UTF-8 字节；达到硬上限时关闭会话并报告可读错误，禁止静默截断。

### Phase E：SSH 稳定性

- 连接、认证、`channel_open_session`、`request_pty`、agent forwarding 和 `request_shell` 分阶段 timeout。
- 检查 PTY/shell 请求结果；启用 TCP_NODELAY（底层 API 可用时）。
- SSH 写入由单 writer 按序处理，resize 与输入不会争抢并发 channel 调用。
- 保留现有 password/key/agent/cert/Jump Host/Agent forwarding 逻辑和连接池隔离，不降低主机密钥校验。

### Phase F：WKWebView 兼容 core 与 renderer 生命周期

- 精确固定 `@baicie/xterm@0.1.7`，运行时与 CSS 同源，保留 fork typings 所需的 ambient shim；禁止直接安装官方 core。
- 核对现有官方 addon 与 fork 公共 `loadAddon` 契约；不恢复 peer contract 面向 xterm 5 的 CanvasAddon。
- 通过依赖契约测试锁定 manifest，并通过 Vite 分包契约测试确保 `@baicie/xterm` 命中 `xterm-core`、官方 addons 命中 `xterm-addons`。
- WebGL 默认不为隐藏终端创建；仅在活动、可见且支持时启用，context loss 后回退默认 renderer。
- 不再全局替换 `console.error` 隐藏 parser 错误；测试和运行时应暴露真实解析错误。

## 8. 代码风格

前端控制器采用显式队列和窄接口，不让 React effect 持有协议状态：

```ts
const input = createTerminalInputQueue(async data => {
  await sessionService.write(sessionId, data)
})

term.onData(data => input.enqueue(data))
```

Rust 阻塞 PTY I/O 留在专用线程或 `spawn_blocking`，Tokio 任务只负责有界通道和生命周期：

```rust
while let Some(command) = input_rx.recv().await {
    writer.write_all(&command).context("write terminal input")?;
    writer.flush().context("flush terminal input")?;
}
```

- 前端使用 `@/` 路径、Zustand selector、现有类型和服务边界。
- Rust 不在 async 上下文执行阻塞 read/write，不跨 `.await` 持有锁。
- 新增逻辑文件遵守 300 行、普通 TSX 200 行门禁；接近上限时先拆分。
- 不使用 `unwrap()` 处理生产路径；错误携带 session/generation 上下文但不记录凭证。

## 9. 测试策略

严格执行 RED -> GREEN -> REFACTOR，每个缺陷先看到新测试在旧实现上失败。

### 9.1 前端单元/集成测试

- `registerTerminalInput`：Tab、上下方向键、Ctrl+C、Unicode、批量粘贴逐字节原样送达。
- input queue：FIFO、同一时刻只有一个 write、连接前缓冲、关闭后拒绝新输入、写失败可观察。
- resize controller：首次有效尺寸、connecting 期间 latest-wins、ready 后最终值、无效 0x0 不发送。
- output scheduler：跨 frame 批量、callback 串行、硬上限错误、ANSI/`%` 原样保留。
- lifecycle：连接中关闭、双击 reconnect、旧 generation 返回、serial disconnect、结构化错误。
- settings：所有数据库字段传入 xterm，cursorStyle/scrollback 动态生效。

### 9.2 Rust 单元/集成测试

- streaming UTF-8：在每个可能字节边界拆分中文/emoji，结果无 `�`。
- bounded pump：慢消费者下内存有界、字节顺序不变、EOF/ExitStatus 不丢。
- local PTY（Unix）：默认回显、`read`/`cat`、`stty size`、EOF 清理。
- session manager：主动 close 与自然 EOF 均幂等移除全部注册表。
- SSH writer/resize 状态机：单 writer FIFO、timeout 分类、旧 generation 隔离；真实 SSH 服务另做本地或实机 smoke。

### 9.3 真实终端回归

本地 PTY 和可用 SSH 目标分别执行：

```bash
printf 'plain\n中文🙂\n%%\n'
printf '\033[31mred\033[0m\n'
stty size
read value; printf '<%s>\n' "$value"
cat
seq 1 200000
yes 0123456789 | head -c 8388608
vim /tmp/terminal-vim-check.txt
nano /tmp/terminal-nano-check.txt
```

交互检查：Tab 补全、上下历史、Ctrl+C、Ctrl+Z、Ctrl+R、Home/End、Delete、Alt/Option、中文 IME、多行粘贴、窗口连续拖拽、分屏切换、断线重连。

## 10. 命令

```bash
# 精确前端回归（文件名随拆分结果补充）
pnpm --filter=@terminal/frontend test -- \
  src/hooks/terminal-input-registration.test.ts \
  src/features/terminal/services/terminal-session-manager.test.ts

# 全量前端
pnpm --filter=@terminal/frontend test
pnpm --filter=@terminal/frontend lint
pnpm --filter=@terminal/frontend typecheck
pnpm --filter=@terminal/frontend build

# Rust
cargo test --manifest-path src-tauri/Cargo.toml session::
cargo test --manifest-path src-tauri/Cargo.toml
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings

# 项目门禁
pnpm check:source-size
pnpm verify
git diff --check

# 真实桌面运行时
pnpm tauri dev
```

## 11. 边界

### 始终执行

- 保留 SSH password/key/agent/cert、Jump Host、Agent forwarding、SFTP/端口转发的现有公共接口。
- 对所有共享协议改动增加前端和 Rust 两侧测试。
- 保持 macOS、Windows、Linux 条件编译和路径/shell 差异。
- 记录参考项目、固定 commit、采用机制和许可边界。
- 每完成一个阶段更新本规格的决策和验证结果。

### 需要先询问

- 数据库 schema、Tauri capability、CI/release workflow 的修改。
- 引入精确固定的 `@baicie/xterm`、现有官方 addons 之外的新 npm/crate 依赖。
- 为了背压改变用户可见语义，例如截断输出或自动断开会话。
- 删除命令补全 UI，而不是仅禁用其破坏性 PTY 拦截。

### 绝不执行

- 不复制 GPL 或无许可证项目代码。
- 不通过 `term.write()` 伪造用户输入或 shell 编辑状态。
- 不在任意 IPC chunk 上清洗 ANSI/VT 数据。
- 不静默丢输入、输出、EOF、ExitStatus 或错误事件。
- 不把浏览器 mock、编译成功或单元测试描述为 Windows/Linux/SSH/串口实机通过。
- 不回滚或覆盖当前工作区中与本轮无关的用户改动。

## 12. 成功标准

- P0/P1 缺陷全部有先失败后通过的回归测试，相关旧伪测试被删除或改为测试真实导出逻辑。
- local 与 SSH 的输入顺序、VT 输出、UTF-8、resize 和生命周期使用同一组明确协议不变量。
- `read`、`cat`、readline 历史/Tab、vim/nano、中文 IME、8 MiB 输出和连续 resize 在本机 Tauri 运行时可用。
- 十次创建、EOF/断开、重连、关闭后，Rust `session_list` 与前端 record 数量回到基线。
- 前端全量测试、lint、typecheck、build，Rust test/fmt/clippy，源码行数与 `git diff --check` 全部通过。
- `@baicie/xterm@0.1.7` 依赖/分包契约生效，运行时与 CSS 不混用官方 core；隐藏终端不耗尽 WebGL context，终端 parser 错误不再被全局吞掉。
- `docs/project.md`、`docs/issue.md`、`docs/todo.md`、`docs/xterm.md` 与真实验证边界一致。

## 13. 实施与验证记录

2026-08-20 最终自动化状态：恢复兼容 core 并增加 manifest/分包契约后，`pnpm verify` 全绿，包含前端 79 个文件/675 项、Team Server 25 个文件/103 项、Rust 112 个单测 + 2 个桌面配置集成测试，以及 lint、typecheck、production build、bundle 预算、fmt、Clippy `-D warnings` 和 478 个生产源码文件规模门禁。Bundle 首屏/总 gzip 为 108.16/545.92 KB。

Tauri `Terminal Dev` 已真实验证本地 zsh、普通命令、Unicode、Ctrl+C 与 `stty size=45 125`。随后 8 MiB 连续输出真实复现 `frontend output ACK timed out after 10000 ms`：首版 watchdog 从首次触及高水位后固定计时，持续 ACK 但尚未降到低水位仍会误判超时。修复采用两条不变量：前端单次 write 限制为 32 KiB 并按 Unicode code point 安全拆分；Rust 每收到一次有效 ACK 就刷新 no-progress deadline，完全无 ACK 仍在 10 秒后失败。两条回归均先 RED 后 GREEN，调试包已重建。

最终验收前的重复 smoke 暴露了前台 RAF 被节流的问题：一次在 `ready` 阶段超时，另一次完整通过但耗时 123.989 秒。第一轮 RED/GREEN 回归让 100ms timer 与 RAF 竞速；后续真实 8 MiB 重跑又证明 timer 也会随 WKWebView 被节流，而且 callback 后切到 microtask 会使 xterm 下一批重新依赖内部 `setTimeout(0)`。最终实现让受流控输出额外竞速 microtask，并在 fallback 的 callback 内直接追加下一批，让已启动的 parse slice 避免每个 32 KiB 批次都重新等待内部 timer；fallback 状态跨越短暂空队列，后续无字节计数尾批次也直接由 microtask 续写。xterm 首次写入和约 12ms slice 主动让出仍保留其自身 timer 语义；reset、dispose 或 generation 变化时复位。

调度器修复后又发现 smoke 自身 `defaultNextFrame()` 仍只等待 RAF；RAF 不回调时控制流卡死，最终由 Rust watchdog 报 `stage rust-watchdog: terminal smoke timed out`。现改为 `waitForTerminalSmokeFrame()` 的 RAF/100ms timeout 竞速并取消未完成的一侧，新增回归覆盖 RAF 永不回调。

修复后的标准 Tauri/xterm smoke 已通过：shell 命令精确生成 8,388,608 字节，xterm 中观察到 `LOAD_END`，随后命令 `AFTER_LOAD_OK` 可见；resize 后 shell 的 `stty size` 返回 `31 97`，xterm 尺寸为 97 列 × 31 行。恢复 `@baicie/xterm@0.1.7` 并重新构建 Tauri 调试二进制后的最新运行耗时 562 ms，三个可见性标记均为 true。该证据证明尾标记与压力后的交互链路可用，但没有独立逐字节统计 xterm parser 消费的全部 8 MiB，也不能证明物理重叠按键。

真实 macOS WKWebView 物理 `a/s/d` 重叠按键、快速连续输入、Option/dead key、中文 IME，以及 SSH password/key/agent/cert/Jump、Windows/Linux/Pageant、串口硬件、vim/nano、连续 resize、SGR mouse、bracketed paste 和非 UTF-8 原始输入保持未通过状态，不能由自动化、构建结果或 macOS 本地 smoke 替代。

2026-08-21 增量验证：前端全量 93 个测试文件/801 项、typecheck 通过；Rust 依赖收口后 `cargo check --locked --all-targets --all-features` 与 `cargo test --locked --lib` 143 项通过。下一切片固定为 macOS WKWebView 物理输入资格门禁，再扩展真实 SSH/跨平台矩阵；不再增加应用层 textarea fallback，也不在此门禁前扩展终端 UX。

2026-08-24 重连门禁收口：定位到 smoke fixture 仅终止监听 daemon、没有终止独立 `sshd-session` 进程组，导致活动 TCP 连接持续存活并最终触发 180 秒 watchdog。fixture 现在校验 daemon 直接子进程的 PID/PPID/PGID，先终止隔离 session groups，再终止 daemon group，并在 3 秒后分别升级 `SIGKILL`；异常元数据 fail-closed。脚本回归 23 项通过，真实 localhost OpenSSH 重连 smoke 在 6.7 秒内完成 10 轮、产生 11 个唯一 session、拒绝旧 generation 输出并回收全部资源。普通 Tauri/xterm smoke 也在 5.4 秒内再次通过 8 MiB、97×31 resize 和 10 轮资源回收。下一切片仍是 macOS WKWebView 物理输入资格门禁，不因自动化重连通过而提前扩展 UX。

2026-08-26 WKWebView 主终端恢复：Shell Integration 改用 `term.parser.registerOscHandler`，删除错误的 Terminal 类型扩展；入口内联样式移入现有外链 CSS，并把 viewport 改为单行，避免 Tauri style nonce/hash 使 WebKit 忽略 `unsafe-inline`。重建 debug App 后，本地 PTY显示 Connected，Safari Web Inspector 在主终端页为 0 error/0 warning；完整 `pnpm verify`、506 文件规模门禁与 `git diff --check` 通过。物理 `a/s/d` 30 轮资格门禁仍未完成，下一切片不变。

## 14. 待确认问题

1. 是否接受先停用当前“Tab/方向键拦截式补全”，以标准 shell 补全和历史为准？本规格建议接受。
2. 已确认不迁回官方 core：`@baicie/xterm@0.1.7` 是 macOS WKWebView 输入正确性的必要兼容分支，必须精确固定并补足可追溯发布流程。
3. 是否接受首轮实机以当前 macOS + 本地 PTY 为强制门禁，Windows/Linux/Pageant/串口保留为后续硬件矩阵？本规格建议接受。
