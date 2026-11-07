# Phase 9.6.1 — Recovery Safety Audit & Startup Gate Hardening

> 日期：2026-11-06
> 分支：`feat/phase9-5-upgrade-integrity`（PR #8 Draft）
> 代码 HEAD：`efb96aa`

## 1. 审计发现的真实缺陷

| # | 缺陷 | 影响 | 修复 |
| --- | --- | --- | --- |
| 1 | 启动门禁在 App 内部做条件渲染，`initializeTeam`/`hydrateFromDatabase`/工作区恢复等 hooks 与 effects 先于门禁注册并执行 | 恢复阻断时仍可能打开数据库（fail-open） | 新增 `StartupGate` 根组件，只有 allow 才挂载 App；业务 hooks 只在 App 内 |
| 2 | `fetchDbRecoveryStatus` 捕获异常返回 `null`，等同于正常启动 | Tauri 状态查询失败时 fail-open | `probeRecoveryStatus` 返回判别结果；Tauri 异常/非法对象一律 blocked；浏览器显式 nonTauri 分支 |
| 3 | 阻断集合漏掉 `RECOVERY_REQUIRED` | 需要恢复的数据库进入业务路径 | 只有 `HEALTHY`/`RECOVERED` 允许启动 |
| 4 | 前端可再次 diagnose 覆盖后端实际裁决（如 `RESTORE_INTERRUPTED`） | 失败状态被“重新查询”洗掉 | 后端 `RecoveryVerdict` 保存本次启动裁决；`db_recovery_status` 只读；新增 `db_recovery_retry` 显式重跑 |
| 5 | Team schema 调用 `ensurePreMigrationSnapshot` 却从不清理标记 | Team 迁移成功后永远残留 pending 标记 | Team 成功后调用 `database_migration_completed` |
| 6 | `TARGET_COLUMNS` 只有 hosts 两列 | Team 部分迁移会被当成 Core 完成 | 标记 v2：`targets[]` + `migrationId`，Core/Team 共用；v1 标记兼容 |
| 7 | 完成通知只信任前端 | 未验证 schema 就清除标记 | 后端校验所有目标列存在 + `integrity_check` 后才清除，否则保留标记 |
| 8 | `fsync_dir` 用 `File::open` 打开目录，Windows 上失败 | Windows 标记写入/恢复直接失败 | `cfg(windows)` 使用 `FILE_FLAG_BACKUP_SEMANTICS`；仅 `ERROR_INVALID_FUNCTION` 视为该卷不支持目录 flush 并记录 |

## 2. 实现要点

- `packages/frontend/src/startup-gate.tsx`：根启动门禁；`pending` 阶段不挂载任何业务组件；
  阻断界面显示脱敏 state/reason，仅提供 Retry（重新执行 `db_recovery_retry`）。
- `service/database/startup-gate.ts`：进程级状态机；`getDb()` 在 `pending`/`blocked`
  时直接抛错，形成 UI 之外的第二道门。
- `recovery-status.ts`：状态白名单校验；Tauri 异常 fail-closed；非 Tauri 分支显式放行。
- `src-tauri/src/db_recovery.rs`：
  - `MigrationMarker v2`：`snapshot_path`、`targets[{table,columns}]`、`migration_id`；
    写标记与已存在标记**合并**，不会让新迁移覆盖旧恢复点；
  - 启动判定按目标列统计 `present/total`：全部存在→验 integrity 后清标记；
    零存在→验 integrity 后视为未开始；部分存在→验证快照后恢复；
  - 完成校验 `verify_completion`：integrity + 所有目标列；失败保留标记；
  - Win32 目录 fsync 使用 backup-semantics 句柄；
  - `RecoveryVerdict` 持久化本次启动状态；`db_recovery_retry` 显式重跑并更新。

## 3. 测试

- Rust：`db_recovery` **6 项**（fresh、部分 Core 恢复、缺失快照不覆盖、完成后幂等、
  完成守卫拒绝部分目标、Team 部分迁移恢复并保留业务行）；全量 **309 passed**；
  Clippy `-D warnings`、fmt 通过。
- 前端：`startup-gate.test.tsx` **14 项**（9 种阻断/允许状态、Tauri 失败 fail-closed、
  非 Tauri 放行、Retry、StrictMode 双执行）；关键测试 45/45；typecheck、ESLint、
  bundle budget 通过。
- E2E：待最终 run 回写（含 corrupt 场景在新门禁下的真实行为）。

## 4. 判定

```text
STARTUP_RECOVERY_GATE_FAIL_CLOSED=PASS
BUSINESS_SQL_BLOCKED_DURING_RECOVERY=PASS
RECOVERY_VERDICT_PERSISTENCE_VERIFIED=PARTIAL
CORE_MIGRATION_RECOVERY_VERIFIED=PASS
TEAM_MIGRATION_RECOVERY_VERIFIED=PARTIAL
MIGRATION_MARKER_PROTOCOL_VERIFIED=PASS
MIGRATION_COMPLETION_GUARD_VERIFIED=PASS
BACKUP_PROVENANCE_VERIFIED=PARTIAL
RECOVERY_CRASH_SAFETY_VERIFIED=PASS
MULTI_INSTANCE_RECOVERY_SAFE=NOT_RUN
WINDOWS_FILESYSTEM_RECOVERY_VERIFIED=PARTIAL
UPGRADE_E2E_VERIFIED=PASS
EVIDENCE_FINGERPRINT_VALID=PASS
PHASE_9_6_1_ENGINEERING_COMPLETE=PARTIAL
PR_8_INTEGRATION_READY=YES
READY_FOR_RC=NO
READY_FOR_RELEASE=NO
```

证据：

| 判定 | 证据 |
| --- | --- |
| 启动门禁 fail-closed | `startup-gate.test.tsx` 14 项（9 状态 + Tauri 失败 + 非 Tauri + Retry + StrictMode）；`getDb` 守卫 |
| 业务 SQL 阻断 | 阻断状态不挂载 App；`connection.ts` 在 pending/blocked 抛错 |
| 裁决持久化 | `RecoveryVerdict` + `db_recovery_status` 只读 + `db_recovery_retry`；E2E 启动读取同一裁决。未单独断言“不重新 diagnose”，故 PARTIAL |
| Core 恢复 | Rust `a_partial_migration_is_restored...`；E2E `42179513200`（`efb96aa`）interrupted `product recovery=PASS` |
| Team 恢复 | Rust `a_partial_team_migration_is_restored_without_losing_rows`（真实 SQLite，业务行保留）；真实 Team 应用迁移 SIGKILL **NOT_RUN** |
| 标记协议 | v2 targets/migrationId、合并写入、v1 兼容；Rust 6 项测试 |
| 完成守卫 | `completion_guard_rejects_a_partial_target_set_and_keeps_the_marker` |
| 备份 provenance | 备份目录边界、非 live、integrity、A schema；canonicalize/symlink 攻击面未单测 → PARTIAL |
| crash safety | `restore-crash-matrix` 8/8 + E2E interrupted |
| 多实例 | **NOT_RUN**（无恢复锁/并发启动测试） |
| Windows FS | `cfg(windows)` backup-semantics + only ERROR_INVALID_FUNCTION tolerated + Windows-only test；未在 windows runner 执行 cargo test → PARTIAL |
| E2E | run `42179513200`（`efb96aa`）**5/5**；corrupt/interrupted 均通过 |
| 证据指纹 | run `42179506989`，`docs/verification/evidence-manifest.json` `3fd0148a…`，门禁 0 problem |

