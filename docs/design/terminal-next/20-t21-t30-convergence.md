# T21–T30 收敛验收记录

> 基线 `main@2f682a0`（T08 之后）。
>
> 这份文件把「这一轮修了什么」「什么是真的通过」「什么只能外部条件满足」
> 分开写。任何把三者混为一谈的句子都是错的。

## 状态词

| 词 | 含义 |
| --- | --- |
| `FIXED` | 有先红后绿的测试，且有变异验证 |
| `VERIFIED` | 既有实现经核对成立，本轮未改 |
| `AUTOMATED_ONLY` | 自动化通过，真实 GUI / 真机未跑 |
| `NOT_RUN` | 该做的没做 |
| `BLOCKED_EXTERNAL` | 缺证书、账号、硬件或授权 |

---

## 一、这一轮修掉的缺陷（5 个，全部先红后绿）

### 1. 清除凭据会静默删掉秘密（P0）

`hostUpdateArgs` 的 `dropIdentityFilePathArgument` 选项**被声明、从未被读取**。两条
clear/switch-to-agent 语句各只有 19 个 `?`，函数却返回 23 个参数。

sqlx 按占位符数量绑定并**忽略多余参数**（`sqlx-sqlite` `arguments.rs`：
`for param_i in 1..=cnt`），不报错。于是从第 7 个占位符起全部错位，`WHERE id = ?`
拿到 `agent_forwarding`（0 或 1），UPDATE 匹配不到任何行 —— 而 `hosts.ts` 随后仍然
删除 Vault 里的旧版本，因为 `retirePreviousVersion` 不检查 `rowsAffected`。

**用户以为只是清除，实际秘密已经没了，而行还声称自己有一个。**

修法：补上 `dropIdentityFilePathArgument` 分支（19 个值，按语句列序）。
守卫：`host-update-args.test.ts` 从 `hosts.ts` **读取**每条语句并数占位符，
与参数列表长度比对。

| 变异 | 结果 |
| --- | --- |
| 分支改回 `if (false && …)` | 2 项红 |
| 参数顺序错位 | 由最后一项必须是 id 的用例抓 |

### 2. 私钥解析失败被当作密码再试一次（P0）

`ssh.rs` 两处：主连接与跳板。`authType: 'key'` 时前端把**私钥口令**放进
`password` 字段，回退会把它当账号密码再认证一次。

后果：多一次失败登录（可能计入锁定），口令恰好等于账号密码时会以用户没选的方式
登录成功，最终错误信息说的是密码而失败的是密钥。

修法：两处回退删除，统一报 `KeyParseFailed`。新增 `on_key_decode_failure()` 作为
唯一决策点，枚举只有一个变体 —— 没有 `FallBackToPassword` 可供未来改动取用。

### 3. 断流被报成完整答案（P0）

SSE 循环在 `Ok(None)`（连接关闭）时跳出，然后只凭 `saw_content` 决定完成。
实测：两个 chunk 之后连接断开、没有 `[DONE]`，事件序列是
`Chunk, Chunk, Done` —— UI 渲染成一个完整回答。

**用户拿到一段被截断的解释，且没有任何提示。**

修法：`[DONE]` 是唯一完成信号。没有它 → 新 `AiFailureKind::Incomplete`，
已到达的 chunk 仍然显示（前端测试钉住 `state.text` 保留）。

> **这个过程本身值得记下**：第一版测试用 `content-length` 比实际多 64 字节，
> 于是 reqwest 在传输层先失败，测试**通过了一个它没测到的行为**。改成
> 长度精确但缺 `[DONE]` 之后才真正变红。

### 4. Extension 账本每次停用都泄漏一个桶（P1）

`deactivate` 先 `generation += 1` 再调 `rollback`，而 `settleOwnedContributions`
只在 `currentGeneration() === generation` 时调 `clear`。两者永远不相等，
**`clear` 是死代码**。

实测：一次 enable+deactivate 后 `contributions.size` 与 `disposables.size` 都仍是 1。
100 次循环会留 100 个桶，每个桶持有死激活的 disposer 与事件处理器。

