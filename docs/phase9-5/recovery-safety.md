# Phase 9.5.2 — Backup and Recovery Safety

> 日期：2026-11-05
> 代码：`scripts/verify-install/upgrade-e2e.mjs`、`data-retention.mjs`
> 本地结果：normal / restore / downgrade / interrupted 全部 PASS（Node 24）
> 判定：`BACKUP_RECOVERY_SAFETY_VERIFIED = PARTIAL`、`DISK_FULL_RECOVERY_VERIFIED = NOT_RUN`

## 1. 本轮修复的 fail-open 点

| 风险 | 修复 |
| --- | --- |
| `PRAGMA wal_checkpoint(TRUNCATE)` 的 `(busy, log, checkpointed)` 被丢弃，busy checkpoint 也报 PASS | 读取返回值，要求 `busy=0`、`log=checkpointed`、WAL 为空；否则非零退出 |
| 恢复时先 `rename` 新 DB，再删旧 `-wal/-shm`，崩溃会留下“旧 WAL + 新主库” | 先验证 checkpoint、删除 `-wal/-shm/-journal`、fsync 目录，再 rename，再 fsync |
| 恢复临时文件没有在失败时清理 | `try/catch` 删除 `terminal.restore.tmp`，不覆盖 live DB |
| 恢复前不校验备份内容，可能拿到半迁移/已含 B 列的备份 | 先对备份候选做 A 快照验证（含 forbid B 列），再用临时副本验证一遍 |
| `waitForBackup` 取字典序最后一个；`backup-verify` 取 mtime 最新，二者可能不是同一文件 | 两处都按 `pre-migration-<数字>` 数字时间戳选择**最早**的备份；恢复时同一个路径 |
| 中断分支 backup 缺失只加 FAIL check，但 `applyFaultAssessment` 会把 status 覆盖成 PASS | 先看任何 FAIL check，再取 fault overall；`main()` 对任何 FAIL check 退出 1 |
| `SIGKILL` 的 exit 事件未确认就 checkpoint/恢复 | 仍保留 2 秒等待；本轮没有实现进程组/lsof 二次确认（NOT_RUN） |
| 损坏/只读只比较主 DB 文件 SHA | 改为 `db + -wal + -shm + -journal` 的整组 SHA；只读测试同时 chmod DB 与 sidecar 0400 |
| 降级只比较主文件哈希，且 `compatible` 时无条件 PASS | 迁移后先记 B 快照；降级后按 B 快照逐字段验证，新增 `downgrade A launch`、`downgrade preserved B columns` |

## 2. 恢复顺序（当前实现）

1. 应用停止；`checkpoint` 校验 busy/log/checkpointed；
2. 备份候选是最早的 `pre-migration-<stamp>.db`；
3. 复制到 `terminal.restore.tmp`，fsync；
4. 用 A 快照 `verify --forbid-columns agent_forwarding,shell_integration` 校验
   临时副本（integrity/foreign_key/字段/行）；
5. 删除 live DB 的 WAL/SHM/journal，fsync 目录；
6. `rename` 临时副本为 `terminal.db`，fsync 目录；
7. 启动 A，等待 schema，检查进程仍存活，读回 seeded 行；
8. 比较恢复后 DB SHA 与备份 SHA。

本机 `restore-backup` 报告：`restored DB matches backup`、`restored A launch`、
`backup restore` 均 PASS。

## 3. 降级

`downgrade` 现在：

1. B 迁移完成后生成 `b-before-downgrade.json` 快照；
2. A 启动并等待 schema，新增 `downgrade A launch`；
3. 用 B 快照 `verify`（包含 B 的 `agent_forwarding`/`shell_integration` 数据）；
4. 新增 `downgrade preserved B columns`；
5. 只有字段验证通过才判定 `downgrade did not destroy data`。

本机 PASS。该验证只覆盖加法 schema 的 A 读取，不覆盖“未来不兼容 schema 的拒绝”。

## 4. 仍未执行

- **磁盘满（ENOSPC）**：没有确定性小容量卷 fixture；`DISK_FULL_RECOVERY_VERIFIED = NOT_RUN`。
- **busy checkpoint 的负面测试**：代码已 fail-closed，但没有在 CI 构造第二个
  连接持有读事务的自动化测试。
- **恢复中途崩溃**：没有在 rename 前后注入 crash point。
- **恢复包含 vault**：当前备份只覆盖数据库；vault 不在备份集内，恢复后 vault
  保持原样。文档明确这是 database-only 恢复。
- **进程组/lsof 二次确认**：只等待直接子进程退出。
- **Linux 故障注入**：仍未执行。

## 5. 验证命令

```bash
/Users/liuzhiwei/.nvm/versions/node/v24.16.0/bin/node scripts/verify-install/upgrade-e2e.mjs run \
  --a-installer <dev.1.dmg> --b-installer <current.dmg> --platform darwin \
  --expect-a-version 0.0.1-dev.1 --expect-b-version 0.0.1-dev.4-local \
  --expect-identifier com.baicie.termius \
  --expect-new-host-columns agent_forwarding,shell_integration \
  --expect-backup --fault restore-backup ...
```

## 6. 判定

- `BACKUP_RECOVERY_SAFETY_VERIFIED = PARTIAL`：checkpoint、sidecar 顺序、备份
  选择、恢复前校验、A 启动证据均已加固；busy checkpoint/崩溃窗口/ENOSPC 未测。
- `DISK_FULL_RECOVERY_VERIFIED = NOT_RUN`：没有确定性磁盘满 fixture。
- `DOWNGRADE_GUARD_VERIFIED = PARTIAL`：加法 schema 的读取与 B 数据保留已验；
  不兼容未来 schema 的拒绝未实现。
