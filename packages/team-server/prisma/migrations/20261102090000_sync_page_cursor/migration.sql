-- Phase 8.9 Task 1 — 复合分页位置 (txid, seq) 的索引
-- 前向兼容：只新增索引，不删列、不改类型、不改既有约束；旧二进制不受影响。
-- 读取窗口固定为 txid < bound 且位置 > (txid, seq)，排序键与过滤键同源，
-- 因此 (teamId, txid, seq) 让过滤与排序走同一棵索引，不必再对候选集排序。

CREATE INDEX "SyncChange_teamId_txid_seq_idx"
    ON "SyncChange"("teamId", "txid", "seq");

-- (teamId, txid) 是新索引的严格前缀，保留它只会多维护一棵树。
DROP INDEX IF EXISTS "SyncChange_teamId_txid_idx";

-- ---------------------------------------------------------------------------
-- DOWN MIGRATION（回退方案；纯索引变更，回退不改变任何数据或语义）
--
--   CREATE INDEX "SyncChange_teamId_txid_idx" ON "SyncChange"("teamId", "txid");
--   DROP INDEX IF EXISTS "SyncChange_teamId_txid_seq_idx";
--
-- 线上大表注意：Prisma migrate 在事务内执行 DDL，不能使用 CONCURRENTLY。
-- 变更日志已达百万级时，应改为停机窗口执行，或先由 DBA 手工
--   CREATE INDEX CONCURRENTLY "SyncChange_teamId_txid_seq_idx" ...
-- 再以 migrate resolve --applied 标记本迁移。索引缺失只影响排序开销，
-- 不影响正确性（分页位置由游标决定，不依赖索引）。
-- ---------------------------------------------------------------------------
