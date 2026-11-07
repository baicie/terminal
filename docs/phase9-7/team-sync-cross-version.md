# Phase 9.7 WP3 — Team Sync Cross-Version Acceptance

> 分支 `feat/phase9-7-product-acceptance`（Draft PR #9）
> 基线：`42990ce`；本轮实现见 `scripts/verify-install/team-cross-version.mjs`

## 1. 结论先行

```text
TEAM_CROSS_VERSION_A_TO_B_VERIFIED=FAIL
TEAM_CROSS_VERSION_DIRTY_ROW_UPGRADE=PASS
TEAM_CROSS_VERSION_TOMBSTONE_CONSUMED=FAIL
TEAM_CROSS_VERSION_TOMBSTONE_RESURRECTION=NOT_RUN
TEAM_CROSS_VERSION_UPDATE_SAFETY=PASS
```

历史客户端能在空服务器上完成**首次**推送与拉取；一旦服务器上已有数据，它的下一次
同步就会失败。这不是环境问题，是两条代码路径的真实不兼容，证据见 §4。

## 2. 历史 A 的选取（与旧计划的修正）

所有已发布 tag 都早于 dirty-row / cursor 协议：

| tag | 日期 | `dirty`/`cursor` |
| --- | --- | --- |
| `v0.0.1-dev.1` | 2026-08-12 | 无 |
| `v0.0.1-dev.2` | 2026-10-29 | 无 |

因此"让历史 A 产生脏行再升级"在物理上不存在：`dirty` 列、游标协议和
`pushLocalShares` 都是 Phase 9.2 之后才进入前端的。旧计划（从 dev.1 构建 A 并制造
脏行）不成立，本轮改用可验证的写法：

- **A** = `v0.0.1-dev.2` 的前端源码，固定 commit `835fae82…`、tree
  `460ce93a…`，由 `git archive` 物化到 `packages/team-server/.tmp/team-sync-a`；
- **B/current** = 当前 HEAD 的前端源码；
- 脏行由**当前客户端在 A 生成的数据库上**产生：这正是"升级后第一次离线编辑"的
  真实路径。

把同一份源码改两个版本号仍然不算跨版本验收，本轮没有这样做。

## 3. 运行结构（每条都是真进程）

```text
当前 Nest AppModule ── 真实 PostgreSQL
      ▲  真实 HTTP
      │
 ┌────┴──────────────┬─────────────────────┬────────────────────┐
 A seed 进程         B upgrade 进程         B peer 进程         A verify 进程
 (dev.2 源码)        (当前源码)             (当前源码)          (dev.2 源码)
 本地 a.db           a.db 的副本 + 迁移     本地 peer.db        再次打开 a.db
```

- 服务端：`src/cross-version-server/main.ts`，生产 `AppModule`、真实
  `ApiKeyGuard`/`ValidationPipe`、真实 PostgreSQL；经 `tsc` 构建后由 `node`
  启动（`tsx` 不发射 `design:paramtypes`，DI 会全空）。
- 前端：vitest 以不同 alias 指向两份源码树，`@` 在 A 进程里只解析历史树，
  当前模块不可能混入 A。
- SQLite：每个客户端一个磁盘文件，不是 `:memory:`；升级前先
  `wal_checkpoint(TRUNCATE)` 再复制（第一次实现只复制主文件，WAL 里的行丢失，
  被升级阶段当场发现）。
- 用户与团队：注册、建团队、加成员走真实 HTTP；A/B 身份不同。

## 4. 实测结果与根因

### 4.1 A seed：PASS

A 用**自己的** `createDataActions.shareHost/shareSnippet` 在本地写入 2 台主机、
1 个 snippet，再调用自己的 `sync()`：拉取 → 推送 → 重载。服务端收到 3 条 share，
本地 3 行，`syncError=null`。

随后用 A 的 `teamApi.pushChanges` 重放它下一次同步会发的更新载荷
（`baseVersion = createdAt`，毫秒时间戳）：

