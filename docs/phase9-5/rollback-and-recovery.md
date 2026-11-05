# Phase 9.5.1 — Rollback, Interruption and Recovery

> 日期：2026-11-05
> 脚本：`scripts/verify-install/upgrade-e2e.mjs`、`fault-assessment.mjs`
> 证据：本机报告 + `upgrade-evidence-current` / `upgrade-evidence-*` artifacts
> 判定：见第 7 节

## 1. 两类结果不能混写

故障测试必须拆成五个独立事实，不能用一个 `PASS` 概括：

| 事实 | 含义 |
| --- | --- |
| `FAULT_INJECTED` | 故障确实发生（文件被改、目录只读、进程在迁移中被杀） |
| `APPLICATION_FAILURE_OBSERVED` | 应用自己识别并记录了失败，而不是静默重建 |
| `ORIGINAL_DATA_PRESERVED` | 原 DB/vault 字节或可读内容未被破坏 |
| `NO_PARTIAL_MIGRATION` | 没有留下“看似成功”的半迁移状态 |
| `RECOVERY_SUCCEEDED` | 恢复步骤真的执行并读回数据 |

`fault-assessment.mjs` 对每类故障声明 required facts；required 中有 `NOT_RUN`
就是 `PARTIAL`，有 `FAIL` 就是 `FAIL`。报告同时保留每个 fact 的 check，
`check-upgrade-evidence.mjs` 是独立门禁。

## 2. 覆盖矩阵

| 场景 | 模式 | 本机/CI 结果 | 关键证据 |
| --- | --- | --- | --- |
| 正常 A→B | `none` | **PASS** | 字段级数据比较、schema 前后列 |
| 损坏 DB | `corrupt-db` | **PASS** | DB SHA 不变、日志 `file is not a database` |
| 数据目录只读 | `read-only-data-dir` | **PASS** | DB SHA 不变、日志 `readonly database`，恢复后 B 迁移成功 |
| 第二次启动 | `restart-idempotent` | **PASS** | schema 不重复、字段级验证仍通过 |
| 迁移中途 kill | `interrupted` | **PASS** | 第一条列已提交、第二条缺失时 SIGKILL；重启收敛 |
| 备份恢复 | `restore-backup` | **PASS** | 备份复制回 DB，A 启动并读回 |
| B→A 降级 | `downgrade` | **PASS** | A 能读加法 schema；数据哈希未变 |
| 磁盘满 | — | **NOT_RUN** | 未实现确定性小容量卷 |
| 安装介质只读 | — | **NOT_RUN** | 未实现 |
| 自动回滚 | — | **NOT_RUN** | 产品没有自动回滚状态机 |

## 3. 真正的中途迁移中断

早期实现只等到 `snapshot-finished` 后固定睡 300 ms；在 1.5 s 迁移延迟下，
kill 可能发生在**第一条 ALTER 之前**。本轮改为轮询数据库：

1. 启动 B，设置 `TERMINAL_STARTUP_STAGES_PATH`；
2. 等待 `snapshot-finished`（迁移前备份已完成）；
3. 轮询 `pragma_table_info('hosts')`，直到 `agent_forwarding` 出现；
4. 此时 `shell_integration` 仍缺失，立即 `SIGKILL`；
5. 重新启动 B，等待两列都存在；
6. `data-retention verify` 逐字段比较，并检查 pre-migration backup 可读。

本机 `dev.1 → dev.4-interrupt`（`0.0.1-dev.4-interrupt`，注入构建）结果：

| 项 | 值 |
| --- | --- |
| 中断前已提交列 | `id,name,hostname,port,username,auth_type,password,private_key,certificate,group_id,is_favorite,color,tags,port_forwards,startup_command,environment,jump_host_id,jump_host_auth_type,created_at,updated_at,agent_forwarding` |
| 中断时缺失列 | `shell_integration` |
| `FAULT_INJECTED` | **PASS** |
| `ORIGINAL_DATA_PRESERVED` | **PASS** |
| `NO_PARTIAL_MIGRATION` | **PASS**（重启后两列齐全，没有半迁移残留） |
| `RECOVERY_SUCCEEDED` | **PASS**（B 重启收敛，数据逐字段验证） |
| `APPLICATION_FAILURE_OBSERVED` | **NOT_RUN**（SIGKILL 不会产生应用错误日志，这是预期） |
| 报告 | `/tmp/phase951-interrupt-report5/upgrade-report.json`（本地；CI 归档同名报告） |

这不是“迁移窗口太短所以不测”，而是可重复的、在第一条 ALTER 已提交后发生的
真实中断。`VITE_TERMINAL_MIGRATION_DELAY_MS=1500` 只在
`VITE_TERMINAL_SMOKE_BUILD=1` 的测试构建中生效，生产构建默认 0。

## 4. 备份恢复

`restore-backup` 模式：

1. 完成正常 A→B，保留 B 的 post-upgrade DB 作为证据；
2. 找到 `backups/pre-migration-<epoch>.db`；
3. checkpoint 后把备份复制为 `terminal.db`，`fsync`，删除 WAL/SHM；
4. 启动 A 副本，等待 schema；
5. 用 `data-retention verify` 读回 seeded 行；
6. 断言恢复后的 DB 与备份 SHA 相同。

本机结果：**PASS**，`restored DB matches backup` 与 `backup restore` 均为 PASS。
这证明产品当前**没有自动恢复**；可执行的恢复是人工停应用、保留现场、复制备份、
删除 WAL/SHM、重启并验证。CI 的 `restore-backup` 报告同样由门禁检查。

## 5. 降级

`downgrade` 模式在 B 迁移后直接用 A 启动同一个 DB：

- A 能读加法 schema（新增列不破坏旧查询）；
- A 启动、schema 就绪；
- 数据哈希未变（`downgrade did not destroy data`）。

本机 **PASS**。但这只证明 **A 读取** 成功，不证明 B 新增列的数据会被 A 保留
或写回；产品仍没有正式的降级状态机。若未来出现破坏性迁移，A 读取不能作为
降级安全的通用保证。

## 6. 损坏与只读

- `corrupt-db`：覆盖 DB 文件头；应用日志出现 `file is not a database`；原 DB
  哈希不变；没有静默删除/重建。`RECOVERY_SUCCEEDED` 不要求（产品不会自动修）。
- `read-only-data-dir`：`chmod 0500`；应用日志出现 `attempt to write a readonly
  database`；迁移与备份均未写半成品。恢复写权限后重启 B，迁移成功，数据逐字段
  验证通过，因此该模式额外要求 `RECOVERY_SUCCEEDED=PASS`。
- `restart-idempotent`：B 第二次启动不重复迁移、不产生重复行。

## 7. 判定

- `MIGRATION_INTERRUPTION_RECOVERY_VERIFIED = YES`（本机真实中途 kill + 重启收敛；
  CI 报告见 `ci-current-version-upgrade.md`）
- `BACKUP_RESTORE_VERIFIED = YES`（本机端到端复制备份并用 A 读回；CI 同样执行）
- `DOWNGRADE_SAFETY_VERIFIED = PARTIAL`（A 可读加法 schema，数据未被破坏；没有
  正式降级状态机，也没有 B→A 写回保证）
- `FAILURE_RECOVERY_VERIFIED = PARTIAL`（损坏/只读/重启/中断/备份恢复已执行；
  磁盘满、安装介质只读、自动回滚 NOT_RUN）
- 不得声称“所有升级故障都能自动恢复”：产品没有自动恢复或自动回滚。
