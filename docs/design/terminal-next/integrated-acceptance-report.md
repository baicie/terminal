# Terminal Next — Integrated Acceptance & Independent Final Review

- 审查角色：独立 Release Quality Gatekeeper
- 审查日期：2026-11-13
- 审查基线：`main` = **`1a24eed0c1a89994a317776a2a6ce2ee3e49053a`**
- 复审方式：不采信实现者总结，全部结论回到源码与实跑结果
- 本文档状态：**完成**

---

## 0. 结论速览（TL;DR）

| 判定项 | 结果 |
| --- | --- |
| `WORKSPACE_DAILY_DRIVER_READY` | **PARTIAL** |
| `SFTP_TRANSFER_SAFE` | **PARTIAL** |
| `AGENT_RUNTIME_READY` | **NOT_APPLICABLE** |
| `AGENT_TOOL_SECURITY_READY` | **NOT_APPLICABLE** |
| `AGENT_UI_USABLE` | **NOT_APPLICABLE** |
| `RELEASE_SMALL_READY` | **PARTIAL** |
| `CROSS_PLATFORM_READY` | **PARTIAL** |
| `TERMINAL_NEXT_RC_READY` | **FAIL** |

**为什么有三个 `NOT_APPLICABLE` 而不是 `NOT_RUN`**：任务书假设本仓库存在 LLM Agent 运行时
（Model Stream、Agent Run、Tool Approval、Model 切换、Agent Composer）。**它不存在。**
这不是「没测」，是「没有可测的对象」——详见 §1.3。把它们记成 `NOT_RUN` 会暗示
「功能已写但未验收」，那是与事实相反的陈述。

---

## 1. 检查提交范围

### 1.1 当前 main

| 项 | 值 |
| --- | --- |
| SHA | `1a24eed0c1a89994a317776a2a6ce2ee3e49053a` |
| 提交时间 | 2026-11-13 09:17:36 +0800 |
| 标题 | `docs(ux1): 补回被遗漏的真实 GUI 截图 (#41)` |
| `origin/main` | 同一 SHA（本地与远端一致，ahead/behind = 0/0） |
| 工作树 | 干净；唯一未跟踪项是 `.worktrees/`（见 §1.6） |

### 1.2 相关 PR 与合入状态

全部 Terminal Next 相关 PR **均已合入 main**，当前没有 open 的 Draft PR。

| PR | 标题 | base ← head | 合入 commit | 状态 |
| --- | --- | --- | --- | --- |
| #36 | UX-1a: Terminal Workspace Shell | `main` ← `feat/terminal-next-ux1a-workspace-shell` | `4270629` | MERGED |
| #37 | UX-1b: Connection Explorer | `main` ← `feat/terminal-next-ux1b-connection-explorer` | `fa6d6c8` | MERGED |
| #38 | build: release-small profile | `main` ← `build/release-size-optimization` | `46071b5` | MERGED |
| #39 | UX-1c: Context Dock | `main` ← `feat/terminal-next-ux1c-context-dock` | `c134ba5` | MERGED |
| #40 | UX-1 Acceptance & Hardening | `main` ← `feat/terminal-next-ux1-hardening` | `d6f3878` | MERGED |
| #41 | docs(ux1): 补回遗漏截图 | `main` ← `fix/ux1-evidence-screenshot` | `1a24eed` | MERGED |

**stacked dependency**：#37 → #39 → #40 是顺序堆叠（各自 base 为 main，但内容依赖前一个）。
因全部已合入，当前不存在未解决的堆叠依赖。

### 1.3 关键否证：「Agent」在本仓库指 SSH Agent，不是 LLM Agent

这是本轮最重要的一条核实，它决定了任务书一半条目的性质。

| 证据 | 内容 |
| --- | --- |
| `src-tauri/src/agent.rs:1-4` | `//! SSH Agent Protocol Implementation` … `for communicating with ssh-agent` … `RFC 4716` |
| `src-tauri/src/lib.rs:5` | `mod agent;` —— 该模块就是上述 SSH Agent |
| 全仓 grep | `rig-core` / `openai` / `anthropic` / `chat_completion` / `tool_call` / `composer` **命中 0** |
| `src-tauri/Cargo.toml` / `Cargo.lock` | LLM 相关依赖 **0** |
| `docs/design/terminal-next/04-rust-rig-ai.md:3-4` | 「状态：**提案（Draft）**，UX-4 才实施」；「**默认构建不包含 AI**」 |
| `packages/frontend/src/store/right-panel-state.ts:16` | `export type RightPanelMode = 'none' \| 'sftp'` —— 注释提到 `snippets`/`ai`，**代码里没有** |
| `src-tauri/src/lib.rs:5-31` | `mod` 列表无 `ai` 模块 |

因此下列任务书条目在本基线**没有对象可审**：

- Model Stream、Agent Run、Agent Tool Approval、Agent Composer、模型切换
- 「Agent 无静默执行权限」「Prompt Injection 不提升权限」「模型响应不执行 Shell」
- 「模型 API Key 不进日志」「SSH Credential 不进模型上下文」

**本报告不会为这些项编造行为描述或凭空判 PASS。** 对每一场景，我改为审查它在本仓库
**真实存在的对应执行面**（脚本执行、shell 注入、终端写入总线、凭据读取边界），
并在 §4/§5 中如实标注这是替代场景而非原场景。

### 1.4 文件修改重叠

`docs/verification/` 下的六个证据 JSON + `evidence-manifest.json` + `raw/` 在
**每一个** UX-1 PR 中都被重写（#37/#38/#39/#40 均含）。这是**按规则重采**，不是冲突：
任何 `FINGERPRINT_PATHS` 内改动都会让旧证据失效，必须重采。

源码层面各 PR 的改动域基本不重叠：

- #36：`components/activity-rail`、`components/status-bar`、`top-toolbar`、`layout/*`、`workspace-*`
- #37：`features/connection-explorer`、`router/terminal-route.ts`、`store/*-panel-*`
- #38：**只改 `src-tauri/Cargo.toml` + 文档**（新增 `[profile.release-small]`）
- #39：`layout/right-panel.tsx`、`view/sftp/*`、`layout/use-panel-layout.ts`
- #40：`view/sftp/hooks/*`、`layout/*`
- #41：**只加一张 PNG**

### 1.5 配置与 Lockfile

| 文件 | 变化 |
| --- | --- |
| `src-tauri/Cargo.toml` | 新增 `[profile.release-small]`（LTO fat + codegen-units=1 + strip=symbols），**默认 `[profile.release]` 未被覆盖**（已核实 §6.2） |
| `pnpm-lock.yaml` | 本批次无实质依赖变更 |
| `src-tauri/Cargo.lock` | 无变更 |

### 1.6 未提交文件与残留工作区

```
git status --porcelain  →  ?? .worktrees/
git worktree list       →  main 1a24eed [main]
                           /private/tmp/wp6-baseline 1a24eed (detached HEAD)
                           .worktrees/ux1i 4d6849d [fix/terminal-next-ux1i-runtime-acceptance]
```

两条仓库卫生问题（**均为 P2**）：

1. **`.worktrees/` 不在 `.gitignore` 中**。已核实 `.gitignore` 无 `worktree` 条目，
   所以它会持续出现在 `git status` 里。AGENTS.md 的「分支与工作区清理」要求用完即清。
2. **`/private/tmp/wp6-baseline` 是遗留 worktree**（UX-1i 调查用的对照检出），未清理。

`fix/terminal-next-ux1i-runtime-acceptance` 分支有 6 个提交、**未推送到远端**、
**不在 main 上**，另有 1 个未提交文件（其交付文档）。
**它不属于本轮审查的 main 基线**，但其中包含三处对 main 缺陷的修复与先红证据，
本轮把它们作为独立发现引用（见 §2.1、§3.2）。

