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

- Rust `db_recovery` **28 项**，新增 runtime lock 双句柄/真实双进程、标记消失、
  重复完成、迟到回调、外部删除；全量 **332 passed**；fmt/Clippy 通过。
- 真实单实例 E2E：`scripts/verify-install/single-instance-e2e.mjs`（macOS CI，
  三次启动：首次存活 → 第二次被拒并激活首进程 → 杀首进程后第三次成功）。

## 2. WP1 — Windows NSIS

- 共享 `windows-latest` 只运行隔离状态机与原生进程树探针，并**证明共享 profile
  不满足隔离**（`Prove the shared runner profile fails closed`，run
  `42337739253` 的 Windows job）。
- 一次性 Windows VM / 独立 SID 环境不可用：NSIS A→B、卸载边界保持
  **BLOCKED_EXTERNAL**；未在共享 runner 上执行破坏性安装。

## 3. WP2 — Vault app-level

- 现有 Rust `VaultState`/Node Argon2id fixture 覆盖创建、解锁、错误密码、
  改密、旧 verifier 兼容与篡改拒绝。
- 本轮未建立 UI 自动化（WebDriver/tauri-driver）路径，无法证明
  UI → Tauri command → VaultState → 文件 的完整链路；
  `VAULT_APP_LEVEL_VERIFIED=NOT_RUN`。

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
MAIN_BASELINE_VERIFIED=PASS
SINGLE_INSTANCE_VERIFIED=待 E2E
ACTIVE_INSTANCE_DATABASE_ISOLATION_VERIFIED=待 E2E
MIGRATION_COMPLETION_GUARD_VERIFIED=PASS

WINDOWS_DISPOSABLE_ENV_VERIFIED=PARTIAL
WINDOWS_NSIS_A_TO_B_VERIFIED=BLOCKED_EXTERNAL
WINDOWS_UNINSTALL_BOUNDARY_VERIFIED=NOT_RUN

VAULT_APP_LEVEL_VERIFIED=NOT_RUN
VAULT_PASSWORD_ROTATION_VERIFIED=PARTIAL
VAULT_A_TO_B_VERIFIED=NOT_RUN

TEAM_SYNC_REAL_HTTP_VERIFIED=PASS
TEAM_SYNC_CROSS_VERSION_VERIFIED=NOT_RUN
TEAM_SYNC_DIRTY_RETRY_VERIFIED=PARTIAL
TEAM_SYNC_CONFLICT_SAFETY_VERIFIED=PARTIAL

UPDATER_SIGNED_RUNTIME_VERIFIED=NOT_RUN
UPDATER_DOWNLOAD_INSTALL_RESTART_VERIFIED=NOT_RUN
UPDATER_NEGATIVE_CASES_VERIFIED=NOT_RUN

LINUX_APPIMAGE_STOCK_STARTUP_VERIFIED=NOT_RUN
INSTALL_ENOSPC_RECOVERY_VERIFIED=PARTIAL
SECURITY_RELEASE_BLOCKERS=OPEN
IDENTITY_MIGRATION_READY=NO
OS_SIGNING_READY=BLOCKED_EXTERNAL

EVIDENCE_FINGERPRINT_VALID=待重采
CI_ALL_GREEN=待最终 CI
PHASE_9_7_ENGINEERING_COMPLETE=PARTIAL
READY_FOR_RC=NO
READY_FOR_RELEASE=NO
```

## 8. 未完成与 Phase 9.8 建议

1. Windows 一次性 VM：SID/Profile/Known Folder/ACL 证明 + NSIS A→B + 卸载边界。
2. Vault：tauri-driver/WebDriver 或等价 UI 自动化，覆盖创建/锁定/解锁/改密/重启/升级。
3. Team Sync：历史客户端二进制 × 当前客户端的真实双版本链（含 dirty row、
   409/428、tombstone、断网重试）。
4. Updater：测试密钥 + loopback + 真实下载/验签/安装/重启，再扩展负向用例。
5. Linux AppImage stock 启动与安装/fsync ENOSPC 矩阵。
6. 正式签名/公证、identity 迁移决策、RSA advisory 处置。
