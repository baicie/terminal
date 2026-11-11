# Phase 10.4.1 — 合并前最后一次针对性审查与修复

PR #33 的合并前复审发现三个问题。本轮只修这三个，不新增 Phase 10.x 功能。

基线 `main = 2813c26`，修复前 PR HEAD `5516aaf`，分支
`feat/phase10-4-a-vault-lock-recovery`。

---

## WP1 — 清除凭据失败产生未处理 Promise rejection

### 缺陷

`clear-credential-action.tsx` 的确认按钮调用 `void confirm()`，`confirm()` 是
`try/finally` 而没有 `catch`，而 `use-host-dialog-form.ts` 的
`handleClearCredential` 在 toast 之后又 `throw err`。三层叠起来的结果：**每次
清除失败都产生一个无人接收的 Promise rejection**。

Phase 10.4 的 WP-B 测试只覆盖了成功路径，所以这条唯一需要用户重试的路径没有被
任何断言触到。

### 失败测试（先红）

`host-clear-credential.test.tsx` 新增 6 项，其中一项安装
`process.on('unhandledRejection')` 监听并断言它从未被触发。

修复前：

```
 × does not leave an unhandled promise rejection behind
   AssertionError: expected [ Error: database is locked ] to deeply equal []
 Errors  5 errors
```

`Errors 5` 是 vitest 报出的 5 次未捕获 rejection —— 缺陷被真实复现，不是被
测试命名"声称"出来的。

### 修复

`confirm()` 增加 catch（不吞掉错误，只阻止 rejection 逃逸），对话框保持打开，
`finally` 恢复 busy。错误由调用方 toast 显示，含原始 `message`。

修复后 11/11 通过，`Errors` 归零。

---

## WP2 — Credential read failure 不得进入网络重连循环

### 缺陷

`classifyTerminalFailure` 对 `credential-read-failed` 返回 `retryable: true`，
理由是"解密可能因为 vault 正在改密而暂时失败"。但 `retryable` 正是
`startTerminalSession` 用来决定是否调用 `reconnects.automatic(...)` 的开关。

结果：一次 Vault 读取失败会消耗完整的自动重连预算 —— 最多 5 次尝试加 30 秒恢复
计时器 —— 而这 5 次注定以同样原因失败。

**一个布尔值无法表达三种语义**，这是本轮的根因判断：

| 语义 | 含义 |
| --- | --- |
| `automatic` | 瞬时网络故障，管理器可以自己重试 |
| `manual` | 必须有人先改东西（凭据、主机、密钥） |
| `after-vault` | 卡在 Vault 上，只有 Vault 修好后才值得重试 |

### 失败测试（先红）

新建 `terminal-session-manager-credential-retry.test.ts`，**驱动真实的
`TerminalSessionManager`**，不是只单测分类函数。

修复前：

```
 × does not schedule a single automatic attempt
   AssertionError: expected "vi.fn()" to be called 1 times, but got 6 times
 × does not arm a recovery timer that would retry it again
   AssertionError: expected 1 to be +0
 × reports the credential kind so the pane can offer the right fix
 × still lets the user retry by hand after the vault is fixed
```

`6 times` = 1 次初始连接 + 5 次自动重连。缺陷被量化。

### 修复

引入 `TerminalFailureRecovery` 三态枚举，贯穿
`TerminalFailure → TerminalSessionSnapshot → TerminalRecord`。只有
`recovery === 'automatic'` 才允许：

- `startTerminalSession` 的首次连接自动重连
- `reconnect.ts` 的自动重试循环
- `wake-recovery.ts` 的 host wake 恢复

`retryable` 对凭据失败恒为 `false` —— 语义是"管理器仍在自动重试"，而非"是否有
出路"。手动重试按钮不依赖它（`terminal-pane-header.tsx` 的 `canReconnect` 只看
`status` 与 `onReconnect`），所以"Vault 修好后手动连回来"仍然可用，并有测试锁住。

真实网络故障（`connection reset`、`connection timed out`、VPN 切换）仍走
`automatic`，同样有测试锁住。

