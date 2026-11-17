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
> 当前工作分支：`feat/tn-ux4-ai-dock`（PR #97，base `main@02c6495`）。
> `main` 已含 PR #95（`dbbde31`）与 #96（`02c6495`）。

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
| **成功后显式保存** | **`IMPLEMENTED`** | `save-after-auth.ts`、`pending-save.ts`、`save-credential-dialog.tsx`、`use-save-after-auth.ts` | 本轮实现。只在 tab 报 `connected` 后询问——`arm` 不等于 `show`，被拒绝的密码永远不产生 `connected`，因此不可能为未证实的凭据提示保存。写走 `updateHost`（复用损坏引用守卫与 authType 切换规则）。回答后同时清空 pending 与临时 profile 上的明文。真实 sshd E2E `NOT_RUN`（见下方阻塞说明） |
| `authType` 切换丢弃旧方式 kind | `PASS`（既有） | `hosts.ts` | Phase 10.3 已修 |
| **CredentialRef V2 / Provider Registry / 按 provider 分派** | **`PASS`（链路级）** | `credential-resolver.ts`、`credential-provider-registry.ts` | PR #95 已落地，详见 UX-2b 表。生产路径 `session-credentials.ts` 已接线；变异验证让旧 resolver 立即变红 |
| 系统 Keychain / Credential Manager / Secret Service | `BLOCKED_EXTERNAL` | — | 需跨平台真实签名与隔离 profile 证据 |
| Replace 导入的 `secretPolicy` | `PARTIAL` | `db_import` | 当前 `COALESCE` 是安全兼容行为；显式策略需状态机语义先行 |

### `REAL_SSH_ONE_TIME_SAVE` 的阻塞原因（`NOT_RUN`，非"没做"）

尝试过一次真实 sshd E2E，卡在 fixture 的认证模型上，已撤销而不是留一个半死测试：

| 障碍 | 事实 |
| --- | --- |
| fixture 没有 password 模式 | `terminal-smoke-sshd.mjs` 只有 `key` / `cert`。我加过 password 模式，然后撤销 |
| 加不进去的原因 | fixture 用**当前系统用户**（`userInfo().username`）跑 sshd。密码认证需要该账户的真实系统密码 —— 在 hermetic fixture 里做不到，且**绝不该改用户的系统密码** |
| key 路径也没走通 | fixture 给每个授权 key 都带 `command="<wrapper>"`，且私钥加密后需要交互式解口令。`sshpass` 只处理 **password 认证**，不处理私钥口令 —— 这一点是确定的（我最初误判了它的作用范围）。`SSH_ASKPASS_REQUIRE=force` 配一个打印口令的 helper 能让 `ssh-keygen -y -f <key>` 成功解密，但同配置下 `ssh` 仍卡在 `Server accepts key` 之后又回到 `Authentications that can continue`。**未能隔离出确切原因**：可能是 helper 未被调用、可能是 tty 抢占、也可能是 `setsid` 缺失（macOS 无此命令）。因此这一条记为「key 路径未打通」，而不是「ASKPASS 对 ssh 无效」——后者我也没有证据 |

**要真正解除**，需要 fixture 支持一个隔离的专用账户（`useradd` / `dscl` + 受控密码），这是一个独立的基础设施改动，不该塞进本 PR。

现状：决策与写入两端有 14 项自动化测试覆盖；**没有**证据表明这条链路在真实 SSH 认证下触发。

---