### 1.7 证据文件状态

| 项 | 值 |
| --- | --- |
| manifest `commit` | `51599bcace1b7f0afe78b1cf23413697403e7dab` |
| manifest `runId` | `43259056123`（`Real-machine terminal matrix`，**success**） |
| manifest `fingerprint` | `8129680b4a8a35722099217c7da88850bb820b0d99f36aabeb61749ba502c736` |
| 该 commit 是否为 main 祖先 | **否** —— 它在 `feat/terminal-next-ux1-hardening` 分支上（PR #40 的 head 之后） |

**这不是证据失效。** 我已实测复核：

- `git diff 51599bca main -- <全部 FINGERPRINT_PATHS>` 输出为**空**，即指纹路径内容完全一致；
- 在 HEAD `1a24eed` 上实跑 `computeSourceFingerprint()` 得到
  `8129680b…`，与 manifest **完全一致**（`MATCH: true`）。

所以证据描述的就是当前源码。文档里另有一个 `ff265ac2` 的指纹是**作废值**
（`ux1-acceptance-hardening.md:290` 自己记录：派完证据后又改代码，那次证据当场作废）。

---

## 2. 端到端架构与共享资源所有权

### 2.1 调用链（逐跳，含 file:line）

```
用户操作
  └─ React 组件（view/*、components/*、layout/*）
       └─ Zustand store（store/app.ts、host.ts、transfer-queue.ts、sftp-binding-store.ts…）
            └─ service 层（service/ssh.ts → features/terminal/services/session.ts）
                 └─ Tauri IPC  invoke('session_create_*' | 'sftp_*' | 'vault_*')
                      └─ Rust 命令（src-tauri/src/lib.rs:296-380 generate_handler!）
                           ├─ session/manager.rs  SessionState + ChannelManager
                           ├─ session/ssh.rs      russh 连接、writer、输出泵
                           ├─ session/local.rs    portable-pty
                           ├─ sftp.rs             russh_sftp 会话
                           ├─ vault.rs            进程内 AES-GCM + Argon2id
                           └─ port_forward.rs / serial.rs / storage.rs
                                └─ 事件回传  app.emit('terminal-output' | 'sftp-progress' | …)
                                     └─ store 更新 → React 重渲染
```

### 2.2 共享资源所有权表

| 资源 | Owner | 创建点 | 释放点 | 结论 |
| --- | --- | --- | --- | --- |
| Terminal Session（SSH） | `SessionManager`（`session/manager.rs`） | `register_session`（`manager.rs:148`），id = `ssh-{uuid}`（`ssh.rs:1606`） | `session_close` → `remove_session`（`manager.rs:264`）→ `remove_registry_entries`（`manager.rs:362`） | ✅ 所有权清晰，id 为 UUID 不复用 |
| Terminal Session（local PTY） | 同上 | `local.rs:362`，id = `local-{uuid}` | 同上 | ✅ |
| **xterm 实例** | React（`use-terminal-instance.ts`） | effect body | cleanup 调 `term.dispose()`（`use-terminal-instance.ts:193`） | ✅ 只销毁渲染层，不碰后端 |
| **Terminal 会话的关闭时机** | `terminalSessionManager.prune` | — | `terminal-by-url.tsx:84`，`tabs` 变化时 prune | ✅ INV-8 成立：按完整 tab 集合关闭 |
| **SFTP Session** | `state.sftp_sessions`（`state.rs:508`） | `sftp_connect`（`sftp.rs:117-118`） | **仅** `shutdown.rs:38` 的进程退出 `clear()` | 🔴 **见 §2.3** |
| Transfer Queue | Zustand 全局单例（`store/transfer-queue.ts`） | `enqueue` | 终态记录保留供 UI 展示 | ✅ 单例；并发由 `sftp-transfer-queue.ts` 的 `MAX_CONCURRENT=3` 裁决 |
| sftp-progress 监听器 | `service/sftp-transfer.ts` 模块级 `listenerPromise` | `ensureProgressListener()` | 无移除（单例，随进程） | ✅ 幂等：并发调用共享同一 Promise |
| Secret Provider | `service/vault-secret-provider.ts` | 连接时按需 | 不缓存明文 | ✅ 见 §4.2 |
| Workspace State | `store/app.ts` + `service/workspace-*.ts` | tab 增删 | `prune` + `workspace-recovery-journal` | ✅ 见 §3.7 |
| Event Listener | Tauri `listen()` 各模块自行持有 | 各自 effect | 各自 cleanup / 模块级单例 | ✅ 逐处核查见 §3 |

### 2.3 P1 缺陷：SFTP 会话表没有关闭路径（资源泄漏 + 悬挂引用）

**位置**：`src-tauri/src/sftp.rs:117-118`、`src-tauri/src/commands.rs:83-87`、`src-tauri/src/shutdown.rs:38`

先说明**正确的所有权设计**（这部分是好的）：

```rust
// sftp.rs:98-101 —— SFTP 不新建连接，而是从终端会话取 handle
let handle = get_session_manager()
    .get_ssh_handle(&session_id)      // manager.rs:214-223, 只认 SessionState::Ssh
    .await
    .ok_or(SftpError::SessionNotFound)?;
```

```rust
// session/ssh.rs:779-783 —— 连接池同时把 handle 注册进全局表供 SFTP/端口转发查找
self.inner.write().await.insert(key, conn);
let sessions = get_ssh_sessions();
sessions.insert(key_for_global, handle);
```

```rust
// session/ssh.rs:786-810 —— release 会正确移除全局条目并断开
let handles = { self.inner.write().await.remove(&key)... };
sessions.lock().await.remove(&key);
```

**SFTP 是终端 SSH 连接上开的一个 subsystem channel，不新建第二条连接。**

缺陷在于 SFTP 的**第二个 map** 没人清理：

```rust
// sftp.rs:117-118 —— 以同一个 session id 为 key，插入独立的 map
let mut sftp_sessions = state.sftp_sessions.lock().await;
sftp_sessions.insert(session_id, Arc::new(sftp));
```

```rust
// commands.rs:83-87 —— 关闭 SSH 会话，但不碰 sftp_sessions
pub async fn session_close(session_id: String) -> Result<(), SessionError> {
    finish_session_output(&session_id);
    let manager = get_session_manager();
    manager.remove_session(&session_id).await   // 清 sessions / channel_manager / session_meta
    //                                            ← sftp_sessions 未清
}
```

**已核实的三条事实**：

1. 全仓**不存在** `sftp_close` / `sftp_disconnect` 命令（`lib.rs:317-326` 的 SFTP 命令列表里没有，
   前端也从未调用）。
2. 全仓**唯一**的 `sftp_sessions` 清理点是 `shutdown.rs:38` 的进程退出 `clear()`。
3. `sftp_sessions` 在三处被访问：`sftp.rs:66`（get）、`sftp.rs:117`（insert）、
   `shutdown.rs:38`（clear）。**没有任何 remove**。

**失败场景**：用户开 SFTP → 关 Dock（`sshService.close` 关掉终端 SSH 会话）→ 再开一台 host。
`Arc<SftpSession>` 与它持有的 `russh_sftp` 流一直留在 map 里，直到应用退出。
一次会话里开关 N 次就累积 N 条。**更关键的是**：连接池的 `release` 已经把底层 handle 移除并
`disconnect`，而 `sftp_sessions` 里那条仍持有已死的 stream —— 它是**悬挂引用**，
不只是内存占用。

**为什么不是 P0**：SSH session id 是 UUID（`ssh.rs:1606`），**不会被复用**，
所以残留条目不会被后续 `get_sftp` 误取到别的会话 —— 不会造成跨主机误操作。

