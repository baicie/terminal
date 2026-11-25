# F03 — SSH 运行验收矩阵（当前基线）

本文件是 **SSH01–SSH20 的唯一当前状态基线**。后续任务据此推进，不再按任务编号
宣称「百分百完成」。历史文档里的 PASS 是它们写作时的快照；与下表冲突时以下表为准，
且下表每一项都指向可以当场打开的证据。

## 为什么这张表存在

SSH05–SSH20 的每一轮都在文档里记了 PASS，但那些 PASS 的**层级不同**：有的是
纯函数单测，有的是真实 sshd 上的 Rust 测试，有的是真实 Tauri 二进制驱动的 smoke，
没有一项走过真实 GUI。把四者混记成「已完成」，会让「SSH 恢复已经做完了」这句话
在真实使用里第一次断网时立刻变成假话。

所以每一行标的是**它实际到达的最远层级**，不是它最好看的那条证据。

## 层级定义

| 层级 | 含义 |
| --- | --- |
| `IMPLEMENTED` | 产品路径里存在，但只有类型/结构证据 |
| `UNIT_VERIFIED` | 有会在回归时变红的单测或组件测试 |
| `REAL_RUST_VERIFIED` | 走真实 Rust 产品连接路径对真实 OpenSSH（`ssh_jump_e2e_tests` / `scripts/verify-install/*`） |
| `PRODUCT_SMOKE_VERIFIED` | 真实 Tauri 二进制 → IPC → Rust → 真实 sshd（`scripts/run-terminal-smoke.mjs`） |
| `NATIVE_GUI_VERIFIED` | 真实 GUI E2E 套件驱动 |
| `PARTIAL` / `NOT_RUN` / `BLOCKED_EXTERNAL` | 未达到上述任一层级，或依赖外部条件 |

## 矩阵

| # | 主题 | 最远层级 | 证据 | 缺口 |
| --- | --- | --- | --- | --- |
| SSH01 | sshd fixture 就绪语义/端口重试/诊断 | `UNIT_VERIFIED` | `scripts/sftp-command-e2e.lifecycle.test.mjs:85/109/143/255` | 修复落在**测试文件自己的** fixture 里；CI 实际跑的 `scripts/verify-install/sftp-command-e2e.mjs:111` 仍是 `reservePort()` 无重试、`generateKey` 无 `existsSync` 保护 |
| SSH02 | — | **NOT_FOUND** | 仓库内任何分支/文档/提交都没有痕迹 | 无法判定范围 |
| SSH03 | 调用图/爆炸半径审计 | `IMPLEMENTED`（仅文档） | `docs/…/34-…md:7-86`，结论 `:217` | 数字已漂移：文档说 96 处 `Result<_, SessionError>`，实际 89 处；且文档 `:218` 说 6 个命令、`:219` 说 5 个，自相矛盾 |
| SSH04 | `SessionFailure` 错误架构 ADR | `IMPLEMENTED` + `UNIT_VERIFIED` | `session/types.rs:727/741/758/821`；全仓无 `From<SessionFailure> for SessionError` | 没有测试断言「反向转换不存在」 |
| SSH05–06 | `SessionFailure` IPC 契约与首个真实路径 | `REAL_RUST_VERIFIED` | `types.rs:854/893/922/955`；类型经 `ssh_jump_e2e_tests.rs:154` 的真实双跳 | smoke 从不检查 hop 字段 |
| SSH07–09 | hop/stage 在跳板/隧道/目标处附加 | `REAL_RUST_VERIFIED`（部分） | `ssh.rs:2646/2672/2110/2149/2192`；真实覆盖 `ssh_jump_e2e_tests.rs:259/203/312/365` | **`tunnel_open`（`:2110`）与跳板 `tcp_connect`（`:2646`）没有真实后端用例**，只有形状测试 |
| SSH10 | hop/stage 到达快照且不影响重试 | `UNIT_VERIFIED` | `terminal-session-manager-hop.test.ts:56/81/118/159` | 快照→DOM 未在真实窗口验证 |
| SSH11 | 用户可见诊断（哪台机器拒绝） | `UNIT_VERIFIED`（组件） | `terminal-failure-diagnostic.ts:44/82/143`；`terminal-error-overlay.test.tsx:227` | 真实 GUI 渲染、Toast、连接日志全部 `NOT_RUN` |
| SSH12 | 真实双跳健康路径 | `REAL_RUST_VERIFIED` | `ssh_jump_e2e_tests.rs:154` | `#[ignore]`，**没有任何 workflow 调它** |
| SSH13 | 跳板拒绝归因矩阵 | `REAL_RUST_VERIFIED` | `ssh_jump_e2e_tests.rs:259/312` | 同上 |
| SSH14 | 目标 host-key 归因 | `REAL_RUST_VERIFIED` | `ssh_jump_e2e_tests.rs:365` | 同上 |
| SSH15 | 断连释放双腿 | `REAL_RUST_VERIFIED` | `ssh_jump_e2e_tests.rs:425`（服务端 `netstat` 计数 + 正控制 `:473`） | 只有健康会话一种；失败路径清理仅有 mock |
| SSH16 | 双跳会话池生命周期 | `REAL_RUST_VERIFIED`（弱） | `ssh_jump_e2e_tests.rs:749` | **测试自己 `insert` 池条目**（`:794`），不证明产品会注册；无多目标隔离 |
| SSH17 | 同一跳板两条会话不共享 transport | `REAL_RUST_VERIFIED` | `ssh_jump_e2e_tests.rs:586`（基线为 0 + 逐会话递增） | 同跳板 + **两个不同目标**从未测过 |
| SSH18 | `maxDelayMs` 夹在抖动之后 | `UNIT_VERIFIED` | `terminal-session-reconnect-policy.test.ts:70` + 负控制在 `:95` | 真实后端上不可观测：缺陷需要 `maxAttempts > 5`，而出货是 `new TerminalSessionManager()` |
| SSH19 | 真实后端永久失败 + 结构化原因 | `PRODUCT_SMOKE_VERIFIED`（本地记录，未归档） | `run-terminal-smoke.mjs:983` + `terminal_smoke.rs:955-976`；真实输出见提交 `9896f5e` | `docs/verification/raw/` 下没有 `failure-observed`；它不是矩阵用例。**`attempts` 结构性恒为 null**（见下） |
| SSH20 | 重试阶梯矩阵 + `attempt ≤ 0` 修复 | `UNIT_VERIFIED` | `terminal-session-reconnect-policy.ts:104` + 测试套件 | 纯函数；自定义策略永不到达真实 sshd |