## UX-2b · 凭据存储抽象

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| Vault 写入安全（秘密列字面 NULL、版本化、命名空间拆分） | `PASS`（既有） | Phase 10.1～10.4 已合入 |
| **`CredentialRef V2`（按 `provider` 分派）** | **`PASS`（链路级）** | `credential-resolver.ts::providerFor`。真实生产路径 `session-credentials.ts` 已构造带 registry 的 resolver。变异验证：把 resolver 回退到 HEAD 版本，`refuses a foreign provider instead of reading the vault` 立即变红。另实现 `ProviderDispatchingResolver` 提供五种独立状态的完整语义 |
| **`SecretProvider` Registry** | **`PASS`** | `credential-provider-registry.ts`：`vault` 已注册，三个系统 provider 报告为 `unsupported` 而非省略；重复注册抛错；`registerBuiltInProviders` 幂等 |
| 写入 / 读回 / 回滚补偿（vault provider） | **`PASS`（自动化）** | `host-credentials.ts::persistHostSecrets`：写入前捕获旧值 → 逐 kind 写入 → **读回全量核对**（含 carry-forward 的 kind）→ 任一不符即 `removeVersion` 回滚。`retirePreviousVersion` 的失败只上报不抛（行已指向新版本，抛错会谎报保存失败）。覆盖见 `hosts-credential-versions.test.ts`、`import-security.test.ts`（断言 `vault did not return`） |
| **跨 Provider** 写入/读回/切换/补偿 | `NOT_RUN` | — | 上面那条路径全部走 `vaultSecretProvider` 单例。没有第二个 provider 实现，所以「同一份逻辑在别的 provider 下也成立」未被验证。解除需要真实的 Keychain / Secret Service（`BLOCKED_EXTERNAL`）或一个测试用第二 provider |
| 凭据批量迁移 | `NOT_RUN`（未授权） | 需显式批准；按规则不得自行执行 |

---

## UX-3 · 内置扩展平台

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| **Typed Capability Gateway** | **`PASS`** | `capability-gateway.ts` + `approval-book.ts`。25 条对抗性测试。grant 按 extension id 查询（修复了「返回当前 grant、事后再比 id」的错配风险） |
| **Extension Manifest 校验** | **`PASS`** | `extension-manifest.ts`。10 类拒绝，含拒绝可命名动态代码的 `entry` |
| **Extension Registry（生命周期）** | **`PASS`** | `extension-registry.ts`。55 条测试：回滚、generation、幂等启用、失败隔离 |
| **Snippet Dock 扩展（完整链路）** | **`PARTIAL`** | 逻辑 14 条 + 开关 8 条 + 选择发布 11 条测试 PASS；已挂进 RightPanel，Settings 有开关，`read-selected` 接真实 `term.getSelection()`。本轮补齐**草稿消费方**（见下）。**剩余缺口**：真实 GUI 未点击验证 |
| **`terminal.read-selected` 真实选择源** | **`PASS`（自动化）** | `terminal-selection.ts` + `use-publish-terminal-selection.ts`。只有活动 tab 发布；gateway 双源一致才可读（发布值 + 活动 tab）。后台 tab 的选择读不到 |
| Rust 侧 `ExtensionIntent` Gateway | `NOT_RUN` | 本版本不允许扩展跨进程边界，暂不需要 |

### 本轮修复的断链：捕获的草稿没有消费方

矩阵此前把它记作「已知未修」，但按调用链读下来它比记录更严重：

| 事实 | 位置 |
| --- | --- |
| `captureSelection()` 把文本存进 `pendingDraft` | `snippet-dock-extension.ts` |
| dock 把 `pendingDraft` 渲染成一个 `<pre>` | `snippet-dock-view.tsx` |
| **没有任何代码读它** | 全仓 grep 只有渲染点与类型定义 |
| 原文案写「到 Snippets 页面保存」 | 但那个页面不知道这份草稿存在 —— 用户去了也找不到 |

用户能选中文本、捕获、看到它出现，然后**什么也做不了**。功能在每一个既有测试里都是「完成」的，因为每个测试都停在「草稿在 state 里」。

修复：命名 + 就地保存（走既有 `createSnippet`，不经扩展 capability）、保存后刷新列表、丢弃入口。**扩展本身仍然不写库** —— 保存是 UI 调既有服务的职责，与扩展契约一致。

`SnippetDock` 此前**没有任何组件测试**，这正是断链没被发现的原因。本轮补 6 条。

UX-3 的边界与生命周期层已由 PR #95 落地；缺的是 Snippet Dock 的真实 GUI 点击验收，以及 Rust 侧跨进程 Gateway（本版本按设计不做）。

