# Phase 9.5.4 — ENOSPC Verification

> 日期：2026-11-05
> 判定：`ENOSPC_RECOVERY_VERIFIED = NOT_RUN`

本轮没有建立安全、可销毁、与 runner 根分区隔离的小容量卷。因此以下全部
NOT_RUN：

- 备份 VACUUM 时 ENOSPC；
- 备份写一半 ENOSPC；
- migration/WAL ENOSPC；
- staged restore ENOSPC；
- 目录 fsync 失败；
- 安装 B 空间不足；
- ENOSPC 后恢复重试。

禁止用 `throw new Error('ENOSPC')` 冒充真实磁盘故障，也不得填满共享 runner
根文件系统。

必须使用一次性 VM 或受控小容量卷；测试后自动销毁，原始数据可读、备份不被覆盖。