**测试覆盖**：`grep sftp_sessions` 在全部 Rust 测试文件中**命中 0**。该 map 的生命周期没有任何测试。

**与 UX-1i 的关系**：该分支（未合入）修的是前端 `useSftpRemote` 的释放幂等性，
**不涉及**这个 Rust 侧的 map。两者是不同层的两个问题。

---

## 3. 跨模块竞态

> 说明：任务书 12 个场景中，**#2/#3/#4/#5/#8/#9/#10/#12** 以 LLM Agent 为前提，本仓库无此对象（§1.3）。
> 下表对每一项给出「原场景是否适用」与「实际审查的对应场景」。**没有任何一项被跳过。**

| # | 任务书场景 | 适用性 | 实际审查对象 | 判定 |
| --- | --- | --- | --- | --- |
| 1 | SSH 连接期间打开 SFTP | ✅ 适用 | 双连接所有权 | **SAFE**（见 3.1） |
| 2 | SFTP 上传期间打开 Agent | ❌ 无 Agent | 上传期间切换 Dock 主机 | **SAFE**（见 3.2） |
| 3 | Agent Streaming 期间关闭 Dock | ❌ 无 Agent | 上传期间关闭 Dock | **SAFE**（见 3.3） |
| 4 | 切换 Host 时 Agent 仍在生成 | ❌ 无 Agent | 切 tab 时 SFTP 面板指向 | **SAFE**（见 3.4） |
| 5 | Agent 待授权时关闭终端 Tab | ❌ 无 Agent | 关闭 tab 时后端会话是否释放 | **SAFE**（见 3.5） |
| 6 | 上传中关闭整个 Workspace | ✅ 适用 | workspace 切换的在途传输 | **见 3.6** |
| 7 | 改字体大小时双面板展开 | ✅ 适用 | 布局预算 | 🔴 **DEFECT**（见 3.7） |
| 8 | 恢复 Workspace 期间打开 Agent | ❌ 无 Agent | 恢复与用户操作竞争 | **见 3.8** |
| 9 | Vault 锁定期间触发模型请求 | ❌ 无模型 | Vault 锁定时发起 SSH/SFTP | **SAFE**（见 3.9） |
| 10 | Agent 取消后切换模型 | ❌ 无 Agent | 取消传输后立即新传输 | **见 3.10** |
| 11 | 连续开关面板 100 次 | ✅ 适用 | 幂等性 / 监听器 / 连接复用 | **PARTIAL**（见 3.11） |
| 12 | 中文输入法操作终端与 Composer | ⚠️ 仅终端 | IME 组合态 | **见 3.12** |

### 3.1 SSH 连接期间打开 SFTP —— 需要注意的共享，不是独立连接

**先前判断需要修正**：SFTP **不是**独立建第二条连接，而是复用**它自己创建的那个 SSH 会话**。

分两种情况：

**(a) 从终端 tab 打开 Dock** —— 两者**不共享**连接。
`use-sftp-remote.ts:118-137` 自己调 `sshService.createSshSessionPassword/Key` 建**新**会话，
再对此 `connResult.sessionId` 调 `sftpConnect`。终端会话由 `terminalSessionManager` 持有，
SFTP 会话由 `useSftpRemote.sessionRef` 持有。**两条独立连接，所有权清晰。**

**(b) 在已有会话上开 SFTP channel** —— 共享同一条 SSH 连接。
`sftp.rs:98-101` 的 `get_ssh_handle(&session_id)` 从 `SessionManager.sessions` 取 handle
（`manager.rs:214-223`），在该连接上 `channel_open_session()` + `request_subsystem("sftp")`。
这是**正确且经济**的设计：SFTP 是 SSH 的一个 subsystem，不该另开 TCP 连接。

**由此产生的耦合（这是缺陷的来源）**：因为 SFTP channel 挂在终端连接上，
关闭终端会话时，`SshConnectionPool::release`（`ssh.rs:786-810`）会断开底层 handle，
但 `sftp_sessions` 里那条记录**不会被清**（§2.3）。

**判定**：连接所有权本身正确（**SAFE**），但释放路径不完整（**§2.3 的 P1**）。

### 3.2 上传期间切换 Dock 主机 —— SAFE

`transfer-queue` 的每条 `TransferRecord` 在入队时**固化** `sessionId`（`transfer-queue.ts:29`），
传输执行时用的是这个固化值，不是「当前面板的会话」。因此切换 Dock 主机不会把在途上传改投另一台。
`useSftpRemote` 在切 host 时对旧会话走 `releaseOrDefer`（`use-sftp-remote.ts:109-114`），
有在途传输则不关闭。

### 3.3 上传期间关闭 Dock —— SAFE

`releaseOrDefer`（`sftp-deferred-release.ts:36-54`）用 `Map<sessionId, disposer>`，
重复调用不新建 watcher、不重复 close。测试直接计数 `close` 调用次数而非 `toHaveBeenCalledWith`
（`sftp-deferred-release-idempotency.test.ts:18-20` 明确写出这一点）。
StrictMode 双调用路径也有测试（`sftp-release-callers.test.tsx:224-241`）。

### 3.4 切 tab 时 SFTP 面板指向 —— SAFE

`resolveSftpHostId`（`store/sftp-binding.ts:59-66`）：**已 pin 的绑定优先于 activeTab**，
未 pin 时跟随 activeTab。面板的 `sessionId` 来自 `useSftpRemote({ activeHost })`，
而 `activeHost` 由 `hostId` 解析而来 —— 上传/下载/拖拽全部使用 `remote.sessionId`
（`sftp-container.tsx:71-108`），与显示的主机同源。

这是 UX-1c 修复的 INV-13，有专门的绑定逻辑与测试。**成立。**

### 3.5 关闭终端 tab 时后端会话释放 —— SAFE

`removeTab`（`store/app.ts:182`）只改 store。真正的释放来自
`terminal-by-url.tsx:84`：`tabs` 变化 → `terminalSessionManager.prune(new Set(tabs.map(...)))`
→ 对不在集合内的 tabId 调 `close`（`terminal-session-manager.ts:144-148`）
→ `closeTerminalBackend`。

**没有「关闭 tab 但会话仍在跑」的路径**（就终端而言）。SFTP 会话是另一个问题（§2.3）。

### 3.6 上传中关闭/切换 Workspace —— 未见缺陷，但无直接测试

`transfer-queue` 是**全局** store，不随 workspace 清空；传输记录跨 workspace 存活。
`prune` 会关闭不在新 tab 集合中的**终端**会话，而传输用的是 SFTP 的独立会话，
不在 `prune` 的管辖内，因此传输不会被 workspace 切换打断。

这是「符合预期」的行为，但**没有任何测试直接覆盖「切换 workspace 时在途传输」**。
判定为**未充分验证**，不判 SAFE 也不判 DEFECT。

### 3.7 改字体大小时双面板展开 —— 🔴 P1 DEFECT

**位置**：`packages/frontend/src/layout/use-panel-layout.ts:112-117`（预算入参）
与 `packages/frontend/src/layout/main-layout-content.tsx:66`（调用方）

```ts
// use-panel-layout.ts
const budget = panelBudget(
  viewportWidth,
  cellWidth,
  RAIL_WIDTH + SEPARATOR_WIDTH,   // ← 52，从不包含左侧栏宽度
  DOCK_WIDTH,                      //   300
)
```

```tsx
// main-layout-content.tsx:66 —— 同组件作用域内第 47 行就有 sidebarWidth
const panelLayout = usePanelLayout()
```

**左侧栏的真实宽度**：`sidebar-width.ts:3-5` → `SIDEBAR_MIN=64`、`SIDEBAR_MAX=420`、`SIDEBAR_DEFAULT=176`。
`LeftPanel` 按这个宽度渲染（`left-panel.tsx:33`、`main-layout-content.tsx:125`）。