```json
{ "conflictIds": ["<host-id>"], "errorIds": [], "requestError": null }
```

服务端 `classifyBaseVersion` 把毫秒时间戳判为 `legacy-timestamp`，**拒绝**该写入。
即：历史客户端不能更新已有 share，只能新建。这是安全的行为（不会覆盖新数据），
但对老客户端是功能降级。

### 4.2 B upgrade：PASS

当前客户端打开 A 数据库的副本：

- 迁移前列：`id, team_id, host_data, shared_by, permission, created_at`
- 迁移后新增：`version, updated_at, dirty, is_sensitive, encrypted_data`
- A 的 2 台主机 + 1 个 snippet 全部保留；
- 当前客户端离线编辑一台主机：`dirty` 从 `1` 到 `0`，服务端读到新内容。

`TEAM_CROSS_VERSION_DIRTY_ROW_UPGRADE=PASS`。

### 4.3 B peer：PASS

第二个身份在全新数据库上拉到 A 的 3 条 share，创建自己的 snippet 并推送，
再用自己的 token 删除；服务端不再返回该 share。

### 4.4 A verify：FAIL（本轮的关键发现）

A 的第二个进程从同一数据库重新水合，再同步。结果：

```text
sync error: Database query failed: UNIQUE constraint failed: team_shared_hosts.id
```

根因有两条，缺一不可：

1. **当前服务端把历史毫秒游标当成"超出安全水位"**：`resolveChangeWindowAnchor`
   看到 `cursor > safeNow`（safeNow 是 PostgreSQL 事务号，毫秒时间戳必然大于它），
   返回 `resync: true`；`readLegacyWindow` 不做时间过滤，直接返回整个窗口。
   历史客户端每次启动 `lastSyncAt` 都是 `null`（未持久化），因此每次都是全量。
2. **历史客户端用裸 `INSERT` 应用快照**：`addSharedHost` 是
   `INSERT INTO team_shared_hosts ...`，没有任何 `ON CONFLICT`。重新收到已经存在的
   share 就触发 UNIQUE，异常向上冒泡，整轮同步中止。

所以：**任何在服务器上已有数据的 dev.2 客户端，下一次同步都会失败**。这不只是
"旧客户端不能改"，而是"旧客户端不能再次同步"。

A verify 在拉取阶段就中止，后续的 tombstone 消费与 stale-write 拒绝无法观测，
因此这两项记为 ``NOT_RUN`，而不是 `PASS` 或 `NOT_DETECTED`。

## 5. 影响与修复方向

- 旧客户端无法通过服务端兼容层修复：它既能被全量快照打断，也无法 upsert 单条更新。
  唯一安全的用户路径是**先升级客户端**，这正是 WP4 运行时升级链要解决的问题，
  而它仍是 `NOT_RUN`。
- 对新客户端而言，当前服务端的"无法证明的游标 → 全量重快照"是正确且必要的；
  不应用放宽 legacy 窗口的方式来迁就旧客户端，否则会掩盖数据丢失。
- 如果必须支持旧客户端，服务端只能替换命令面（真正的版本化 API），
  不能靠调整 `readLegacyWindow` 的过滤条件。

## 6. 复现

```bash
TEAM_SERVER_TEST_DATABASE_URL=postgresql://<user>@127.0.0.1:5432/team_cross_version \
  node scripts/verify-install/team-cross-version.mjs
```

报告写到 `team-cross-version-report.json`，包含历史 commit/tree、每个阶段的
退出码、断言明细与本文引用的 finding。CI 中该步骤是**诊断**（`continue-on-error`），
因为当前的 `FAIL` 是已知发现；把它改成阻塞是修复的任务，不是采集器的任务。

## 7. 未完成

- 真实桌面二进制（dev.2 安装包）在 UI 上驱动的 A→B；当前用的是同一 tag 的前端
  源码与真实进程，不是 UI 自动化。
- 旧客户端删除操作的 tombstone 消费（被 4.4 阻断）。
- 断网/响应丢失/服务端已提交的幂等重放。
