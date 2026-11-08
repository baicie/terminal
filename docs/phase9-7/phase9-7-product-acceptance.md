# Phase 9.7 — Cross-Platform Product Acceptance & RC Hardening

> 日期：2026-11-07
> 分支：`feat/phase9-7-product-acceptance`（Draft PR #9）
> 基线：`main` = `3b23e8c`；main CI `42337739277` 11/11；main Upgrade E2E
> `42337739253` 5/5

## 1. WP0 — 单实例与数据库访问安全（本轮已完成代码）

### 决策

同一用户数据目录只允许一个应用进程。采用 Tauri 官方
`tauri-plugin-single-instance v2.5.5`（首个注册插件），第二次启动由第一个
进程接管并激活窗口，第二个进程退出。插件之外再加一层**进程生命周期
`instance.lock`**：在 `setup` 中、任何数据库/恢复访问之前获取，失败则返回
`ManualInterventionRequired`，启动门禁阻断数据库。两层分别覆盖 IPC 与直接
二进制启动。

- 插件初始化位于 `tauri::Builder::default()` 的第一个 `.plugin(...)`，早于
  窗口、SQL、恢复状态机与 `setup`。
- 窗口被托盘关闭但进程存活时，激活回调按 `tauri.conf.json` 重建 `main` 窗口。
- 不同数据目录使用各自的 `instance.lock`；插件按 identifier 识别实例，
  因此同一构建的多个数据目录仍会被视为同一实例——本轮不提供自定义数据目录。
- 测试观察点：`TERMINAL_SINGLE_INSTANCE_ACTIVATION_PATH` 仅记录“第一进程处理了
  第二次启动”，不改变生产行为。

### verify_completion 负向语义

`CompletionLedger` 记录本进程已验证完成的 transaction id：

| 场景 | 结果 |
| --- | --- |
| 标记不存在 + 非空 transaction id + 无完成记录（外部删除） | `Err`，不释放锁 |
| 标记不存在 + 已记录完成（重复回调） | `Ok(true)`，幂等 |
| 标记不存在 + 无 transaction id（旧调用） | `Ok(false)` |
| 迟到的旧事务回调 + 标记属于新事务 | `Err`，标记保留 |
| 目标列不齐 / integrity 失败 | `Err`，标记保留 |

### 测试

- Rust `db_recovery` **32 项**，新增 runtime lock 双句柄/真实双进程/inode 失效、
  Retry 绕过、标记消失、重复完成、迟到回调、外部删除；全量 **336 passed**；
  fmt/Clippy 通过。
- 真实单实例 E2E：`scripts/verify-install/single-instance-e2e.mjs`（macOS CI，
  从 B DMG 安装，三次启动：首次存活 → 第二次被拒并激活首进程 → SIGKILL 后
  第三次取得锁并真实读写数据库）。

### 证据

官方 `real-machine-matrix` run `42447284830`（`2695f5c`）**3/3 success**，
六份证据指纹 **`32729825…`**（debug `133c8daa…`、release `8b8c2e5d…`），
`check-verification-evidence.mjs` **0 problem**；raw log 归档
`docs/verification/raw/42447284830/`。未手工修改 manifest。此前一轮
`42441960278`（`9bad962`，指纹 `4bbee997…`）因 vault 并发创建修复改动了
`src-tauri/src` 而按规则失效（更早的 `42437603925` 因路由预加载、
`42355653387` 因 Vault Escape 修复失效），本轮是重采，不是把旧证据改到新
源码上。