**算术反例**（`USABLE_COLS = 60`，`OVERVIEW_RULER_WIDTH = 14`，cellWidth 8.4）：

| 视口 | 预算认为的列数 | 左栏 176 时实际 | 左栏 420 时实际 | 预算的判定 |
| --- | --- | --- | --- | --- |
| 1024 | 78 | 62 | **33** | 双栏 OK（错） |
| 1240 | 104 | 88 | **59** | 双栏 OK（错，跌破 60） |
| 1440 | 127 | 112 | 83 | 双栏 OK（对，但余量算错） |

**失败场景**：1024px 窗口 + 左栏拖到 420px。预算以为 78 列 → `bothPanels=true` → 两个面板都按列渲染
→ 终端实际只有 **33 列**，远低于本仓库自己定义的 `USABLE_COLS=60`。字体调大（cellWidth 上升）
会让情况更糟，而 `usePanelLayout` 确实监听 `fontSize`/`fontFamily`（`use-panel-layout.ts:99-102`），
所以「改字体大小」正是触发路径之一。

**为什么现有测试抓不到**：`terminal-width-budget.test.ts` 的 15 个用例全部直接调用
`panelBudget(...)` 并**正确传入** `LEFT + RAIL`。算法一直是对的 —— 错的是唯一调用方传什么，
而那个调用方**没有测试**。这与本仓库反复记录的形态一致：守卫存在、有单测、真实入口走另一条路。

**佐证**：未合入的 UX-1i 分支为这个缺陷写了先红测试
（`.worktrees/ux1i/.../use-panel-layout.test.ts`，3 项失败），并把入参改为**必填对象**
`{ explorerWidth }`，使 `main-layout-content.tsx` 立刻报 `TS2554`。该修复**不在 main 上**。

**INV-12 的自我声明不成立**：`ux1-acceptance-hardening.md:371` 把 INV-12 记为
「PASS / `usePanelLayout` 在 `isMobile` 时返回 hidden」，但它验证的是**移动端分支**，
不是「窄窗口预算用了正确宽度」。

### 3.8 恢复 Workspace 期间的用户操作 —— 未见缺陷

`StartupGate` 在门禁未通过前不挂载业务 App（Phase 9.6.1），恢复是**阻塞式**的，
因此「恢复期间用户操作」在架构上不可达。窗口布局恢复有 `workspace-layout-version.ts`
的版本迁移，且迁移点被放在三个读写边界（`workspace-layout-migration-boundaries.test.ts`）。

无测试覆盖「恢复写入晚于用户操作」，但因为 App 尚未挂载，该竞争没有入口。

### 3.9 Vault 锁定时发起 SSH/SFTP —— SAFE

`credential-resolver.ts:31-44` 对三种状态各给一句明确文案，且**不退化为空密码**。
`credential-resolver` 返回 `state` 字段（不是靠字符串反推）。
`VAULT_UNAVAILABLE_MESSAGES.locked` 明确指向「解锁 Vault 后重连」。
Phase 10.4.1 已把「Vault 读取失败」从网络重连阶梯中剥离（`recovery: 'after-vault'`）。

### 3.10 取消传输后立即新传输 —— 未见缺陷

`cancelled_transfers`（`sftp_upload.rs:405-407`）是全局 `HashSet<String>`，
在 `sftp_upload` 返回后由 `clear_cancel`（`sftp.rs:258`）同步清除，
注释明确写出目的是「不让 id 取消后续复用它的传输」（`sftp.rs:256-257`）。

**残留风险（P2）**：若 `staged_upload` 发生 panic（而非返回 `Err`），
`clear_cancel` 不会执行，该 transfer_id 会永久留在取消集合里。
`db_import::writer` 用了 `catch_unwind`，但 `sftp_upload` 没有。
实际影响有限（transfer_id 通常唯一），但这是无界集合。

### 3.11 连续开关面板 100 次 —— PARTIAL

已覆盖的部分：
- 幂等 close：`sftp-deferred-release-idempotency.test.ts`（3 次调用 → 1 次 close）
- 反复挂载不累积 poller：`sftp-release-callers.test.tsx:218-227`（**5 次**循环）
- StrictMode 双调用：同上（至少 1 项）

**缺口**：任务书要求 100 次，测试最多做了 5 次。没有测试断言
「100 次开关后 `sftp_sessions` 的条目数不变」（因为 Rust 侧根本没有清理机制）。
监听器安装是模块级单例（`sftp-transfer.ts:96-108`），理论上幂等，但没有 100 次的压力断言。

### 3.12 中文输入法 —— 未见缺陷，但无自动化

终端输入路径：`terminal-input-protocol.ts`（有测试）、`use-safe-paste.ts`、
`paste-gate.ts`（有测试）。多行/控制字符粘贴有确认门（PastePolicy）。
**IME 组合态（compositionstart/update/end）在本仓库没有任何测试**，
`GUI_IME` 在 AGENTS.md 中一直记为 NOT_RUN。此项只能记 **NOT_RUN**。

## 4. 安全检查

> 任务书 8 项中 3 项以 LLM 为前提。对每一项，我审查它在**本仓库真实存在的对应面**，
> 并明确标注这是替代审查。

| # | 任务书检查项 | 适用性 | 实际审查 | 判定 |
| --- | --- | --- | --- | --- |
| 1 | 模型 API Key 不进入日志 | ❌ 无模型 | SSH 凭据是否进入日志/toast/错误串 | **PASS**（4.1） |
| 2 | SSH Credential 不进模型上下文 | ❌ 无模型 | 凭据读取边界与导出白名单 | **PASS**（4.2） |
| 3 | Agent 无静默执行权限 | ❌ 无 Agent | 脚本执行/调度器的触发条件 | **PARTIAL**（4.3） |
| 4 | Tool Approval 与 Session 绑定 | ❌ 无审批 | 主机密钥确认与连接绑定 | **PASS**（4.4） |
| 5 | Prompt Injection 不提升权限 | ❌ 无 LLM | 远端数据是否被当作指令执行 | **见 4.5** |
| 6 | SFTP 操作与 Host 显式绑定 | ✅ 适用 | 绑定源一致性 | **PASS**（4.6） |
| 7 | Tauri IPC 不暴露通用读秘密能力 | ✅ 适用 | command 面 + capabilities | 🔴 **FAIL**（4.7） |
| 8 | 模型响应不直接执行 Shell | ❌ 无模型 | 终端写入总线 / shell rc 注入 | **PARTIAL**（4.8） |

### 4.1 凭据不进入日志 —— PASS

- `service/vault.ts`、`credential-resolver.ts`、`credential-boundary.ts` 中
  `console.log/warn/error` 命中 **0**。
- Rust 侧 `tracing::*password*` / `println!(*password*)` 命中 **0**。
- Vault 的错误类型（`VaultError`）只描述失败原因，不回显明文。
- Phase 10.1 的记录也确认「密码/秘密不入日志」，且 `smoke-vault-probe` 明确写文件而非打印。

### 4.2 凭据读取边界 —— PASS

Rust 的导入 SQL 把秘密列写成**字面 `NULL`**，不是绑定 NULL 参数：

```rust
// db_import/writer.rs:115
const HOST_INSERT: &str = "... password, private_key, ... VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ...)";
// db_import/writer.rs:130
const SSH_KEY_INSERT: &str = "... private_key, public_key, ..., passphrase, ... VALUES (?, ?, ?, NULL, ?, ?, NULL, ?, ?, ?, ?)";
```

重新引入明文列必须**同时**改 SQL 文本与参数构造，而不是只改一个绑定。
`HOST_UPDATE` 用 `credential_ref = COALESCE(?, credential_ref)`，保留已有引用（§5.3 的另一面）。