修复后 7/7 通过。

### 连带

`reconnect.ts` 的循环本身是自动阶梯，所以它写入 `reconnecting` 与耗尽状态时必须
显式声明 `recovery: 'automatic'`。这属实现细节，但正是它让 host wake 能区分
"正在进行的网络恢复"与"卡在 Vault 上的失败"。5 条既有测试因此需要补夹具字段，
补后全绿。

---

## WP3 — 结构化 CredentialKind 必须进入真实 UI

### 缺陷

Phase 10.4 把 `credentialKind` 加进了分类器、`TerminalRecord` 和
`TerminalSessionSnapshot`，**但没有一条路径把它送到屏幕**：
`use-terminal.ts` 的 `onState` 从未读取该字段。`TerminalPaneHeader` 仍在
`vaultActionFor(props.errorMessage)` 上做字符串匹配。

两个可见后果：

1. `could not be read` 被映射成 **Unlock the vault** —— 一个"读不出来"的 Vault
   需要的是去看它，不是解锁它。
2. 一段**看起来像** Vault 问题的网络错误文案，照样能触发 Vault 按钮。

这是本项目第五次出现同一形状：**数据到位、入口没接**。

### 额外发现（本轮由我引入又修掉）

Phase 10.4 的 `TerminalVaultAction` 用的是 `href="#/vaults"`，而应用用的是
`createBrowserRouter`（history API）。hash 变化不匹配任何路由，**点击不会有任何
反应** —— 上一轮加的这个"解锁 Vault"入口本身就是不可达的。

改成裸 `<a href="/vaults">` 也不行：那会真的整页导航，重载 webview 并拆掉所有
活动的终端会话，包括这条 header 自己所属的那个。测试里 jsdom 输出
`Not implemented: navigation to another Document` 正是这件事的证据。

最终实现：保留 `href`（可访问性、中键/新窗口），普通点击
`preventDefault()` + `useNavigate()`。修饰键点击仍然交给浏览器。

### 失败测试（先红）

新建 `terminal-vault-action.test.tsx`（15 项）与
`terminal-session-state.test.ts` 追加 5 项、`vault-failure-classification.test.ts`
追加 5 项、`use-terminal-error-recovery.test.tsx` 追加 3 项。

修复前 7 项失败：

```
 × an unusable vault offers the vaults page, not unlocking
   AssertionError: expected 'Unlock the vault' to be 'Open Vaults'
 × a damaged reference offers re-saving the credential
   AssertionError: expected 'Open Vaults' to be 'Re-save the credential'
 × a network error whose text mentions the vault shows nothing
   AssertionError: expected <a href="#/vaults"> to be null
 × links to the vaults route where the app can follow it
```

### 修复

| kind | 动作 | 目标 |
| --- | --- | --- |
| `vault-locked` | Unlock the vault | `/vaults` |
| `vault-uninitialized` | Create a vault | `/vaults` |
| `vault-unusable` | Open Vaults | `/vaults` |
| `credential-read-failed` | Open Vaults | `/vaults` |
| `credential-corrupt-reference` | Re-save the credential | `/hosts` |
| `credential-not-bound` | Re-save the credential | `/hosts` |
| `credential-missing` | Re-save the credential | `/hosts` |

三种需要重新保存凭据的 kind 指向 `/hosts` 而不是 `/vaults`：把它们送到 Vaults
页面会让用户无事可做。

`vaultActionFor(kind, status)` 同时看 `status`：只有 `error` 才给动作，过期 kind
不会在已经连上的会话上显示 Vault 按钮。

### 文案不再是主判据

`credentialFailureFrom()` 此前用 `message.includes('no vault has been set up')`
反推 Vault 状态 —— 这正是本模块存在要消灭的技术，只是下沉了一层。

现在 `VaultAvailability` 的 `state` 作为结构化数据从 provider 经
`CredentialResolutionFailure.state` 传到分类器：

- provider 能说 → 用 `state`
- provider 不能说 → `unusable`（我们确知 Vault 读不了、但不知道原因，这正是该
  状态的定义），而不是猜 `locked`

