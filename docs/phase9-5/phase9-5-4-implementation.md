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
| 进程/DB quiescence | **PASS（macOS/Linux）**：process/streams/process-tree/lsof DB 四事实；E2E 10 份报告全 PASS；Windows NOT_RUN |
| 恢复状态机 | **完成**：8 阶段、顺序断言、stages 入报告 |
| 真实 crash-point 矩阵 | **完成**：独立 worker，8/8 阶段真实 SIGKILL + control |
| 恢复重试 | **完成**：`restored` / `already-restored` 两态，独立 retry 进程 |
| 文件集证据 | **完成**：每阶段精确文件名 → SHA-256、integrity_check、内容读回 |
| ENOSPC | **PARTIAL**：真实 64 MB DMG 上 staged restore 失败后主库不变、retry 收敛；备份 VACUUM/migration/安装 ENOSPC NOT_RUN |
| Windows/Vault/TeamSync/Updater/AppImage | **NOT_RUN / PARTIAL**（见下） |

## 2. 代码

| 文件 | 变更 |
| --- | --- |
| `process-lifecycle.mjs` | `termination`、`stdoutClosed`/`stderrClosed`、logError、`requireStopped`；`raceAfter` 清理超时计时器，不再让 30s 定时器拖住测试进程 |
| `process-lifecycle.test.mjs` | 10 项；就绪标记在 handler 注册后发布，already-exited/日志失败改为有界等待 |
| `quiescence.mjs` | 四事实、`snapshotDescendants`/`settledChildren`、lsof DB 句柄、异步 `requireQuiescent` |
| `quiescence.test.mjs` | 4 项，含真实 lsof 句柄与父子进程泄漏 |
| `recovery-state-machine.mjs` | 8 阶段与顺序断言；`crashPoint()` 仅保留为单元测试契约，Harness 已不再使用 |
| `restore-worker.mjs` | 独立进程执行 8 阶段恢复；`--crash-at` 自 SIGKILL；`retry` 收敛；可调用 `data-retention verify` |
| `restore-crash-matrix.mjs` | 8 阶段 + control 矩阵、PID 归属、精确文件集、retry 读回 |
| `restore-crash-matrix.test.mjs` | CI 门禁：矩阵全过才通过 |
| `upgrade-e2e.mjs` | `replaceWithBackup` 改为 spawn worker；`restore-backup` 场景执行矩阵并写 `restore crash matrix` |

## 3. 测试

- 本地脚本：`node --test scripts/verify-install/*.test.mjs`：**67 tests / 65 pass /
  2 skipped**（Node 22 跳过 Argon2；Node 24 CI 全跑）。
- 全部脚本（含 `scripts/*.test.mjs`）：**465 tests / 463 pass / 2 skipped / 0 fail**。
- `process-lifecycle.test.mjs`：10/10。
- `quiescence.test.mjs`：4/4（真实 lsof 句柄 + 父子进程泄漏探针）。
- `recovery-state-machine.test.mjs`：3/3。
- `restore-crash-matrix.test.mjs`：1/1（内部 8 阶段 + control，约 4.3s）。
- `enospc-recovery.test.mjs`：1/1（真实 64 MB DMG；Linux 无 sudo 时显式 skip）。
- `checkpoint-safety.test.mjs`：1/1（真实第二连接 busy）。
- 本机 normal 在最后一轮被共享 WKWebView localStorage 恢复状态污染（A 启动后
  直接 exit 0），CI fresh runner 不受该本地状态影响；不以本地失败掩盖 CI 结果。
- `051f8c6` 的 E2E `42030992498` **5/5 success**、CI `42031006776` **11/11 success**。
- `d4b7759`（独立 worker + Harness 接入）的 E2E `42035362763` **5/5 success**、
  CI `42035362783` **11/11 success**；macOS current 报告中的
  `restore crash matrix` 为 **PASS**，8 条记录 PID 30001–30038、
  `signal=SIGKILL`、`code=null`，`postCrashFiles` 与 retry 结果与第 3 节一致。
- `b069beb`（ENOSPC）的 Linux tmpfs 路径已在本地 privileged 容器
  （Node 24.18）实测 **PASS**。
- `df57c0c`（含最终代码 `b069beb`）的 E2E `42037724319` **5/5 success**、CI `42037724332`
  **11/11 success**；macOS 报告矩阵仍 **PASS**；ubuntu `Repository gates`
  真实执行 ENOSPC 测试并 **PASS**（457 ms），不是 skip。

## 4. 15 项判定

