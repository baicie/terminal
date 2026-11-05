# Phase 9.5.4 — Real Crash-Point Matrix

> 日期：2026-11-05
> 判定：`REAL_CRASH_POINT_MATRIX_VERIFIED = NOT_RUN`

## 1. 状态

`recovery-state-machine.mjs` 有 8 个阶段和 `crashPoint()`，但当前实现是
**同一进程抛异常**，不是独立 worker 的真实终止。父进程没有：

- 独立 recovery worker；
- stage marker 与 PID 归属证明；
- kill 前后文件集合 SHA；
- worker 停止确认；
- 崩溃后恢复重试；
- A/B 启动读回。

## 2. 已完成

- 阶段顺序断言；
- 单点 crash point 选择；
- `TERMINAL_TEST_CRASH=1` 显式开关；
- `backup restore stages` 报告。

## 3. 未完成

| stage | 状态 |
| --- | --- |
| PREPARE | NOT_RUN |
| QUIESCE | NOT_RUN |
| VERIFY_BACKUP | NOT_RUN |
| STAGE | NOT_RUN |
| VERIFY_STAGED | NOT_RUN |
| COMMIT | NOT_RUN |
| VERIFY | NOT_RUN |
| COMPLETE | NOT_RUN |

下一步必须实现独立 worker、真实 SIGKILL/exit、文件集合快照与恢复重试；不能用
异常模拟冒充。
