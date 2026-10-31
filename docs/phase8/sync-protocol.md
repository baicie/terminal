# Phase 8.8 Task A — Team Sync 协议正确性设计

状态：已实施（feat/phase8-rc-hardening）
范围：packages/team-server（NestJS + Prisma + PostgreSQL 16）、packages/frontend 团队同步
关联代码：src/sync/{sync.service,offline-sync.service,sync-protocol,sync.dto,sync-results}.ts、
prisma/migrations/20261101120000_sync_change_log/migration.sql、
packages/frontend/src/store/team-actions-sync.ts

---

## 0. 被替换的旧机制与它的三类漏洞（代码为准）

| # | 旧行为（证据） | 后果 |
| --- | --- | --- |
| 1 | 客户端 set({ lastSyncAt: Date.now() })（team-actions-sync.ts:153）作为下一轮 since | 本地时钟晚于服务端查询时刻，「查询之后、Date.now() 之前」被更新的记录永久跳过；客户端时钟偏差直接污染游标 |
| 2 | 客户端 baseVersion: item.createdAt（team-actions-sync.ts:127），服务端 existing.updatedAt.getTime() > baseVersion（offline-sync.service.ts:49、sync.service.ts:130） | createdAt <= updatedAt，行被更新过一次后客户端永远推不上去 |
| 3 | 服务端游标 = Date.now()（sync.service.ts:23），updatedAt BETWEEN since AND until（:38） | 先分配后提交的事务若提交晚于本轮 SELECT，其 updatedAt 落在本轮窗口内，下一轮 since=本轮 timestamp 排除它，永久漏同步（A4） |
| 4 | pushChanges 对已存在行无条件走 update（sync.service.ts:105-148），baseVersion 校验只在客户端给了值时才生效（:128-134） | CREATE 重放可以把较新数据覆盖成旧数据 |
| 5 | CREATE / UPDATE 共用一条 upsert 路径 | 协议层无法区分「首次创建」与「更新已有」，也就无法识别重放 |

新设计的三条不变量：

- INV-1（不丢）：任何一次已提交的写入，最终一定会出现在某个客户端某一轮的响应里。
- INV-2（不覆盖）：重放旧请求永远不会覆盖比它更新的已提交数据。
- INV-3（可重放）：同一请求重放任意次，数据库最终状态与只执行一次相同。

---

## 1. CREATE / UPDATE / DELETE 的语义、幂等键、重放识别

三者写同一张 Share 表，但协议意图不同，因此判定规则不同。客户端通过
PushShareDto.operation 显式声明意图；未声明时按「无版本写入」的旧客户端规则处理（见 §6）。

### 1.1 CREATE — 目标是「该 id 从不存在变为存在」

- 行不存在 → 创建。新行由数据库触发器分配 version（见 §2）。
- 行已存在：
  - 内容指纹相同（规范化 JSON 摘要一致）→ 幂等 ack：不写库、不 bump version、不出错误，
    id 落在响应的 updated 数组（保持既有 A1 契约）。这就是「重复重放识别」。
  - 内容指纹不同 → 返回 conflict，绝不覆盖（修复问题 4）。
- 该 id 存在墓碑（SyncChange.op='DELETE'）：
  - 客户端 baseVersion 缺失或小于墓碑 version → conflict（修复「先删后建丢失删除」，用例 S3）。
  - baseVersion >= 墓碑 version → 允许复活（客户端已证明自己看到了删除，那是用户的显式再创建）。
- 幂等键：(shareId, contentDigest)；contentDigest = 规范化 JSON（键排序、剔除 baseVersion）的 sha256。

### 1.2 UPDATE — 目标是「把该 id 从 baseVersion 推进到新内容」

- 必须携带服务端发放的 baseVersion（Share.version）。
- 行不存在 → conflict（不重建，修复「删除后被 update 复活」，用例 S3）。
- existing.version > baseVersion → conflict（有过更新的提交）。
- baseVersion 落在旧客户端时间戳域（>= 1e12，即 2001-09-09 之后的 ms 时间戳）→ conflict（见 §6）。
- baseVersion 缺失 → 退化为「无版本写入」：内容指纹相同 → 幂等 ack；不同 → conflict。
- 幂等键：(shareId, baseVersion, contentDigest)。重放时服务端把 version 与 baseVersion 比较：
  - 若客户端在收到响应后把新 version 写回本地，重放等价于一次普通 CAS（成功或 conflict，都不覆盖）；
  - 若响应丢失、客户端保留旧 baseVersion，重放拿到 conflict —— 这是期望行为（绝不静默二次写入）。

