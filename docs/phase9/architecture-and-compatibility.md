# 架构与兼容性（P9.0）

## 1. 同步协议的两代游标

| 维度 | 协议 1（裸数字游标） | 协议 2（复合 2.bound.txid.seq） |
| --- | --- | --- |
| 客户端回传 | timestamp（一个数字） | cursor（不透明串，不得解析） |
| 能否翻页 | 不能（第二轮窗口恒空） | 能：(txid,seq) 键集分页，200/页 |
| 单轮交付 | **完整交付，或升级要求** | 一页 + hasMore |
| 上限 | LEGACY_FULL_DELIVERY_LIMIT = 5000 | CHANGES_PAGE_SIZE = 200 |
| 截断时 | upgradeRequired，**零数据**，且 timestamp 不前进 | hasMore=true + 复合游标 |
| epoch-ms 游标 | 无效 → resync 全量重同步 | bound/txid > safe → resync |

**为什么协议 1 必须完整交付**：它的客户端只能把响应里的 timestamp 当作下一轮的 since，
而 timestamp 是水位上限，所以第二轮窗口是 [safe, safe) ——恒空。分页对协议 1 根本不存在，
「截断 + 宣告完成」必然丢数据。修复前实测 210 条只交付 200 条，另 10 条永久丢失。

**upgradeRequired 的关键设计**：返回零数据**且 timestamp 不前进**。这样忽略该标志的旧客户端
只会原地重试（停滞可见），不会静默跳过。

## 2. 同步作用域

作用域 = 该用户在当前服务器上、由服务端每次请求重算的完整成员集合；游标只是集合内部的位置。

**不采用「客户端点名 teamId」**，三条理由：旧客户端不传 teamId 会导致两种作用域并存（线格式/DTO/正则全改）；
客户端本地库是全团队落库，按团队过滤会让其它团队长期陈旧；**最关键的是它不闭合缺陷**——
单团队游标同样无法证明成员关系未变。

绑定机制（都不依赖时钟）：

| 机制 | 作用 |
| --- | --- |
| TeamMember.joinedTxid（DB 默认 pg_current_xact_id） | 窗口成员作用域 = {joinedTxid < 冻结水位}，逐页重建 |
| 游标携带的 issuedBound | 存在成员 joinedTxid >= issuedBound 时该位置不可信 → 整窗重投 resync |

代价：成员一变就整窗重投一次（带宽换正确性）。

**迁移回填语义（刻意）**：ADD COLUMN + 易变默认值让既有成员行取到迁移事务号，比任何既有游标都新，
因此迁移后首次同步必做一次全量重同步——这是补上「迁移前已被旧游标跳过的历史缺口」的唯一手段。

## 3. 版本契约（唯一 CAS）

唯一 CAS 条件是 where { id, teamId, sharedBy, version }。**updatedAt 不参与任何最终判定。**

| baseVersion | 结果 |
| --- | --- |
| == version，内容相同 | 幂等 ack（不写库、不 bump） |
| == version，内容不同 | 条件写；count=0 → conflict |
| < version / > version | conflict（stale / **future**） |
| 缺失 / 负数 / 非安全整数 | conflict（unproven，fail-closed） |
| >= 1e12 | conflict（legacy-timestamp） |

## 4. 兼容性破坏与回退

Phase 9.0 的写入侧改动是**协议破坏性变更**：未声明 baseVersion 的 UPDATE 从「静默覆盖」改为
conflict + upgradeRequired。**无降级路径**，回退旧二进制必须同时停写。

旧客户端仍可安全执行：拉取（<=5000 完整交付）、创建全新 id、内容一致的 CREATE 重放（幂等 ack）、
删除（幂等 + 墓碑）、conflicts/check。

不可再执行：无版本 UPDATE、危险的 CREATE 重放、复活已删除项。