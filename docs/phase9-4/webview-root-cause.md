# macOS WebView 冷启动根因

> 日期：2026-11-03
> 基线：`e44d7ab` + Phase 9.4 压力工具

## 1. 历史证据

Phase 9.3.1 统计 16 次 real-machine run：

| 结论 | 次数 |
| --- | --- |
| success | 12 |
| failure | 3 |
| 日志过期无法判定 | 1 |

可判定失败率 **3/15 = 20%**。

已知失败不是同一种：

1. **WebView 一阶段都没有**：`stages: none recorded`，Issue #65 曾在非 smoke
   二进制上抓到 `didFailProvisionalLoadForFrame ... code=-1004`。
2. **DB ready 后停滞**：run `41475640293`
   `frontend-boot@0ms -> ... -> ready@1081ms`，之后 6 秒无阶段。
3. 早期两次失败日志只有 `terminalReady:false`，连阶段插桩都没有。

因此不能把历史 20% 全部归因成 `-1004`。

## 2. 五段判据

Phase 9.3.2/9.4 把冷启动拆成独立可观测阶段：

| 段 | 阶段 | 说明 |
| --- | --- | --- |
| 1 | `frontend-boot` | WebView 是否执行了 bundle |
| 2 | `ready` | 数据库 bootstrap 是否完成 |
| 3 | `terminal-mounted` | xterm 是否完成 open，携带 `tabId@workspaceId` |
| 4 | `session-create-requested` → `session-created` | 是否真的请求并建立了会话 |
| 5 | SSH prompt marker | 端到端 shell 是否可用 |

`terminal-mounted` 在 `term.open()` 与 viewport attach 之后发出，不表示 PTY/SSH
已建立；`open()` 抛错时不会发出。重复挂载会重复发出，分析脚本使用**首次**
`terminal-mounted`。

## 3. 本轮 30 次真实样本

工作流：`Cold-start stress` run `41601372583`
（`a1bd3b6`，instrumented debug binary
`613aeab7156350546b92d9a194f1bd4922986d5e1a7166b53bf0e099195f4b9f`）。

| 指标 | 值 |
| --- | --- |
| 样本 | 30 |
| 成功 | 30 |
| 失败 | 0 |
| 成功率 | 100% |
| spawn→ready 最小 / 中位 / p95 / 最大 | 3393 / 3512 / 3819 / 4858 ms |

阶段出现次数：

```text
frontend-boot=30 ready=30 terminal-mounted=30
session-create-requested=30 session-created=30
```

分段耗时（30 次）：

| 边 | 最小 | 中位 | p95 | 最大 |
| --- | --- | --- | --- | --- |
| `ready → terminal-mounted` | 389 | 406 | 426 | 740 ms |
| `terminal-mounted → session-create-requested` | 56 | 87 | 104 | 255 ms |
| `session-create-requested → ssh-connect-start` | 1 | 2 | 6 | 12 ms |

30/30 中 `session-create-requested` 均早于 `ssh-connect-start`，无因果倒置。

## 4. 统计边界

30 次全过**不能**证明失败率低于 1%。若真实失败率仍为 20%，30 次全过的概率约为
`0.8^30 ≈ 0.12%`；但这不是“失败率已经为 0”的证明。0/30 的单侧 95% 置信上界约为
**9.5%**，仍高于 RC 目标。

为把 95% 上界压到约 1%，需要约 **300** 次连续样本；Phase 9.4 已提高工作流样本量
并重新运行，结果见 `cold-start-statistics.md`。

## 5. 根因状态

| 项 | 状态 |
| --- | --- |
| 五段诊断链 | **PASS**（30/30 阶段完整） |
| 30 次真实重复测量 | **PASS**（30/30） |
| 历史 20% 失败根因 | **NOT_RUN / 未复现** |
| WebKit Unified Log 失败回调 | **NOT_RUN**（本轮无失败可采） |
| 300 次高压样本 | 见 `cold-start-statistics.md` |

**不能**把 30/30 写成“20% 失败已修复”。本轮只能证明：在新的诊断链下，这批样本
全部走完 `frontend-boot → ready → terminal-mounted → session-create-requested`
并建立了 SSH 会话；历史失败仍需在更大样本或失败复现时用 Unified Log 定位。
