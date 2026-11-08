# Phase 9.8-B1 — Team API 单例与同步身份隔离

分支 `feat/phase9-8-b-sync-isolation`，base `feat/phase9-7-product-acceptance`。

## 根因

`teamApi` 是可变单例：`configure(endpoint, token, userId)` 修改实例字段，而一次
同步 round 在多个 `await` 之间跨页运行。任何其他功能（切换 workspace、创建团队、
读取共享）在这期间调用 `configure()`，第 2 页就会带着新的 endpoint/token/userId
发出去——两个服务器、两个身份被混进同一个游标槽位。原实现只在响应里比较
`window.userId`，无法发现“请求已经发给了另一个服务器”。

## 实现

1. **不可变请求上下文**（`service/team-api-base.ts`）
   - `context(): TeamApiContext` 取当前配置；
   - `forContext(context): this` 返回一份新实例，字段在生命周期内不再改变。
2. **同步 round 固定**（`store/team-actions-sync.ts`）
   - round 开始时取 `teamApi.forContext(...)`，之后所有分页与推送只用这个副本；
   - `isCurrent()` 比较 store 中的 endpoint / apiToken / userProfile.id 与 round
     起点；任一变化（切换工作区、换账号、令牌轮换）即视为过期。
3. **分页边界与游标**（`store/team-sync-engine.ts`、`store/team-sync-round.ts`）
   - 每页请求前、响应后、持久化游标前、修剪本地行前都校验 round 仍然有效；
   - 过期时抛 `SyncRoundStaleError`：不再发下一页、不应用已返回的页、不推进
     游标、不修剪、不写 `lastSyncAt`；
   - 已应用的旧页保留（它们属于旧 scope），新 scope 不会被标成“已同步”。
4. **推送**使用 round 的客户端（`pushLocalShares(..., round.api)`），避免推送
   落到另一个服务器/身份。

## 测试

`packages/frontend/src/store/team-sync-isolation.test.ts`，两个**真实 HTTP 服务端**
（`node:http`，各自记录请求路径与 Authorization），3 项全部通过：

1. **凭据快照**：第 2 页在途时对单例调用 `configure(B, token-b, user-b)`；round
   仍向 A 发第 2 页，两个请求都带 `Bearer token-a`，B 收到 0 个请求，round 正常
   完成（`lastSyncAt` 被写入）。
2. **真实工作区切换**：第 2 页在途时修改 store 的 endpoint/token/userProfile；
   第 2 页返回后被丢弃，`addSharedHost` 只收到第 1 页，B 收到 0 个请求，
   `removeUnauthorizedTeamShares` 未调用，A 的游标停在已完整应用的第 1 页，
   B 的游标为 null，`syncError` 记录 round 过期。
3. **令牌轮换**：请求在途时轮换 apiToken；该页不被应用，不写 `lastSyncAt`。

## 验收判定

| 项 | 判定 | 证据 |
| --- | --- | --- |
| `TEAM_SYNC_ENDPOINT_ISOLATION` | **PASS** | 真实双服务端测试 1、2：B 在 A 的 round 中收到 0 个请求 |
| `TEAM_SYNC_CREDENTIAL_SNAPSHOT` | **PASS** | 测试 1：单例被改写后第 2 页仍用 round 的 `token-a` |
| `TEAM_SYNC_STALE_ROUND_REJECTED` | **PASS** | 测试 2、3：过期 round 不应用页、不推进游标、不写 `lastSyncAt` |
| `TEAM_CROSS_SCOPE_DATA_PRESERVED` | **PASS** | 测试 2：A 游标保留在已应用页，B 游标为 null，未修剪、未删共享 |

## 未覆盖 / 边界

- 已应用的旧页数据留在本地（本地表不按 endpoint 分区，这是既有模型）；本修复
  保证的是“不再把旧 round 剩下的结果写进新 scope”。
- 单次非分页操作（`createTeam`、`listShares` 等）仍通过单例发送；它们只有一个
  请求，不存在跨页混用，未纳入本轮改造。
