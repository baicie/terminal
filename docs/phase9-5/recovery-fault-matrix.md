# Phase 9.5.3 — Recovery Fault Matrix

> 日期：2026-11-05
> 所有故障只在临时 HOME/临时 Applications/临时数据库目录中执行。
> `TERMINAL_TEST_CRASH=1` 只允许测试构建设置，生产默认关闭。

## 1. 恢复 crash point 矩阵

| # | 注入点 | 预期 | 状态 |
| --- | --- | --- | --- |
| 1 | `PREPARE` | 尚未触碰 live DB，重试可恢复 | **NOT_RUN**（hook 有，真实链未逐点跑） |
| 2 | `QUIESCE` | checkpoint 失败/中断，WAL 保留 | **NOT_RUN** |
| 3 | `VERIFY_BACKUP` | 备份校验失败，live 不变 | **NOT_RUN** |
| 4 | `STAGE` | 临时副本不完整，live 不变，临时文件清理 | **NOT_RUN** |
| 5 | `VERIFY_STAGED` | 临时副本校验失败，live 不变 | **NOT_RUN** |
| 6 | `COMMIT` | sidecar 已删但 rename 未发生，live 不完整 | **NOT_RUN** |
| 7 | `VERIFY` | 新 DB 已发布但恢复后校验失败 | **NOT_RUN** |
| 8 | `COMPLETE` | 已发布且校验通过 | **NOT_RUN** |

本表是**待执行清单**，不是 PASS。`recovery-state-machine.test.mjs` 只验证阶段
顺序与单点选择。

## 2. 已执行的 SQLite 故障

| 故障 | 结果 | 证据 |
| --- | --- | --- |
| busy checkpoint（真实第二个连接） | **PASS**：checkpoint 非零退出，WAL 保留 | `checkpoint-safety.test.mjs` |
| 损坏 DB（文件头） | **PASS**：整组文件 SHA 不变，应用日志识别 | CI normal 套件 |
| 只读目录 | **PASS**：DB/sidecar chmod，恢复后 B 迁移 | CI normal 套件 |
| 中断 migration | **PASS**：第一条列提交后 SIGKILL，重启收敛 | CI normal 套件 |
| 备份恢复 | **PASS**：最早备份、A 快照校验、A 启动读回 | CI normal 套件 |
| 降级 B 快照 | **PASS**：A 读取后字段比较 | CI normal 套件 |

## 3. 磁盘满（ENOSPC）

| 场景 | 状态 | 原因 |
| --- | --- | --- |
| 备份 VACUUM 时 ENOSPC | **NOT_RUN** | 未建立安全的小容量卷 |
| 备份写一半 ENOSPC | **NOT_RUN** | 同上 |
| migration/WAL ENOSPC | **NOT_RUN** | 同上 |
| staged restore ENOSPC | **NOT_RUN** | 同上 |
| 目录 fsync 失败 | **NOT_RUN** | 未实现故障注入 |
| 安装 B 空间不足 | **NOT_RUN** | 同上 |

禁止用简单 `throw Error` 冒充真实 ENOSPC；未填满共享 runner 根分区。

## 4. 进程/文件句柄

- 直接子进程：已用真实 exit/close 事件管理；
- 进程组/WebKit/PTY 子进程/lsof：**NOT_RUN**；
- 恢复前检查数据库是否被其他连接持有：只依赖 checkpoint busy，不依赖 lsof。

## 5. 判定

`SQLITE_RECOVERY_CRASH_SAFETY_VERIFIED = PARTIAL`
`BUSY_CHECKPOINT_VERIFIED = YES`
`DISK_FULL_RECOVERY_VERIFIED = NOT_RUN`