**`NATIVE_GUI_VERIFIED`：没有任何一行达到。** `e2e/gui/specs/*` 里连一个跳板 fixture 都没有，
更没有失败诊断用例。

### SSH03 文档里的一个真实矛盾

`34-…md:218` 写「6 个命令」，`:219` 写「5 个」。实测是 5 个 `session_create_ssh_*` 加一个
通用 helper（`commands.rs:747-817`）。文档不得同时持有两个数字。


## 必须保留的限定（不要因为「都绿了」而删掉）

这几条是 F03 明确要求保留的，它们限定的正是最容易被读成「已完成」的那几项：

1. **SSH19 的真实后端只证明了直连永久失败。** 跳板的永久失败在本轮之前没有编排过；
   F09 补上了场景表，但在它真正跑通之前，双跳永久失败仍是 `PARTIAL`。
2. **SSH12–SSH15 的真实双跳 6/6 不是完整的双跳断连矩阵。** 已覆盖的是认证/主机密钥
   四类拒绝与一次健康连接；RST、握手中断、连接后断开都不在其中，那些属于 F12。
3. **SSH16 的池注册/释放测试不代表多目标隔离。** 它证明「一条双跳连接注册一个池条目
   并在释放后清掉」，不证明 Bastion A / Bastion B / Target A / Target B 之间互不串用。
   后者属于 F11。
4. **SSH20 的阶梯矩阵只在默认策略上跑过真实后端。** 出货的
   `terminalSessionManager` 是 `new TerminalSessionManager()`，不收参数，所以自定义
   `baseDelayMs` / `maxAttempts` 的真实执行是 `NOT_RUN`，而 F13 要求补上它。

## F09 首次真实编排的结果（必须保留）

第一次真实跑 `--scenario BASTION_AUTH_REJECTED` **失败**，失败信息本身是有价值的：

```
Invalid terminal smoke result: smoke failed at stage connecting:
connect jump host failed: Connection reset by peer (os error 54)
```

同日志显示产品**重试了 6 次**（09:04:38 → 09:04:54，六条 `session-create-requested`）。
两点必须先分清楚，而当前还分不清：

- **是 fixture 坏了，还是产品把跳板认证拒绝当成了可重试故障？**
  若为后者，这是一个真实的产品缺陷：`authentication_rejected` 是终态，不该走阶梯。
  若为前者，则场景表本身还没有被证明可用。
- 已排除的解释：`authorized_keys` 替换后 daemon 仍存活、仍接受 TCP、用 `ssh` 直连
  稳定得到 `Permission denied (publickey)`（3 次连续）。所以「替换文件把 daemon 弄坏了」
  不成立。
- 尚未排除：`Rust` 的 `direct-tcpip` 路径与 fixture 的 role 组合是否存在别的问题；
  正在用仓库既有的 `scripts/verify-install/ssh-jump-e2e.mjs`（Rust 级、真实双跳、
  8 个用例）判断健康双跳在本机是否成立。

**在结论出来之前，F09 记为 `PARTIAL`。** 场景表与编排代码已就绪且单测覆盖，
但「每个场景在真实后端上产生预期 diagnosis」一条都还没有被真实运行证明。
不得因为表写好了就记 PASS。