---

## UX-4 · AI Assistant 与 Server Inspector

契约层在 PR **#96**（已合并 `02c6495`），存储 / 编排 / Dock / 设置编辑器 / Server
Inspector 在 PR **#97**（`feat/tn-ux4-ai-dock`，12 个提交）。

| 能力 | 状态 | 位置 | 说明 |
| --- | --- | --- | --- |
| **Model Profile 契约 + endpoint 安全规则** | **`PASS`（自动化）** | `features/ai/model-profile.ts` | 16 条测试。HTTPS 允许 / 回环 HTTP 允许 / 远程明文 HTTP 需显式确认 / 其他 scheme 拒绝。`ModelProfilePublic` **没有可放 API key 的字段** |
| **Context Review（用户明确选择）** | **`PASS`（自动化）** | `features/ai/context-review.ts` | 16 条测试。64 KiB **字节**上限（CJK 用例）、脱敏编辑列表、发送时重算摘要、会话绑定 |
| **AI Run 状态机** | **`PASS`（自动化）** | `features/ai/ai-run-state.ts` | 16 条测试。迟到 chunk 三方向丢弃、取消需确认、完成后失败不污染好结果、stale 标记 |
| **Prompt 构造与注入防护** | **`PASS`（自动化，已迁到 Rust）** | `src-tauri/src/ai/prompt.rs` | 指令不随内容变化、分隔符逐级升级、payload 不能提前闭合不可信块。`draftRisk` 只标记不改写，留在 `features/ai/ai-prompt.ts`（UI 文本分类） |
| **OpenAI-compatible HTTP Adapter** | **`PASS`（真实本地 HTTP server，已在 Rust）** | `src-tauri/src/ai/transport.rs` + `ai/tests.rs` | 流式/取消/超时/401/403/500/404/429（含 `Retry-After`）、空流报 bad-response；provider body 与 key 不进入错误消息。DTO 改动前的 WebView `fetch` 路径已删除 |
| **Server Inspector 解析与策略层** | **`PASS`（自动化）** | `features/inspector/server-inspector.ts` | 21 条测试。固定 probe allowlist（无插值点）、缺失数据为 null 而非 0、TTL 边界含等号、平台不认识则拒绝猜测 |
| **Profile 存储** | **`PASS`（自动化）** | `service/database/ai-profiles.ts` | 17 条测试。表无 key 列；写入→读回→指向；三 namespace 隔离（修了 `vaultKey` 把新类型落进 ssh-key namespace 的真 bug） |
| **运行编排 `AiRunner`** | **`PASS`（自动化）** | `features/ai/ai-runner.ts` | 16 条测试。7 类拒绝均在发送前；事件来自 Rust 通道并穿过 reducer；异常关闭上报；取消按 requestId；请求体**不含 key/endpoint/model** |
| **AI Dock UI** | **`IMPLEMENTED`** | `layout/ai-dock-{view,config,result}.tsx` | 14 条组件测试。`ai` 已是可渲染占位者 + Command Palette 入口。**真实 GUI 未点击** |
| **Profile 编辑器** | **`IMPLEMENTED`** | `view/settings/ai-profile-{editor,form}.tsx` | Settings 新增 AI 标签页；明文确认不继承；key 留空即保留 |
| **Inspector 真实探测链** | **`PASS`（自动化）** | `features/inspector/inspector-probe.ts` | 13 条测试。先 `uname -s` 再选命令集；未知平台报 `unsupported-platform` 不猜测；权限/缺工具/超时/断连分别分类；部分数据仍返回 |
| **Server Inspector 面板** | **`IMPLEMENTED`** | `layout/server-inspector-{view,metrics}.tsx` | 11 条组件测试。无 timer（三次 TTL 后 exec 仍只调用 2 次）；缺失数据显示 N/A；切 host 清空结果 |
| **`INSPECTOR_REAL_SSH`** | **`PASS`** | `src-tauri/src/inspector_probe_e2e_tests.rs` + `scripts/verify-install/inspector-probe-e2e.mjs` | 真实 OpenSSH：平台探测返回 `uname -s`、探测输出含全部 `key=` 行、两条并发 exec 各自完成、关闭连接后探测快速失败不挂起。本机跑 **4/4 PASS** |
| `REAL_MODEL_E2E` | `BLOCKED_EXTERNAL` | — | 只有本地 fake HTTP server；未调用真实 provider（本机无 ollama / LM Studio / 任何 11434·1234·8080·8000 监听） |
| `AI_DOCK_REAL_GUI` / `INSPECTOR_REAL_GUI` | `NOT_RUN` | — | 无人真实点击 |
| Rig MSRV / 体积 / Audit 评估 | `NOT_RUN` | — | 按设计延后，需独立 ADR |

