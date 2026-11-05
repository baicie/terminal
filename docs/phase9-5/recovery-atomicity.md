# Phase 9.5.4 — Recovery Atomicity

> 日期：2026-11-05
> 判定：`SQLITE_RECOVERY_ATOMICITY_VERIFIED = PARTIAL`、
> `RECOVERY_RETRY_VERIFIED = NOT_RUN`

## 1. 已验证

- checkpoint 失败即中止；
- sidecar 在 rename 前删除；
- staged 副本先校验再发布；
- 恢复后 A 启动、schema 等待、字段比较；
- 报告记录 8 阶段序列。

## 2. 未验证

| 场景 | 状态 |
| --- | --- |
| 删除 sidecar 前崩溃 | NOT_RUN |
| 删除 sidecar 后、rename 前崩溃 | NOT_RUN |
| rename 后、fsync 前崩溃 | NOT_RUN |
| 目录 fsync 失败 | NOT_RUN |
| 重复恢复幂等 | NOT_RUN |
| 崩溃后恢复重试 | NOT_RUN |

当前 `crashPoint()` 仅为 JS 异常 hook，不是独立进程终止实验；不得把它写成
真实 crash-safety PASS。
