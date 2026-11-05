# Phase 9.5.4 — Real Crash-Point Matrix

> 日期：2026-11-05
> 判定：`REAL_CRASH_POINT_MATRIX_VERIFIED = YES`（恢复协议；产品自身仍无自动恢复）
> 实现：`restore-worker.mjs` + `restore-crash-matrix.mjs` + `restore-crash-matrix.test.mjs`

## 1. 为什么重做

Phase 9.5.3 的 crash point 是**同一进程抛异常**：`crashPoint()` 在恢复流程里
`throw`，父进程捕获后继续。它能证明阶段顺序，但不能证明“进程在中途被杀掉”
之后磁盘上是什么状态，也不能证明下一次启动能收敛。本轮把它替换为真正的
独立 worker 进程终止实验。

## 2. 结构

| 组件 | 作用 |
| --- | --- |
| `restore-worker.mjs` | 独立进程执行 8 阶段恢复；`--crash-at <stage>` 在阶段完成后 `SIGKILL` 自己 |
| `restore-crash-matrix.mjs` | 每个阶段一套 fixture，启动 worker、验证退出信号/PID/文件集，再启动 retry 进程并读回 |
| `restore-crash-matrix.test.mjs` | CI 门禁：8 阶段 + control 全过才算通过 |

worker 的 stage 日志逐行写入 `{stage, pid, at}`；父进程断言日志中的 PID
就是自己 spawn 的 PID，避免把上一次运行的日志当成本次证据。

## 3. 阶段与崩溃后的磁盘状态

`--crash-at` 的语义是“该阶段动作已完成，进程在进入下一阶段前被杀”。

| 阶段 | 崩溃后主 DB | staging 文件 | 恢复重试 |
| --- | --- | --- | --- |
| PREPARE | live（未 checkpoint） | 无 | `restored` |
| QUIESCE | live（checkpoint 完成） | 无 | `restored` |
| VERIFY_BACKUP | live | 无 | `restored` |
| STAGE | live | `terminal.restore.tmp` = 备份 SHA | `restored` |
| VERIFY_STAGED | live | 同上 | `restored` |
| COMMIT | live（sidecar 已删，尚未 rename） | 同上 | `restored` |
| VERIFY | 备份（rename + dir fsync 完成） | 无 | `already-restored` |
| COMPLETE | 备份 | 无 | `already-restored` |

矩阵对每个阶段断言**精确文件集**（文件名 → SHA-256）：

- 主 DB 只允许是 live 或备份两者之一，绝不允许第三个 SHA；
- `terminal.restore.tmp` 只在 STAGE..COMMIT 存在，且等于备份 SHA；
- 不允许残留 `-wal` / `-shm` / `-journal`；
- retry 后文件集必须恰好是 `{ terminal.db: 备份 SHA }`；
- 最终 DB `PRAGMA integrity_check = ok`，fixture 内容 = 备份内容。

## 4. 恢复重试语义

`retry` 是独立进程，不是 worker 内的 catch：

1. 若主 DB SHA 已等于备份 SHA → `already-restored`，只清理残留 staging；
2. 否则删除 staging，从头执行完整 8 阶段恢复 → `restored`；
3. 两种情况都再次用 `integrity_check` 和内容校验读回。

这覆盖了“rename 之前任意点崩溃”和“rename 之后崩溃”两类状态，并且**不会**
把半成品 staging 直接当备份发布。

## 5. 实测结果

本机（macOS，2026-11-05）`node scripts/verify-install/restore-crash-matrix.mjs`：

```text
PASS PREPARE       pid=27618 signal=SIGKILL code=null retry=restored files=terminal.db
PASS QUIESCE       pid=27623 signal=SIGKILL code=null retry=restored files=terminal.db
PASS VERIFY_BACKUP pid=27628 signal=SIGKILL code=null retry=restored files=terminal.db
PASS STAGE         pid=27633 signal=SIGKILL code=null retry=restored files=terminal.db
PASS VERIFY_STAGED pid=27645 signal=SIGKILL code=null retry=restored files=terminal.db
PASS COMMIT        pid=27650 signal=SIGKILL code=null retry=restored files=terminal.db
PASS VERIFY        pid=27655 signal=SIGKILL code=null retry=already-restored files=terminal.db
PASS COMPLETE      pid=27660 signal=SIGKILL code=null retry=already-restored files=terminal.db
PASS CONTROL       full staged restore
```

每个阶段 `exitObserved=true`、`closeObserved=true`、`signal=SIGKILL`、
`code=null`，stage 日志 PID 与 spawn PID 一致。

## 6. 接入升级 Harness

`upgrade-e2e.mjs` 的 `replaceWithBackup` 不再在 Harness 进程内执行恢复，改为
spawn `restore-worker.mjs`：

- 恢复协议与 crash 矩阵是**同一份实现**；
- `restore-backup` 场景额外执行一次 8 阶段矩阵，报告 `restore crash matrix`；
- 阶段日志仍写入 `backup restore stages`，证据契约不变。

## 7. 边界

- 本矩阵验证的是**恢复协议**（Harness 的 restore），不是产品启动时的自动恢复：
  Terminal 应用本身仍没有内建自动恢复状态机，**PRODUCT_AUTO_RECOVERY = NOT_RUN**。
- 不覆盖 ENOSPC、进程组/PTY/WebKit 子进程、Windows 信号语义（Windows 上
  Node 没有 POSIX signal，矩阵记录非零退出码并明确标注）。
- retry 由测试进程显式启动；产品侧“崩溃后自动重试”仍未实现。
