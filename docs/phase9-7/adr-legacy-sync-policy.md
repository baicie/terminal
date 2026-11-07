# ADR: 历史 Team Sync 客户端的兼容策略

- 日期：2026-11-08
- 状态：Accepted
- 相关：`docs/phase9-7/team-sync-cross-version.md`

## 背景

`v0.0.1-dev.2` 客户端使用毫秒时间戳作为 `since` 游标，并以裸 `INSERT` 将拉取到的
share 写入本地 SQLite。当前服务端使用复合游标 `2.<bound>.<txid>.<seq>`。

实测：dev.2 首次同步（无游标）可创建 share；第二次同步（毫秒游标）时，旧实现把
时间戳视为高于安全水位，返回**全量窗口**，旧客户端重复 INSERT 触发
`UNIQUE constraint failed`，整轮同步中止。旧客户端也无法更新既有 share：它把
`createdAt` 当 `baseVersion`，服务端按 `legacy-timestamp` 拒绝。

## 决策

**最低支持版本策略**：服务端对"裸数字且 ≥ 1e12（毫秒 epoch）"的游标返回
`426 Upgrade Required`（`code=CLIENT_UPGRADE_REQUIRED`），在读取任何数据之前拒绝。
受支持的复合游标与小的历史事务号游标不受影响。

- 旧客户端必须升级后才能继续同步；服务端不向它交付无法安全应用的数据。
- 拒绝发生在 `teamMember.findMany` 之前，不产生部分窗口、不写数据、不推进水位。
- 客户端本地数据保持不变；服务端 tombstone/share 状态保持不变。
- 新客户端（复合游标）完全不受影响。

## 为什么不选择其它方案

| 方案 | 否决原因 |
| --- | --- |
| 继续返回全量窗口 | 旧客户端非幂等 INSERT，必然 UNIQUE；等于故意交付会损坏本地的数据 |
| 旧窗口按 `changedAt` 过滤 | 任何被更新的 share 仍会让旧客户端 UNIQUE；只是把失败推迟 |
| 返回 `upgradeRequired: true` 但照常给数据 | dev.2 不认识该字段，行为与全量窗口相同 |
| 服务端替旧客户端做 upsert | 服务端无法改写已发行二进制；且会掩盖 `baseVersion` 安全校验 |
| 放宽 `baseVersion` 检查 | 允许旧客户端无版本覆盖，直接破坏并发写安全 |

## 后果

- 已安装的 dev.2 客户端在升级前**不能继续同步**；必须通过安装包升级。
- `TEAM_CROSS_VERSION_A_TO_B_VERIFIED` 保持 **FAIL**（旧客户端不能继续同步），
  同时新增两项独立判定：
  - `TEAM_LEGACY_CLIENT_SAFE_REJECTION=PASS`（426、无数据交付、无本地/服务端数据变化）
  - `TEAM_MIN_SUPPORTED_CLIENT_POLICY=PASS`
- 这是数据安全优先的有意取舍，不是跨版本 PASS。

## 证据

- 服务端：`sync-protocol.test.ts`、`sync.service.test.ts`、`real-server-sync.pg-spec.ts`
  （真实 HTTP/PG：时间戳游标 426，前后 share 集合一致）。
- 跨版本：`scripts/verify-install/team-cross-version.mjs` 真实进程运行，
  A 的第二次同步收到 426，本地 2 主机 + 1 snippet 完整，服务端 share 集合不变。