`terminal-session-manager-errors.ts` 里 `NON_RETRYABLE_MESSAGES` 的 Vault 句子
保留为**降级路径**（针对没有结构化包装的旧记录或 Rust IPC），不再是主判据：
凭据失败在到达它之前就已按 `kind` 分类返回。

---

## 门禁

| 项 | 结果 |
| --- | --- |
| 前端全量 | **216 文件 / 1911 项**，`Errors 0` |
| Rust | **381 passed / 0 failed** |
| typecheck | 通过（两个 project） |
| ESLint | 0 error |
| source-size | **638 文件**全部通过 |
| bundle budget | initial 130.68 / 240 KB，total **615.65 / 624 KB** |

本轮改动触发了三次 source-size 违规，全部在本地发现并拆分
（`credential-boundary.ts` 352 行 → 拆出 `credential-resolver.ts`；
`terminal-pane-header.tsx` 205 行 → 拆出 `terminal-pane-target.ts`；
`container.tsx` 201 行 → 合并解构）。**没有一次是让 CI 抓到的。**

---

## 判定

```
CLEAR_CREDENTIAL_UNHANDLED_REJECTION=PASS
VAULT_READ_FAILURE_SKIPS_NETWORK_RETRY=PASS
CREDENTIAL_KIND_REACHES_UI=PASS
CREDENTIAL_UI_DECIDES_ON_STRUCTURE=PASS
VAULT_ACTION_REACHABLE=PASS
VAULT_REAL_E2E=NOT_RUN
SSH_VAULT_REAL_E2E=NOT_RUN
JUMP_HOST_VAULT_REAL_E2E=NOT_RUN
SFTP_REAL_E2E=NOT_RUN
GUI_IME=NOT_RUN
WORKSPACE_RESTORE=NOT_RUN
DAILY_DRIVER_7DAY_SCORECARD=NOT_RUN

DAILY_DRIVER_READY=NO
TABBY_REPLACEMENT_READY=NO
```

本轮全部是自动化可验证项。真机验收项一条都没有动 —— 它们需要真实 GUI 交互，
本轮不具备条件，也不会因为代码变绿而改判。

---

## 停止线

按任务书要求：完成本轮后**停止新增 Phase 10.x 功能**。下一阶段只做真实 macOS
Daily Driver 验收，重点是 Vault、SSH、Jump、SFTP、IME 与 Workspace 恢复。

未获得明确合并授权前，PR #33 保持 Draft，不合并不发布。

---

## 本轮额外抓到的一个缺陷（由我引入）

在补「launcher 是否真的转发 `state`」的测试时发现：`resolveSessionCredential`
的失败分支写的是 `if (!resolved.ok) return resolved`，返回的是解析器的
`CredentialResolutionFailure`，它把状态字段叫 `state`；而这个模块的
`SessionCredentialOutcome` 叫 `vaultState`。两者结构相近，**TypeScript 不会报错**，
于是 `state` 被静默丢弃。

后果：`withResolvedCredential` 收到的 `vaultState` 恒为 `undefined`，
所有 Vault 故障在真实连接路径上都会退化成 `vault-unusable` —— 一个首次运行的用户
会被要求"打开 Vaults 页面检查"，而不是"创建一个 Vault"。

修复为显式映射。测试 `withResolvedCredential reports the vault state, not a
fallback` 走真实的 `withResolvedCredential`，断言 `kind` 与 `vaultState` 同时正确，
修复前红、修复后绿。

**这条如果不测真实入口，单元测试会全绿而产品仍然错** —— 与 Phase 10.3 记录的五次
同形状缺陷完全一致。

---

## 独立审查结论与两处补修

审查代理未参与开发，逐条尝试推翻三个断言，并对每个关键判定做「改红再改回」的变异验证。