### 1.3 DELETE — 目标是「该 id 变为不存在」

- 行不存在 → 成功（幂等）。
- 行存在 → 删除。墓碑（SyncChange.op='DELETE' + 新 version）由数据库触发器在同一事务内写入。
- 幂等键：shareId。墓碑只在同一个删除事务里写一次，重复 DELETE 找不到行即短路。

### 1.4 重放识别的统一表述

服务端在响应的每条记录里返回 version；客户端把它作为下一次 push 的 baseVersion。
于是「重放」与「新写」在服务端看起来都一样，由 version 比较给出确定结论：
version 比 baseVersion 大，则这条重放是旧的，返回 conflict。
不依赖任何时间戳、不依赖「看起来像不像同一份内容」。

---

## 2. 版本条件：baseVersion 的语义

- Share.version BIGINT NOT NULL DEFAULT 0，由触发器在每一次 INSERT/UPDATE 时
  nextval('ShareVersion_seq') 分配。应用代码永远不写这一列。
- baseVersion = 客户端最后一次见到的该行 version。
- 版本域：[1, 2^53)。旧客户端时间戳阈值 LEGACY_TIMESTAMP_VERSION = 1e12。

- **唯一 CAS 条件是 `updateMany where { id, teamId, sharedBy, version }`**。
  **updatedAt 不参与任何最终判定。** （Phase 8.9 Task 2 前的实现在这里用
  `where { updatedAt: 读到的值 }`，那是错的，已移除。）

- 为什么不用 updatedAt：它由应用时钟驱动（Prisma @updatedAt），精度只有毫秒。
  同一毫秒的两次写入**不可区分**——实测同一毫秒内两次并发 UPDATE 会**都成功**
  （两个 winner），直接丢失更新。Phase 8.9 的 V8 用例进一步证明：同一毫秒内连续
  4 次 UPDATE，版本严格递增 10601→10604，而 updatedAt 完全相同。毫秒时间戳
  根本无法充当次序判据，version 才可以。

- 判定分类（Phase 8.9 Task 2）：

  | baseVersion | 结果 |
  | --- | --- |
  | == version，内容摘要相同 | 幂等 ack（不写库、不 bump 版本） |
  | == version，内容不同 | 条件写；count=1 → 成功，count=0 → conflict |
  | < version | conflict（stale） |
  | > version | conflict（**future**，Phase 8.9 新增；旧实现会放行写入） |
  | 缺失 / 负数 / 非安全整数 | conflict（unproven，fail-closed） |
  | >= 1e12 | conflict（legacy-timestamp，旧客户端不能用时间戳冒充版本） |

- 每行版本单调递增的论证：条件写的谓词是 `version = 读到的值`。两个并发 UPDATE 读到
  同一 version 时，后提交者在 READ COMMITTED 下重算谓词得到 count = 0（conflict），
  因此同一行上两次成功写入不可能交换顺序，version 在行内严格递增。
  这一点**不依赖 nextval 的分配顺序** —— 分配顺序只用于给号，不用于判序。

---

## 3. 游标正确性证明（核心）

### 3.1 三根支柱

1. 变更日志：SyncChange(seq BIGSERIAL, txid BIGINT, teamId, shareId, op, version, 快照列..., changedAt)。
   由 Share 表上的触发器在同一个事务内写入，因此「数据写入」与「变更记录」原子同生同灭。
   txid = pg_current_xact_id()::text::bigint（该事务的 xid8）。
2. 安全水位：safe = pg_snapshot_xmin(pg_current_snapshot())。
   PostgreSQL 定义：xmin 是取快照时仍在运行的最低事务 id；所有 txid < xmin 的事务
   已经结束（提交或回滚）。
3. 游标 = safe（十进制字符串，原样回传）。读取窗口 txid ∈ [since, safe)，按 seq 排序。

### 3.2 不丢的证明（INV-1）

设变更属于事务 T，txid(T) = x。

- 情形 A：取快照时 T 已结束。则 x < safe（否则 T 属于「仍在运行」，与已结束矛盾）。
  又因本轮读取语句的快照不早于取 xmin 的快照，T 的所有行可见，本轮必返回
  （若被 LIMIT 截断，见 §3.4）。
