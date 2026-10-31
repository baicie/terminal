-- Phase 8.8 Task A — 服务端发放的单调版本 + 只追加变更日志
-- 前向兼容：仅新增（带默认值的新列、新表、新序列、新触发器），不删列/不改类型/不改既有约束。
-- 迁移前的旧二进制仍可读写 "Share"（它不认识 version，触发器替它维护）。

-- 1) 每行的服务端版本列 ---------------------------------------------------------
ALTER TABLE "Share" ADD COLUMN "version" BIGINT NOT NULL DEFAULT 0;

CREATE SEQUENCE IF NOT EXISTS "ShareVersion_seq" AS BIGINT START WITH 1 INCREMENT BY 1;

-- 回填幂等：只对 version = 0 的行给号（重复执行不会改变已发放的版本）
UPDATE "Share" SET "version" = nextval('"ShareVersion_seq"') WHERE "version" = 0;

-- 2) 只追加变更日志 -------------------------------------------------------------
CREATE TABLE "SyncChange" (
    "seq" BIGSERIAL NOT NULL,
    "txid" BIGINT NOT NULL,
    "teamId" TEXT NOT NULL,
    "shareId" TEXT NOT NULL,
    "op" TEXT NOT NULL,
    "version" BIGINT NOT NULL,
    "type" "ShareType",
    "data" JSONB,
    "encryptedData" TEXT,
    "isSensitive" BOOLEAN,
    "sharedBy" TEXT,
    "permission" "Permission",
    "shareCreatedAt" TIMESTAMP(3),
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncChange_pkey" PRIMARY KEY ("seq")
);

CREATE INDEX "SyncChange_teamId_txid_idx" ON "SyncChange"("teamId", "txid");
CREATE INDEX "SyncChange_shareId_seq_idx" ON "SyncChange"("shareId", "seq");

ALTER TABLE "SyncChange" ADD CONSTRAINT "SyncChange_teamId_fkey"
    FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3) 写路径全覆盖触发器 ---------------------------------------------------------
-- 同事务写入变更行；txid 取本事务的 xid8，是游标安全水位的判据。
CREATE OR REPLACE FUNCTION "sync_share_change"() RETURNS trigger AS $$
DECLARE
  v_version BIGINT;
  v_txid BIGINT := pg_current_xact_id()::text::bigint;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_version := nextval('"ShareVersion_seq"');
    INSERT INTO "SyncChange" (
      "txid", "teamId", "shareId", "op", "version", "type", "sharedBy", "changedAt"
    ) VALUES (
      v_txid, OLD."teamId", OLD."id", 'DELETE', v_version, OLD."type", OLD."sharedBy",
      now() AT TIME ZONE 'utc'
    );
    RETURN OLD;
  END IF;

  v_version := nextval('"ShareVersion_seq"');
  NEW."version" := v_version;
  INSERT INTO "SyncChange" (
    "txid", "teamId", "shareId", "op", "version", "type", "data", "encryptedData",
    "isSensitive", "sharedBy", "permission", "shareCreatedAt", "changedAt"
  ) VALUES (
    v_txid, NEW."teamId", NEW."id", 'UPSERT', v_version, NEW."type", NEW."data",
    NEW."encryptedData", NEW."isSensitive", NEW."sharedBy", NEW."permission",
    NEW."createdAt", now() AT TIME ZONE 'utc'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- BEFORE ... OR DELETE 才能在同一个事务里留下墓碑；函数对 DELETE 返回 OLD 以放行删除。
CREATE TRIGGER "Share_sync_change"
    BEFORE INSERT OR UPDATE OR DELETE ON "Share"
    FOR EACH ROW EXECUTE FUNCTION "sync_share_change"();

-- 4) 基线回填：既有数据对「无游标/旧游标」的客户端必须可见 ------------------------
INSERT INTO "SyncChange" (
  "txid", "teamId", "shareId", "op", "version", "type", "data", "encryptedData",
  "isSensitive", "sharedBy", "permission", "shareCreatedAt", "changedAt"
)
SELECT 0, s."teamId", s."id", 'UPSERT', s."version", s."type", s."data", s."encryptedData",
       s."isSensitive", s."sharedBy", s."permission", s."createdAt", s."updatedAt"
FROM "Share" s
WHERE NOT EXISTS (SELECT 1 FROM "SyncChange" c WHERE c."shareId" = s."id");

-- 5) 迁移前的删除回填为墓碑（旧实现靠 AuditLog 传递删除，新实现在日志里只有墓碑） --
INSERT INTO "SyncChange" (
  "txid", "teamId", "shareId", "op", "version", "type", "sharedBy", "changedAt"
)
SELECT DISTINCT ON (l."details" ->> 'shareId')
       0, l."teamId", l."details" ->> 'shareId', 'DELETE', nextval('"ShareVersion_seq"'),
       NULL, l."userId", l."createdAt"
FROM "AuditLog" l
WHERE l."action" = 'SHARE_DELETED'
  AND l."details" ->> 'shareId' IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "Share" s WHERE s.id = l."details" ->> 'shareId'
  )
  AND NOT EXISTS (
    SELECT 1 FROM "SyncChange" c
    WHERE c."shareId" = l."details" ->> 'shareId' AND c.op = 'DELETE'
  )
ORDER BY l."details" ->> 'shareId', l."createdAt" DESC;

-- ---------------------------------------------------------------------------
-- DOWN MIGRATION（回退方案；必须先停写，回退后版本语义丢失）
--
--   DROP TRIGGER IF EXISTS "Share_sync_change" ON "Share";
--   DROP FUNCTION IF EXISTS "sync_share_change"();
--   DROP TABLE IF EXISTS "SyncChange";
--   DROP SEQUENCE IF EXISTS "ShareVersion_seq";
--   ALTER TABLE "Share" DROP COLUMN IF EXISTS "version";
--
-- 回退后：新客户端回传的 cursor 失去意义，服务端会判定游标无效并做全量重同步。
-- ---------------------------------------------------------------------------
