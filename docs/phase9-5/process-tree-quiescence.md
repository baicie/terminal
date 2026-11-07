# Phase 9.5.5 — Process-Tree Quiescence

> 日期：2026-11-05
> 判定：`PROCESS_TREE_QUIESCENCE_E2E = PASS`（macOS + Linux，E2E `42047193259`）

## 1. 问题

Phase 9.5.4 的 quiescence 只有 PROCESS_EXITED / STREAMS_CLOSED /
DB_HANDLES_RELEASED，`OWNED_CHILDREN_SETTLED` 一直是 **NOT_RUN**。原因是父进程
退出后，它的子进程会被 reparent 到 launchd/init，事后再按 PPID 查已经找不到
归属；只有**在发信号之前**记录后代 PID，退出后再确认这些 PID 消失，才是可观测
的证据。

## 2. 实现

| 组件 | 行为 |
| --- | --- |
| `snapshotDescendants(pid)` | 用 `pgrep -P` 递归收集全部后代；无子进程（pgrep exit 1）是真实观测；`pgrep` 缺失 → `supported:false` |
| `stopProcess(..., onBeforeSignal)` | 在 `child.kill('SIGTERM')` 之前调用快照，结果写入 `ownedChildren` |
| `stopChecked`（Harness） | 统一传 `pid => snapshotDescendants(pid)`，A/B/恢复/降级/Linux 六个停止点全部覆盖 |
| `settledChildren(pids)` | 退出后最多等待 2 s；仍存活 → 泄漏 |
| `requireQuiescent` | `OWNED_CHILDREN_SETTLED` 进入必需事实；FAIL 抛错，NOT_RUN 使总体为 PARTIAL |

判定语义：

- 快照成功且退出后无存活后代 → **PASS**；
- 有后代仍存活（超过 2 s 宽限）→ **FAIL**，错误信息列出 PID；
- `pgrep` 不可用 / Windows / 快照未执行 → **NOT_RUN**，绝不伪造 PASS。

## 3. 本地真实测试

`quiescence.test.mjs` 新增：

1. 父进程 `spawn` 一个忽略 SIGTERM 的子进程并发布其 PID；
2. 停止父进程前快照，断言子进程 PID 在集合中；
3. 停止父进程后 `requireQuiescent` 必须以 `OWNED_CHILDREN_SETTLED` 拒绝，
   且子进程仍存活；
4. 清理子进程；
5. 对照组：无子进程的父进程停止后 `OWNED_CHILDREN_SETTLED = PASS`。

`node --test scripts/verify-install/quiescence.test.mjs`：**4/4 PASS**；
`process-lifecycle.test.mjs` 10/10；全量脚本 **467/465/2/0 fail**。

## 4. Harness 接入

`upgrade-e2e.mjs` 的 6 个 `assertQuiescence` 改为 await 异步收敛检查，
`stopChecked` 在信号前快照。E2E 报告中的
`A quiescence` / `B quiescence` / `restored A quiescence` /
`downgrade A quiescence` 现在包含第四个事实。

E2E `42047193259`（`10fffd5`）**5/5 success**，CI `42047193385` **11/11
success**。下载的 10 份
`upgrade-report.json`（normal、restore、downgrade、corrupt、readonly、
restart、interrupt、historical、Linux DEB）里，所有 quiescence check
均为 **PASS**，四项事实全部 `PASS`：

```json
{"PROCESS_EXITED":"PASS","STREAMS_CLOSED":"PASS",
 "OWNED_CHILDREN_SETTLED":"PASS","DB_HANDLES_RELEASED":"PASS"}
```

这包含 Linux DEB 上的 WebKitGTK 子进程：停止后没有残留。

## 5. 边界

- Windows 没有 `pgrep`，该事实保持 **NOT_RUN**；Windows 升级 E2E 仍未执行。
- macOS 的 WebKit 进程由 launchd 管理，不是 app 的后代；Linux WebKitGTK
  的 WebProcess 是 app 子进程，若退出后残留会被判 FAIL（这正是要发现的问题）。
- PID 复用窗口极短但并非零；探针以“停止前快照 + 退出后存活检查”为准。
- 2 s 是收敛宽限，不是“忽略泄漏”；超过宽限仍存活即失败。