- 情形 B：取快照时 T 仍在运行。则 x >= safe，本轮不返回（可接受，因为 T 还没提交完）。
  T 结束后，下一轮取快照时 T 已结束，故 x < safe'；而 safe' >= safe（xmin 单调不减），
  所以 x ∈ [since' = safe, safe')，下一轮返回。

结论：不存在「被永久跳过」的提交。这里只用到了事务身份 x 与 xmin 的定义，
没有用到 sequence 的分配顺序，也没有用到任何时钟。特别地：SyncChange.seq（BIGSERIAL）
允许乱序提交（先分配后提交），它只用于同一批响应的展示排序，不参与游标推进。

### 3.3 为什么「只推进到没有更小序号事务在途的位置」是自动满足的

safe = xmin 正是那个位置：所有比它小的 txid 都不在途。因此无需额外维护「在途登记表」，
也不需要等待或心跳。

### 3.4 LIMIT 截断时的推进规则 —— **Phase 8.9 已改为复合分页位置**

> 旧表述「游标推进到已投递的最大 txid，下一轮 txid >= cursor 重投」是**错的**，已废弃。
> 旧实现 where 按 txid 过滤、orderBy 按 seq 排序、游标取最后一行 txid，排序与游标不同源，
> 有两个可复现的反例（Phase 8.9 Task 1 已在真实 PostgreSQL 上复现）：
>
> - **txid 与 seq 逆序**：某行 txid 更小但 seq 更大（排在页边界之后），下一页的
>   `txid >= X` 会把它**永久排除**。实测只交付 201/400，199 条永久漏同步。
> - **单事务超过一页**：一个事务 250 条同一 txid，首页 200 条后游标推进到 T，
>   下一页 `txid >= T` 又返回同样 200 条——**无限重复，永不前进**。

现在的规则：

- 分页位置是**复合值** `(txid, seq)`，排序 `orderBy [(txid asc),(seq asc)]`，
  边界 `(txid > t) OR (txid = t AND seq > s)`——**排序与过滤同源**，边界不可能横跨。
- 每轮的 `bound`（安全水位）**冻结**，整轮分页不重取，避免分页中途 xmin 前进造成窗口漂移。
- 同 share 的多次变更按**最大 seq** 折叠（不是迭代顺序），避免 (txid,seq) 序与写序不一致时取错行。
- 满页却未前进时有一个 `advanced` 守卫：降级为「到达终点」（hasMore=false），
  把假想回归变成终止而不是死循环。
- 恰好满页时会多出一次空页请求，这是键集分页的固有代价，用 hasMore=false 明确收尾。

### 3.5 游标失效检测

游标带**协议版本号**（当前为 2）。以下情形一律判定游标无效、`since = 0` 全量重同步并返回
`resync: true`：

- 游标格式非法，或协议版本号与当前实现不符
- 游标里的 `bound` 大于当前 safe —— 只可能来自旧客户端的 epoch-ms 时间戳（约 1.7e12）、
  pg_resetwal、数据库从备份还原、集群重建
- 游标里的 txid 大于当前 safe（同上）

旧客户端的 since（单一数字、epoch-ms）天然落在这些分支里，安全降级为全量重同步。

### 3.6 成立所依赖的假设，以及假设被违反时的行为

| 假设 | 违反后的行为 |
| --- | --- |
| A1 pg_current_snapshot()/pg_snapshot_xmin 语义成立（PostgreSQL >= 13；本仓库部署 16） | 语句直接报错失败（fail-closed），不会静默漏数据 |
| A2 xid8 单调不减（无 pg_resetwal / 非法还原） | 游标大于 safe，触发全量重同步（§3.5） |
| A3 所有写路径都写 Share 表（于是触发器覆盖完备） | 绕过表直接改库/禁用触发器会让该写入不进变更日志。检测 SQL 见 §8 |
| A4 触发器与数据写入在同一事务（由触发器定义保证） | 不存在「数据提交了但变更没提交」的中间态 |

不再依赖的假设（旧实现依赖它们，新实现不依赖）：客户端时钟、服务端时钟、
「查询期间被更新」的先后关系、sequence 分配顺序等于提交顺序。

---

## 4. 冲突返回与客户端处理

服务端 conflict 一律不写库。触发条件（sync.service）：

| # | 条件 | 含义 |
| --- | --- | --- |
| c1 | existing.version > baseVersion | 有过更新的提交 |
| c2 | baseVersion >= 1e12（旧客户端时间戳） | 无法证明新鲜度，拒绝 |
| c3 | CREATE 命中已存在行且内容指纹不同 | 拒绝覆盖 |
| c4 | CREATE 命中墓碑且 baseVersion 小于墓碑 version | 拒绝复活已删除项 |
| c5 | UPDATE 命中不存在行 | 拒绝复活已删除项 |
| c6 | 条件写 count = 0（读之后被并发提交） | 拒绝丢失更新 |

