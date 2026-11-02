# 同步完整性端到端验证（P9.2-6）

> 采集于 2026-11-02，本机真实 PostgreSQL 16（`127.0.0.1:5432`）。
> 命令：`pnpm --filter=team-server test:pg`
> 结果：**9 个文件 / 80 项全绿，25.56 s**。

## 1. 这一套测的到底是什么

同步缺陷的共同形状是「写成功但没写对」：HTTP 200、行数 1、返回值里没有 `error`，
数据却错了或丢了。这类缺陷**单元测试测不出来**——它需要一个真数据库、一个真服务端、
两个真客户端，以及一条真的网络边界。所以这套测试的接缝只有一个：

| 层 | 真实性 |
| --- | --- |
| PostgreSQL | **真**（本机 16，`prisma migrate deploy` 建库） |
| `SyncService` / `SharesService` | **真**（从 `src/sync/` 直接 import，不 mock Prisma） |
| 前端 store（`team-actions-sync` / `team-actions-data`） | **真**（经 `vitest.pg.config.ts` 的 `@` 别名加载 `packages/frontend/src`） |
| 客户端 SQLite | **真**（`node:sqlite` 内存库，每个客户端一套） |
| `localStorage`（游标） | 内存实现，接口与浏览器一致 |
| **网络** | **唯一被替换的东西**：`globalThis.fetch` 换成把请求投给真实 `SyncService` 的桥 |

也就是说：除了传输层是进程内函数调用，**其它每一层都是生产代码**。
两个客户端各自 `vi.resetModules()` 拿到独立的模块实例，因而持有独立的 SQLite 库——
这是「一个进程里跑两个客户端」不互相污染的关键。

失败注入（法定的失败，不是 mock 掉成功路径）通过同一个 `fetch` 桥的 `inject` 钩子实现，
用来复现 5xx、`200 {success:false}`、空 body、非法 JSON 这几种真实会遇到的响应。

## 2. 九个文件与它们的分工

| 文件 | 项数 | 职责 | 本轮新增 |
| --- | --- | --- | --- |
| `client-sync-e2e.pg-spec.ts` | 6 | 一条主链路：create → pull → edit → conflict → resolve → 重新汇合；外加作用域/成员关系 5 条 | 扩展 |
| `dual-client-sync.pg-spec.ts` | 14 | **两客户端**并发与全部失败路径（C1–C12） | ✅ 新增 |
| `conflict-cas.pg-spec.ts` | 4 | P9.2-1 条件写绕过 | ✅ 新增 |
| `conflict-sensitivity.pg-spec.ts` | 6 | P9.2-2 敏感数据在冲突解决中的不变量 | ✅ 新增 |
| `conflict-version-protocol.pg-spec.ts` | 5 | P9.2-5 毫秒墙钟 vs 版本协议 | ✅ 新增 |
| `sync-pagination.pg-spec.ts` | 16 | 游标分页、旧协议兼容、旧客户端写入 | — |
| `share-concurrency.pg-spec.ts` | 13 | 并发语义 + 协议故障注入 | — |
| `version-contract.pg-spec.ts` | 9 | share 版本契约与同毫秒并发 | — |
| `queue-lease-and-scope.pg-spec.ts` | 7 | 离线队列租约与写入边界 | — |
| **合计** | **80** | 上阶段 51 项 → 本轮 80 项（**新加 29 项**） | +29 |

## 3. 双客户端测试台

### 3.1 两个客户端的构造

```ts
async function createClient(name, userId, token) {
  vi.resetModules()                                   // 新的模块实例 = 新的 SQLite 库
  const { createSyncActions } = await import('@/store/team-actions-sync')
  const { createDataActions } = await import('@/store/team-actions-data')
  const { getDb, getSharedHosts, ... } = await import('@/service/database')
  await getDb()                                       // 打开这个客户端的库
  // ... 用真实 store 的 set/get 契约把 actions 接起来
  return { sync: () => sync.sync(), resolve: (r, id, d) => sync.syncWithConflictResolution(r, id, d), ... }
}
```

`vi.mock('@tauri-apps/plugin-sql')` 把插件的 `Database.load()` 换成 `node:sqlite` 的
内存库，并把每个库塞进 `sqlite.databases`，这样测试可以直接读**客户端本地行**做断言——
不是读 store 的快照，是读真实落盘的行（`host_data` / `version` / `dirty` /
`is_sensitive` / `encrypted_data` / `permission`）。

### 3.2 网络桥

```ts
globalThis.fetch = async (input, init) => {
  const token = headers.Authorization.replace('Bearer ', '')
  const userId = token === TOKEN_A ? USER_A : token === TOKEN_B ? USER_B : ''
  const path = url.pathname.replace(/^\/api\/v1/, '')
  const injected = inject?.(path, body)          // 失败注入优先
  if (injected) return injected
  if (!userId) return new Response('{"message":"Unauthorized"}', { status: 401 })
  // GET /sync · POST /sync · POST /sync/conflicts/resolve · GET /teams/:id/shares/:id
}
```

四个路由，全部落到真实服务方法。异常按 Nest 的规则映射状态码：`HttpException.status`
用它自己的，其余一律 500——所以服务端的一条 `BadRequestException` 在客户端看来就是一个
真实的 400，而不是被吞成一个泛化的失败。

## 4. 十二个端到端场景（C1–C12）

