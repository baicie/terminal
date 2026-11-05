# Phase 9.5.3 — Team Sync Client Migration

> 日期：2026-11-05
> 判定：`TEAM_SYNC_CLIENT_UPGRADE_VERIFIED = NOT_RUN`
> 已有：`TEAM_SYNC_AFTER_UPGRADE = PARTIAL`（服务端 HTTP 同步）

## 1. 已有证据

- Phase 9.5.2 修复 `TeamMember.joinedTxid` BigInt HTTP 序列化；
- `real-server-sync.pg-spec.ts` 启动 full `AppModule`，真实 `ApiKeyGuard`、
  `ValidationPipe`、Prisma、PostgreSQL 和 `fetch`，完成注册/建队/加成员/
  push/pull/update；
- 全量 PG：12 文件 / 96 项通过。

这证明**服务端 HTTP 与数据库同步**，不证明 A→B 客户端升级。

## 2. 缺口

现有 `client-sync-e2e.pg-spec.ts` 和 `dual-client-sync.pg-spec.ts` 用 in-process
`fetch` 桥调用 `SyncService`，不是真实 HTTP；`cloudCreateTeam` 未接 UI；客户端
离线队列实际是 dirty-row 重试，不是 `sync_queue` outbox。

要完成 A→B 需要：

1. 抽出真实 `createClient` helper，使用真实 server URL 和 `fetch`；
2. 在隔离 PG 启动真实 Team Server；
3. A 注册/登录，push host/snippet，离线编辑产生 dirty row；
4. 升级到 B（同一客户端代码/构建切换）；
5. B 重新认证、flush dirty row、pull；
6. 注入 REMOTE/LOCAL 冲突、删除传播、断线重试、重复同步幂等；
7. 第二客户端检查最终收敛。

## 3. 判定

- Local persistence：**PARTIAL**（本地 5 张表）
- Server HTTP sync：**YES**（Phase 9.5.2）
- Current-client integration：**PARTIAL**（客户端 store 的 in-process 桥）
- Actual cross-version client migration：**NOT_RUN**

因此 `TEAM_SYNC_CLIENT_UPGRADE_VERIFIED = NOT_RUN`；不得把服务端 HTTP 测试写成
跨版本客户端 PASS。
