# Phase 9.6.3 — Final Recovery Safety Closure & Phase 9.7 Entry Gate

> 日期：2026-11-07
> 分支：`feat/phase9-5-upgrade-integrity`（PR #8 Draft）
> 代码 HEAD：`65299c8`（最终 E2E 构建点；证据矩阵在 `151c990` 上采集，两者仅差 `scripts/verify-install`，不在证据指纹内）
> 基线：PR #7 `00715d6`（Open）、PR #8 `bc49d66`（Draft）、证据指纹 `c138d564…`

## 1. 实际复现的缺陷

### P0-A 迁移标记事务所有权

原实现 `write_marker` 在已有标记时把新 `targets` 合并进旧事务并**先写回**，
再执行本次 `VACUUM INTO`。当本次备份失败时，`created=false` 只保证“不清除旧
标记”，但旧标记的内容已经被改写：目标列、`migration_id` 变成两个事务的拼接。
下一次启动看到的是一个被污染的事务，而不是事务 A 的原始恢复点。

真实复现（`a_failed_vacuum_restores_transaction_a_and_the_next_startup_recovers_it`）：

1. 事务 A 建立标记与 A 时代快照，标记字节与 SHA 入档；
2. 同一启动内事务 B 扩展标记（可见字节变化）；
3. 目标目录设为只读，真实 `VACUUM INTO` 失败；
4. 回滚后标记逐字节等于 A 的原始字节；
5. 下一次启动从 A 的快照恢复成功。

旧实现在第 4 步就已经把 B 的目标写进 A 的标记，无法还原。

### P0-B 恢复互斥

`ensure_lock` 在本进程已持锁时直接返回成功，两个 Tauri 命令可以在同一进程内
并发执行备份/恢复；无标记启动路径也完全不探测锁，另一个进程在迁移期间仍可
从“无标记”入口打开数据库。

### P0-C 恢复状态与完成语义

- `restore_from_snapshot` 用 `clear_marker(...).unwrap_or(false)`，标记清除失败
  仍然报告 `Recovered`；
- `db_recovery_retry` 在锁获取失败时直接返回，不更新 `RecoveryVerdict`；
- 启动恢复 `Recovered` 后锁不释放，出现“UI 已放行、后端锁仍被持有”的矛盾。

## 2. 修复

| 领域 | 实现 |
| --- | --- |
| 标记 v3 | `migration_id` + `owner_pid` + `owner_token`；`version>3` 一律拒绝 |
| 事务所有权 | `begin_transaction` 只允许同一进程扩展；其他进程/旧版本标记硬失败；扩展前验证快照不含新目标列 |
| 原子回滚 | `MarkerTransaction` 保存原始字节；`rollback_transaction` 核对事务 ID 后逐字节还原或删除 |
| 完成语义 | `verify_completion(db, dir, transaction_id)` 核对事务 ID、目标列、integrity；清除失败返回错误 |
| 恢复完成 | 标记清除失败返回 `RestoreInterrupted`，保留标记与快照作为证据 |
| 锁 | `RecoveryLock` = OS 文件锁 + tokio 进程内互斥 + `migration_active` |
| 启动 | 每次启动都探测锁；标记消失即释放；第二实例 fail-closed |
| 重试 | 锁失败/迁移进行中均返回并写入一致的阻断裁决 |

## 3. 测试矩阵

| 测试 | 结果 |
| --- | --- |
| Rust 全量 | 327 passed（新增 14 项恢复/锁/回滚测试） |
| 真实双进程 E2E | 持锁拒绝、SIGKILL 释放锁、ALTER 中被杀后恢复、并发启动只恢复一次 |
| 真实 SQLite 负向 | 只读目录注入 `VACUUM INTO` 失败 → 标记逐字节回滚 |
| Windows runner | `cargo test --lib db_recovery` **19 passed / 0 failed**，含目录写探测与打开中数据库半替换测试 |
| 前端 | 155 文件 / 1412 项；typecheck、ESLint、source-size 574 文件 |
| 脚本 | verify-install 75 项（4 skipped） |
| Team SIGKILL | 1/3/5/10 目标点；快照/标记/恢复/幂等/字段级数据断言 |
| Upgrade E2E | run `42249215589`（`65299c8`，最终 HEAD）**5/5 success**；Team 场景 4/4 目标点全部 PASS |
| 证据重采 | run `42245189022` 3/3 success，指纹 **`9bad378d…`**（debug `b1bb9fd1…`、release `e04080f3…`），官方门禁 0 problem |
| 最终 CI | 证据与文档提交后在最终 HEAD 上执行，结果见交付报告 |

## 4. 判定

