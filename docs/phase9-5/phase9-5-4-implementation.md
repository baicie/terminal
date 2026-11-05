# Phase 9.5.4 — Crash Recovery Evidence & Upgrade Safety Closure

> 日期：2026-11-05
> 分支：`feat/phase9-5-upgrade-integrity`（PR #8 Draft）
> 约束：不合并 PR、不打 tag、不发布 Release、不改生产密钥/identifier。

## 1. 交付

| 项 | 结果 |
| --- | --- |
| 严格 stop fail-closed | **完成**：`requireStopped` + 所有 A/B/恢复/降级/Linux 路径 `stopChecked` |
| 终止语义 | **完成**：clean-exit / terminated-by-sigterm / forced-sigkill / timeout / spawn-error |
| 日志失败 | **完成**：close 内 try/catch/finally，`logError` 独立诊断，场景 fail-closed |
| 进程/DB quiescence | **PARTIAL**：process/streams/lsof DB 句柄；进程树/PTY/WebKit NOT_RUN |
| 恢复状态机 | **完成**：8 阶段、顺序断言、stages 入报告 |
| 真实 crash-point 矩阵 | **完成**：独立 worker，8/8 阶段真实 SIGKILL + control |
| 恢复重试 | **完成**：`restored` / `already-restored` 两态，独立 retry 进程 |
| 文件集证据 | **完成**：每阶段精确文件名 → SHA-256、integrity_check、内容读回 |
| ENOSPC | **NOT_RUN**：无安全小容量卷 |
| Windows/Vault/TeamSync/Updater/AppImage | **NOT_RUN / PARTIAL**（见下） |

## 2. 代码

| 文件 | 变更 |
| --- | --- |
| `process-lifecycle.mjs` | `termination`、`stdoutClosed`/`stderrClosed`、logError、`requireStopped`；`raceAfter` 清理超时计时器，不再让 30s 定时器拖住测试进程 |
| `process-lifecycle.test.mjs` | 10 项；就绪标记在 handler 注册后发布，already-exited/日志失败改为有界等待 |
| `quiescence.mjs` | 四事实、lsof DB 句柄、`requireQuiescent` |
| `quiescence.test.mjs` | 3 项，含真实文件句柄 |
| `recovery-state-machine.mjs` | 8 阶段与顺序断言；`crashPoint()` 仅保留为单元测试契约，Harness 已不再使用 |
| `restore-worker.mjs` | 独立进程执行 8 阶段恢复；`--crash-at` 自 SIGKILL；`retry` 收敛；可调用 `data-retention verify` |
| `restore-crash-matrix.mjs` | 8 阶段 + control 矩阵、PID 归属、精确文件集、retry 读回 |
| `restore-crash-matrix.test.mjs` | CI 门禁：矩阵全过才通过 |
| `upgrade-e2e.mjs` | `replaceWithBackup` 改为 spawn worker；`restore-backup` 场景执行矩阵并写 `restore crash matrix` |

## 3. 测试

- 本地脚本：`node --test scripts/verify-install/*.test.mjs`：**66 tests / 64 pass /
  2 skipped**（Node 22 跳过 Argon2；Node 24 CI 全跑）。
- 全部脚本（含 `scripts/*.test.mjs`）：**464 tests / 462 pass / 2 skipped / 0 fail**。
- `process-lifecycle.test.mjs`：10/10。
- `quiescence.test.mjs`：3/3（真实 lsof 文件句柄）。
- `recovery-state-machine.test.mjs`：3/3。
- `restore-crash-matrix.test.mjs`：1/1（内部 8 阶段 + control，约 4.3s）。
- `checkpoint-safety.test.mjs`：1/1（真实第二连接 busy）。
- 本机 normal 在最后一轮被共享 WKWebView localStorage 恢复状态污染（A 启动后
  直接 exit 0），CI fresh runner 不受该本地状态影响；不以本地失败掩盖 CI 结果。
- `051f8c6` 的 E2E `42030992498` **5/5 success**、CI `42031006776` **11/11 success**；
  本轮矩阵改动在 `051f8c6` 之后，最终 run 见第 7 节。

## 4. 15 项判定