响应：{ created, updated, deleted, conflicts: string[], errors }。
conflicts 只含 id，语义是「没写」。

客户端处理（team-actions-sync.ts）：把冲突留在 syncConflicts（不清空、下一轮不清），
由用户通过 conflicts/resolve 显式选择 LOCAL（服务端写新 version）或 REMOTE（丢弃本地）。
用户意图不会静默丢失：冲突不入库、本地数据不被删、冲突项在 UI 里可见；
只有用户主动丢弃时才会丢，这是显式动作。

---

## 5. 客户端游标持久化

- 服务器在 GET /sync 响应里返回 `cursor`，是一个**不透明字符串**：
  `2.<bound>.<txid>.<seq>`，三个字段各自零填充到 20 位十进制。
  因此**游标字符串的字典序 == 位置数值序**，可以安全排序与比较，但客户端**不得**解析它——
  原样保存、原样回传。
- 客户端**不得**对游标做数值化（`Number(cursor)`、`parseInt`、时间戳互转）。协议版本升级时
  旧的数值化代码会静默产生错误游标。前端只允许用正则
  `/^\d{1,20}(?:\.\d{1,20})*$/` 做格式校验，不做语义解析。
- 客户端本地时钟只用于 UI 展示（lastSyncAt 显示「最后同步时间」），不再作为任何游标。
- 持久化键必须按 **服务器 / 用户 / 团队 / 协议版本** 隔离；单一全局 key 会在切服务器、
  换用户或换团队时串游标，把 A 的进度当成 B 的起点，直接造成漏同步或全量重扫。
  没有 localStorage 的环境（node 测试、纯内存宿主）退化为进程内变量。
- 写入时机：全部变更应用成功之后才持久化新游标。先存游标再应用会丢数据（崩溃窗口）。
- 离线重启：读到持久化游标则增量；读不到/被清空则无游标，服务端全量重同步
  （resync: true），客户端幂等 upsert 收敛。绝不用「上次成功时间」反推游标。
- 应用顺序：先 deletedShareIds（按响应顺序），再按 seq 升序 upsert 快照；
  同 id 的 upsert 幂等（INSERT ... ON CONFLICT(id) DO UPDATE），因此重投安全。

---

## 6. 旧客户端兼容策略（拒绝而不覆盖）

旧客户端的两个标志：baseVersion = createdAt（epoch-ms >= 1e12）、since = Date.now()（epoch-ms）。

| 能力 | 旧客户端行为 | 结论 |
| --- | --- | --- |
| 拉取 | since 是 epoch-ms，大于 safe，游标无效，全量重同步 | 降级但安全（多花带宽，不丢数据） |
| 创建全新 id | 走 CREATE，行不存在，正常创建 | 完全可用 |
| 更新已存在行 | baseVersion >= 1e12 判定为旧时间戳，返回 conflict | 拒绝（不覆盖；旧代码本来也推不上去，问题 2） |
| CREATE 重放已存在行 | 内容指纹相同则幂等 ack；不同则 conflict | 从「覆盖」改为「拒绝」 |
| conflicts/check | 语义未改动 | 完全可用 |

迁移会把既有 Share 全部回填 version 与一条基线变更行，并把历史删除回填为墓碑，
因此旧客户端切换过来后首次全量重同步能看到全部既有数据与历史删除。

---

## 7. 迁移：前向兼容与回退

迁移文件：prisma/migrations/20261101120000_sync_change_log/migration.sql
（仅 UP；DOWN 在文件的注释块里，见 §7.2）。

### 7.1 前向兼容（新库 + 旧二进制）

- 新增列带默认值（version BIGINT NOT NULL DEFAULT 0）、新增表、新增触发器，
  不删列、不改列类型、不改既有约束。旧版本服务端二进制可以继续读写 Share
  （它不认识 version，触发器替它维护），因此可以灰度：先迁库、后换二进制。
- 旧二进制不读 SyncChange，行为等于今天的语义（仍会漏同步）——这是滚回旧二进制的代价，
  不引入新的数据损坏。
- 回填是幂等的（只对 version = 0 的行回填），重复执行安全。

### 7.2 回退（回滚到迁移前）