不可见的原因是 `diagnostics()` 的计数只统计 active 扩展。

修法：`deactivate` 无条件删除两个桶；`diagnostics()` 新增 `orphanedBuckets`
统计非 active 扩展的账本条目。

> **这一条的测试写错过一次**：第一版把 `baseline`（循环前）与 `after`（循环后）
> 用 `toEqual` 比较 —— 两边都来自同一个可能已经坏掉的观察器。把 `diagnostics()`
> 变异成恒返回 0 之后测试仍然通过。改成断言**绝对数值**（1 个命令、3 个贡献、
> 1 个监听器）后才有验证力。

### 5. Inspector 注释声称的 hostId 守卫不存在（P2）

`server-inspector-view.tsx` 写着「a result whose `hostId` is not the panel's host is
discarded」。代码只比较 generation，`result.hostId` 只被写入、从未被读取。

generation 已经覆盖了真实竞态（有测试），所以这不是活缺陷。但按注释补上守卫并
加测试，因为两者失败方式不同：generation 出错会把 A 的数字显示在 B 名下，
hostId 检查不会。

---

## 二、这一轮改对的测试（2 处）

### `dock-disposal.test.ts` 的用例标题在说一件断言不成立的事

标题「disposes it when activation fails part-way」，注释说要「drives the rollback
through the failure path」，函数体只有 enable + deactivate —— 与上一条用例同一件事。

改为真的构造失败：工厂先注册一个命令、返回一个 disposable、然后 throw。
断言失败的激活不留下命令。变异（跳过 rollback）验证。

### `no-auto-execute.test.ts` 的拦截名单漏了真正的 PTY 通路

名单里有 `session_write`、`terminal.write(`，**没有** `terminalEmitter.writeCommand`
—— 命令面板执行 snippet 走的就是这条路。

实测：往 `features/ai/` 放一个调用 `terminalEmitter.writeCommand` 的文件，
测试**保持绿色**。

修法：加 `writeCommand(`、`terminalEmitter`，并新增 import 级检查
（调用可以被别名藏起来，import 不能）。同时剥掉注释再匹配，否则解释「我们不用它」
的注释会让守卫失败。

变异：加入上述探针文件 → 2 项红，两处都命中。

---

## 三、逐项状态

| # | 任务 | 状态 | 说明 |
| --- | --- | --- | --- |
| T21 | 真实凭据 GUI 体验 | `FIXED` + `NOT_RUN` | 见 §1.1、§1.2；真实 Tauri WebView 的 Vault 解锁/复制/重启恢复 **NOT_RUN** |
| T22 | 系统 Provider 调研 | `VERIFIED` | 见 §4 |
| T23 | AI 四个动作验收 | `FIXED` + `BLOCKED_EXTERNAL` | 见 §1.3；真实模型端点 **BLOCKED_EXTERNAL** |
| T24 | AI 安全边界 | `FIXED` | 见 §1.5、§2.2；见 §5 |
| T25 | Inspector 真实远程数据 | `FIXED` + `NOT_RUN` | 见 §1.5；真实 macOS/Linux SSH 目标 **NOT_RUN** |
| T26 | Snippet/Extension 稳定性 | `FIXED` | 见 §1.4；100 次循环测试已补 |
| T27 | 终端 UI/UX 日用审查 | `NOT_RUN` | 需要真实 GUI 截图，本机 `AXIsProcessTrusted: false` |
| T28 | 真实发布与升级 | `VERIFIED` + `BLOCKED_EXTERNAL` | 见 §6 |
| T29 | CI 与证据可信度 | `VERIFIED` | 见 §7 |
| T30 | RC Readiness 报告 | 本文 | 见 §8 |

---

## 四、T22：Provider 边界（核对，未改）

`credential-provider-registry.ts` 已经有完整的三层：

| 概念 | 值 | 行为 |
| --- | --- | --- |
| 已知 provider | `vault` / `system-keychain` / `windows-credential-manager` / `secret-service` | 引用里能写，`listAvailability()` 会报告它们「此构建不支持」 |
| 已实现 provider | `vault` | **只有这一个** |
| 未知 provider | 任意其它字符串 | `registry.get()` 返回 `undefined` → `unsupported-provider` |