### ✅ 与设计的三处偏离已闭合（AI transport 迁到 Rust）

`07-ux4-ai-inspector.md` 第 4、5 节要求 AI 请求走 **Rust `ai` feature + `reqwest` + typed
IPC**。PR #97 的实现走的是 **WebView 内直接 `fetch`**；本轮把三处偏离全部闭合。

| # | 原偏离 | 现在 |
| --- | --- | --- |
| 1 | **API key 进入 WebView 内存** | `getProfileSecret()` 已从 `service/database/ai-profiles.ts` **删除**（不是留着不用）。key 由 `ai_generate` 在 Rust 侧经 `vault::vault_read_secret`（非 IPC 命令）读出，以 `Zeroizing<String>` 交给 `reqwest`，全程不跨 IPC。runner 的依赖里已经没有能取得 key 的入口 |
| 2 | **无 `ai` feature 开关** | `src-tauri/Cargo.toml` 新增 **非默认** feature `ai`；`tauri.conf.json` 的 `build.features` 为产品构建打开它。feature-off 时 `src/ai/` 整个模块、四个命令都不存在 |
| 3 | **无 Rust typed IPC 边界** | `ai_available` / `ai_profiles_list` / `ai_generate` / `ai_cancel`。**profile 由后端按 `profileId` 重新从 SQLite 读取**（enabled、endpoint、model、limits、timeout），请求里没有这些字段，所以被校验的值与被发送的值不可能不同 |

**没有 `read_secret(id)` 这类通用命令**：设计明确禁止，加了就等于把这次迁移撤销。

边界上的分工：

- **Rust**：HTTP 请求、SSE 解析、取消、超时、key 取用、**prompt 构造与注入防护**、endpoint
  规则、上下文 64 KiB 与摘要重算、profile 状态。
- **前端**：context review UI、审批、状态渲染、`draftRisk` 标记。

摘要算法（`createHashOf`）在 Rust 侧按 **UTF-16 code unit** 逐位复刻，并有 4 条 KAT 向量
（由 TypeScript 实现实际跑出）。后端用它重算并比对，所以「审批后文本被改」在**真正发包
的那一侧**被拦住，而不是信任调用方递来的 digest。

**为什么没有把 `reqwest` 一起 feature 化**：它已经是 `storage.rs`（WebDAV/S3/REST）的非可选
依赖，设成 optional 买不到任何东西，还会把 AI feature 和 storage 耦合起来。feature 关闭时
丢掉的是**命令与整个 `src/ai/` 模块**，这正是
`scripts/check-ai-isolation.mjs` 断言的对象——它分别构建开/关两种目标目录，并在编译产物
里找 `/chat/completions` 与分隔符字符串（只在 `src/ai/` 出现），所以「关掉了」不是靠读
manifest 判断的。

### 迁移中自己引入又修掉的两个缺陷

两个都是**顺着调用链读出来**的，不是测试变红发现的——与 Phase 10.3 记录的那类问题同形，
这次是自己写的新代码里重演。

