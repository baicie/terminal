---
status: progress-matrix
updated: 2026-11-16
scope: "Terminal Next UX-1 → UX-4 实际完成状态、证据、PR 与剩余风险"
---

# Terminal Next 实施进度矩阵

> 本文记录**真实**完成状态。`PASS` 只表示指定 SHA、指定环境与指定证据均通过。
> `NOT_RUN`、`PARTIAL`、`BLOCKED` 不是 `PASS` 的同义词，不得向上折算。
>
> 基线：`main@ff01f60`（PR #90～#94 已合并，main Ruleset 生效）。
> 当前工作分支：`feat/tn-ux1-04-session-sftp-lifecycle`（Draft PR #95）。

## 状态定义

| 状态 | 含义 |
| --- | --- |
| `PASS` | 有生产实现 + 自动化/真实证据，在本文记录的 SHA 与环境上通过 |
| `IMPLEMENTED` | 有生产实现与单元/集成测试，但缺真实环境证据 |
| `PARTIAL` | 实现存在，但有明确链路、平台或行为缺口 |
| `NOT_RUN` | 代码或测试可能就绪，本轮未在真实环境执行 |
| `BLOCKED_EXTERNAL` | 缺设备、证书、权限等外部前置 |

---

## UX-1 · Terminal Workspace

| 能力 | 状态 | 位置 | 说明 |
| --- | --- | --- | --- |
| Activity Rail / StatusBar / TitleBar | `PASS`（既有） | `components/activity-rail`、`status-bar` | PR #36 已合入，本轮未改动 |
| Connection Explorer（搜索/收藏/分组/最近） | `PASS`（既有） | `features/connection-explorer` | PR #37 已合入 |
| SFTP Context Dock / pin / deferred release | `PASS`（既有） | `right-panel`、`sftp-binding` | PR #39 已合入 |
| **Session 四种移除路径统一通知** | **`IMPLEMENTED`** | `session/manager.rs` | 本轮修复；3 条新测试（自然完成、恰好一次、shutdown 后不重复）。真实远端断开 E2E `NOT_RUN` |
| **SFTP 重复连接契约（幂等 / 替换死条目）** | **`IMPLEMENTED`** | `sftp.rs` | 本轮修复；3 条契约测试 + 真实 sshd 5/5（既有用例，覆盖上传/下载/并发路径，**不覆盖**重复 connect 场景） |
| **Layout hysteresis 双向恢复** | **`PASS`** | `layout/layout-hysteresis.ts` | 本轮修复真实缺陷：回升分支永不成立。3 条新测试在旧实现上全部变红 |
| 双 Pane / 分屏 | `PASS`（既有） | `terminal-split-sash` | PR #44 起 |
| 三平台 Native GUI E2E | `NOT_RUN` | `e2e/gui` | 本轮未重跑；Windows 曾有 19/19 首次通过记录（PR #94） |
| 物理键盘 / IME / Vim / tmux / DPI | `BLOCKED_EXTERNAL` | — | 需真实输入设备与交互环境 |
| **Context Dock 单占位者公共契约** | **`PASS`** | `store/right-panel-state.ts` | 本轮实现：union 命名 `none/sftp/snippets/inspector/ai`，`IMPLEMENTED_RIGHT_PANEL_OCCUPANTS` 区分「已声明」与「已实现」，`resolveRightPanelMode` 对未实现占位者回落 `none`。源码级守卫测试禁止重新引入第二个布尔量，已用变异验证（加 `sftpOpen` 即变红） |

### UX-1 本轮修复的三个真实缺陷

1. **自然完成不通知** —— `spawn_completion_cleanup` 清理三张表但从不调用 `notify_removed`，导致自然结束的 session 在 `sftp_sessions` 留下悬挂 `Arc<SftpSession>`，直到进程退出。
2. **移除竞态重复通知** —— `remove_session` 无条件通知，同一 id 两次关闭触发两次 listener。
3. **Hysteresis 单向锁死** —— 回升分支要求列布局比抽屉多出超过 band 的列数，而列布局必然更少，条件恒假。面板一旦降级就永远不恢复。

