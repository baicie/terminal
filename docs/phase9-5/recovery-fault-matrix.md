# Recovery Fault Matrix（Phase 9.5.3 起，9.5.4/9.5.5 更新）

> 日期：2026-11-05
> 所有故障只在临时 HOME/临时 Applications/临时数据库目录或一次性小容量卷中执行。
> `TERMINAL_TEST_CRASH=1` 只保留为单元测试契约，Harness 已改用独立 worker。

## 1. 恢复 crash point 矩阵（Phase 9.5.4，真实 SIGKILL）

| # | 注入点 | 预期 | 结果 |
| --- | --- | --- | --- |
| 1 | `PREPARE` | 尚未触碰 live DB，重试可恢复 | **PASS**：retry `restored` |
| 2 | `QUIESCE` | checkpoint 失败/中断，WAL 保留 | **PASS**：retry `restored` |
| 3 | `VERIFY_BACKUP` | 备份校验失败，live 不变 | **PASS**：retry `restored` |
| 4 | `STAGE` | 临时副本不完整，live 不变，临时文件清理 | **PASS**：temp=备份 SHA，retry `restored` |
| 5 | `VERIFY_STAGED` | 临时副本校验失败，live 不变 | **PASS**：retry `restored` |
| 6 | `COMMIT` | sidecar 已删但 rename 未发生，live 不完整 | **PASS**：retry `restored` |
| 7 | `VERIFY` | 新 DB 已发布但恢复后校验失败 | **PASS**：retry `already-restored` |
| 8 | `COMPLETE` | 已发布且校验通过 | **PASS**：retry `already-restored` |

证据：`restore-crash-matrix.test.mjs`（本地）与 E2E `42037724319` 的 macOS
报告（8 条 PID/SIGKILL/文件集记录）。详见 `real-crash-point-matrix.md`。

## 2. 已执行的 SQLite 故障

| 故障 | 结果 | 证据 |
| --- | --- | --- |
| busy checkpoint（真实第二个连接） | **PASS**：checkpoint 非零退出，WAL 保留 | `checkpoint-safety.test.mjs` |
| 损坏 DB（文件头） | **PASS**：整组文件 SHA 不变，应用日志识别 | E2E corrupt 报告 |
| 只读目录 | **PASS**：DB/sidecar chmod，恢复后 B 迁移 | E2E read-only 报告 |
| 中断 migration | **PASS**：第一条列提交后 SIGKILL，重启收敛 | E2E interrupted 报告 |
| 备份恢复 | **PASS**：最早备份、A 快照校验、A 启动读回 | E2E restore 报告 |
| 降级 B 快照 | **PASS**：A 读取后字段比较 | E2E downgrade 报告 |
| staged restore ENOSPC | **PASS**：64 MB DMG/tmpfs，主库不变、retry 收敛 | `enospc-recovery.test.mjs` |
| 备份/迁移 disk-full | **PASS**：满卷 0/2 新列、A 数据可读、释放后迁移收敛 | E2E `42061498904` |

## 3. 磁盘满（ENOSPC）

| 场景 | 状态 | 说明 |
| --- | --- | --- |
| staged restore ENOSPC | **PASS** | macOS DMG + Linux tmpfs（CI 457 ms） |
| 备份 VACUUM/migration ENOSPC | **PASS**（行为） | 64 MB DMG + 24 MB DB + 8 MB 空闲；失败点由 0/2 新列 + 释放后收敛观测，未归因到具体错误码 |
| 备份写一半 ENOSPC | **PARTIAL** | 由同一 disk-full 场景覆盖，未单独注入 |
| 目录 fsync 失败 | **NOT_RUN** | 未实现故障注入 |
| 安装 B 空间不足 | **NOT_RUN** | 安装介质不在本轮范围 |

禁止用简单 `throw Error` 冒充真实 ENOSPC；未填满共享 runner 根分区。

## 4. 进程/文件句柄

- 直接子进程：真实 exit/close 事件管理；
- **进程树（OWNED_CHILDREN_SETTLED）**：停止前递归快照，退出后等待 2 s 收敛；
  E2E 10 份报告（macOS + Linux，含 WebKitGTK 子进程）四项事实全 PASS；
- lsof DB 句柄：PASS；Windows 无 pgrep，进程树事实 NOT_RUN。

证据：`process-tree-quiescence.md`、E2E `42047193259`。

## 5. 判定

`SQLITE_RECOVERY_CRASH_SAFETY_VERIFIED = YES（恢复协议）`
`BUSY_CHECKPOINT_VERIFIED = YES`
`STAGED_RESTORE_ENOSPC = PASS`
`DISK_FULL_BACKUP_AND_MIGRATION = PASS（行为；归档门禁待最终轮）`
`PROCESS_TREE_QUIESCENCE = PASS（macOS/Linux）`
