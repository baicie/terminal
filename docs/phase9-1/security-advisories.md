# RustSec 漏洞台账（Phase 9.1）

> 由 scripts/build-security-ledger.mjs 从 cargo audit --json 自动生成，未手工编辑。
> 可达性来自 cargo tree，不是「读产品代码猜它用不用某种协议」。
> 基准分由 scripts/cvss.mjs 按 CVSS v3.1 规范公式从向量重新算出，不是抄来的数字：
> 拿着同一条向量的人可以独立复算。cargo audit --json 本身不提供分数字段。

**共 13 条。**

## 摘要（按可达性分列）

一条 7.5 落在 Cargo.lock 残留的 crate 上，和一条 7.5 落在 SSH 传输链路上，
不是同一个结论。所以严重度分布按「是否在构建图内」分开统计：

| 分组 | 条数 | 严重度分布 | 涉及 crate |
| --- | --- | --- | --- |
| 在构建图内 | 6 | Medium 1 / (not published) 5 | glib ×1, proc-macro-error ×1, rsa ×1, zbus_names ×1, zvariant ×1, zvariant_derive ×1 |
| 不在构建图 | 7 | High 2 / Medium 1 / (not published) 4 | quinn-proto ×5, rkyv ×1, rsa ×1 |

RustSec 未发布 CVSS 向量的共 9 条，单独计数，不计入上面任何严重度等级。

### 在构建图内且 High/Critical

（无）

## 全部条目

| # | 类别 | advisory | crate | 锁定版本 | 基准分 / 等级 | CVSS 向量 | 可达性 | 受影响平台 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | unsound | RUSTSEC-2024-0429 | glib | 0.18.5 | (not published) | (not published) | 在构建图内（normal 依赖） | Linux |
| 2 | unmaintained | RUSTSEC-2024-0370 | proc-macro-error | 1.0.4 | (not published) | (not published) | 在构建图内（normal 依赖） | Linux |
| 3 | vulnerability | RUSTSEC-2026-0342 | quinn-proto | 0.11.14 | (not published) | (not published) | 不在构建图（Cargo.lock 残留） | — |
| 4 | vulnerability | RUSTSEC-2026-0339 | quinn-proto | 0.11.14 | (not published) | (not published) | 不在构建图（Cargo.lock 残留） | — |
| 5 | vulnerability | RUSTSEC-2026-0338 | quinn-proto | 0.11.14 | (not published) | (not published) | 不在构建图（Cargo.lock 残留） | — |
| 6 | vulnerability | RUSTSEC-2026-0340 | quinn-proto | 0.11.14 | 7.5 High | CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H | 不在构建图（Cargo.lock 残留） | — |
| 7 | vulnerability | RUSTSEC-2026-0185 | quinn-proto | 0.11.14 | 7.5 High | CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H | 不在构建图（Cargo.lock 残留） | — |
| 8 | vulnerability | RUSTSEC-2026-0235 | rkyv | 0.7.46 | (not published) | (not published) | 不在构建图（Cargo.lock 残留） | — |
| 9 | vulnerability | RUSTSEC-2023-0071 | rsa | 0.10.0-rc.18 | 5.9 Medium | CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:N/A:N | 在构建图内（normal 依赖） | 全部 |
| 10 | vulnerability | RUSTSEC-2023-0071 | rsa | 0.9.10 | 5.9 Medium | CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:N/A:N | 不在构建图（Cargo.lock 残留） | — |
| 11 | unmaintained | RUSTSEC-2026-0371 | zbus_names | 4.3.2 | (not published) | (not published) | 在构建图内（normal 依赖） | Linux |
| 12 | unmaintained | RUSTSEC-2026-0370 | zvariant | 5.15.1 | (not published) | (not published) | 在构建图内（normal 依赖） | Linux |
| 13 | unmaintained | RUSTSEC-2026-0372 | zvariant_derive | 5.15.1 | (not published) | (not published) | 在构建图内（normal 依赖） | Linux |
| 14 | vulnerability | RUSTSEC-2026-0459 | libsqlite3-sys | 0.30.1 | (not published) | CVSS:4.0/AV:L/AC:L/AT:N/PR:N/UI:P/VC:H/VI:N/VA:N/SC:N/SI:N/SA:N | 在构建图内（normal 依赖，`bundled` 编译进二进制） | 全部 |
