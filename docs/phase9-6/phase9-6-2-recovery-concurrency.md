# Phase 9.6.2 — Migration Transaction & Recovery Concurrency Closure

> 日期：2026-11-06
> 分支：`feat/phase9-5-upgrade-integrity`（PR #8 Draft）
> 代码 HEAD：`7df9e3a`
> 证据 run：`42214762202`（源码指纹 `c138d564…`）

## 1. 审计发现与修复

| # | 缺陷 | 修复 |
| --- | --- | --- |
| 1 | `write_marker` 用 `read_marker(...).ok().flatten()`，损坏/无权限/未知版本的旧标记被当作“无标记”，新事务会覆盖它 | `read_marker` 增加 `validate_marker`：损坏、`version > 2`、v2 缺 targets/migrationId、v1 缺 target_columns 一律返回错误；`write_marker` 用 `?` 传播，绝不覆盖未知事务 |
| 2 | 备份失败无条件 `clear_marker()`，会删掉旧事务的标记 | `write_marker` 返回 `created`；只有本次创建标记时失败才回滚；合并到旧事务时保留其标记、快照和恢复证据 |
| 3 | `prune_old_snapshots` 只按数量和年龄删除，可能删掉活动标记引用的快照 | `active_snapshot` 读取标记；清理时固定保留该文件；标记不可读时跳过清理 |
| 4 | `RecoveryVerdict` 只保护内存裁决，不能阻止两个进程同时迁移/恢复 | 新增 `RecoveryLock`（OS 文件锁），启动存在标记时先加锁；备份命令加锁并持有到迁移完成；完成校验后释放；第二个实例 fail-closed |
| 5 | `getDb()` 先返回缓存/`initPromise` 再检查门禁，阻断后仍可用已缓存连接 | 门禁检查移到最前；`select()` 在 catch 中重新断言门禁，不再把拒绝吞成 `[]` |

## 2. 测试

- Rust `db_recovery` **9 项**：新增损坏标记不覆盖、合并保留首个快照、
  第二文件句柄无法取得锁、活动快照 pin（backup 测试）。
- 全量 Rust **313 passed**；Clippy `-D warnings`、fmt 通过。
- 前端新增 `connection-gate.test.ts` 4 项：缓存连接在 pending/blocked 时
  被拒、`select` 传播门禁拒绝、普通查询错误仍返回 `[]`；gate 测试 14 项。
- source-size 573 文件通过。
- CI 增加 `windows-latest` 的 `cargo test --lib db_recovery`：Windows job
  `127803321020` 实测 `9 passed; 0 failed`，含
  `windows_fs_tests::marker_roundtrip_and_directory_flush_on_windows`。

## 3. E2E 与证据

- E2E `42189361366`（`af33ea2`）**5/5 success**：macOS current/historical、
  Linux DEB/AppImage、Windows preflight 全绿；锁与标记改动未破坏正常迁移、
  中断恢复、corrupt 阻断。
- 最终 `7df9e3a` 仅增加 `cfg(windows)` 目录 flush 的 `ERROR_ACCESS_DENIED`
  处理（Windows 真实测试暴露），macOS/Linux 代码路径不变；Windows job
  `42191186517` 为 success。
- 证据：官方 `real-machine-matrix` run `42214762202`（`7df9e3a`）**3/3 success**，
  由 `fetch-verification-evidence.mjs --run-id 42214762202` 取回六份证据与
  `evidence-manifest.json`，新指纹 **`c138d564432bf41a535efb30cfe1fbd8cc82e22a8926bb7e3df55c10638a4ea4`**
  （debug `c7e65f0b…`、release `5c58296d…`），官方门禁 **0 problem**；
  raw log 归档于 `docs/verification/raw/42214762202/`。未手工改写旧 manifest。
- 上一次 CI `42191186517`（`7df9e3a`）为 **10/11**：仅
  `Repository gates` 因证据尚未提交而红，其余 10 个 job success；
  **不得把该 run 记成全绿**。

## 4. 判定