| # | 判定 | 结果 | 依据 |
| --- | --- | --- | --- |
| 1 | `PHASE_9_5_4_ENGINEERING_COMPLETE` | **PARTIAL** | stop/quiescence/crash 矩阵/retry 完成；ENOSPC 与外部平台未做 |
| 2 | `PROCESS_STOP_FAIL_CLOSED` | **YES** | requireStopped + 10 项测试 + 所有路径 stopChecked |
| 3 | `PROCESS_RESOURCE_QUIESCENCE_VERIFIED` | **PARTIAL** | process/streams/lsof DB PASS；owned children/PTY/WebKit NOT_RUN |
| 4 | `REAL_CRASH_POINT_MATRIX_VERIFIED` | **YES** | 8/8 阶段独立 worker SIGKILL + control；PID/stage/文件集/重试全断言 |
| 5 | `SQLITE_RECOVERY_ATOMICITY_VERIFIED` | **YES（恢复协议）** | rename 前主 DB 始终为 live，rename 后为备份；无第三态；产品自动恢复仍 NOT_RUN |
| 6 | `RECOVERY_RETRY_VERIFIED` | **YES** | 崩溃后独立 retry：6 个阶段 `restored`，2 个阶段 `already-restored`，最终 integrity/content 通过 |
| 7 | `BUSY_CHECKPOINT_VERIFIED` | **YES** | 真实第二连接测试 |
| 8 | `ENOSPC_RECOVERY_VERIFIED` | **NOT_RUN** | 无安全小容量卷 |
| 9 | `WINDOWS_DISPOSABLE_PROFILE_VERIFIED` | **NOT_RUN** | 无真实一次性用户/VM |
| 10 | `WINDOWS_UPGRADE_E2E` | **NOT_RUN** | 未安装/升级 |
| 11 | `VAULT_APP_LEVEL_VERIFIED` | **NOT_RUN** | 无 app-level probe |
| 12 | `TEAM_SYNC_CLIENT_UPGRADE_VERIFIED` | **NOT_RUN** | 服务端 HTTP 已有，跨版本客户端未做 |
| 13 | `UPDATER_RUNTIME_E2E` | **NOT_RUN** | 只有静态 manifest |
| 14 | `READY_FOR_RC` | **NO** | Windows/ENOSPC/app-level Vault/跨版本同步/签名身份未闭合 |
| 15 | `READY_FOR_RELEASE` | **NO** | 同 RC，另加 updater/notarization/Authenticode |

## 5. 未完成与风险

- 进程组/WebKit/PTY 子进程 quiescence；
- 产品自身没有启动时自动恢复状态机（矩阵验证的是 Harness 恢复协议）；
- ENOSPC 小容量卷；
- Windows disposable、Vault app-level、Team Sync 跨版本、Updater 运行时；
- AppImage stock 启动；
- 签名/公证/身份迁移/RC/Release。

## 6. Phase 9.5.5 提示词

> 在 `feat/phase9-5-upgrade-integrity` 继续：
> 1) 建立安全 ENOSPC 小容量卷（VM 或独立挂载），覆盖备份/迁移/staged/
>    安装/重试；不得填满共享 runner 根分区。
> 2) 进程组/WebKit/PTY/quiescence 与 lsof 进程树确认。
> 3) Windows disposable VM/用户 NSIS A→B。
> 4) Vault smoke probe A/B app-level unlock/change_password/legacy verifier。
> 5) Team Sync A→B 真实客户端 fetch 链。
> 6) 隔离 updater 运行时链；如独立产品改动，拆独立 Draft PR。
> 7) 若实现产品启动时自动恢复，把本矩阵扩展为“产品进程真实崩溃 + 重启收敛”。
> 8) 改 `FINGERPRINT_PATHS` 则官方重采六份证据，保持 0 problem。

## 7. 最终验证

| 项 | 结果 |
| --- | --- |
| 本地脚本 | **464/462/2/0 fail**；verify-install 子集 **66/64/2** |
| 矩阵 CLI | 8/8 + control PASS（见 `real-crash-point-matrix.md`） |
| 代码提交 | 待推送 |
| Upgrade E2E | 待运行（改动后） |
| 普通 CI | 待运行（改动后） |
