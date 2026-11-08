# Phase 9.8-B2 — 协议 1 首次同步的 200 条静默截断

分支 `feat/phase9-8-b2-sync-window`，base `feat/phase9-7-product-acceptance`。

## 根因

协议 1 的历史客户端没有复合游标，只把 `timestamp` 当 `since` 回传。它的**第一次**
同步不带游标；服务端在此之前无法从请求判断客户端协议，于是走了协议 2 的分页路径：
返回 200 行 + `hasMore` + 复合游标。旧客户端忽略 `hasMore`/`cursor`，只记下
`timestamp`，第二轮用毫秒 `since` 请求——服务端按最低版本策略 426 拒绝，或者
（更早的行为）整窗重发导致裸 `INSERT` 撞唯一键。无论哪条，>200 条的窗口都无法完整
同步，且第一轮的 200 行已经被当作“全部”。

## 协商规则

客户端用 `X-Sync-Protocol: 2` 声明协议；协议 2 客户端首次同步显式发送
`since=2.0.0.0`。服务端规则（`sync.service.ts` / `sync-delivery.ts`）：

| 声明 | 游标 | 行为 |
| --- | --- | --- |
| `2` | 复合 / `2.0.0.0` / 缺省 | 协议 2：整窗 + 分页（缺省等同 `2.0.0.0`） |
| `2` | 裸数字 | **426**（自相矛盾） |
| `1` | 复合 | **426**（自相矛盾） |
| `1` | 裸数字 / 缺省 | 协议 1：整窗交付（≤5000），超过上限 **426** |
| 未知 | 任意 | **426** |
| 无声明 | 复合 | 协议 2（客户端已证明会分页） |
| 无声明 | 裸数字 | 协议 1 整窗（毫秒级裸数字先被 426） |
| 无声明 | 缺省 | 协议 1 整窗，超过上限 **426** |

超过整窗上限时不再返回 `upgradeRequired: true` 的 200 响应，而是直接 426
`CLIENT_UPGRADE_REQUIRED`：不交付任何行，客户端必须升级，忽略提示只会原地重试。

`2.0.0.0` 在 `resolveChangeWindowAnchor` 中解析为一次完整快照（`resync: true`，
从窗口起点开始分页），因此新客户端首同步的“删除本地已不存在的行”语义不变。

## 客户端

- `team-api-sync.ts`：每个 `GET /sync` 带 `X-Sync-Protocol: 2`；
- `team-sync-engine.ts`：无本地游标时发送显式 `2.0.0.0`，不再省略参数
  （省略正是协议 1 的形状）；
- `team-api-base.ts`：`request()` 支持附加头。

## 测试（真实 PostgreSQL）

`sync-pagination.pg-spec.ts`：

- 0/1/199/200/201/500 条矩阵：协议 1 一次整窗（条数精确、`hasMore=false`）；
  协议 2 从 `2.0.0.0` 起完整分页，去重后恰好 N 条、无重复。
- 协议 1 首次同步 201 条：**一次返回 201 条**（修复前只有 200）。
- 协议 2 首次同步 201 条：200 + 1，第二页 `hasMore=false`。
- 无声明但带复合游标：继续分页（不降级为整窗）。
- 协议 1 首次同步 5001 条：**426**，随后协议 2 客户端可翻页拿全 5001 条。
- 协议 2 + 裸数字、未知协议、协议 1 + 复合游标：均 426。
- 原有 L1/L2 边界扫描与分页正确性（P1/P2/P3）保留。

`sync.service.test.ts`：整窗超限由“返回 `upgradeRequired`”改为 426 的断言。

客户端：`team-actions-sync.test.ts` 的首请求断言更新为 `2.0.0.0`；
`client-sync-e2e` / `dual-client-sync` 的 `since: null` 断言同步更新。

## 验收判定

| 项 | 判定 | 证据 |
| --- | --- | --- |
| `SYNC_INITIAL_WINDOW_NO_SILENT_TRUNCATION` | **PASS** | 协议 1 首同步 201/500 条一次交付；5001 条 426 |
| `SYNC_LEGACY_CLIENT_FAIL_CLOSED` | **PASS** | 超上限 426、矛盾声明 426、毫秒游标 426，均不交付行 |
| `SYNC_V2_COMPLETE_PAGINATION` | **PASS** | 0/1/199/200/201/500 矩阵与 L2 的 5001 条全量翻页 |
| `SYNC_CURSOR_RESUME_VERIFIED` | **PASS** | 复合游标续拉（P1/P2/P3、协商用例第二页） |

## 边界

- 协议 1 整窗上限仍为 5000 行；超过即要求升级，不做部分交付。
- 客户端不解析服务端 `timestamp` 作为游标（既有约束不变）。