```text
CORRUPT_MARKER_FAIL_CLOSED=PASS
EXISTING_MARKER_PRESERVED_ON_BACKUP_FAILURE=PARTIAL
ACTIVE_SNAPSHOT_PINNING_VERIFIED=PASS
MIGRATION_TRANSACTION_OWNERSHIP_VERIFIED=PARTIAL
MULTI_PROCESS_RECOVERY_LOCK_VERIFIED=PARTIAL
CONCURRENT_STARTUP_SAFE=PARTIAL
DATABASE_GATE_CACHE_BYPASS_FIXED=PASS
TEAM_APPLICATION_SIGKILL_E2E=NOT_RUN
WINDOWS_NATIVE_RECOVERY_TESTS=PASS
WINDOWS_FILESYSTEM_RECOVERY_VERIFIED=PARTIAL
RECOVERY_VERDICT_PERSISTENCE_VERIFIED=PARTIAL
BACKUP_PROVENANCE_VERIFIED=PARTIAL
UPGRADE_E2E_VERIFIED=PASS
EVIDENCE_FINGERPRINT_VALID=PASS
PHASE_9_6_2_ENGINEERING_COMPLETE=PARTIAL
PR_8_INTEGRATION_READY=YES
READY_FOR_RC=NO
READY_FOR_RELEASE=NO
```

证据与限制：

| 判定 | 证据 |
| --- | --- |
| 损坏标记 fail-closed | `read_marker` + `validate_marker`；`a_corrupt_marker_is_never_overwritten_and_a_merge_keeps_the_first_snapshot`（Windows runner 同样通过） |
| 备份失败保留旧标记 | `write_marker` 返回 `created`，备份失败只回滚本次创建；已测合并语义，未对真实 `VACUUM INTO` 失败做命令级注入 → PARTIAL |
| 活动快照 pin | `active_snapshot` + `prune_old_snapshots(pinned)`；`a_pinned_snapshot_survives_pruning_even_when_it_is_the_oldest` |
| 事务所有权 | `created` 回滚 + 合并保留首个快照；无命令级 E2E 注入 → PARTIAL |
| 跨进程恢复锁 | `RecoveryLock`（OS 文件锁）；`a_second_handle_cannot_take_the_recovery_lock`；尚无两个真实进程同时启动的 E2E → PARTIAL |
| 并发启动安全 | 启动有标记时先加锁、第二实例 fail-closed；仅句柄级测试 → PARTIAL |
| 前端门禁缓存绕过 | `getDb` 先断言门禁；`select` 不再吞掉门禁拒绝；`connection-gate.test.ts` 4 项 |
| Team SIGKILL | 仅 Rust 状态机测试（`a_partial_team_migration_is_restored_without_losing_rows`），真实应用级 **NOT_RUN** |
| Windows 原生恢复测试 | windows-latest job `127803321020`：`cargo test --lib db_recovery` **9 passed / 0 failed**，含 Windows-only 目录 flush 测试 |
| Windows 文件系统恢复 | 目录 flush 容忍 `ERROR_INVALID_FUNCTION`/`ERROR_ACCESS_DENIED` 并有真实测试；完整文件系统矩阵与 NSIS A→B 仍 **NOT_RUN** → PARTIAL |
| 裁决持久化 | `RecoveryVerdict` + 只读 `db_recovery_status` + 显式 `db_recovery_retry`；未单独断言“不重新 diagnose” → PARTIAL |
| 备份 provenance | canonicalization 拒绝备份目录外符号链接/live DB、integrity、A schema；无独立 provenance E2E → PARTIAL |
| 升级 E2E | run `42189361366`（`af33ea2`）**5/5**；`7df9e3a` 仅 Windows-only 代码路径差异 |
| 证据指纹 | run `42214762202`，`docs/verification/evidence-manifest.json` 指纹 `c138d564…`，官方门禁 0 problem |
| 工程完成度 | 上述 PARTIAL/NOT_RUN 项仍在 → PARTIAL |
| PR #8 | 保持 Draft，未合并、未打 Tag、未发布 Release |

## 5. 未完成（不得写成 PASS）

- 两个真实进程并发启动/迁移/恢复的进程级 E2E；
- Team 应用级迁移 SIGKILL 端到端；
- Windows 完整文件系统矩阵（只读卷、reparse、NTFS 语义）与 NSIS A→B；
- Vault app-level 解锁、Team Sync 跨版本客户端、updater 运行时下载/安装/重启；
- 安装阶段 ENOSPC、Linux AppImage stock 启动。