关键性质：**未知 provider 不会退化到 vault**。`credential-provider-dispatch.test.ts`
断言 `read` 与 `isAvailable` 从未被调用，并对 `quantum-keyring` 这种未来 id 同样拒绝。

三个系统 provider 未实现，`IMPLEMENTED_PROVIDER_IDS = ['vault']` 是唯一的真相来源。
**本轮没有写任何隔离 Spike，也没有切换默认 Provider** —— 任务书要求「不自动切换」，
而实现它们需要真实签名与平台权限，属 `BLOCKED_EXTERNAL`。

---

## 五、T24：API Key 的可见面

| 位置 | 明文 | 处理 |
| --- | --- | --- |
| 设置页输入框 | React state | 保存后清空，取消/切 profile 清空 |
| `setProfileSecret` | 参数 | 写入 Vault 后回读比对 |
| `vault_set` IPC | 明文 | 进 Rust |
| `vault.rs` `encrypt_value` | `&str` | AES-GCM 加密（源字符串未 zeroize） |
| `vault_read_secret` 返回 | `String` | 调用方立即 `Zeroizing::new` |
| `transport.rs` `Bearer {}` | 新建 String | **未** zeroize（header 建好后 drop） |
| 日志 / `AiFailure` 文案 | — | 全部来自静态 `kind.message()`；`tests.rs` 断言 key 不进事件/失败文案 |

结构性事实：`vault_get` 接受任意 key 且已注册。所以「渲染进程不持有 key」在 IPC
能力层是**约定性的**，只在 AI 模块层是结构性的（`ipc_tests.rs` 断言无读取 key 的命令）。

**Prompt Injection 不授权自动执行**：见 §2.2。模型输出只有 `AiEvent::Chunk { text }`，
前端只做 `<pre>` 展示与 `navigator.clipboard.writeText`。

**AI 关闭不污染启动**：`#[cfg(feature = "ai")]` 门控模块与命令；
`scripts/check-ai-isolation.mjs` 是 CI 阻塞步骤，实际编译两次比对 rlib 内容。

---

## 六、T28：发布与升级

`upgrade-e2e.yml` 六个 job，最近三次运行全部 success：

| job | 覆盖 | 判定 |
| --- | --- | --- |
| `macos-historical-upgrade` | dev.1 → dev.2 真实 DMG | `VERIFIED` |
| `macos-current-upgrade` | dev.1 → 当前源码 + 恢复 | `VERIFIED` |
| `macos-updater-runtime` | 临时密钥 + loopback + 安装重启 | `VERIFIED`（临时签名） |
| `linux-deb-upgrade` | 真实 apt/dpkg + 字段级数据 | `VERIFIED` |
| `linux-appimage-upgrade` | payload-only | `PARTIAL`（stock 启动 `NOT_RUN`） |
| `windows-isolation-preflight` | 共享 runner fail-closed | `VERIFIED`（仅 preflight） |

**严格区分**（任务书要求）：

```
构建成功        = VERIFIED（三平台 CI 全绿）
安装成功        = VERIFIED（macOS DMG / Linux DEB）
升级成功        = VERIFIED（macOS dev.1→dev.2 与 dev.1→当前）
正式签名分发    = BLOCKED_EXTERNAL
```

Windows A→B 升级 **NOT_RUN**：共享 runner 的 profile 会被真实用户数据污染，
preflight 为此 fail-closed。需要一次性 profile 或 VM。

---

## 七、T29：CI 与证据

- **Ruleset**：按用户授权，`required checks` 不强制。**本轮未改动。**
- **合并门禁**：`scripts/check-merge-gate.mjs` 读 `headRefOid` 并核对最新 head。
  实测 PR #145：`head c153283…`、7 项 pending → `BLOCKED`。
- **GUI 触发范围**：`native-gui-e2e.yml` 的 paths 覆盖
  `components/ view/ router/ store/ layout/ app/ features/terminal/` 与 `src-tauri/**`。
