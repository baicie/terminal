# Daily Driver 验收矩阵

> 本文把任务 13 列出的每一项分成**能自动验证的**与**只能人工使用的**。
> 两者的区别不是难易，而是**证据来源**：自动化证明「这台机器上这一刻成立」，
> 七天人工使用证明「一周的真实工作里没有把你绊倒」。后者无法用前者代替。
>
> 基线：`main = 388e2df`（2026-11-20）。下方每项标注它的证据来源与当前状态。

## 状态定义

| 状态 | 含义 |
| --- | --- |
| `AUTOMATED` | 有自动化测试且通过；标注测试文件与数量 |
| `PARTIAL` | 有自动化覆盖，但覆盖的是链路的一段 |
| `MANUAL` | 只能人工验证，**不得用自动化代替** |
| `BLOCKED_EXTERNAL` | 缺设备、证书或账户 |

---

## 一、可自动化的部分

| 能力 | 状态 | 证据 |
| --- | --- | --- |
| 本地 PTY 启动与退出 | `AUTOMATED` | `e2e-01`（启动）、`e2e-05` 的「关闭 dock 后同一 PTY 仍能执行命令」——断言的是 shell 回显，不是 `xterm` 节点存在 |
| SSH 断开重连 | `PARTIAL` | 重连阶梯与 `TerminalFailureRecovery` 三态有单测；真实断线重连的 GUI 路径 **未跑** |
| 多 Tab / Split | `AUTOMATED` | `tabs.test.tsx`、split 相关组件测试；e2e-04 断言面板单占位者 |
| Focus / Clipboard | `PARTIAL` | 粘贴策略（多行/控制字符/超大）有完整矩阵；真实系统剪贴板 **未测** |
| 输出背压 / OUTPUT ACK | `PARTIAL` | Rust 侧有 ACK 会计；大输出 GUI 场景 **未跑** |
| SFTP 队列 | `AUTOMATED` | `sftp-transfer-queue.test.ts`、`sftp-deferred-release*`、`upload-refresh-retention` |
| 异常退出与恢复 | `AUTOMATED` | `db_recovery` 状态机、`StartupGate`、8 阶段 crash 矩阵（Phase 9.5.4） |
| CPU / 内存增长 | `PARTIAL` | 有界数据结构有测试（`sftp-deferred-release-idempotency` 的 1000 次循环）；**长时间运行的 RSS 曲线未测** |
| Snippet 开关与重启 | `AUTOMATED` | e2e-05 三平台 PASS：开关持久化、重启恢复、SQLite 行读回 |
| Vault 恢复 | `PARTIAL` | 三态（uninitialized/locked/unusable）有单测与 UI；真实解锁 **需要密码，未跑** |
| AI 关闭时启动性能 | `PARTIAL` | `no-auto-execute.test.ts` 断言 AI 模块不触碰会话；启动时间未单独测量 |

## 二、只能人工使用的部分（`MANUAL`）

> 这些**不会**因为 CI 全绿而变成 `PASS`。任务书要求「七天真实使用绝不伪造完成」，
> 而这一节的每一项都需要一个人在真实工作里用它一周。

| 能力 | 为什么无法自动化 |
| --- | --- |
| 七天真实使用评分 | 需要连续一周的真实工作负载；任何脚本化的「模拟使用」测的是脚本 |
| 物理键盘 30 轮重叠 `a/s/d` | 需要真实输入设备的时序；WebDriver 的 `type` 不产生重叠 |
| 中文 IME | 需要真实输入法引擎与候选窗交互 |
| Option / dead key | 依赖键盘布局与操作系统的组合键解析 |
| Vim / tmux 交互 | 需要人对终端状态机的连续观察；自动化只能验证片段 |
| DPI 缩放的主观可读性 | 需要人眼判断 |

## 三、`BLOCKED_EXTERNAL`

| 项 | 缺少什么 |
| --- | --- |
| Windows 远程 Inspector | 产品**不支持**（见 PR #126）；支持它是新功能 |
| OS Keychain / Credential Manager / Secret Service | 需要真实平台密钥链与签名构建 |
| 真实模型端点 | 本机四个常见端口无响应；不使用未授权的付费 key |
| 签名 / 公证 / Updater 运行时 | 需要证书与分发环境 |
| Windows NSIS 升级、Linux AppImage stock 启动 | 需要对应平台的安装环境 |

---

## 四、这份矩阵怎么用

1. **不要**把第一节的 `AUTOMATED` 读成「Daily Driver 达标」——那是第零天。
2. 第二节的每一项在真实使用中记录：出现时间、做了什么、期望与实际。
3. 七天结束时，第一节的绿与第二节的记录一起构成结论；任一为空则结论是 `NOT_RUN`。
4. 新增能力时先问它属于哪一节，再决定用测试还是用使用记录来证明。

---

## 当前判定

```
DAILY_DRIVER_AUTOMATION  = PARTIAL   （第一节里 4 项 PARTIAL）
DAILY_DRIVER_7DAY_USAGE  = NOT_RUN   （第二节全部未发生）
DAILY_DRIVER_READY       = NO
```

`READY = NO` 不是保守，是字面意思：这个产品还没有被一个人连续用满一周。