1. **SSE 多字节字符被按块解码切碎。** 移植时我把 WebView 里的
   `TextDecoder({stream: true})` 写成了 `String::from_utf8_lossy(&chunk)`，于是任何跨
   TCP 读边界的 UTF-8 序列都会变成替换字符。前端实现本来是流式解码的，**照抄语义时漏了
   这一层**。修法是把缓冲区改成 `Vec<u8>`，只在遇到 `\n` 时才解码整行（多字节 UTF-8
   里不可能出现 `0x0A`，所以按行切一定不会切在字符中间）。先红后绿：
   `a_multibyte_character_split_across_tcp_reads_is_not_corrupted` 在旧实现上得到
   `"\u{fffd}\u{fffd}\u{fffd}误：权限不足"`，新实现得到 `"错误：权限不足"`。

2. **`AiRuns` 的 `len()` 是无人使用的测试脚手架。** clippy 报 `never used`。删掉而不是
   加 `#[allow]`：它在唯一用途（断言 in-flight 计数）上本来也不成立——那个计数应该由
   `ai_generate` 的真实生命周期证明，不是由一个只在测试里存在的方法。

另外两处是**测试自身的**问题，修的是测试不是产品：`signature_of()` 一开始不跨行、也不
跳过 `<R: Runtime>` 泛型，扫描密钥命令时还会扫到自己的断言文本。这三条都会让测试**假
失败**，所以按「测试必须证明它声称的事」处理。

**代码读取链的实测**（按本项目历史缺陷的要求走一遍）：`Command Palette open-ai-dock`
→ `setRightPanel('ai')` → `RightPanel` 渲染 `AiDock` → `runner.start()` →
`deps.generate` → `invoke('ai_generate', { request, onEvent })` → `lib.rs` 的
`ai::ai_generate`。参数重命名 `requestId→request_id` / `onEvent→on_event` 由
`ai::ipc_tests` 按两侧源码钉住——这条链在本轮之前没有任何东西守着。

**未变**：`REAL_MODEL_E2E` 仍是 `BLOCKED_EXTERNAL`（本机没有 ollama / LM Studio / 任何
OpenAI-compatible 端点，也不用开发会话自身的凭据冒充验收），`AI_DOCK_REAL_GUI` 仍是
`NOT_RUN`。**`AI_MVP_READY` 与 `SERVER_INSPECTOR_READY` 仍为 `NO`。**

### 迁移中自己引入又修掉的两个缺陷

两个都是**顺着调用链读出来**的，不是测试变红发现的——与 Phase 10.3 记录的那类问题同形，
这次是自己写的新代码里重演。

1. **SSE 多字节字符被按块解码切碎。** 移植时把 WebView 里的
   `TextDecoder({stream: true})` 写成了 `String::from_utf8_lossy(&chunk)`，于是任何跨
   TCP 读边界的 UTF-8 序列都会变成替换字符。前端实现本来是流式解码的，**照抄语义时漏了
   这一层**。修法是把缓冲区改成 `Vec<u8>`，只在遇到 `\n` 时才解码整行（多字节 UTF-8
   里不可能出现 `0x0A`，所以按行切一定不会切在字符中间）。先红后绿：
   `a_multibyte_character_split_across_tcp_reads_is_not_corrupted` 在旧实现上得到
   `"\u{fffd}\u{fffd}\u{fffd}误：权限不足"`，新实现得到 `"错误：权限不足"`。

2. **`AiRuns` 的 `len()` 是无人使用的测试脚手架。** clippy 报 `never used`。删掉而不是
   加 `#[allow]`：它在唯一用途（断言 in-flight 计数）上本来也不成立——那个计数应该由
   `ai_generate` 的真实生命周期证明，不是由一个只在测试里存在的方法。

另外三处是**测试自身的**问题，修的是测试不是产品：`signature_of()` 一开始不跨行、也不
跳过 `<R: Runtime>` 泛型，扫描密钥命令时还会扫到自己的断言文本。这三条都会让测试**假
失败**，所以按「测试必须证明它声称的事」处理。