---

## UX-2a · 连接时凭据体验

| 能力 | 状态 | 位置 | 说明 |
| --- | --- | --- | --- |
| **连接时一次性密码 / 私钥，不保存** | **`IMPLEMENTED`** | `one-time-credential.ts`、`connect-credential-dialog.tsx`、`use-host-connect-actions.ts` | 16 条新测试。秘密只进进程内 profile，不进 tab/store/DB/vault/localStorage。真实 sshd 端到端 `NOT_RUN` |
| **认证失败不持久化** | **`PASS`** | 同上 | 结构上无写入可失败：唯一持久副作用是进程内 profile，取消或 tab 打开失败即丢弃，有测试钉住 |
| **Host 损坏/未知引用可清除** | **`PASS`** | `host-stored-credential.tsx`、`host-clear-credential.test.tsx` | 三态规则；malformed / unknown-provider / unsupported-version 均显示清除入口。3 条在旧 gate 上红 |
| **SSH Key 损坏引用可清除** | **`PASS`** | `ssh-keys.ts::clearSSHKeyCredential`、`clear-key-credential-action.tsx` | 此前完全无入口。先失去引用再删密文；无法解析时仍执行 UPDATE |
| Vault 三态（uninitialized / locked / unusable）内联恢复 | `PASS`（既有） | `vault-recovery.tsx` | Phase 10.2 A2 已合入 |
| 成功后显式保存 | `NOT_RUN` | — | 设计要求独立的确认步骤；本轮只做"仅本次使用" |
| `authType` 切换丢弃旧方式 kind | `PASS`（既有） | `hosts.ts` | Phase 10.3 已修 |
| **CredentialRef V2 / Provider Registry / 按 provider 分派** | `NOT_RUN` | — | `TN-UX2A-02` 未开始 |
| 系统 Keychain / Credential Manager / Secret Service | `BLOCKED_EXTERNAL` | — | 需跨平台真实签名与隔离 profile 证据 |
| Replace 导入的 `secretPolicy` | `PARTIAL` | `db_import` | 当前 `COALESCE` 是安全兼容行为；显式策略需状态机语义先行 |

---

## UX-2b · 凭据存储抽象

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| Vault 写入安全（秘密列字面 NULL、版本化、命名空间拆分） | `PASS`（既有） | Phase 10.1～10.4 已合入 |
| **`CredentialRef V2`（按 `provider` 分派）** | **`PASS`（链路级）** | `credential-resolver.ts::providerFor`。真实生产路径 `session-credentials.ts` 已构造带 registry 的 resolver。变异验证：把 resolver 回退到 HEAD 版本，`refuses a foreign provider instead of reading the vault` 立即变红。另实现 `ProviderDispatchingResolver` 提供五种独立状态的完整语义 |
| **`SecretProvider` Registry** | **`PASS`** | `credential-provider-registry.ts`：`vault` 已注册，三个系统 provider 报告为 `unsupported` 而非省略；重复注册抛错；`registerBuiltInProviders` 幂等 |
| 跨 Provider 写入/读回/切换/补偿 | `NOT_RUN` | — |
| 凭据批量迁移 | `NOT_RUN`（未授权） | 需显式批准；按规则不得自行执行 |

---

## UX-3 · 内置扩展平台

| 能力 | 状态 |
| --- | --- |
| **Typed Capability Gateway** | **`PASS`** | `capability-gateway.ts` + `approval-book.ts`。25 条对抗性测试。grant 按 extension id 查询（修复了「返回当前 grant、事后再比 id」的错配风险） |
| **Extension Manifest 校验** | **`PASS`** | `extension-manifest.ts`。10 类拒绝，含拒绝可命名动态代码的 `entry` |
| **Extension Registry（生命周期）** | **`PASS`** | `extension-registry.ts`。55 条测试：回滚、generation、幂等启用、失败隔离 |
| **Snippet Dock 扩展（完整链路）** | **`PARTIAL`** | 逻辑 14 条 + 开关 8 条 + 选择发布 11 条测试 PASS；已挂进 RightPanel，Settings 有开关，`read-selected` 接真实 `term.getSelection()`。**唯一缺口**：真实 GUI 未点击验证 |
| **`terminal.read-selected` 真实选择源** | **`PASS`（自动化）** | `terminal-selection.ts` + `use-publish-terminal-selection.ts`。只有活动 tab 发布；gateway 双源一致才可读（发布值 + 活动 tab）。后台 tab 的选择读不到 |
| Rust 侧 `ExtensionIntent` Gateway | `NOT_RUN` | 本版本不允许扩展跨进程边界，暂不需要 |

