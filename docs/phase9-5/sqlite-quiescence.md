# Phase 9.5.4 — SQLite Quiescence

> 日期：2026-11-05
> 判定：`SQLITE_RECOVERY_ATOMICITY_VERIFIED = PARTIAL`

## 1. 恢复前检查

`replaceWithBackup()` 的顺序：

```
PREPARE
→ QUIESCE（checkpoint busy/log/checkpointed + WAL 空）
→ VERIFY_BACKUP（A 快照、forbid B 列）
→ STAGE（复制临时文件 + fsync）
→ VERIFY_STAGED（再次验证）
→ COMMIT（删 sidecar、fsync 目录、rename、fsync 目录）
→ VERIFY
→ COMPLETE
```

`backup restore stages` 写入报告；`assertStageOrder` 拒绝回退顺序。

## 2. 连接/文件句柄

- checkpoint 使用真实 SQLite 返回值，busy 非零即失败；
- `quiescence.mjs` 在进程停止后探测 DB/WAL/SHM/journal 的 `lsof` 持有者；
- 发现持有者即 FAIL；
- 没有 lsof 时标记 NOT_RUN，不伪造 PASS；
- 进程组/WebKit/PTY 未枚举，仍是 NOT_RUN。

## 3. 仍未证明

- sidecar 删除与 rename 之间崩溃后的状态；
- rename 后 fsync 前崩溃；
- 目录 fsync 失败；
- 重复恢复幂等；
- 旧 live DB 的独立可恢复副本是否在所有分支保留；
- ENOSPC。

本轮只把顺序、checkpoint 和 quiescence 做成显式门禁，**没有**声称多文件恢复
在任意 crash 下原子。
