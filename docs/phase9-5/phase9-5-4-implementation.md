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
| 进程/DB quiescence | **PARTIAL**：process/streams/lsof DB 句柄；进程树 NOT_RUN |
| 恢复状态机 | **完成**：8 阶段、顺序断言、stages 入报告 |
| 真实 crash-point 矩阵 | **NOT_RUN**：仍是同进程异常 hook |
| 恢复重试 | **NOT_RUN** |
| ENOSPC | **NOT_RUN** |
| Windows/Vault/TeamSync/Updater/AppImage | **NOT_RUN / PARTIAL**（见下） |

## 2. 代码

| 文件 | 变更 |
| --- | --- |
| `process-lifecycle.mjs` | `termination`、`stdoutClosed`/`stderrClosed`、logError、`requireStopped` |
| `process-lifecycle.test.mjs` | 9 项，包括 clean-exit、SIGTERM、forced、日志失败、严格门禁 |
| `quiescence.mjs` | 四事实、lsof DB 句柄、`requireQuiescent` |
| `quiescence.test.mjs` | 3 项，含真实文件句柄 |
| `recovery-state-machine.mjs` | 8 阶段、crash point hook |
| `upgrade-e2e.mjs` | `stopChecked` 全路径、A/B/恢复/降级 quiescence、stages |

## 3. 测试

- 本地脚本：`node --test scripts/verify-install/*.test.mjs`，60+ 项中 2 项
  Argon2 在 Node 22 跳过；Node 24 CI 全跑。
- `process-lifecycle.test.mjs`：9/9。
- `quiescence.test.mjs`：3/3（真实 lsof 文件句柄）。
- `recovery-state-machine.test.mjs`：3/3。
- `checkpoint-safety.test.mjs`：1/1（真实第二连接 busy）。
- 本机 normal 在最后一轮被共享 WKWebView localStorage 恢复状态污染（A 启动后
  直接 exit 0），CI fresh runner 不受该本地状态影响；不以本地失败掩盖 CI 结果。

## 4. 15 项判定

| # | 判定 | 结果 | 依据 |
| --- | --- | --- | --- |
| 1 | `PHASE_9_5_4_ENGINEERING_COMPLETE` | **PARTIAL** | stop/quiescence/状态机完成；真实 crash 矩阵/ENOSPC 未做 |
| 2 | `PROCESS_STOP_FAIL_CLOSED` | **YES** | requireStopped + 9 项测试 + 所有路径 stopChecked |
| 3 | `PROCESS_RESOURCE_QUIESCENCE_VERIFIED` | **PARTIAL** | process/streams/lsof DB PASS；owned children NOT_RUN |
| 4 | `REAL_CRASH_POINT_MATRIX_VERIFIED` | **NOT_RUN** | 仍是 JS 异常 hook，未独立 worker/SIGKILL |
| 5 | `SQLITE_RECOVERY_ATOMICITY_VERIFIED` | **PARTIAL** | 顺序/checkpoint/staged 校验；crash 边界未执行 |
| 6 | `RECOVERY_RETRY_VERIFIED` | **NOT_RUN** | 未在 crash 后重试 |
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

- 独立 recovery worker + 8 阶段真实 terminate/kill；
- crash 后恢复重试、文件集合 SHA、A/B 读回；
- 进程组/WebKit/PTY 子进程 quiescence；
- ENOSPC 小容量卷；
- Windows disposable、Vault app-level、Team Sync 跨版本、Updater 运行时；
- AppImage stock 启动；
- 签名/公证/身份迁移/RC/Release。

## 6. Phase 9.5.5 提示词

> 在 `feat/phase9-5-upgrade-integrity` 继续：
> 1) 实现独立 recovery worker（真实进程），父进程按 8 个 stage marker 发
>    SIGKILL/exit；每次从独立 fixture 开始，记录 PID、stage、DB/WAL/SHM/备份
>    SHA、integrity、恢复重试与 A/B 读回。
> 2) 在 crash 后执行恢复重试，验证幂等、备份保留、无数据丢失。
> 3) 建立安全 ENOSPC 小容量卷（VM 或独立挂载），覆盖备份/迁移/staged/
>    安装/重试；不得填满共享 runner 根分区。
> 4) 进程组/WebKit/PTY/quiescence 与 lsof 进程树确认。
> 5) Windows disposable VM/用户 NSIS A→B。
> 6) Vault smoke probe A/B app-level unlock/change_password/legacy verifier。
> 7) Team Sync A→B 真实客户端 fetch 链。
> 8) 隔离 updater 运行时链；如独立产品改动，拆独立 Draft PR。
> 9) 改 `FINGERPRINT_PATHS` 则官方重采六份证据，保持 0 problem。