整阶段未开始。依赖 UX-1 的 Dock 单占位者契约（当前 `PARTIAL`）。

---

## UX-4 · AI Assistant 与 Server Inspector

PR **#96**（`feat/tn-ux4-ai-inspector`），三个提交，**Draft，未合并**。

| 能力 | 状态 | 位置 | 说明 |
| --- | --- | --- | --- |
| **Model Profile 契约 + endpoint 安全规则** | **`PASS`（自动化）** | `features/ai/model-profile.ts` | 16 条测试。HTTPS 允许 / 回环 HTTP 允许 / 远程明文 HTTP 需显式确认 / 其他 scheme 拒绝。`ModelProfilePublic` **没有可放 API key 的字段** |
| **Context Review（用户明确选择）** | **`PASS`（自动化）** | `features/ai/context-review.ts` | 16 条测试。64 KiB **字节**上限（CJK 用例）、脱敏编辑列表、发送时重算摘要、会话绑定 |
| **AI Run 状态机** | **`PASS`（自动化）** | `features/ai/ai-run-state.ts` | 16 条测试。迟到 chunk 三方向丢弃、取消需确认、完成后失败不污染好结果、stale 标记 |
| **Prompt 构造与注入防护** | **`PASS`（自动化）** | `features/ai/ai-prompt.ts` | 14 条测试。指令不随内容变化、分隔符逐级升级、`draftRisk` 只标记不改写 |
| **OpenAI-compatible HTTP Adapter** | **`PASS`（真实本地 HTTP server）** | `features/ai/openai-compatible-driver.ts` | 24 条测试。流式/取消/超时/401/403/429/500/400；provider body 与 key 不进入错误消息；连接测试不携带终端文本 |
| **Server Inspector 解析与策略层** | **`PASS`（自动化）** | `features/inspector/server-inspector.ts` | 21 条测试。固定 probe allowlist（无插值点）、缺失数据为 null 而非 0、TTL 边界含等号、平台不认识则拒绝猜测 |
| **Profile 存储** | **`PASS`（自动化）** | `service/database/ai-profiles.ts` | 17 条测试。表无 key 列；写入→读回→指向；三 namespace 隔离（修了 `vaultKey` 把新类型落进 ssh-key namespace 的真 bug） |
| **运行编排 `AiRunner`** | **`PASS`（自动化）** | `features/ai/ai-runner.ts` | 15 条测试。7 类拒绝均在发送前；事件穿过 reducer；异常关闭上报；取消被确认 |
| **AI Dock UI** | **`IMPLEMENTED`** | `layout/ai-dock-{view,config,result}.tsx` | 14 条组件测试。`ai` 已是可渲染占位者 + Command Palette 入口。**真实 GUI 未点击** |
| **Profile 编辑器** | **`IMPLEMENTED`** | `view/settings/ai-profile-{editor,form}.tsx` | Settings 新增 AI 标签页；明文确认不继承；key 留空即保留 |
| **Inspector 真实探测链** | **`PASS`（自动化）** | `features/inspector/inspector-probe.ts` | 13 条测试。先 `uname -s` 再选命令集；未知平台报 `unsupported-platform` 不猜测；权限/缺工具/超时/断连分别分类；部分数据仍返回 |
| **Server Inspector 面板** | **`IMPLEMENTED`** | `layout/server-inspector-{view,metrics}.tsx` | 11 条组件测试。无 timer（三次 TTL 后 exec 仍只调用 2 次）；缺失数据显示 N/A；切 host 清空结果 |
| **`INSPECTOR_REAL_SSH`** | **`PASS`** | `src-tauri/src/inspector_probe_e2e_tests.rs` + `scripts/verify-install/inspector-probe-e2e.mjs` | 真实 OpenSSH：平台探测返回 `uname -s`、探测输出含全部 `key=` 行、两条并发 exec 各自完成、关闭连接后探测快速失败不挂起。本机跑 **4/4 PASS** |
| `REAL_MODEL_E2E` | `NOT_RUN` | — | 只有本地 fake HTTP server；未调用真实 provider |
| `AI_DOCK_REAL_GUI` / `INSPECTOR_REAL_GUI` | `NOT_RUN` | — | 无人真实点击 |
| Rig MSRV / 体积 / Audit 评估 | `NOT_RUN` | — | 按设计延后，需独立 ADR |

