# Phase 8 · P8.2 SQLite 事务正确性审计

> 本文件记录对「导入事务是否原子」的确证结论。所有结论均有源码行号支撑。

## 1. 结论：不构成原子事务（结构性缺陷）

### 证据链

| 层 | 事实 | 位置 |
| --- | --- | --- |
| JS 侧 | 只有 load/execute/select/close，**无任何事务 API** | `@tauri-apps/plugin-sql@2.4.0 dist-js/index.js:88-98,117-124` |
| Rust 插件 | invoke_handler 只注册 load/execute/select/close，**无 begin/commit/rollback** | `tauri-plugin-sql-2.4.0 src/lib.rs:139-144` |
| 插件内部 | `execute` 直接 `pool.execute(query)`，持有的是 **sqlx Pool** | `src/commands.rs:56-67`、`src/wrapper.rs:25-34,166,234` |
| sqlx | `Executor for &Pool` 每次 `fetch_many` 都 `pool.acquire()` | `sqlx-core-0.8.6 src/pool/executor.rs:28,48,58,68`；`src/executor.rs:37` |
| sqlx 默认 | `max_connections=10, min_connections=0, idle_timeout=10min` | `sqlx-core-0.8.6 src/pool/options.rs:143-165` |
| 本项目 | 零自定义 sqlx 使用点，DB 完全走插件 | `src-tauri/src/lib.rs:154`；grep 只命中 SSH 连接池 |
| 前端事务 | BEGIN IMMEDIATE → 40+ 次独立 execute → COMMIT/ROLLBACK | `service/sync-import-support.ts:14-29`、`sync-import.ts:35-290` |

### 为什么现在看起来没事

串行 await + `min_connections=0` + `pop_idle` 复用 → 空闲时池里通常只有 1 条连接。只要没有并发流量且间隔 < `idle_timeout`，同一条连接会被复用。

**事务是「碰巧」成立的，不是设计成立的。**

## 2. 真实失败模式（比原文档记载更严重）

`docs/project.md` 原记载「最坏为 COMMIT 报错、整批回滚，属可见失败」——**该论断已作废**。

| 场景 | 机制 | 后果 |
| --- | --- | --- |
| **a. 拆连** | 某条语句落到另一连接 → 该连接上无事务 → 立即自动提交 | 导入随后报错也回滚不掉 → **半导入落盘，且不报错** |
| **b. 串入** | 语句执行完连接即归还空闲队列，持有 BEGIN 的正是这条连接 | 其他模块的写被 pop 到它上面执行 → **被并入导入事务** → 导入 ROLLBACK 时他人的写**静默丢失** |
| **c. ROLLBACK 落错连接** | ROLLBACK 也走独立 acquire | `cannot rollback - no transaction is active`；原连接事务保持打开并被放回池，**持续持写锁**直到清扫器关闭它 |
| **d. PRAGMA 只作用于一条连接** | `busy_timeout`/`synchronous`/`cache_size` 是**连接级** | `connection.ts:49-51` 只配置了执行 PRAGMA 的那条连接；其余连接用 sqlx 默认（`busy_timeout=5s`）。`journal_mode` 是文件级，全局生效，无此问题 |

## 3. 影响面

- 全前端 **27 个文件**直接调用 `executeQuery` → 并发 DB 流量客观存在，场景 b 有现实触发条件。
- 现有测试是 `vi.mock` 打桩（`sync-import.test.ts:12-30`），只断言语句序列，**结构上不可能发现连接池问题**。
- 调用方：`sync-file.ts:12`、`sync-team.ts:125`（团队包导入）。

## 4. 不确定的部分（诚实标注）

静态分析只能断言「每次都是独立 acquire，是否同一连接取决于池状态」，**不能断言生产上必然拆连**。要 100% 定论需要运行时实验：

1. dev 构建中在导入开始 500ms 后触发一次带外 `executeQuery`，再让导入中途失败并 ROLLBACK——若该行消失则证实「串入」。
2. 给插件 execute 打点，打印连接身份，跑一次大导入统计出现的连接数。

## 5. 修复方案对比

| 方案 | 做法 | 代价 | 风险 | 结论 |
| --- | --- | --- | --- | --- |
| **A** | 新增 Rust command，**复用插件同一个 pool**，在单条连接的单事务内执行整个导入 | 中（Rust 300-450 行 + sqlx 依赖 + 前端改 1 次 invoke） | 中低（9 表逐列对齐） | **推荐** |
| B | 新建独立 sqlx Pool（max_connections=1 + after_connect 统一 PRAGMA） | 中高（双池共存、生命周期竞态） | 中 | A 的超集增强，可后置 |
| C | fork/patch 插件把池改成 max_connections=1 | 低 | 中高（破坏 checksum、读写彻底串行） | 不采纳：把正确性押在 fork 上 |
| D | 不修，改幂等 + 失败可见 | 最小 | 数据面仍可能半导入 | 仅在源码冻结时作过渡 |

选择 A 的理由：只有 A 在「不 fork 依赖、不改导出格式、不给前端加锁语义」的前提下，把事务边界真正落到一条物理连接上。

## 6. 状态

- 审计：**COMPLETE**
- 修复：**待实施**（等工作树无并发写者后执行方案 A）
- 文档更正：**已完成**（`docs/project.md` 的错误论断已作废并注明原因）