**代码读取链的实测**（按本项目历史缺陷的要求走一遍）：`Command Palette open-ai-dock`
→ `setRightPanel('ai')` → `RightPanel` 渲染 `AiDock` → `runner.start()` →
`deps.generate` → `invoke('ai_generate', { request, onEvent })` → `lib.rs` 的
`ai::ai_generate`。参数重命名 `requestId→request_id` / `onEvent→on_event` 由
`ai::ipc_tests` 按两侧源码钉住——这条链在本轮之前没有任何东西守着。

### 合入后补丁：重复 `requestId` 不再顶掉取消句柄（#100）

`AiRuns::register` 原来无条件 `insert`，同 id 的第二次运行会**覆盖第一次的取消句柄**——
`cancel(id)` 只打到后来那个，第一个继续烧 token 且无人能停。`finish()` 同样盲：先结束的
那个删掉的是第二个的条目。

经 dock 走不到（前端 id 单调递增），**而这正是它活过审查的原因**：安全性质长在调用方的
id 生成器里，而不是拥有该句柄的地方。现在 `register` 返回 `Option`，重复 id 被拒绝
（`AiFailureKind::Busy`），发生在开 socket 之前。

**过程记录：这件事被两个会话同时发现并各自修了一遍。** 评估一个遗留的并行 worktree 时
发现它，同一时间另一个会话也开了 PR。两份实现最终在 `register()` 上**字节级相同**，
差异只是 failure kind 命名（`RunInProgress` vs `Busy`，采用后者）与测试组织。先创建、
注释更完整的那份被合并（#100），另一份关闭并把本节文字补到这里。

**我在这轮判断上错过一次，值得记下来**：我最初用 `git diff A...B` 对比两条分支，把方向
读反了，于是得出「#100 没有实现修复」——差点据此建议关闭别人正确的 PR。功能等价的判断
必须先确认 diff 的 A/B 方向，再下结论。