导出走字段白名单（`export-sanitize.ts`），`password`/`private_key`/`passphrase` 不在其内；
读不懂的引用会 `throw ExportIntegrityError` 而不是静默降级为 `null`。
团队包导出这条路径也已覆盖（Phase 10 第二轮审查发现并修复）。

### 4.3 脚本执行权限 —— PARTIAL

`service/script-executor.ts` 批量执行时并发上限 5（`MAX_CONCURRENT_HOSTS`），
带指数退避重试，执行走 `sshService.execute`（真实 SSH）。
`script-scheduler.ts` 提供调度。

**未解决的疑问**：这些是**既有产品功能**（Phase 1-3 就有），触发**完全由用户发起**——
没有模型、没有远程输入可以驱动它们。但本仓库**没有**「执行前二次确认」的统一门禁，
且我未找到针对「调度器被同步数据/团队共享内容影响」的负向测试。
判 PARTIAL 的理由是「缺少显式的授权断言」，不是「发现了静默执行路径」。

### 4.4 主机密钥确认与连接绑定 —— PASS

`state.rs:355-408` 的 `check_server_key`：

- 有 `expected_host_key` 且**不匹配** → `Err("server key does not match the preflight key")`，直接失败；
- 无 known_hosts 条目且**无**预检密钥 → `Err("key not found in known_hosts")`，**不会自动接受**；
- 只有两种情况返回 `Ok(true)`：known_hosts 命中，或命中预检密钥（一次性 TOFU 批准）。

证书分支取证书内嵌公钥做同样的 known_hosts 判定（`state.rs:358-365`），
且注释明确说明为什么不额外验 CA（本应用没有 per-host CA 设置，凭空加会静默拒绝今天能用的服务器）。
**确认与连接强绑定，没有自动接受路径。**

### 4.5 Prompt Injection —— 不适用，但有等价风险需记录

没有 LLM，因此没有 prompt injection 面。等价的「远端数据被当指令」的风险：

- **SFTP 文件名**：`uploadPaths` 用本地 basename 拼远端路径（`sftp-transfer.ts:251-256`），
  不引入 `..` 穿越。远端返回的文件名只用于显示与作为路径参数回传，
  **不会**被拼进 shell 命令。
- **终端输出**：OSC/标题序列由 xterm 处理，不进入执行路径。
- **shell rc 注入**：`session/shell_startup.rs` 写入的是**本应用生成的**脚本内容，
  路径来自应用自身，不由远端提供。

**未发现远端数据被提升为本地执行指令的路径。** 但因为不存在原场景，本项不判 PASS。

### 4.6 SFTP 与 Host 显式绑定 —— PASS

见 §3.4。`SftpBindingStore` 与 `activeTab.hostId` 的优先级由 `resolveSftpHostId` 唯一决定，
面板的显示主机、`activeHost`、`sessionId`、上传/下载/拖拽的目标**全部同源**。
绑定**不持久化**（`sftp-binding-store.ts:6-11` 明确说明：恢复的 dock 不应在启动时自动连服务器）。

### 4.7 🔴 P0（安全面）：IPC 暴露通用读秘密能力 + 无约束文件读写

这是本轮安全审查的**最重要发现**。

**能力面（`src-tauri/capabilities/default.json`）**：

```json
"permissions": [
  ...
  "fs:allow-read-text-file",     // 注释自述 "without any pre-configured scope"
  "fs:allow-write-text-file",    // 同上
  "sql:default", "sql:allow-load", "sql:allow-execute", "sql:allow-select",
  ...
]
```

**已核实**：

1. `default.json` 中**没有任何 `fs:scope` 限制**。`gen/schemas/acl-manifests.json` 里
   `allow-read-text-file` 的描述原文是「Enables the read_text_file command
   **without any pre-configured scope**」。→ 渲染进程可读写**任意路径**的文本文件。
2. `src-tauri/src/lib.rs:331-344` 注册了 `vault_get` / `vault_list` / `vault_set` / `vault_delete`。
   `vault_get`（`vault.rs:992-999`）只检查「Vault 已解锁」，**不校验调用方身份**，
   key 由调用方任意给出。
3. `sql:allow-load/execute/select` 允许渲染进程直接对 SQLite 执行任意 SQL。

**组合后的失败场景**：一个被攻陷的 webview（XSS、恶意依赖、供应链）可以：
① 用 `plugin:sql|select` 读出 `hosts.credential_ref` 与 `ssh_keys.credential_ref`；
② 用 `vault_get(key)` 对每个 ref 取回**明文密码与私钥**；
③ 用 `fs:allow-read-text-file` 读取 `~/.ssh/id_*`、`vault.json`、`terminal.db`；
④ 用 `fs:allow-write-text-file` 覆盖任意用户可写文件。

**这一条已有部分记录，但不完整**：`docs/phase9-7/session-lock-safety.md:45-54` 记录了
`plugin-sql` 的信任边界（B 方案：靠 `StartupGate` 不挂载业务 App，明确声明
「被攻陷的 webview 直接调用 plugin:sql|load 不在本轮信任模型内」）。
但**同一份文档没有提到**：(a) `vault_get` 是通用读接口；(b) `fs:allow-*` 完全没有 scope。
三者叠加后，攻击面比该文档描述的更大。

**为什么判 FAIL 而不是 PARTIAL**：任务书的判定标准是「Tauri IPC **不暴露**通用读取秘密能力」。
`vault_get(key)` 就是一个通用读取秘密的 IPC 命令，且 `fs` 无 scope。
按字面标准，这一项**不成立**。

**这不是本轮引入的回归**——它是既有架构。但它是 **RC 阻断项**，
因为威胁模型里「渲染进程被攻陷」是真实存在的（本项目已把 `csp` 配置为
`script-src 'self'`，说明已在考虑 XSS）。

**缓解事实（不改变判定，但影响优先级）**：`tauri.conf.json` 的 CSP 是
`default-src 'self'; script-src 'self'`，且 `connect-src` 含 `http: https:`（较宽）。
没有发现现实可利用的 XSS 入口，所以这是**纵深防御缺口**而不是已知可利用漏洞。

### 4.8 终端写入 / shell 注入 —— PARTIAL

`terminal-write-bus.ts`、`ssh-execute-auth.ts`、`session_exec` 都能把字符串送进 PTY/shell。
数据来源：

- 用户键入（`onData`）—— 预期；
- snippet 与命令历史 —— **来自数据库，而数据库可被云同步/团队共享写入**；
- `startup_command`（host 配置）—— 同样可来自导入/同步。

**已核实**：没有「自动执行」路径把它们直接送进 shell（需要用户在终端里回车或显式运行脚本）。
但「同步来的 snippet 内容在执行前没有任何标记/确认」这一点没有测试覆盖。
本项判 PARTIAL，理由是「缺少对同步来源内容在执行前的显式区分」。

---

## 5. 真实 E2E 分级

> 判定标准：**Mock 不能替代真实系统验收**；没跑的一律 NOT_RUN。