顺序必须是先停写、再回退（否则回退期间产生的写入没有版本语义）。DOWN：

    DROP TRIGGER IF EXISTS "Share_sync_change" ON "Share";
    DROP FUNCTION IF EXISTS "sync_share_change"();
    DROP TABLE IF EXISTS "SyncChange";
    DROP SEQUENCE IF EXISTS "ShareVersion_seq";
    ALTER TABLE "Share" DROP COLUMN IF EXISTS "version";

回退后的影响：新客户端回传的 cursor 会大于旧服务端的任何判断依据，或直接失配，
触发全量重同步；旧服务端行为恢复到迁移前。回退会丢失版本语义，
不可与「在线继续写」叠加使用。

---

## 8. 一致性自检 SQL（假设 A3 的检测手段）

    -- 1) 每个 Share 的最新 UPSERT 变更行必须与行本身 version 相同
    SELECT s.id, s.version AS row_version, c.version AS change_version
    FROM "Share" s
    LEFT JOIN LATERAL (
      SELECT "version" FROM "SyncChange" c
      WHERE c."shareId" = s.id AND c.op = 'UPSERT'
      ORDER BY c.seq DESC LIMIT 1
    ) c ON TRUE
    WHERE c."version" IS DISTINCT FROM s.version;

    -- 2) 变更行里的 UPSERT 必须要么对应的 Share 还存在，要么有更晚的 DELETE 墓碑
    SELECT u."shareId"
    FROM "SyncChange" u
    WHERE u.op = 'UPSERT'
      AND NOT EXISTS (
        SELECT 1 FROM "SyncChange" d
        WHERE d."shareId" = u."shareId" AND d.op = 'DELETE' AND d.seq > u.seq
      )
      AND NOT EXISTS (SELECT 1 FROM "Share" s WHERE s.id = u."shareId");

两条查询都必须返回 0 行；sync-protocol.pg-spec.ts 的 F0 用例把它变成断言。

---

## 9. 故障注入覆盖对照

| 要求 | 用例 | 并发度 |
| --- | --- | --- |
| a 响应丢失后重放 V1 不覆盖 V2 | S1 | 2 客户端 / 2 连接 |
| b 乱序提交（先分配后提交）不被游标跳过 | A4（已从 it.fails 改为正向）、S2、S2b | 1 读者 + 2 写事务 |
| c 删除与更新交错，不复活、不丢删除 | S3 | 2 客户端 |
| d 客户端时钟提前/落后不影响正确性 | S4（Date.now 被 mock 到正负 1e12 毫秒） | 1 客户端 |
| e 网络中断后多次重试幂等 | S5（5 次重放 + 队列重试） | 串行 5 次 |
| f 多客户端并发拉取与推送，最终一致 | S6（4 写者 x 5 轮 + 3 读者并发） | 4 并发写 / 3 并发读 |
| 隐藏缺口：数据库一致性 | F0 | 1 |

---

## 10. 已知代价与边界（诚实披露）

1. **游标推进被「最老的在途写事务」挡住（head-of-line）。** safe = xmin 的性质决定了：只要有
   一个写事务还开着，所有 txid 更大的变更都不会投递。这是「宁可晚投、绝不跳过」的代价。
   本仓库的写事务都是单语句或两语句极短事务（deleteShareWithAudit 为两条语句），
   因此实际影响可忽略；若线上出现异常长事务，客户端可用 since=0 做一次全量重同步绕过
   （幂等，安全，只多花带宽）。用例 S2 把这个行为显式断言下来，避免有人误以为「未提交的事务
   能被提前看到」。
2. **数值域上界。** 游标与 version 以 number 传输，受 2^53 限制。xid8 与 ShareVersion_seq 需要
   9e15 次分配才可能越界（按 1e6 次/秒计约 285 年）。真到越界时，DTO 的 Max 校验会让请求
   400 显式失败，不会静默错序。
3. **isStaleWrite 的 updatedAt 回退分支**只在「读路径完全没有 version 列」时生效
   （降级读/迁移瞬间）；生产库中该列 NOT NULL 且有默认值，正常路径永远走版本比较。
4. **未声明 operation 且未携带 baseVersion 的推送**按「旧客户端强制写」处理（保持既有的
   幂等 ack 与 READWRITE 成员更新语义）；它可能覆盖较新的远端数据，因此新客户端必须声明
   operation 或携带 baseVersion。墓碑检查（拒绝复活已删除项）同样只对「声明了意图」的
   请求生效；未声明的旧写入不在其适用范围。