同一 worktree 里还有一处**没有采纳**的设计：它把传输层作为参数注入
`execute(request, profile, cancel, transport)`，从而能在无 socket 的情况下测整条运行链。
那对覆盖「profile 加载后、发请求前」的失败分支确实更有力，但属于测试重构，收益/风险比
不如缺陷修复本身，记为后续项。

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
| [#96](https://github.com/baicie/terminal/pull/96) | `feat/tn-ux4-ai-inspector` | `ea62e76` | **18/18 pass** | **已合并 `02c6495`** | 四个提交可独立回滚；无 schema / IPC / Rust 变更 |
| [#97](https://github.com/baicie/terminal/pull/97) | `feat/tn-ux4-ai-dock` | `537bca9` | 见下文 | 待合并（base `main@02c6495`） | 12 个提交可独立回滚；新增一张 `CREATE TABLE IF NOT EXISTS`，无 Identifier / Vault 迁移 / AI 自动执行 |

### PR #97 提交明细（12 个，均可单独 revert）

| SHA | 内容 |
| --- | --- |
| `9594432` | Profile 存储 + `AiRunner` 编排（TN-UX4-04） |
| `d680590` | AI Dock 接进产品（TN-UX4-05） |
| `82f7502` | 设置里的 profile 编辑器（TN-UX4-06） |
| `2eeffd8` | Inspector 探测走真实 SSH 会话（TN-UX4-07） |
| `d933a2a` | Server Inspector 面板，从 Context Dock 进入（TN-UX4-08） |
| `b66f39e` | 真实 OpenSSH 上的探测 E2E（TN-UX4-09） |
| `420d693` | **修复**：Dock 看不到打开之后才做的选中 |
| `c0955b0` | **修复**：首次使用没有可点入口 |
| 其余 4 个 | 文档与进度矩阵 |

### PR #95 提交明细（已 squash，下列为合并前原始 SHA）

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

- ~~`CredentialRef V2` + Provider Registry + 按 provider 分派~~ —— PR #95 已落地（UX-2b 表，链路级 `PASS`）
- 系统 Keychain / Credential Manager / Secret Service 的真实稳定访问门禁 `BLOCKED_EXTERNAL`
- 跨 provider 写入 / 读回 / 切换 / 补偿 `NOT_RUN`
- 成功后显式保存 `NOT_RUN`
- 凭据批量迁移需显式授权（未执行）

### Extension Ready

- ~~Typed Capability Gateway~~ / ~~Manifest 校验~~ / ~~Registry 生命周期~~ —— PR #95 已落地
- Snippet Dock 完整链路 `PARTIAL`（逻辑与接线有测试，真实 GUI 未点击）
- Rust 侧 `ExtensionIntent` Gateway `NOT_RUN`（本版本不允许扩展跨进程边界）

### AI MVP Ready

- ~~Capability Gateway~~、~~安全 SecretProvider（存 API Key）~~ —— 均已落地
- ~~AI Dock / 设置编辑器 / Server Inspector 面板~~ —— PR #97 已落地且可达
- **`REAL_MODEL_E2E` `BLOCKED_EXTERNAL`** —— 缺一个真实 OpenAI-compatible 端点
- `AI_DOCK_REAL_GUI` / `INSPECTOR_REAL_GUI` `NOT_RUN`

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

对 PR #95 与 #97 的 8 个维度做了独立审查，每个维度由未参与开发的 agent 阅读真实代码，
每条发现再由独立 skeptic 尝试推翻。**26 条候选发现，16 条确认为真实缺陷并已修复**，
其余记录在此。

> 下表的修复提交是**合并前的原始 SHA**。PR #95 已 squash 为 `dbbde31`、#96 为 `02c6495`，
> 这些 SHA 在 `main` 与当前分支上都不再可达（`git cat-file` 仅因本地对象未回收才找得到）。
> 需要追溯时按 PR 与缺陷描述检索，**不要**把这些 SHA 当作可 checkout 的引用。原始提交
> 内容由 `dbbde31` 的提交信息与本节描述共同承载。

### 已修复（16）

| # | 严重度 | 缺陷 | 修复提交（原始 SHA，已 squash） |
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

（部分发现合并为同一提交，上表按问题计。合计 16 条，与本节开头一致。）

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

## 最终 CI

### PR #97（`feat/tn-ux4-ai-dock`，已合并 `100cfce`）

HEAD `82b4fb0` 的 **14 个必检作业全部 success**：三平台 Tauri build（macOS / ubuntu /
Windows）、Rust quality、Frontend quality、Repository gates、cargo audit、Team Server
quality 与 container、Dependency audit、zsh probe、Test execution report，以及
`required` 聚合门禁。

**GUI E2E 最终 4/4 success**，run `44035811576`（`workflow_dispatch`，
`head=82b4fb0`，与 PR head 一致）：`Driver isolation gate`、`macOS GUI E2E`、
`Windows GUI E2E`、`Linux GUI E2E` 全部完成。

合并前的三次状态变化，记下来是因为它们容易被误读：

| 现象 | 真实结论 | 判据 |
| --- | --- | --- |
| 三个 GUI 作业显示 `fail` | **`cancelled`** | 耗时 1m23s–1m32s（正常 10–20 分钟）；job 的 `conclusion` 字段是 `cancelled`，`gh pr checks` 把它渲染成 fail |
| `gh run rerun` 后无限排队 >25 分钟 | **重跑在取消自己** | workflow 设了 `concurrency: group: gui-e2e-${{ github.ref }}` + `cancel-in-progress: true`，attempt 2 与原 attempt 同组 |
| 推送纯文档提交却触发完整 CI | **正确行为** | `classify-change.mjs` 算的是 `base...HEAD` 全分支 diff，不是单次推送 |

**正确的重跑方式**是 `gh workflow run native-gui-e2e.yml --ref <branch>` 另起独立
run，不是 `gh run rerun`。另记：该 workflow 的 `pull_request` paths 过滤器包含
`packages/frontend/src/layout/**`，本 PR 改了这个目录，所以每次 push 都会触发 GUI E2E。

### PR #95（已合并 `dbbde31`）

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
