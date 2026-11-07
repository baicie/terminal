# Phase 9.5.2 — Team Sync Server E2E

> 日期：2026-11-05
> 代码：`packages/team-server/src/__tests__/pg/real-server-sync.pg-spec.ts`
> 修复：`teams/team-response.ts`（BigInt HTTP 序列化）
> 判定：`TEAM_SYNC_AFTER_UPGRADE = PARTIAL`

## 1. 发现的问题

- `POST /api/v1/teams` 与成员接口直接返回 Prisma `TeamMember`，其中
  `joinedTxid` 是 `bigint`；`JSON.stringify` 抛错，Nest 在数据库写入后返回 500。
  这阻断了真实 HTTP 建队/加成员。
- 现有 client sync E2E 用 in-process `fetch` 桥直接调用 `SyncService`，不经过
  Nest 路由、`ApiKeyGuard`、全局 `ValidationPipe` 和 JSON 序列化；另一个 Nest
  HTTP spec 只启动 SharesModule，没有 SyncController。
- 没有“真实服务器 + 客户端 store”的跨版本升级测试。

## 2. 本轮修复

`team-response.ts` 把 HTTP 边界的 `joinedTxid` 序列化为 string；内部
`SyncService`/`sync-delivery` 仍使用 bigint 做游标排序，不受影响。应用：
`TeamsService.create`、`MembersService.findAll/addMember/updateRole`。

## 3. 新增真实 Nest HTTP E2E

`real-server-sync.pg-spec.ts`：

1. `Test.createTestingModule({ imports: [AppModule] })`，完整 `api/v1` 前缀和
   `ValidationPipe`，监听 `127.0.0.1:0`；
2. 通过 `POST /api/v1/auth/register` 注册两个临时用户，取得真实 Bearer token；
3. `POST /api/v1/teams` 建队，断言 `members[0].joinedTxid` 是 string（BigInt
   修复）；
4. `POST /api/v1/teams/:id/members` 加入第二个用户；
5. `POST /api/v1/sync` 推送一个 HOST share，断言 `created`；
6. B `GET /api/v1/sync?since=0` 看到该 share；
7. B 用服务端 `version` 作为 `baseVersion` 更新，断言 `updated`；
8. A 再次 pull，断言数据已更新。

全部经过真实 Nest 路由、ApiKeyGuard、ValidationPipe、Prisma、PostgreSQL 和
真实 `fetch`；没有 in-process 桥。

## 4. 真实结果

```bash
TEAM_SERVER_TEST_DATABASE_URL=postgresql://.../team_server_e2e_952 \
  pnpm --filter=team-server exec vitest run --config vitest.pg.config.ts
```

- 全量 PG 套件：**12 files / 96 tests passed**（含新增 2 项）。
- Team Server 单测：**25 files / 119 tests passed**。
- 本地 PostgreSQL 17.10，隔离数据库 `team_server_e2e_952`；CI 使用独立
  `postgres:16-alpine` service。

## 5. 证据边界

- 这是**服务端 HTTP API** 的真实同步，不是“A 客户端升级到 B 后重新认证并
  pull/push”的跨版本客户端链。
- 没有验证冲突解决、多客户端并发、离线 dirty-row retry、删除传播；这些在
  现有 service-level PG 测试中有覆盖，但不在本轮新 spec 中。
- 前端 `cloudCreateTeam` 仍不是创建云团队的调用路径；本轮 spec 用 HTTP 建队。
- `TEAM_SYNC_AFTER_UPGRADE = PARTIAL`：真实 HTTP 同步 PASS，跨版本客户端
  升级链 **NOT_RUN**。

## 6. 后续

1. 把 `createClient` 抽成可复用 helper，使用真实 `fetch` 和真实 server URL，
   跑 A→B 两版本客户端。
2. 增加断网→本地编辑→恢复→dirty-row 重试，以及 REMOTE/LOCAL 冲突。
3. 把 `cloudCreateTeam` 接到 UI 并持久化服务端 team id。
4. 在 release gate 中区分“本地表持久化”“HTTP 同步”“跨版本同步”三种证据。