| 断言 | 首审判定 | 原因 |
| --- | --- | --- |
| A 未处理 rejection | **CONFIRMED** | 删 `catch` 实测变红；改成「失败也关对话框」实测 3 条变红 |
| B Vault 读取不进重连 | **PARTIAL** | vault 四 kind 与 not-bound 实测 0 次自动重连；但损坏引用仍跑满 5 次 |
| C 结构化 kind 到 UI | **PARTIAL** | 13 跳链路真实贯通；但 7 个 kind 中 3 个在生产不可达 |

### 补修一：损坏引用没有生产者

审查的可达性枚举：

```
CASE "problem malformed"   -> {"kind":null, "recovery":"automatic", "errName":"Error"}
CASE "problem empty-kinds" -> {"kind":null, "recovery":"automatic", "errName":"Error"}
CASE "identityFilePath"    -> {"kind":"credential-not-bound", "recovery":"manual"}
CASE "no ref, no problem"  -> 不抛（正常无凭据主机）
```

`withResolvedCredential` 对 `credentialRefProblem` 抛的是**裸 `Error`**。于是
`credential-corrupt-reference` 这个枚举成员、`recovery: 'manual'` 这个分类、以及
pane 上的「重新保存凭据」这个动作，三者都存在而**没有一个能被生产路径触达**。

这与本轮修复的 vault 缺陷是同一形状：守卫存在、枚举存在、UI 映射存在，真实入口
走另一条路。

修复：改抛 `CredentialFailure('credential-corrupt-reference', …)`。四种损坏
（malformed / empty-kinds / unknown-provider / unsupported-version）各有测试，
修复前 4 项红、修复后绿；并补一条 manager 级测试证明它只尝试 1 次而非 5 次。

### 补修二：测试没锁住 `recovery` 判定

审查报告：「你指定的 mutation（`start.ts` 回退成 `failure.retryable`）实测
**7/7 仍绿**」。

我复现了：8/8 仍绿。原因是分类器保证 `retryable` 与 `recovery === 'automatic'`
对每个真实失败都一致，所以「没有发生自动重连」这个观察无法区分管理器读了哪个字段。

这不是测试写错，是**测试观测不到它声称观测的东西**。补法不是删掉 `recovery`，而是
在两者**必须不一致**的地方钉住契约：新建
`terminal-recovery-field-contract.test.ts`，mock 分类器产出
`retryable: true` + `recovery: 'after-vault'` 的分叉组合。

三处判定的变异验证结果：

| 位置 | 变异 | 结果 |
| --- | --- | --- |
| `start.ts:141` | `recovery === 'automatic'` → `retryable` | **红**（2 次 vs 期望 1 次） |
| `wake-recovery.ts` `resumable()` | 去掉 `recovery === 'automatic'` | **红** |
| `reconnect.ts:198` | `result.recovery !== 'automatic'` → `!result.retryable` | **红**（7 次 vs 允许 3 次） |

三处都改回，改回后各测试恢复绿。

### 审查未推翻的部分

- A 的 `process.removeAllListeners('unhandledRejection')` 不会造成假绿
- C 的 13 跳链路（snapshot 带对 kind、`useTerminal` 读取、header 按 kind 决策）
- `includes` 已从 `credentialFailureFrom` 完全清除
- `Object.hasOwn` 能抗原型污染
- `/vaults` 是真路由，`useNavigate` 不整页刷新，终端常驻层不卸载

### 仍为 PARTIAL 的部分

`credential-missing` 仍无生产者（`resolveSessionCredential` 返回带 `reason` 的失败
时走 `credentialFailureFrom`，不带 reason 时由 launcher 兜底成 `credential-missing`，
但那条兜底分支当前不可达）。保留该枚举成员与 UI 映射，因为它描述的状态是真实的；
不伪造一个生产者为它"补测"。此项记入剩余风险。

---

## 最终门禁

| 项 | 结果 |
| --- | --- |
| 前端全量 | **217 文件 / 1926 项**，`Errors 0` |
| Rust | **381 passed / 0 failed** |
| typecheck | 通过 |
| ESLint | 0 error |
| source-size | 638 文件 |
| bundle budget | initial 130.67 / 240 KB，total **615.74 / 624 KB** |