| # | 场景 | 断言的核心 |
| --- | --- | --- |
| C1 | 两客户端并发改同一条 | 后写者拿到冲突，先写者数据在服务端**未被覆盖**；后写者本地编辑仍在且仍 `dirty` |
| C2 | 敏感共享 + 非创建者 LOCAL 解决 | 服务端保持敏感、保持原密文、`data` 仍为 `{}`；冲突保留 |
| C2b | 敏感共享 + 创建者 LOCAL 解决 | 写回密文，`data` 仍为 `{}` |
| C3 | REMOTE 解决 | **先落库**（内容、版本、`dirty=0` 三项都对上）**再删冲突** |
| C4 | REMOTE 读不到快照（503） | 冲突保留、本地编辑保留、错误被明确报告 |
| C5 | `200 {success:false}` | 冲突保留、错误文本含 `CONFLICT_STALE_VERSION`、服务端一个字节没变 |
| C6 | 空 body / 非法 JSON | 两种都判失败，冲突保留 |
| C7 | 解决期间第三方又写入 | LOCAL 被拒绝为过期版本，服务端保留第三方数据 |
| C8 | 解决后两端重新收敛 | 两端内容、版本、`dirty` 与冲突列表全部对齐 |
| C9 | 未同步成功的本地创建 | 后续拉取不得丢弃它；恢复网络后能推上去 |
| C10 | 先删除后远端重建 | 本地不得复活旧内容 |
| C10b | 没证明见过删除的 CREATE | 服务端拒绝复活，且自己不复活 |
| C11 | 两端各持不同记录 | 一次同步后两边的数据都还在 |
| C12 | 拉取被截断（600 条） | 单页 ≤ 200；持续同步后 600 条全部到位，游标合法 |

C1/C3/C5/C7 是这一轮修掉的五个 P0 缺陷的**直接回归**——它们在没有修复的代码上是红的。
C4/C6/C9 覆盖「失败不得伪装成成功」，C10/C10b/C11/C12 覆盖删除、崩溃与分页边界。

## 5. 断言写的是「落盘」而不是「返回值」

一个刻意的取舍：几乎每条用例都读**服务端行**与**客户端行**，而不只看函数返回值。

```ts
await clientB.resolve('REMOTE', id)
const local = clientB.row(id)                    // ← 读 SQLite 里的真实行
expect(JSON.parse(String(local?.host_data))).toEqual({ name: 'by-a' })
expect(Number(local?.version)).toBe(Number(remote?.version))
expect(local?.dirty).toBe(0)
expect(clientB.state().syncConflicts).toEqual([]) // ← 只有落库之后才为空
```

原因很直接：这批缺陷里有三个的返回值和实际效果不一致（成功但没写、写了但写错、
没写也没报错）。只看返回值等于让被测代码自己给自己判卷。

## 6. 已注意到但未覆盖的部分

- **前端 UI 层**：冲突对话框的点击路径没有 E2E。`team-actions-sync-conflict.ts` 的
  状态机被覆盖了，React 组件本身只有单测。
- **多进程真实浏览器**：两个客户端是同一 Node 进程里的两个模块实例。它证明的是
  **协议与存储**的并发正确性，不证明两个物理设备的网络时序。
- **服务端多副本**：`SyncService` 是单实例直连 PG。多副本下的队列租约由
  `queue-lease-and-scope.pg-spec.ts` 用两个连接池覆盖，但那不是两个进程。
- **Windows 路径与大小写**：SQLite 在 macOS 上默认大小写不敏感、Linux 上敏感，
  测试只在 macOS 上跑过。

## 7. 复现

```bash
# 前置：本机 PostgreSQL 16 在 127.0.0.1:5432，当前用户可建库
pg_isready -h 127.0.0.1 -p 5432

# 全量
pnpm --filter=team-server test:pg

# 只跑本轮新增的四套（29 项）
pnpm --filter=team-server exec vitest run --config vitest.pg.config.ts \
  src/__tests__/pg/conflict-cas.pg-spec.ts \
  src/__tests__/pg/conflict-sensitivity.pg-spec.ts \
  src/__tests__/pg/conflict-version-protocol.pg-spec.ts \
  src/__tests__/pg/dual-client-sync.pg-spec.ts

# 用别的库（CI 用这条）
TEAM_SERVER_TEST_DATABASE_URL=postgresql://user:pass@127.0.0.1:5432/db \
  pnpm --filter=team-server test:pg
```

`pg-global-setup.ts` 会建库并跑 `prisma migrate deploy`，`beforeEach` 会
`TRUNCATE ... RESTART IDENTITY CASCADE` 清表，所以套件之间没有顺序依赖
（`fileParallelism: false` 是因为共享同一个库，不是因为有顺序耦合）。

## 8. CI 里的位置

`.github/workflows/ci.yml` 的 `team-server` job 起一个 `postgres:16-alpine` service，
跑完单测与构建后：

```yaml
- name: Apply migrations
- name: Verify migrated database matches schema
- name: Team Server concurrency suite (real PostgreSQL)
  env:
    TEAM_SERVER_TEST_DATABASE_URL: postgresql://postgres:ci-password@127.0.0.1:5432/team_server_concurrency_test
  run: pnpm exec vitest run --config vitest.pg.config.ts
```

这一段在本轮之前就存在（它当时只跑 4 个文件）。本轮新增的 4 个文件通过
`vitest.pg.config.ts` 的 `include: ['src/__tests__/pg/*.pg-spec.ts']` 自动被收进来，
**CI 配置没有为本轮的新增测试单独加一行**——这是一个有意的设计：新增 pg-spec
不需要同时改 workflow，否则「忘了改 workflow」就会让新测试静默不跑。