**`AI_MVP_READY = NO`、`SERVER_INSPECTOR_READY = NO`。** 契约与 UI 都已落地，但
没有真实模型证据（`REAL_MODEL_E2E` = `BLOCKED_EXTERNAL`），也没有真实 GUI 点击验收。

### 本轮自己发现并修复的两个可达性缺陷

这两个都不是「测试变红」发现的，而是**顺着调用链读出来**的——正是 Phase 10.3
记录的那类问题：守卫存在、有单测、真实入口却在它之前返回。

1. **AI Dock 看不到打开之后才做的选中。** `RightPanel` 只在渲染时读一次
   `currentTerminalSelection()`，无订阅。「先开 Dock、再选文本」是最自然的使用顺序，
   于是功能的主路径是坏的：面板一直显示「请先选中」。已加
   `subscribeTerminalSelection`，7 项测试，含一个组件形状的探针断言重渲染真的发生。
2. **首次使用只被告知去哪，没有可点的入口。** 无 profile 时只说「去设置添加」，
   而这是新用户唯一能看到的东西。已加「打开设置」按钮，用 router 导航而非
   `<a href>`——裸 href 会整页加载并拆掉所有会话（Phase 10.4.1 记录过同一陷阱）。


---

## 本轮 PR

| PR | 分支 | Head SHA | CI | 状态 | 风险 / 回滚 |
| --- | --- | --- | --- | --- | --- |
| [#95](https://github.com/baicie/terminal/pull/95) | `feat/tn-ux1-04-session-sftp-lifecycle` | `7a532cd` | **18/18 pass** | **已合并 `dbbde31`** | 各提交可独立回滚；无 schema / IPC / Identifier 变更 |
| [#96](https://github.com/baicie/terminal/pull/96) | `feat/tn-ux4-ai-inspector` | `ea62e76` | **18/18 pass** | 待合并（base 已含 #95） | 四个提交可独立回滚；无 schema / IPC / Rust 变更 |

### 提交明细

| SHA | 内容 | 关键证据 |
| --- | --- | --- |
| `8bcaa84` | Session 通知 + SFTP 契约 + hysteresis | Rust 440/0；变异验证 3 红；真实 sshd 5/5 |
| `f6fec4b` | Host/Key 损坏引用可清除 | 前端 2360/0；3 条在旧 gate 上红 |
| `785ec1f` | 一次性凭据连接 | 前端 2388/0；16 条新测试 |
| `e2c4500` | Context Dock 单占位者契约 | 前端 2400/0；9 条契约 + 3 条源码守卫（变异验证 1 红） |
| `b41a66c` | Provider Registry + 按 provider 分派 | 11 条新测试；**变异验证 2 条在旧 resolver 上红**；生产路径 `session-credentials.ts` 已接线；顺带修复 cert 认证无证书时的空证书握手 |

---

## 距离各里程碑还缺什么

### Core Daily Driver

- 真实 macOS GUI 全流程验收（Focus / Explorer / Dock / 分屏 / 错误态 / 窗口控件）`NOT_RUN`
- 7 天真实使用 Scorecard `NOT_RUN`
- 三平台原生运行矩阵 `NOT_RUN`／`BLOCKED_EXTERNAL`

### Credential Ready

- `CredentialRef V2` + Provider Registry + 按 provider 分派（UX-2b 主体）
- 系统 Keychain / Credential Manager / Secret Service 的真实稳定访问门禁
- 成功后显式保存
- 凭据批量迁移需显式授权

### Extension Ready

- UX-3 全部
- Dock 单占位者公共契约（UX-1 遗留 `PARTIAL`）

### AI MVP Ready

- UX-4 全部
- 前置依赖：安全 SecretProvider（存 API Key）+ Capability Gateway

### Signed Release Ready

- Apple notarization、Windows Authenticode、Tauri updater pubkey 均 `BLOCKED_EXTERNAL`
- 产品 Identifier 迁移未执行（需批准）

---

## 需要人工决策 / 外部依赖

| 项 | 类型 | 说明 |
| --- | --- | --- |
| 系统 Keychain 作为默认 Provider | 人工决策 | 需先有跨构建/升级/回退的稳定读取证据 |
| 凭据批量迁移执行 | 人工授权 | 会写 Vault 并清理明文列 |
| 产品 Identifier 变更 | 人工批准 | 涉及五处路径派生，`vault.json` 不在其中 |
| Apple / Windows 签名证书 | `BLOCKED_EXTERNAL` | 公开分发前置 |
| 物理键盘、IME、串口、Pageant 硬件 | `BLOCKED_EXTERNAL` | 需真实设备 |
| AI 自动执行任何命令 | **明确禁止** | 模型输出只作为草稿 |

---

## 下一项最优先工程任务

**Extension Registry + Manifest（`TN-UX3-02`），然后接 Snippet Dock 作为首个内置扩展。**

理由：Gateway 本轮已建好，它定义了"扩展能做什么"。没有 Registry，就没有东西能拿到 Gateway 授予的 context —— 边界存在但无人使用，这是"代码存在、链路不通"的失败模式。Registry 是让 Gateway 真正被使用的最小下一步，且它不依赖任何外部设备或证书。

Snippet Dock 紧随其后，因为它是设计指定的第一个内置扩展，且只依赖已有的 Snippet service 与 `terminal.read-selected`，不需要 AI、网络或新的 Rust 权限 —— 它是验证整条扩展链路（注册 → 激活 → 命令/菜单/Dock 注册 → 停用清理）的最短路径。

---

## 独立对抗性审查（2026-11-17）

对本分支 8 个维度做了独立审查，每个维度由未参与开发的 agent 阅读真实代码，每条发现再由独立 skeptic 尝试推翻。**26 条候选发现，9 条确认为真实缺陷并已修复**，其余记录在此。

### 已修复（9）

| # | 严重度 | 缺陷 | 修复提交 |
| --- | --- | --- | --- |
| 1 | P1 | `resolve()` 的 availability 检查在 dispatch **之前**执行且硬编码 Vault，导致命名其他 provider 的引用被按 Vault 状态判断（Vault 锁定时让用户去解锁一个无关的 Vault） | `45356df` |
| 2 | P2 | `registerBuiltInProviders` 一次性注册，后传入的不同 provider 被静默忽略 | `45356df` |
| 3 | P1 | `requestSendText` 只检查「存在选中」，从不比对 `intent.text` 与选中文本 —— 扩展可提交任意文本获得审批 | `fdc5af8` |
| 4 | P1 | 审批文本只绑定 32 位 FNV 哈希，而文本由扩展在两端提供，可构造碰撞 | `fdc5af8` |
| 5 | P1 | `consumeApproval` 不重新授权、不重读可见 session —— 停用后审批仍可兑换 | `fdc5af8` |
| 6 | P2 | 所有非 `already-used` 失败都重抛为 `approval-expired`，掩盖替换文本的攻击 | `fdc5af8` |
| 7 | P1 | hysteresis band 被计两次（上/下各一个），实际窗口 2×band ≈ 34px，超过一次拖拽步长 → 无限抖动 | `f9d35ae` |
| 8 | P1 | `selectionId` 是每 tab 常量，审批可跨选择重用 | `de34f5f` |
| 9 | P1 | `snippets` 占位者可渲染但不可达 —— 无任何代码设置 `rightPanel = 'snippets'` | `de34f5f` |
| 10 | P1 | `notify_removed` 注释承诺 panic 不中断 teardown，实际无 `catch_unwind` | `de34f5f` |
| 11 | P2 | `sftp_is_live` 把 `Timeout` 当作死连接（上传拥塞会产生假死） | `0394dc4` |
| 12 | P2 | `Err(_) => true` 把 `SSH_FX_NO_CONNECTION`/`CONNECTION_LOST` 当作活连接 | `0394dc4` |
| 13 | P2 | `Replace` 分支先删条目再握手，失败后比修复前更差（完全没有条目） | `0394dc4` |
| 14 | P2 | insert 前不检查 session 是否已移除，会重建悬空 Arc | `0394dc4` |
| 15 | P2 | `buildContext` 不校验 manifest 声明的 capability —— manifest 形同装饰 | `435f2fa` |
| 16 | P1 | `enable()` 未守卫 `deactivating`，停用中途再启用会启动第二次激活 | `435f2fa` |

（部分发现合并为同一提交，上表按问题计。）

### 未修（需要产品决策或更大改动）

| 严重度 | 发现 | 为何未修 |
| --- | --- | --- |
| P2 | `withHysteresis` 的 `usableColsMin` 参数，唯一生产调用方从不传入 | 需要先决定布局是否应支持每调用方的 floor；当前行为（恒用 60）是安全的 |
| P2 | band 保持整个 presentation 对，可能让 dock 停在 overlay 而 explorer 恢复 | 两轴独立 vs 成对保持是布局语义问题，需产品决策 |
| P2 | `emit()` 不校验 handler 的 generation；回调 rejection 会标记**当前**激活失败 | 需要 generation 感知的 handler 身份，改动大于其他修复 |
| P2 | 关闭 dock 不清除 SFTP host pin | 需决定「重开 dock 应回到哪个主机」 |
| P2 | 捕获的 snippet 草稿没有消费方（Snippets 页面无 handoff） | 需要跨页面草稿传递的设计 |
| P2 | SFTP 与 manager 接线的那一行没有测试 | 需要能在无 sshd 情况下构造真实注册路径的夹具 |

### 审查过程中发现并修正的两个过程问题

1. **审查 agent 在共享 worktree 留下的变异与探针被误提交。** 一个 agent 把
   `src-tauri/src/sftp.rs` 的 `on_session_removed` 改成 `let _ = &listener; // MUTATION`，
   另一个在 `manager_tests.rs` 追加了标注「will be reverted」的临时探针。旧的
   `git add -A` 把它们一起带进了 `f44e0ef`。已用 `--force-with-lease` 重建该提交，
   当前 `af4bbb5..HEAD` 对 `src-tauri/` 零改动。
   **教训**：多个 agent 共享一个 worktree 时，提交前必须 `git diff --stat` 逐项核对，
   不能假定工作区只有自己的改动。

2. **测试编码了缺陷。** `capability-gateway.test.ts` 中 8 条断言用与夹具选择不符的
   文本请求审批并期望成功 —— 它们断言的正是「任意文本可被审批」。已修正。
   这与 Phase 10.3 记录的 `expect(privateKey).toBe('~/.ssh/id_ed25519')` 同类。

### 门禁纪律：本地必须复现 CI 的确切命令

本轮 `CI / Rust quality` 因 `clippy::wrong_self_convention` 失败一次（`d45c6ee` 修复），
因为本地只跑了 `cargo test --lib`，而 CI 跑的是：

```
cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
```

`--all-targets` 覆盖测试代码，`--all-features` 启用 `custom-protocol`，`-D warnings`
把 lint 变成错误 —— 三者缺一都会漏掉这类问题。

这是本项目第三次记录同一类失误（Phase 10.1.1 漏 `source-size`、Phase 10.2 漏
`build:budget`）。**提交前的本地门禁清单**：

| 门禁 | 命令 |
| --- | --- |
| 前端测试 | `pnpm --filter=@terminal/frontend test` |
| typecheck | `pnpm typecheck` |
| ESLint | `pnpm lint` |
| 源码规模 | `pnpm check:source-size` |
| bundle 预算 | `pnpm --filter=@terminal/frontend build:budget` |
| 脚本测试 | `node --test scripts/*.test.mjs` |
| Rust 格式 | `cargo fmt --manifest-path src-tauri/Cargo.toml --check` |
| **Rust lint（CI 等价）** | `cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` |
| **Rust 全量测试** | `cargo test --locked --manifest-path src-tauri/Cargo.toml` |
| 真实 SFTP | `node scripts/verify-install/sftp-command-e2e.mjs` |

### CI 基础设施失败（非代码）

`4b07d0f` 的 `Tauri build (macos-latest)` 失败一次，原因是 **GitHub 托管 macOS arm64
runner 容量不足**，job 排队 15 分钟后报
`The job was not acquired by Runner of type hosted even after multiple attempts`，
导致 `CI / required` 聚合门禁失败。

判据：同一 run 中 `macOS GUI E2E` **pass（12m0s）**，`Tauri build (ubuntu/windows)`
均 pass —— 说明 macOS runner 本身可用，失败是一次分配超时。

处置：`gh run rerun --failed` 重跑，不改代码。这与 2026-11 早前
`tauri-apps/binary-releases` 502/504 属于同类：**不得用重试掩盖真实失败，但分配超时
不是真实失败**，重跑是正确处置，且必须在报告中写明原因而不是把它读成代码通过。

---

## 最终 CI（本分支）

`26af44e` + macOS runner 重跑：**18/18 pass，0 fail**。

期间两次 macOS arm64 runner 分配超时（`Tauri build (macos-latest)`、
`macOS GUI E2E`），均报
`The job was not acquired by Runner of type hosted even after multiple attempts`，
用 `gh run rerun --failed` 重跑后均通过（GUI 套件实跑 11m34s）。**未改代码**，
原因已在上文记录，不把基础设施故障读成代码通过。

三次代码侧失败，全部已修：

| 失败 | 原因 | 修复 |
| --- | --- | --- |
| `Rust quality` | `clippy::wrong_self_convention`（`is_alive(self)`） | `d45c6ee` |
| `Rust quality`（更早） | 同上，本地只跑了 `cargo test --lib` | 同上，并固化本地门禁清单 |
| — | — | — |

`macOS GUI E2E` 与 `Windows GUI E2E` 均为 CI 环境的 headless 驱动，
**不等于**本机真实桌面的键盘/IME/DPI 验收（见上文 `BLOCKED_EXTERNAL`）。

### `REAL_MODEL_E2E` 的状态：`BLOCKED_EXTERNAL`

需要的是一次对**真实** OpenAI-compatible provider 的调用，用来覆盖 401/403/429、断流、
取消、超时、Prompt Injection 和 Secret 泄漏的真实行为。

本机检查结果：

| 检查项 | 结果 |
| --- | --- |
| `127.0.0.1:11434`（Ollama 默认） | 无响应 |
| `127.0.0.1:1234`（LM Studio 默认） | 无响应 |
| `127.0.0.1:8080` / `:8000` | 无响应 |
| `ollama` / `llama-server` 可执行文件 | 未安装 |

环境里有 `ANTHROPIC_BASE_URL`，但那是**当前开发会话自己的凭据**。用它跑产品测试有两
个问题：一是把会话凭据用于会话之外的目的，二是被测对象与验证凭据同源，结果说明不了
产品在用户凭据下的行为。因此不使用。

**结论**：`REAL_MODEL_E2E` 标记为 `BLOCKED_EXTERNAL`，阻塞项是一个可用的 provider
端点或本地模型运行时。已有证据等级不变：本地 fake HTTP server 覆盖了状态码映射、流式
解析、取消与超时（24 项），但没有真实 provider 的响应形态与限流行为。

解除阻塞的方式（任一）：
1. 在开发机启动 Ollama 或 LM Studio，`pnpm` 侧无需改代码，直接跑既有 adapter 测试；
2. 提供一个测试用 OpenAI-compatible endpoint 与 key（写入隔离的测试 profile，不提交）。