- **NOT_RUN 不被吞**：`e2e-03` 的证据文件曾给出 `11 passing` 而 `notRunCount: 10`
  —— 那条已在本轮之前修掉（`scripts/gui-e2e-preconditions.mjs` 在 Node 22 上直接退出非 0）。

**本轮新增的守卫**：
- `host-update-args.test.ts` 从源码读语句数占位符（防止再次错位）
- `registry-diagnostics.orphanedBuckets`（防止账本泄漏再次不可见）
- `no-auto-execute` 的 import 级检查（防止别名绕过）

---

## 八、T30：判定

```
UX-1 工作区 / 导航        = VERIFIED（此前已合入）
UX-2 凭据                 = PARTIAL（见下）
UX-3 扩展平台             = PARTIAL（见下）
UX-4 AI / Inspector       = PARTIAL（见下）

CORE_DAILY_DRIVER_RC      = NOT_READY
SEVEN_DAY_HUMAN_USAGE     = NOT_RUN
NATIVE_GUI_THREE_PLATFORM = PARTIAL（macOS 有通过记录，Windows/Linux informational）
REAL_SSH_SFTP             = AUTOMATED_ONLY（本机 sshd，非真实远程主机）
PERFORMANCE_RESOURCES     = PARTIAL（冷启动 n=20 已测；长时 RSS 曲线未测）
CREDENTIAL_SECURITY       = PARTIAL（本轮修了 3 个 P0；真实 Vault 解锁未跑）
INSTALL_AND_UPGRADE       = VERIFIED（macOS/Linux）；Windows NOT_RUN
SIGNED_RELEASE            = BLOCKED_EXTERNAL
```

### 为什么是 `NOT_READY`

不是保守，是三条具体缺失：

1. **七天真人使用 `NOT_RUN`**。`daily-driver-scorecard.mjs` 只能统计覆盖，
   不能代替一个人连续用一周。
2. **真实设备矩阵不完整**。macOS 有通过记录；Windows/Linux GUI E2E 仍是
   informational（失败可见但不阻塞）。Windows A→B 升级 `NOT_RUN`。
3. **真实 Vault 解锁链路无运行期证据**。所有 Vault 测试都 mock 了 `vaultService`。

### 余下 P0 / P1 / P2

| 级别 | 项 | 为什么 |
| --- | --- | --- |
| P0 | 七天真人使用 | 只有真人能做 |
| P0 | 签名 / 公证 / Authenticode | 缺证书与分发环境 |
| P1 | Windows GUI E2E 去 informational | 需要连续稳定通过记录 |
| P1 | Windows NSIS A→B 升级 | 需要一次性 profile/VM |
| P1 | 真实远程 Inspector 数据 | 需要真实 macOS/Linux 远端主机 |
| P2 | `vault.rs` 加密/解密路径 zeroize | 每台机器上明文短暂驻留 |
| P2 | `sftp.goUp` 翻译键无消费者 | 文案在、功能没做 |
| P2 | `emit()` 无生产调用方 | 四种 `SAFE_EVENTS` 无生产者 |
| P2 | `snippet-dock.open` 命令无可达入口 | 注册了，但命令面板不消费 `registry.commands()` |
| P2 | `consumeApproval` 无宿主调用 | 扩展能 mint token，「审批后写回 shell」在产品里不存在 |

### 责任边界

- **本人可继续**：P2 全部、P1 的 Windows 去 informational（需要 CI 观察期）、
  更多先红后绿的缺陷修复。
- **需要真实用户**：七天使用记录。
- **需要外部资源**：签名证书、Windows 一次性环境、真实远程主机、付费模型端点。

### 下一阶段建议

1. 修 P2 三项（都有明确 file:line，成本低）。
2. 用一次真实远程主机（VPS 或家用服务器）跑 Inspector 与 SFTP，
   把 `AUTOMATED_ONLY` 提升到 `VERIFIED`。
3. 若要 `CORE_DAILY_DRIVER_RC`，最小充分条件是：七天真人使用 + Windows
   GUI E2E 连续 5 次稳定通过 + 真实 Vault 解锁一次成功。