| # | 判定 | 结果 | 依据 |
| --- | --- | --- | --- |
| 1 | `PHASE_9_5_4_ENGINEERING_COMPLETE` | **PARTIAL** | stop/quiescence/crash 矩阵/retry 完成；ENOSPC 仅 staged restore，外部平台未做 |
| 2 | `PROCESS_STOP_FAIL_CLOSED` | **YES** | requireStopped + 10 项测试 + 所有路径 stopChecked |
| 3 | `PROCESS_RESOURCE_QUIESCENCE_VERIFIED` | **YES（macOS/Linux）** | 四事实全 PASS：PROCESS_EXITED/STREAMS_CLOSED/OWNED_CHILDREN_SETTLED/DB_HANDLES_RELEASED；E2E `42047193259` 的 10 份报告均 PASS；Windows NOT_RUN |
| 4 | `REAL_CRASH_POINT_MATRIX_VERIFIED` | **YES** | 8/8 阶段独立 worker SIGKILL + control；PID/stage/文件集/重试全断言 |
| 5 | `SQLITE_RECOVERY_ATOMICITY_VERIFIED` | **YES（恢复协议）** | rename 前主 DB 始终为 live，rename 后为备份；无第三态；产品自动恢复仍 NOT_RUN |
| 6 | `RECOVERY_RETRY_VERIFIED` | **YES** | 崩溃后独立 retry：6 个阶段 `restored`，2 个阶段 `already-restored`，最终 integrity/content 通过 |
| 7 | `BUSY_CHECKPOINT_VERIFIED` | **YES** | 真实第二连接测试 |
| 8 | `ENOSPC_RECOVERY_VERIFIED` | **PARTIAL** | staged restore 与产品迁移两路径均 PASS（64 MB DMG）；安装 B/目录 fsync NOT_RUN，迁移失败点未归因到具体错误码 |
| 9 | `WINDOWS_DISPOSABLE_PROFILE_VERIFIED` | **NOT_RUN** | 无真实一次性用户/VM |
| 10 | `WINDOWS_UPGRADE_E2E` | **NOT_RUN** | 未安装/升级 |
| 11 | `VAULT_APP_LEVEL_VERIFIED` | **NOT_RUN** | 无 app-level probe |
| 12 | `TEAM_SYNC_CLIENT_UPGRADE_VERIFIED` | **NOT_RUN** | 服务端 HTTP 已有，跨版本客户端未做 |
| 13 | `UPDATER_RUNTIME_E2E` | **NOT_RUN** | 只有静态 manifest |
| 14 | `READY_FOR_RC` | **NO** | Windows/部分 ENOSPC/app-level Vault/跨版本同步/签名身份未闭合 |
| 15 | `READY_FOR_RELEASE` | **NO** | 同 RC，另加 updater/notarization/Authenticode |

## 5. 未完成与风险

- Windows 没有 pgrep，进程树事实在 Windows 上仍 NOT_RUN；
- 产品自身没有启动时自动恢复状态机（矩阵验证的是 Harness 恢复协议）；
- 备份 VACUUM/migration/安装阶段 ENOSPC（staged restore 已在隔离卷验证）；
- Windows disposable、Vault app-level、Team Sync 跨版本、Updater 运行时；
- AppImage stock 启动；
- 签名/公证/身份迁移/RC/Release。

## 6. Phase 9.5.5 提示词

> 在 `feat/phase9-5-upgrade-integrity` 继续：
> 1) 补齐备份 VACUUM/migration/安装阶段 ENOSPC（staged restore 已在 64 MB
>    隔离卷验证）；不得填满共享 runner 根分区。
> 2) Windows 进程树 quiescence（无 pgrep）与 Windows E2E。
> 3) Windows disposable VM/用户 NSIS A→B。
> 4) Vault smoke probe A/B app-level unlock/change_password/legacy verifier。
> 5) Team Sync A→B 真实客户端 fetch 链。
> 6) 隔离 updater 运行时链；如独立产品改动，拆独立 Draft PR。
> 7) 若实现产品启动时自动恢复，把本矩阵扩展为“产品进程真实崩溃 + 重启收敛”。
> 8) 改 `FINGERPRINT_PATHS` 则官方重采六份证据，保持 0 problem。

## 7. 最终验证

| 项 | 结果 |
| --- | --- |
| 本地脚本 | **465/463/2/0 fail**；verify-install 子集 **67/65/2** |
| 矩阵 CLI | 8/8 + control PASS（见 `real-crash-point-matrix.md`） |
| ENOSPC | 真实 64 MB DMG PASS（见 `enospc-verification.md`） |
| 代码提交 | `b069beb`（文档 HEAD `df57c0c`） |
| Upgrade E2E | `42037724319` **5/5 success** @ `df57c0c`；矩阵 check **PASS** |
| 普通 CI | `42037724332` **11/11 success** @ `df57c0c` |
| ENOSPC | macOS 64 MB DMG **PASS**；Linux privileged 容器 **PASS**；ubuntu runner tmpfs 457 ms **PASS** |
