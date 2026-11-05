# Phase 9.5.3 — Crash-Safe Recovery

> 日期：2026-11-05
> 代码：`upgrade-e2e.mjs`、`recovery-state-machine.mjs`、`data-retention.mjs`
> 测试：`recovery-state-machine.test.mjs`、`checkpoint-safety.test.mjs`
> 判定：`SQLITE_RECOVERY_CRASH_SAFETY_VERIFIED = PARTIAL`

## 1. 状态机

恢复流程显式记录并断言：

```
PREPARE → QUIESCE → VERIFY_BACKUP → STAGE → VERIFY_STAGED → COMMIT → VERIFY → COMPLETE
```

- `PREPARE`：调用方已停止应用；
- `QUIESCE`：checkpoint 必须 `busy=0`、`log=checkpointed`、WAL 为空；
- `VERIFY_BACKUP`：用 A 快照验证备份本身（含 forbid B 列）；
- `STAGE`：复制到同目录临时文件并 fsync；
- `VERIFY_STAGED`：再次验证临时副本；
- `COMMIT`：删除 live 的 `-wal/-shm/-journal`，fsync 目录，再 rename；
- `VERIFY`：恢复后 A 启动、等待 schema、字段校验、SHA 对比；
- `COMPLETE`：`assertStageOrder` 通过并写入报告。

报告新增 `backup restore stages`，失败时不会出现完整的阶段序列。

## 2. 安全不变量

- checkpoint busy 不会被当作成功；
- 不把旧 WAL 应用到新的主数据库：sidecar 在 rename 前删除；
- 不在未知连接状态下恢复：checkpoint 失败即中止（损坏 DB 的 header 失败例外，
  但仍保留临时文件校验）；
- 不删除唯一备份：备份源在恢复前只读校验，临时文件失败会清理；
- 不凭文件存在宣称恢复成功：恢复后启动 A、等待 schema、字段比较；
- 不以“删库重建”作为兜底。

## 3. Crash point

`recovery-state-machine.mjs` 定义 8 个阶段，`crashPoint(stage)` 在：

- `TERMINAL_TEST_CRASH=1` 且
- `TERMINAL_RESTORE_CRASH_POINT=<stage>`

时抛出 `injected recovery crash at <stage>`。生产默认不设置，任何阶段都不会
被环境变量触发。`restoreStagePlan` 只允许一个 crash point。

已实现但**未在真实恢复链上逐点执行**；`recovery-state-machine.test.mjs` 验证
阶段顺序、单点选择与显式开关。真实 crash-point 矩阵在
`recovery-fault-matrix.md` 标记 NOT_RUN，避免把“代码里有 hook”写成已验证。

## 4. busy checkpoint 真实测试

`checkpoint-safety.test.mjs` 启动一个 Node 子进程：

1. 打开 WAL 数据库并提交一行；
2. 第二个连接 `BEGIN` + `SELECT`，持有读事务；
3. 写入 ready 标记并保持连接；
4. 父进程执行 `data-retention.mjs checkpoint`。

结果：checkpoint 以非零退出，输出包含 busy/checkpoint；父进程不删除 WAL。
这使用真实 SQLite 锁，不是 mock。

## 5. 剩余风险

- crash point 尚未在真实 restore 上逐点运行；
- 恢复失败后“备份仍可用”没有独立恢复重试测试；
- vault 不在数据库备份集，恢复是 database-only；
- 进程组/lsof quiescence 未实现；
- ENOSPC 未覆盖。

## 6. 判定

- `BUSY_CHECKPOINT_VERIFIED = YES`
- `SQLITE_RECOVERY_CRASH_SAFETY_VERIFIED = PARTIAL`
- `DISK_FULL_RECOVERY_VERIFIED = NOT_RUN`
