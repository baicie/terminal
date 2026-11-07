# Phase 9.7 WP3 — Team Sync Cross-Version Acceptance

> 分支 `feat/phase9-7-product-acceptance`（Draft PR #9）
> 基线：`42990ce`；P0-A.2 代码 `5e8ce13`

## 1. 已有真实基础

`Team Server quality` 在 CI 中运行真实 PostgreSQL 的并发套件：

- `packages/team-server/src/__tests__/pg/client-sync-e2e.pg-spec.ts`
- `packages/team-server/src/__tests__/pg/dual-client-sync.pg-spec.ts`

这些测试启动完整 Nest `AppModule`、真实 PostgreSQL、Auth/ApiKeyGuard/
ValidationPipe，并通过 `fetch` 桥接直接调用真实 `SyncService`；客户端一侧使用
真实 store/actions、`node:sqlite` 本地数据库、游标持久化与 dirty row 逻辑。
它们是**真实 HTTP + 真实 PG + 真实客户端持久化**，但不是两个不同版本的桌面
客户端进程。

## 2. A→B 跨版本缺口

- 历史客户端 `0.0.1-dev.1` 的同步实现早于当前 dirty-row/游标字段，直接把它
  接到当前服务端会掩盖协议差异；
- 没有可插桩的历史桌面二进制，无法在 A 内运行当前测试入口；
- 因此 `TEAM_CROSS_VERSION_A_TO_B_VERIFIED=NOT_RUN`。

把同一源码编译成两个版本号**不构成**跨版本验收，本轮明确不这样做。

## 3. 计划中的跨版本运行器

1. 从 tag `v0.0.1-dev.1` 构建真实 A 客户端（隔离数据目录）。
2. 当前 HEAD 构建 B；第三个当前客户端 C 使用独立数据库。
3. 启动隔离 PostgreSQL + 真实 Nest 服务。
4. A 注册/认证、创建 Team、创建 Host/Snippet、push；C pull 校验。
5. A 断网修改 Host/Snippet 产生 dirty rows，退出。
6. 同一数据目录升级到 B，执行本地 schema 迁移，恢复认证。
7. B flush 未同步修改、pull 最新数据；C 再 pull 校验最终状态。
8. B 重启再同步，验证幂等与无重复对象。
9. 负向矩阵：409/428、REMOTE/LOCAL 冲突、并发编辑、tombstone、断网重试、
   认证过期、响应丢失但服务端已提交、cursor 回退、BigInt 序列化、敏感字段。

## 4. 判定

```text
TEAM_REAL_SERVER_HTTP_VERIFIED=PASS
TEAM_REAL_CLIENT_RUNTIME_VERIFIED=PARTIAL
TEAM_CROSS_VERSION_A_TO_B_VERIFIED=NOT_RUN
TEAM_DIRTY_RETRY_VERIFIED=PARTIAL
TEAM_CONFLICT_SAFETY_VERIFIED=PARTIAL
TEAM_DELETE_PROPAGATION_VERIFIED=PARTIAL
```

- `TEAM_REAL_SERVER_HTTP_VERIFIED`：CI `Team Server quality` 的真实 PG 套件。
- `TEAM_REAL_CLIENT_RUNTIME_VERIFIED=PARTIAL`：客户端 store/SQLite/游标走生产
  代码，但运行在同一测试进程，不是两个桌面客户端。
- dirty/冲突/tombstone 已有部分覆盖；A→B 升级前后语义未验证，保持 PARTIAL。

## 5. 未完成

- 真实历史客户端二进制与当前客户端的 A→B 链。
- 桌面 UI 集成验收（`cloudCreateTeam` 调用链已有前端服务，但本轮未做 UI 驱动）。
- 断网/响应丢失/服务端已提交后的幂等证据需要真实客户端运行时。
