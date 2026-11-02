# 同步正确性（P9.0）

## 全部结论都遵循「先证明失败，再证明修复」

| 问题 | 改前实测 | 改后实测 |
| --- | --- | --- |
| 分页排序与游标不同源 | 只交付 **201/400**（199 条永久漏同步） | 400/400 |
| 单事务跨页 | 去重后 **200/250**，原样重投 | 250 = [200,50] |
| 协议 1 截断 | **200/210**，另 10 条永久丢失 | 210/210 |
| 同毫秒两次 UPDATE | **都成功**（2 个 winner，丢失更新） | 恰 1 成功 1 冲突 |
| 旧客户端串行覆盖 | 最终 data=b-stale（**真被覆盖**） | conflicts=[id]，版本未变 |
| 旧客户端复活已删除项 | 行存在=true（**静默复活**） | created=[]，行不存在 |
| 冲突解决 LOCAL 无条件写 | success=true（**无条件覆盖**） | CONFLICT_STALE_VERSION |
| 加入新团队的 500 条历史 | 永久跳过 | 500/500 |

## 五种边界（协议 1）

    [L1] 199 -> 199 | 200 -> 200 | 201 -> 201 | 210 -> 210 | 5000 -> 5000（全部完整交付）
    [L2] 5001 条 -> upgradeRequired=true 交付 0 条 水位 0；同一 5001 条用协议 2 可完整交付
    [L3] epoch 游标 -> resync=true，一次交付 210
    [L4] 越界游标（备份恢复场景）-> resync=true 且完整交付
    [L5] 协议 1 完整交付后切复合游标，只拿增量 5 条

**L2 是关键的「拒绝而非丢弃」证明**：同一批数据用协议 2 能完整拿到，说明协议 1 的拒绝不是数据丢失。

## 作用域五场景

| 场景 | 改后实测 |
| --- | --- |
| A 加入有 500 条历史的团队 | 加入后本地该团队行数 = 500（先前 0） |
| B 退出团队 | 退出后本地该团队行数 = 0；服务端同游标也拿不到 |
| C 切换账户/Token | syncError = identity mismatch，已落库行数 = 0，游标 = null |
| D 旧全局游标 | 首次请求 since = null，旧键被丢弃（**不再「谁先同步归谁」**） |
| E 落库团队归属 | 服务端 teamId 优先；缺失或不在授权集合内则拒绝整页且不推进游标 |

## 分页上限与 resync 清理

- 单轮 25 页上限：改前静默 return 后照常 push 并写 lastSyncAt（**假装同步完成**）。
  改后 PullOutcome.hasMore；截断轮不 push、不写 lastSyncAt、不丢已发现冲突。
- resync 幽灵行：只在 resync=true + hasMore=false + authorizedTeams!=null + 行 version IS NOT NULL 且 dirty=0
  **四条同时满足**时，才删除快照中缺席的行。反例用例锁定「增量轮/截断轮/无作用域一律不删」。

## 未覆盖

- 两个真实客户端实例（真 Tauri SQLite + 真 Nest HTTP + 鉴权/DTO）未做端到端
- push-only 冲突（无前序拉取）时 remoteVersion 仍是占位
- RESOLVE LOCAL 未携带 baseVersion 时仍有串行窗口，需前端回传 remoteVersion.version