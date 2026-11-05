# Phase 9.5 — Upgrade Failure & Recovery

> 日期：2026-11-05（Phase 9.5.1 更新）
> 证据：`docs/phase9-5/evidence/`、`upgrade-evidence-current` artifacts
> 详细实现与五事实判定：`docs/phase9-5/rollback-and-recovery.md`
> 所有故障注入都在临时 HOME / 临时 Applications 目录中执行，不接触真实用户数据。
> macOS 的 WKWebView localStorage 不受 `HOME` 重定向；本轮未读取或清理该目录。

## 0. 覆盖矩阵（Phase 9.5.1）

| # | 场景 | 状态 | 证据 |
| --- | --- | --- | --- |
| 1 | A 数据保留后安装 B | **PASS** | dev.1→dev.2 / dev.1→当前源码 |
| 2 | Migration 抛错 | **PASS** | 只读目录使迁移失败，旧 DB 不变 |
| 3 | 重启后重新执行迁移 | **PASS** | 第二次 B 启动幂等 |
| 4 | 重复启动幂等性 | **PASS** | `fault-restart-idempotent/` |
| 5 | 数据库损坏检测 | **PASS** | `fault-corrupt-db/`，日志 `file is not a database` |
| 6 | 磁盘空间不足 | **NOT_RUN** | 未实现确定性小容量卷 |
| 7 | 目标路径只读 | **PASS** | `fault-read-only-data-dir/` |
| 8 | 备份失败 | **PASS** | 只读目录同时阻断 backups，迁移不执行 |
| 9 | 迁移中断 | **PASS** | 第一条列提交后、第二条列前 SIGKILL；重启收敛 |
| 10 | 恢复前后数据一致性 | **PASS** | 备份复制回 DB，A 启动并读回 |
| 11 | B→A 降级读取 | **PASS**（读取）/ **PARTIAL**（无状态机） | A 可读加法 schema，数据哈希未变 |

## 1. 五事实拆分

每个故障必须分别给出：

- `FAULT_INJECTED`
- `APPLICATION_FAILURE_OBSERVED`
- `ORIGINAL_DATA_PRESERVED`
- `NO_PARTIAL_MIGRATION`
- `RECOVERY_SUCCEEDED`

`fault-assessment.mjs` 按故障类型声明 required facts；required 有 `NOT_RUN` 即
`PARTIAL`，有 `FAIL` 即 `FAIL`。`check-upgrade-evidence.mjs` 独立检查报告，
不允许“只保留了 DB 但没有注入故障”或“故障注入了但没有应用观察”被写成 PASS。

## 2. 已执行（摘要）

| 故障 | 注入 | 结果 |
| --- | --- | --- |
| 数据库损坏 | 覆盖 DB 文件头 32 字节 | **PASS**：DB SHA 不变；日志 `file is not a database`；未静默删除/重建 |
| 数据目录只读 | `chmod 0500` 数据目录 | **PASS**：DB SHA 不变；日志 `attempt to write a readonly database`；恢复写权限后 B 迁移成功 |
| 重复启动幂等 | B 首次迁移成功后再次启动 B | **PASS**：逐字段验证仍通过，无重复行/重复迁移副作用 |
| 迁移前备份可读 | 当前 B 的 `backup_database_before_migration` | **PASS**：`pre-migration-<epoch>.db` integrity ok，seeded 行可读 |
| 备份写入失败 | 只读数据目录同时阻断 backups | **PASS**：备份失败时迁移不执行，旧 DB 不变 |
| 迁移中途 kill | 第一条 host 列提交后 SIGKILL | **PASS**：重启后两列齐全，数据逐字段验证 |
| 备份恢复 | 复制备份回 `terminal.db` | **PASS**：A 启动并读回，恢复后 SHA 与备份一致 |
| B→A 降级 | A 启动 B 迁移后的 DB | **PASS**（读取）：加法 schema 可读，数据哈希未变 |

## 3. 恢复策略

- 迁移是**加法**的；迁移前由 Rust `backup_database_before_migration` 用
  `VACUUM INTO` 写 `pre-migration-<epoch>.db`，并做 integrity/表/行数读回校验。
- 备份失败是迁移的**中止信号**：前端不执行任何 ALTER。
- 当前版本**没有自动回滚**。可执行的恢复步骤已端到端验证：

  1. 停止应用；
  2. 保留当前 DB 作为证据；
  3. 将 `backups/pre-migration-<epoch>.db` 复制为 `terminal.db`；
  4. 删除 `terminal.db-wal` / `terminal.db-shm`；
  5. 重新启动 A，跑 `data-retention integrity` 和内容读回。

- 对于 schema 已向前迁移的库：**禁止假装旧版本可读**。当前策略是禁止不兼容
  降级、从升级前备份恢复；A 读取加法 schema 只是兼容性观察，不是通用回滚保证。

## 4. 未执行（NOT_RUN）

| 项 | 原因 |
| --- | --- |
| 磁盘空间不足 | 未实现确定性的小容量卷/fixture |
| 安装介质只读 | 未实现 |
| 从备份自动恢复 | 产品只有人工恢复步骤；本轮验证的是人工步骤 |
| B→A 写回保证 | 没有降级状态机；只证明 A 能读加法 schema |
| 真实 Vault 解锁失败 | 需要主密码，不能伪造 |
| Windows 故障注入 | `%APPDATA%` 实际未隔离，预检已 fail-closed；需要一次性 profile/VM |
| Linux 故障注入 | 本轮只做 Linux 正常 A→B，未做磁盘满/只读/中断 |

## 5. 判定

`FAILURE_RECOVERY_VERIFIED = PARTIAL`

Phase 9.5.3：恢复状态机与 busy checkpoint 已实现；crash point/ENOSPC 仍
NOT_RUN，详见 `crash-safe-recovery.md` 与 `recovery-fault-matrix.md`。

- 已覆盖：损坏 DB、只读目录、备份失败、重复启动、备份可读、迁移中途中断、
  备份恢复、A 读取降级；
- 未覆盖：磁盘满、安装介质只读、自动恢复/自动回滚、B→A 写回保证、Linux 故障
  注入、真实 Vault/Windows。