| 级别 | 状态 | 证据 |
| --- | --- | --- |
| **UNIT** | **PASS** | 前端 240 文件 / 2160 项；Rust 391 passed；Team Server 27 文件 / 124 项；scripts 398 项 |
| **INTEGRATION** | **PASS** | Team Server 真实 PostgreSQL 套件；Rust `db_import` 真实 SQLite（`run_import` 非纯函数）；前端 `credential-*`/`workspace-*` 真实 store 驱动 |
| **REAL_SSH** | **PASS**（本机实跑） | **本轮亲自执行**：3 个 `.e2e.test.ts` / **14 项全部通过**，使用项目自带的真实 OpenSSH fixture（`scripts/terminal-smoke-sshd.mjs`）。详见 5.1 |
| **PRODUCT_SFTP_E2E** | **NOT_RUN** | fixture **没有 `Subsystem sftp`**，测试文件自己写明「SFTP over the fixture fails for a fixture reason」。见 5.2 |
| **REAL_MODEL_E2E** | **NOT_APPLICABLE** | 本仓库无模型调用（§1.3） |
| **GUI_E2E** | **NOT_RUN** | 无 GUI 自动化；仅有 1 张静态截图（`ux1h-evidence/01-default-workspace.png`，本轮已查看）。见 5.3 |
| **CROSS_PLATFORM_BUILD** | **PASS** | CI run `43343241289` 的 `Tauri build` macOS / ubuntu / windows **三个平台全部 success** |
| **CROSS_PLATFORM_RUNTIME** | **PARTIAL** | `real-machine-matrix` run `43259056123` 三 job success（macOS real SSH / Windows PowerShell+cmd / Linux real SSH smoke），但**不含 GUI**，Windows 未覆盖 Pageant/串口 |

### 5.1 REAL_SSH —— 本轮亲自实跑

```
$ npx vitest run src/features/import/ssh-real-connect.e2e.test.ts \
                 src/features/sftp/sftp-transfer-live.e2e.test.ts \
                 src/features/terminal/services/vault-ssh-real.e2e.test.ts --reporter=verbose

✓ the payload is 24 MB and hashes to a stable value
✓ a real SSH connection is accepted by the fixture
✓ a reference resolving to a private key completes a real login
✓ a version mismatch yields a failure rather than a wrong-but-plausible key
✓ a locked vault refuses instead of attempting an empty login
✓ a decrypt failure is reported as a failure, not as "no credential"
✓ the resolver never returns a value for a kind the reference does not name
✓ the byte path carries 24 MB without corruption
✓ reading the path the config named yields key material sshd accepts
✓ a path that is not key material fails the same way it would at connect time
✓ an ssh connection survives the command that opened it
✓ completes a two-hop handshake with distinct credentials per leg
✓ SFTP over the fixture fails for a fixture reason, not a product one
✓ an unreachable bastion prevents the target login rather than silently going direct

Test Files  3 passed (3)
     Tests  14 passed (14)
```

**重要限定**：这证明的是「密钥材料与跳板凭据能被真实 OpenSSH 接受」，
**不是**「Tauri 应用的 Rust 会话驱动了握手」。后者需要 GUI 或对打包二进制的驱动
（AGENTS.md 已把 `OPENSSH_IDENTITYFILE_REAL_CONNECT` 保持为 NOT_RUN，本报告认同）。

### 5.2 PRODUCT_SFTP_E2E —— NOT_RUN，且测试文件诚实声明

`sftp-transfer-live.e2e.test.ts:1-25` 的头部注释原文：

> `scripts/terminal-smoke-sshd.mjs` runs OpenSSH with a **ForceCommand wrapper**
> and **no sftp subsystem**. `ssh -s sftp` fails with "subsystem request failed on channel 0"
> — that is the fixture's design, not a product defect.
> …
> What it does NOT prove, and what stays NOT_RUN:
> `SFTP_TRANSFER_E2E` — a real `sftp` upload with a dock close mid-flight.

该文件的第 5 个用例名字就叫
`it('SFTP over the fixture fails for a fixture reason, not a product one')` ——
它把「SFTP 不可用」变成了断言，这是**诚实**的做法，不能读作 SFTP 已验证。

**结论**：**真实 SFTP 传输在本轮未被验证**。Rust 侧 `staged_upload` 有 18 项故障注入测试
（真实文件系统 + fake RemoteFs），前端有队列/幂等测试，但「真实 sshd 上跑一次上传」是 NOT_RUN。

### 5.3 GUI_E2E —— NOT_RUN

唯一 GUI 证据是 PR #41 补回的 1 张截图（`docs/design/terminal-next/ux1h-evidence/01-default-workspace.png`）。
本轮已实际打开查看：显示的是 Dark 主题、Activity Rail、单终端 tab、底部 StatusBar
（`Connected · Local` 与 `142×43`），与 UX-1a 的设计意图一致。

**但这只是一张静态图**：不含 SFTP Dock、不含双面板、不含窄窗口、不含 IME。
`ux1a-evidence/` 下的 4 张图属于 UX-1a 阶段，未覆盖 UX-1b/1c/1h 的新交互。

**任务书要求的「GUI 证据」不成立。**

## 6. 构建与 CI

### 6.1 本轮本地实跑的全部门禁（HEAD `1a24eed`）

在**本机**（macOS arm64，Node v22.12.0）执行 `node scripts/verify.mjs all`，**退出码 0**：

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| ESLint | `pnpm --filter=@terminal/frontend lint` | ✅ 通过（team-server 侧 90 warnings / 0 errors） |
| typecheck | `tsc -p tsconfig.json && tsc -p tsconfig.node.json` | ✅ 通过 |
| 前端测试 | `vitest run` | ✅ **240 文件 / 2160 项** |
| bundle budget | `vite build && bundle-stats --check` | ✅ **Initial 130.91 KB gzip / Lazy 493.80 / Total 624.71**（预算 240 / 628 / JS chunk 500） |
| Team Server | prisma validate + lint + typecheck + test + build | ✅ **27 文件 / 124 项** |
| `cargo fmt --check` | — | ✅ 通过 |
| `cargo check --locked --all-targets --all-features` | — | ✅ 通过 |
| `cargo clippy -D warnings` | — | ✅ 通过 |
| `cargo test --locked --all-targets --all-features` | — | ✅ **391 passed / 0 failed / 4 ignored** |
| scripts 测试 | `node --test scripts/*.test.mjs` | ✅ **398 项全部 pass**（0 skipped） |
| source-size | `check-source-size.mjs` | ✅ **674 个生产文件** |
| 证据完整性 | `check-verification-evidence.mjs` | ✅ **0 problem** |

**一条被 SKIP 的测试**（如实记录）：`scripts` 组里有 1 项
`Phase 8.8 E2 - database upgrade compatibility (real SQLite files)` 被 **SKIP**，
原因写在输出里：

```
needs node:sqlite and TypeScript type stripping (pinned .node-version is 24.16);
this runtime is v22.12.0 and failed with ERR_UNKNOWN_BUILTIN_MODULE
```

本机 Node 是 **v22.12.0**，项目钉定 **24.16**（`.node-version` 与 `package.json` engines）。
**这不是被测代码的缺陷**，是本机环境与钉定版本不符导致的降级跳过。
CI 用 `node-version-file: .node-version` 拉 24.16，因此**在 CI 上该项会真正执行**。
本报告把它记为「本机未执行」，不冒充通过。

### 6.2 release-small 的隔离性 —— PASS

```toml
# src-tauri/Cargo.toml:98-118
# The default `release` profile is deliberately left untouched so
# `cargo build --release`, the CI compile gate and every local debug cycle
# keep their current cost.
[profile.release-small]
inherits = "release"
lto = "fat"
codegen-units = 1
strip = "symbols"
```

已核实：`[profile.release]` 在 main 上**根本没有定义**（`grep "^\[profile"` 只有
`dev` / `test` / `release-small`），所以默认 release 沿用 Cargo 内建值，
`release-small` 是纯增量、opt-in 的配置。`pnpm tauri build` 与 CI 编译门禁都不使用它。

**但 `RELEASE_SMALL_READY` 仍判 PARTIAL**，理由是：
- 体积收益只在 macOS arm64 实测，**Windows / Linux 未构建验证**；
- 采用 `strip` 的**前置条件未满足**：仓库没有任何 dSYM 归档流程，
  上线后崩溃将永久失去符号化能力（`build-optimization.md` 已写明这个风险，但**没有决定**）；