```text
EXISTING_TRANSACTION_ROLLBACK_SAFE=PASS
VACUUM_FAILURE_PRESERVES_OLD_MARKER=PASS
TRANSACTION_OWNER_ENFORCED=PASS
ACTIVE_SNAPSHOT_PROTECTED=PASS
IN_PROCESS_RECOVERY_SERIALIZED=PASS
TWO_PROCESS_LOCK_E2E_VERIFIED=PASS
CONCURRENT_STARTUP_SAFE=PARTIAL
CORE_TEAM_MIGRATION_ATOMICITY_VERIFIED=PASS
TEAM_APPLICATION_SIGKILL_E2E=PASS
RECOVERY_VERDICT_CONSISTENT=PASS
WINDOWS_FILESYSTEM_RECOVERY_VERIFIED=PARTIAL
UPGRADE_E2E_CURRENT_HEAD=PASS
EVIDENCE_FINGERPRINT_VALID=PASS
PHASE_9_6_3_ENGINEERING_COMPLETE=PARTIAL
PHASE_9_7_ENTRY_READY=PARTIAL
PR_8_INTEGRATION_READY=待最终 CI
READY_FOR_RC=NO
READY_FOR_RELEASE=NO
```

### 判定说明

- `CONCURRENT_STARTUP_SAFE=PARTIAL`：启动门禁与迁移/恢复锁覆盖了“启动时另一实例
  正在迁移或恢复”的路径；但一个**已经运行**的实例在另一实例恢复期间仍持有旧
  连接并可能继续普通写入，本轮未引入全程实例锁。
- `CORE_TEAM_MIGRATION_ATOMICITY_VERIFIED=PASS`：Team 场景证明 Core 完成后、
  Team 部分迁移时不会被误判为健康，恢复点为 post-Core/pre-Team 快照，
  数据字段级一致。
- `WINDOWS_FILESYSTEM_RECOVERY_VERIFIED=PARTIAL`：19 项原生测试通过（目录写探测、
  打开中数据库不得半替换、标记字节回滚等）；reparse point、ACL 拒绝目录与
  NSIS A→B 仍 **NOT_RUN**。
- `PHASE_9_7_ENTRY_READY=PARTIAL`：三类数据安全风险（事务被覆盖、并发恢复、
  错误完成）已关闭；剩余 PARTIAL 属于平台/外部验收，按计划转入 Phase 9.7，
  但不得宣称 9.6.x 全部关闭。

## 5. Phase 9.7 执行计划

数据安全门禁完成后按以下顺序进入真实产品验收，不再扩展恢复框架：

1. **Windows NSIS A→B**：一次性 VM/profile，隔离校验 fail-closed；共享 runner
   只做非破坏性预检，不触碰真实 `%APPDATA%`。
2. **Vault app-level**：真实 Tauri command → UI 解锁、改密、重启后解锁；
   主密码只来自测试用一次性输入，不写入日志/证据。
3. **Team Sync 双客户端跨版本**：真实 PostgreSQL，A/B 两个客户端版本同步、
   冲突与离线队列；服务端迁移包含在链内。
4. **Updater 运行时**：临时测试密钥下的下载、验签、安装、重启；不把历史
   `.sig` 当作运行时更新成功。
5. **ENOSPC 安装与 fsync**：安装卷、数据卷、目录 flush 三类故障矩阵；
   与现有迁移 disk-full 分开记录。

正式签名/公证、identity 迁移、安全 advisory 仍作为发布阻塞单独登记
（BLOCKED_EXTERNAL），不阻塞 Phase 9.7 的工程验收。

## 6. PR #7 / #8 集成建议

- 先合并 PR #7（`00715d6`，18 commits，base `main`），保留 merge commit；
- #7 分支删除后 #8 自动指向 `main`，确认 diff 只剩本栈改动；
- #8 用 merge commit 合并，保留 9.5–9.6.3 每阶段判定与证据提交；
- 合并前必须满足：最终 CI 11/11、证据指纹为当前源码、PR #8 仍为 Draft 直到
  合并动作由维护者发起。

## 7. 未完成

- 已运行的第二实例在另一实例恢复期间仍可继续持有旧连接；启动门禁与迁移锁
  已覆盖启动/迁移/恢复路径，但未阻止已运行实例的普通写入。
- Windows reparse point/ACL 拒绝目录、NSIS A→B 仍 **NOT_RUN**。
- Phase 9.7 产品验收：Windows 独立 VM NSIS、Vault app-level、Team Sync 双客户端、
  updater 运行时、安装 ENOSPC。
- 签名/公证/身份迁移/安全 advisory 仍是发布阻塞（BLOCKED_EXTERNAL）。
