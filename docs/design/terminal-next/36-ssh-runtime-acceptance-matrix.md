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

<!-- FILLED_BY_AUDIT -->

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