- 本轮**未在任何平台构建或运行** `release-small` 产物，因此无法给出实际尺寸与可运行性复核。

### 6.3 CI 状态

| 项 | 值 |
| --- | --- |
| main CI（`d6f3878`，run `43343241289`） | ✅ **11/11 success** |
| 覆盖 job | Frontend quality、Dependency audit (npm)、Team Server quality、zsh probe diagnostic、Repository gates、Rust quality、cargo audit (blocking)、Team Server container、Tauri build × 3 |
| HEAD `1a24eed` 的 CI | **无记录** —— 该提交只改了 `docs/**` 与一张 PNG，命中 `ci.yml` 的 `paths-ignore`（`**/*.md`、`docs/**`） |
| 实机矩阵（run `43259056123`） | ✅ macOS real SSH / Windows PowerShell+cmd / Linux real SSH smoke **3/3 success** |

**`1a24eed` 没有 CI 记录是合理的**，不是遗漏：`git diff d6f3878..1a24eed --name-only`
只输出 `docs/design/terminal-next/ux1h-evidence/01-default-workspace.png`。
`d6f3878` 与 `1a24eed` 在**全部 `FINGERPRINT_PATHS` 上内容一致**（已实测），
因此 `d6f3878` 的 11/11 结论对 `1a24eed` 有效。

**两处 `continue-on-error`（已逐一核实，均为声明式诊断，不是偷偷放水）**：

- `ci.yml:158` Team Sync 跨版本验收 —— 注释写明「already recorded that the historical client
  cannot re-sync against the current server, and a red step exists to keep that finding visible」；
- `ci.yml:188` zsh probe diagnostic —— 注释写明「collects evidence; it does not validate the product」。

其余 job（含 `cargo audit (blocking)` 与 `Repository gates`）均为阻塞门禁。

### 6.4 证据完整性 —— 有效

见 §1.7。**HEAD 实算指纹 = manifest 指纹 = `8129680b…`**（`MATCH: true`）。
证据描述的就是当前源码，未发现篡改。文档中残留的 `ff265ac2` 是**已作废**的旧值，
`ux1-acceptance-hardening.md:290` 自己记录了作废原因。

---

## 7. 风险清单

### P0（阻断 RC / 发布）

| # | 问题 | 位置 | 说明 |
| --- | --- | --- | --- |
| **P0-1** | IPC 暴露通用读秘密能力 + 文件系统无 scope | `capabilities/default.json:25-26`、`vault.rs:992`、`lib.rs:331-344` | `vault_get(任意 key)` + `fs:allow-read/write-text-file`（无 scope）+ `sql:allow-*`。被攻陷的 webview 可取出全部明文凭据。**既有架构问题，非本轮回归**（§4.7） |
| **P0-2** | 无签名 / 无公证 / updater 公钥是占位符 | `tauri.conf.json:51` `"pubkey": "REPLACE_WITH_TAURI_UPDATER_PUBLIC_KEY"` | updater 无法验签，自动更新链**不可用**。AGENTS.md 已记为 `BLOCKED_EXTERNAL`，本报告确认仍成立 |
| **P0-3** | 产品标识仍是 `Termius` / `com.baicie.termius` | `tauri.conf.json:3-5` | 身份迁移未做，影响升级链与用户数据归属（AGENTS.md T1–T12 NOT_RUN） |

### P1（应在 RC 前修）

| # | 问题 | 位置 | 说明 |
| --- | --- | --- | --- |
| **P1-1** | 布局预算不包含左侧栏宽度 | `use-panel-layout.ts:112-117`、`main-layout-content.tsx:66` | 1024px + 420px 左栏时终端只剩 **33 列**（下限 60）。INV-12 自我声明 PASS 不成立（§3.7） |
| **P1-2** | `sftp_sessions` 无任何关闭路径 | `sftp.rs:117`、`commands.rs:83`、`shutdown.rs:38` | 每次开 SFTP 留一条悬挂引用直到进程退出；零测试覆盖（§2.3） |
| **P1-3** | 真实产品级 SFTP 传输未验证 | — | fixture 无 `Subsystem sftp`；`PRODUCT_SFTP_E2E = NOT_RUN`（§5.2） |
| **P1-4** | 无 GUI 自动化与多场景截图 | — | 仅 1 张静态图，不含 Dock / 双面板 / 窄窗 / IME（§5.3） |

### P2（记录，不阻断）

| # | 问题 | 位置 |
| --- | --- | --- |
| P2-1 | `.worktrees/` 未加入 `.gitignore`，持续污染 `git status` | `.gitignore` |
| P2-2 | 遗留 worktree `/private/tmp/wp6-baseline` 未清理 | `git worktree list` |
| P2-3 | 分支 `fix/terminal-next-ux1i-runtime-acceptance` 6 提交未推送、未合并 | — |
| P2-4 | `cancelled_transfers` 在 panic 路径下永久残留 | `sftp_upload.rs:405-407`、`sftp.rs:258` |
| P2-5 | 反复开关面板只测到 5 次，任务书要求 100 次 | `sftp-release-callers.test.tsx:218` |
| P2-6 | `ux1-acceptance-hardening.md` 里 INV-12 与证据指纹两处自述与实测不符 | 该文件 :352、:371 |
| P2-7 | 本机 Node v22.12.0 ≠ 钉定 24.16，1 项脚本测试降级跳过 | `.node-version` |
| P2-8 | `right-panel-state.ts` 注释称 `ai`/`snippets` 在枚举内，实际只有 `'none' \| 'sftp'` | `right-panel-state.ts:8-9,16` |

---

## 8. 仍未验证的项目

以下均为 **NOT_RUN**，不得在任何交付材料中记为通过：

| 类别 | 项目 |
| --- | --- |
| **SFTP** | 真实 sshd 上的上传/下载（`Subsystem sftp`）；断点/大文件/符号链接/权限边界；`staged_upload` 在真实服务器 rename 语义下的行为 |
| **GUI** | 全部交互场景：Dock 开关、双面板、窄窗口、拖拽上传、右键菜单、焦点与键盘导航、Escape 关闭 |
| **IME / 键盘** | 中文输入法组合态；Option/dead keys；物理键盘 30 轮重叠输入 |
| **Vault** | 真实 GUI 的创建/解锁/改密/重启持久化；A→B 跨版本 |
| **SSH 真机** | Tauri Rust 会话驱动握手（本项目只验证了密钥材料被 OpenSSH 接受） |
| **跨平台运行时** | Windows NSIS 安装→运行→升级；Windows Pageant；串口真实硬件；Linux AppImage stock 启动 |
| **Agent** | **不存在**（§1.3）—— 不是未验证，是无对象 |
| **签名/公证/updater** | Apple notarization、Windows Authenticode、updater 运行时下载验签安装重启 —— `BLOCKED_EXTERNAL` |
| **升级链** | Windows A→B；Linux AppImage 迁移；安装期 ENOSPC |
| **性能** | 本轮未做任何性能对照测量（任务书要求「性能对照」，**无法给出**，因为无基线数据） |

## 9. 准入结论

### 9.1 八项判定