Upgrade E2E [`42356452096`](https://github.com/baicie/terminal/actions/runs/42356452096)
（`49e9903`）**5/5 success**；证据与 Vault Escape 修复后的最终 HEAD
`64db332` 上 Upgrade E2E
[`42365420354`](https://github.com/baicie/terminal/actions/runs/42365420354)
同为 **5/5 success**（单实例与 Vault 步骤 PASS）。证据提交后的 HEAD `8adff85` 上 CI
[`42357395943`](https://github.com/baicie/terminal/actions/runs/42357395943)
**11/11 success**（含 `Repository gates` 的证据门禁）。

P0-A.2 的证据采集源码为 `5e8ce13`；`49e9903` 仅修单实例 E2E 的 SQLite
`busy_timeout`，不在证据指纹路径内。

## 2. WP1 — Windows NSIS

- 共享 `windows-latest` 只运行隔离状态机与原生进程树探针，并**证明共享 profile
  不满足隔离**（`Prove the shared runner profile fails closed`，run
  `42337739253` 的 Windows job）。
- 一次性 Windows VM / 独立 SID 环境不可用：NSIS A→B、卸载边界保持
  **BLOCKED_EXTERNAL**；未在共享 runner 上执行破坏性安装。

## 3. WP2 — Vault app-level

- smoke 构建内的 `VaultService` probe（编译期 + 隔离目录标记双重门控）覆盖
  创建、写入秘密、锁定、错误密码、解锁、读取、改密、旧密码失效、新密码读取；
  第二次启动验证重启持久化。详见 `docs/phase9-7/vault-app-e2e.md`。
- 这是**服务级**应用链路（frontend service → Tauri command → VaultState → 文件），
  不是 UI 自动化；UI 点击仍标 NOT_RUN。
- A→B 跨版本 Vault 无历史可插桩 A 构建，标 NOT_RUN。

## 4. WP3 — Team Sync 跨版本

- 现有 full AppModule + 真实 Nest HTTP + 真实 PostgreSQL + 真实客户端
  store/SQLite 的 PG E2E 持续在 CI 运行（`Team Server quality`）。
- 历史客户端二进制与当前客户端的双版本链本轮未构建：
  `TEAM_SYNC_CROSS_VERSION_VERIFIED=NOT_RUN`；dirty/冲突/重试语义由现有 PG
  E2E 覆盖，标 PARTIAL。

## 5. WP4 — Updater runtime

- `tauri.conf.json` 仍是占位 `pubkey`；未生成测试签名密钥、loopback 更新服务
  与 A/B 运行时安装链。
- `UPDATER_SIGNED_RUNTIME_VERIFIED=NOT_RUN`、
  `UPDATER_DOWNLOAD_INSTALL_RESTART_VERIFIED=NOT_RUN`、
  `UPDATER_NEGATIVE_CASES_VERIFIED=NOT_RUN`；正式签名/公证继续
  **BLOCKED_EXTERNAL**。

## 6. WP5 — Linux / ENOSPC / 发布安全

- AppImage 仍为 payload-only；stock 启动受 headless WebKit/EGL 阻断，
  `LINUX_APPIMAGE_STOCK_STARTUP_VERIFIED=NOT_RUN`。
- 迁移 disk-full 与 staged restore ENOSPC 已 PASS（Phase 9.5.5）；
  安装器/fsync/目录 flush ENOSPC 未测，`INSTALL_ENOSPC_RECOVERY_VERIFIED=PARTIAL`。
- 安全基线仍为 13 条 advisory（1 条三平台真实、上游无修复）；
  `SECURITY_RELEASE_BLOCKERS=OPEN`，不把 baseline 当作已修复。

## 7. 判定

```text
SINGLE_INSTANCE_PLUGIN_REGISTERED=PASS
RUNTIME_LOCK_ACQUIRED_BEFORE_DATABASE=PASS
RUNTIME_LOCK_RETRY_BYPASS_BLOCKED=PASS
SECOND_PROCESS_ACTIVATES_FIRST=PASS
SECOND_PROCESS_DATABASE_ACCESS_BLOCKED=PASS
SIGKILL_RELEASES_RUNTIME_LOCK=PASS
THIRD_PROCESS_REAL_STARTUP_VERIFIED=PASS
TRAY_WINDOW_REACTIVATION_VERIFIED=NOT_RUN
COMPLETION_LEDGER_NEGATIVE_CASES=PASS
SINGLE_INSTANCE_REAL_E2E_VERIFIED=PASS

RUNTIME_LOCK_CACHED_CONNECTION_SAFE=PASS
RUNTIME_LOCK_INFLIGHT_INIT_SAFE=PASS
RUNTIME_LOCK_FILE_REPLACEMENT_SAFE=PASS
RUNTIME_LOCK_WINDOWS_IDENTITY_VERIFIED=PARTIAL
DIRECT_PLUGIN_SQL_TRUST_BOUNDARY_DOCUMENTED=PASS
RUNTIME_LOCK_RETRY_BYPASS_BLOCKED=PASS

VAULT_PROBE_PRODUCTION_DISABLED=PASS
VAULT_APP_LEVEL_UNLOCK_VERIFIED=PASS
VAULT_PASSWORD_ROTATION_VERIFIED=PASS
VAULT_RESTART_PERSISTENCE_VERIFIED=PASS
VAULT_CROSS_VERSION_VERIFIED=NOT_RUN

TEAM_REAL_SERVER_HTTP_VERIFIED=PASS
TEAM_REAL_CLIENT_RUNTIME_VERIFIED=PASS
TEAM_CROSS_VERSION_A_TO_B_VERIFIED=FAIL
TEAM_CROSS_VERSION_DIRTY_ROW_UPGRADE=PASS
TEAM_CROSS_VERSION_TOMBSTONE_CONSUMED=FAIL
TEAM_CROSS_VERSION_UPDATE_SAFETY=PASS
TEAM_DIRTY_RETRY_VERIFIED=PARTIAL
TEAM_CONFLICT_SAFETY_VERIFIED=PARTIAL
TEAM_DELETE_PROPAGATION_VERIFIED=PARTIAL

UPDATER_RUNTIME_CHECK_VERIFIED=PASS
UPDATER_SIGNED_DOWNLOAD_VERIFIED=PASS
UPDATER_INSTALL_RESTART_VERIFIED=PASS
UPDATER_DATA_PRESERVATION_VERIFIED=PASS
UPDATER_NEGATIVE_MATRIX_VERIFIED=PASS
UPDATER_PLATFORM_SCOPE=macOS-arm64

UPGRADE_E2E_CURRENT_HEAD=PASS
EVIDENCE_FINGERPRINT_VALID=PASS
CI_ALL_GREEN=PASS
PHASE_9_7_P0_A_COMPLETE=PARTIAL
PR_9_READY_FOR_REVIEW=NO
READY_FOR_RC=NO
READY_FOR_RELEASE=NO
```

## WP3 — Team Sync 跨版本（本轮新增）

`scripts/verify-install/team-cross-version.mjs` 以两个独立客户端进程 + 独立服务端
进程跑真实 HTTP/PG/SQLite：A 是 `v0.0.1-dev.2` 的源码（固定 commit `835fae82…`），
B 是当前 HEAD。A 首次推送与拉取 PASS，当前客户端在 A 数据库上升级并推送脏行 PASS；
**A 的第二次同步 FAIL**：服务端把毫秒游标当作超出安全水位并返回全量窗口，
历史客户端用裸 `INSERT` 应用快照，重复 share 触发 `UNIQUE constraint failed`。
详见 [team-sync-cross-version.md](team-sync-cross-version.md)。

## WP4 — Updater 运行时（本轮新增）

`src-tauri/src/updater_probe.rs`（`smoke-updater` feature，生产构建不编译）补齐
check → download → minisign 验签 → install → restart；`updater-e2e.mjs` 用临时密钥、
loopback HTTP 与两次真实构建跑 9 个用例：正向安装并重启为 B、数据保留、7 个负向
（降级、错误架构、404、缺签名、错签名、篡改、截断）全部按预期拒绝且不产生半安装。
macOS arm64 通过；Windows NSIS/Linux AppImage 运行时与正式签名仍 NOT_RUN/BLOCKED_EXTERNAL。
详见 [updater-runtime.md](updater-runtime.md)。

## 产品缺陷修复（本轮）

- **路由切换闪烁**：`RouteTransition` 用 effect 更新 key 导致新页面先挂载再重挂；
  改为同步按 pathname 设 key、外层加不透明背景、动画只作用于内层内容（避免位移
  暴露背后的终端层）。回归测试见 `route-transition.test.tsx`。Issue #195。

## 相关文档

- [single-instance-e2e.md](single-instance-e2e.md)
- [vault-app-e2e.md](vault-app-e2e.md)
- [session-lock-safety.md](session-lock-safety.md)
- [team-sync-cross-version.md](team-sync-cross-version.md)
- [updater-runtime.md](updater-runtime.md)
- [rc-readiness.md](rc-readiness.md)

## 8. 未完成与 Phase 9.8 建议

1. Windows 一次性 VM：SID/Profile/Known Folder/ACL 证明 + NSIS A→B + 卸载边界。
2. Vault：tauri-driver/WebDriver 或等价 UI 自动化，覆盖创建/锁定/解锁/改密/重启/升级。
3. Team Sync：历史客户端二进制 × 当前客户端的真实双版本链（含 dirty row、
   409/428、tombstone、断网重试）。
4. Updater：测试密钥 + loopback + 真实下载/验签/安装/重启，再扩展负向用例。
5. Linux AppImage stock 启动与安装/fsync ENOSPC 矩阵。
6. 正式签名/公证、identity 迁移决策、RSA advisory 处置。
