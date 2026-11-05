# Phase 9.5 — Upgrade Failure & Recovery

> 日期：2026-11-05
> 证据：`docs/phase9-5/evidence/fault-*`
> 所有故障注入都在临时 HOME / 临时 Applications 目录中执行，不接触真实用户数据。

## 1. 已执行

| # | 故障 | 注入 | 结果 | 证据 |
| --- | --- | --- | --- | --- |
| 1 | 数据库损坏 | 覆盖 DB 文件头 32 字节 | **PASS**：DB 文件 SHA 不变；应用日志 `file is not a database`；未静默删除/重建 | `fault-corrupt-db/` |
| 2 | 数据目录只读 | `chmod 0500` 数据目录 | **PASS**：DB SHA 不变；应用日志 `attempt to write a readonly database`；迁移/备份未写半成品 | `fault-read-only-data-dir/` |
| 3 | 重复启动幂等 | B 首次迁移成功后再次启动 B | **PASS**：逐字段验证仍通过，无重复行/重复迁移副作用 | `fault-restart-idempotent/` |
| 4 | 迁移前备份可读 | 当前 B 的 `backup_database_before_migration` | **PASS**：`pre-migration-<epoch>.db` integrity ok，seeded hosts/settings/workspace/layout 可读 | `dev1-to-dev3-current/backup-report.json` |
| 5 | 备份写入失败 | 只读数据目录同时阻断 backups | **PASS**（与 #2 同一路径）：迁移前备份失败时迁移不执行，旧 DB 不变 | `fault-read-only-data-dir/` |

每一条都验证了：

- 旧数据未被静默删除（DB SHA 不变）；
- 没有把半迁移状态当成成功（schema 未写/迁移未执行，应用日志明确报错）；
- 能识别失败原因（`file is not a database` / `readonly database`）；
- 失败证据完整（报告 JSON + 应用日志）。

## 2. 未执行（NOT_RUN）

| 项 | 原因 |
| --- | --- |
| 迁移中途 kill 后重启 | dev.1→dev.2 的迁移窗口只有两个 ALTER，无法确定性命中；本轮不伪造 PASS |
| 磁盘空间不足 | 未实现确定性的小容量卷/fixture |
| 安装介质只读 | 未实现 |
| 从备份自动恢复 | 产品的恢复步骤只有人工复制备份；本轮只验证备份可读，未执行端到端恢复 |
| B→A 降级/回滚 | 产品没有降级状态机；schema 是加法迁移，但不能假设旧版可读新 schema |
| 真实 Vault 解锁失败 | 需要主密码，不能伪造 |
| Windows 故障注入 | `%APPDATA%` 实际未隔离，现有脚本会删除真实目录；必须一次性 profile/VM |

## 3. 恢复策略（设计，未全部执行）

- 迁移是**加法**的；迁移前由 Rust `backup_database_before_migration` 用
  `VACUUM INTO` 写 `pre-migration-<epoch>.db`，并做 integrity/表/行数读回校验。
- 备份失败是迁移的**中止信号**：前端不执行任何 ALTER。
- 当前版本**没有自动回滚**。可执行的恢复步骤是：

  1. 停止应用；
  2. 保留当前 DB 作为证据；
  3. 将 `backups/pre-migration-<epoch>.db` 复制为 `terminal.db`；
  4. 删除 `terminal.db-wal` / `terminal.db-shm`；
  5. 重新启动 A，跑 `data-retention integrity` 和内容读回。

  第 3–5 步本轮**未端到端执行**，只验证了备份文件可打开、数据可读。

- 对于 schema 已向前迁移的库：**禁止假装旧版本可读**。可接受的策略只有：
  禁止不兼容降级、从升级前备份恢复、或经验证的兼容迁移。当前采用前两者。

## 4. 判定

`FAILURE_RECOVERY_VERIFIED = PARTIAL`

- 已覆盖：损坏 DB、只读目录、备份失败、重复启动、备份可读；
- 未覆盖：迁移中断、磁盘满、自动恢复、B→A 降级、真实 Vault/Windows。