| 判定项 | 结果 | 依据 |
| --- | --- | --- |
| `WORKSPACE_DAILY_DRIVER_READY` | **PARTIAL** | 工作区/布局/恢复链有真实测试（`workspace-*`、`workspace-layout-migration-boundaries`），启动门禁 fail-closed 成立；但 **P1-1 布局预算缺陷**在窄窗+宽左栏下让终端跌到 33 列，且无 GUI 验证（§3.7、§5.3） |
| `SFTP_TRANSFER_SAFE` | **PARTIAL** | `staged_upload` 的备份/替换/回滚设计扎实（`sftp_upload.rs:158-285`，18 项故障测试），前端队列/幂等/绑定均正确；但 **P1-2 悬挂引用**、**P1-3 无真实产品级 E2E** 两条未闭合 |
| `AGENT_RUNTIME_READY` | **NOT_APPLICABLE** | 本仓库无 LLM 运行时（§1.3）。`agent.rs` 是 SSH Agent 协议 |
| `AGENT_TOOL_SECURITY_READY` | **NOT_APPLICABLE** | 无 Tool Approval / 无工具调用循环（§1.3） |
| `AGENT_UI_USABLE` | **NOT_APPLICABLE** | 无 Agent UI。`RightPanelMode` 只有 `'none' \| 'sftp'`（§1.3） |
| `RELEASE_SMALL_READY` | **PARTIAL** | profile 隔离正确（§6.2），但仅 macOS arm64 实测、无 dSYM 归档决定、Windows/Linux 未构建、本轮未运行任何 `release-small` 产物 |
| `CROSS_PLATFORM_READY` | **PARTIAL** | 三平台**编译打包**全绿（CI `43343241289`）+ 实机矩阵三 job success；但**运行时**仅 macOS 有真机证据，Windows 未覆盖 Pageant/串口/NSIS 安装升级，Linux AppImage stock 启动 NOT_RUN（§5、§8） |
| `TERMINAL_NEXT_RC_READY` | **FAIL** | 三条 P0 全部未闭合：IPC 秘密读取面（P0-1）、签名/公证/updater（P0-2）、产品标识仍是 Termius（P0-3） |

### 9.2 为什么 `TERMINAL_NEXT_RC_READY = FAIL` 而不是 PARTIAL

RC 的定义是「可交付候选版本」。三条 P0 中任意一条都足以阻止发布：

- **P0-1** 使「凭据安全」这一整个 Phase 10/10.1/10.2/10.3/10.4 的努力在威胁模型上打折 ——
  数据库里不再有明文，但一条 IPC 就能把 Vault 里的明文全取出来。
- **P0-2** 使**自动更新链不可用**（公钥是占位符字符串），且安装包无签名无公证。
- **P0-3** 意味着应用仍以 `Termius` 为 `productName`、`com.baicie.termius` 为 identifier，
  升级/迁移路径没有建立。

这三条都不是「再测一轮就能变绿」的问题，而是需要代码/流程改动的阻断项。
按任务书「不得为了报告好看而改写证据」「不得宣称未执行的真机测试通过」的要求，
只能判 FAIL。

**注意**：`FAIL` 在这里描述的是**RC 准入**，不是「代码质量差」。
本轮本地门禁 2160 + 391 + 398 项全绿、三平台构建通过、真实 SSH E2E 14 项实跑通过，
工程质量是扎实的。FAIL 来自三条**未被任何门禁覆盖**的架构/流程阻断项。

### 9.3 推荐的 PR 合并顺序

当前**没有 open PR**（#36–#41 全部已合入 main）。若要把 §P1 的修复推上去，建议顺序：

| 序 | 内容 | 理由 |
| --- | --- | --- |
| **1** | **P1-1 布局预算修复**（`usePanelLayout` 收 `{ explorerWidth }` 必填对象） | 独立、影响所有用户的可见缺陷；UX-1i 分支已有先红测试与实现，可直接复用。改动会触发证据重采 |
| **2** | **P1-2 `sftp_sessions` 清理**（新增 `sftp_close`，或在 `session_close` 中同步移除） | 与 1 无文件重叠，可并行；需要补 Rust 测试 |
| **3** | **P1-3 真实 SFTP fixture**（给 `terminal-smoke-sshd.mjs` 加 `Subsystem sftp`，或新建专用 fixture） | 依赖 2 落地后有可测的关闭语义；这是把 `SFTP_TRANSFER_SAFE` 从 PARTIAL 推向 PASS 的唯一途径 |
| **4** | **P0-1 IPC 收敛**（`vault_get` 改为按 ref 读取 + `fs:scope` 收紧） | 需要威胁模型决策，改动面最大，应单独一个 PR 并单独重采证据 |
| **5** | **P2 清理**（`.gitignore`、worktree、ux1i 分支处置） | 可与任意 PR 同批 |

**合并约束（本报告不代为执行）**：不自动合并、不自动发布。
每个 PR 落地后都必须按 `FINGERPRINT_PATHS` 规则**重采六份证据**，
不得手改旧 manifest（AGENTS.md 与 `docs/release/workflow-rules.md` 已明确）。

### 9.4 阻止进入下一阶段的最小问题集合

按「最小且必要」原则，只有三项：

1. **P0-1** —— Tauri IPC 的通用秘密读取面与无 scope 的文件系统权限。
   至少要做到：`vault_get` 不接受任意 key，或前端路径无法直接调用它；`fs:allow-*` 加 `fs:scope`。
   **不解决这一条，任何「凭据安全」的结论都不能算成立。**
2. **P0-2** —— updater 公钥替换为真实密钥 + 至少一个平台完成签名/公证。
   当前 `REPLACE_WITH_TAURI_UPDATER_PUBLIC_KEY` 使自动更新链在运行时必然失败。
3. **P1-1** —— 布局预算缺陷。这是本轮唯一一个**普通用户在日常使用中就会撞到**的功能性缺陷
   （窄窗口 + 宽侧栏 → 终端不可用），且修复成本低、已有先红测试。

**P0-3（身份迁移）** 严格说也是发布阻断，但它需要产品决策（是否保留 Termius 标识），
不属于「修 bug」范畴，因此列为**发布前必须决策项**而非最小修复集。

### 9.5 关于本轮方法的一处说明

任务书要求「不得直接相信实现者提交的总结」。本轮据此做了三件事：

1. **每条结论都回到源码**，给出 `file:line`；
2. **亲自实跑**了本地全部门禁与三个真实 SSH E2E 文件，不引用他人数字；
3. **推翻了两处**实现者文档的自我陈述：
   - `ux1-acceptance-hardening.md:371` 的 INV-12「PASS」—— 实际预算漏算左侧栏宽度（§3.7）；
   - 该文件 `:352` 的证据指纹 `ff265ac2` —— 实际 manifest 是 `8129680b`（§1.7，文档滞后而非造假）。

同时**没有**推翻的部分也如实记录：证据链完整有效、`staged_upload` 设计扎实、
16 项不变量中 14 项经核实成立、三平台构建全绿。

---

## 附录 A：本轮实际执行的命令

```bash
# 门禁（退出码 0）
node scripts/verify.mjs all

# 真实 SSH E2E（3 文件 / 14 项全通过）
cd packages/frontend && npx vitest run \
  src/features/import/ssh-real-connect.e2e.test.ts \
  src/features/sftp/sftp-transfer-live.e2e.test.ts \
  src/features/terminal/services/vault-ssh-real.e2e.test.ts --reporter=verbose

# 证据指纹复核（MATCH: true）
node -e "import('./scripts/check-verification-evidence.mjs').then(async m => {
  console.log(await m.computeSourceFingerprint()) })"

# CI 状态
gh run list --branch main --limit 8
gh run view 43343241289 --json jobs
gh run view 43259056123 --json jobs
```

## 附录 B：本轮未做（并明确说明理由）

- **未做性能对照**：任务书要求「性能对照」，但仓库没有可比的基线测量数据，
  本轮也没有构建两个可比产物。**给不出有意义的数字，因此不给。**
- **未构建 `release-small`**：需要 20+ 分钟冷构建，且本轮判定不依赖它（配置隔离性已静态核实）。
- **未做 GUI 操作**：会话运行在 Claude 桌面应用内，无可用的辅助功能/录屏权限，
  无法驱动或截取真实窗口。仅有的一张截图是仓库内既有文件，本轮仅查看未生成。
