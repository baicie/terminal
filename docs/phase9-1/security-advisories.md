# RustSec 漏洞台账（Phase 9.1）

> 由 scripts/build-security-ledger.mjs 从 cargo audit --json 自动生成，未手工编辑。
> 可达性来自 cargo tree，不是「读产品代码猜它用不用某种协议」。
> 基准分由 scripts/cvss.mjs 按 CVSS v3.1 规范公式从向量重新算出，不是抄来的数字：
> 拿着同一条向量的人可以独立复算。cargo audit --json 本身不提供分数字段。

**共 27 条。**

## 摘要（按可达性分列）

一条 7.5 落在 Cargo.lock 残留的 crate 上，和一条 7.5 落在 SSH 传输链路上，
不是同一个结论。所以严重度分布按「是否在构建图内」分开统计：

| 分组 | 条数 | 严重度分布 | 涉及 crate |
| --- | --- | --- | --- |
| 在构建图内 | 21 | Critical 1 / High 7 / Medium 4 / Low 2 / (not published) 7 | quick-xml ×4, rustls ×4, zip ×3, crypto-bigint ×2, rsa ×2, ctutils ×1, h2 ×1, russh ×1, russh-cryptovec ×1, rustls-webpki ×1, webpki-root-certs ×1 |
| 不在构建图 | 6 | High 2 / (not published) 4 | quinn-proto ×5, rkyv ×1 |

RustSec 未发布 CVSS 向量的共 11 条，单独计数，不计入上面任何严重度等级。

### 在构建图内且 High/Critical

| advisory | crate | 锁定版本 | 基准分 | 等级 |
| --- | --- | --- | --- | --- |
| RUSTSEC-2026-0369 | zip | 4.6.1 | 9.1 | Critical |
| RUSTSEC-2026-0195 | quick-xml | 0.37.5 | 7.5 | High |
| RUSTSEC-2026-0194 | quick-xml | 0.37.5 | 7.5 | High |
| RUSTSEC-2026-0195 | quick-xml | 0.39.2 | 7.5 | High |
| RUSTSEC-2026-0194 | quick-xml | 0.39.2 | 7.5 | High |
| RUSTSEC-2026-0154 | russh | 0.60.2 | 7.5 | High |
| RUSTSEC-2026-0153 | russh-cryptovec | 0.59.0 | 7.5 | High |
| RUSTSEC-2026-0367 | zip | 4.6.1 | 7.3 | High |

## 全部条目

| # | advisory | crate | 锁定版本 | 基准分 / 等级 | CVSS 向量 | 可达性 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | RUSTSEC-2026-0387 | crypto-bigint | 0.5.5 | (not published) | (not published) | 在构建图内（normal 依赖） |
| 2 | RUSTSEC-2026-0387 | crypto-bigint | 0.7.0-rc.28 | (not published) | (not published) | 在构建图内（normal 依赖） |
| 3 | RUSTSEC-2026-0385 | ctutils | 0.4.2 | (not published) | (not published) | 在构建图内（normal 依赖） |
| 4 | RUSTSEC-2026-0258 | h2 | 0.4.13 | (not published) | (not published) | 在构建图内（normal 依赖） |
| 5 | RUSTSEC-2026-0195 | quick-xml | 0.37.5 | 7.5 High | CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H | 在构建图内（normal 依赖） |
| 6 | RUSTSEC-2026-0194 | quick-xml | 0.37.5 | 7.5 High | CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H | 在构建图内（normal 依赖） |
| 7 | RUSTSEC-2026-0195 | quick-xml | 0.39.2 | 7.5 High | CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H | 在构建图内（normal 依赖） |
| 8 | RUSTSEC-2026-0194 | quick-xml | 0.39.2 | 7.5 High | CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H | 在构建图内（normal 依赖） |
| 9 | RUSTSEC-2026-0342 | quinn-proto | 0.11.14 | (not published) | (not published) | 不在构建图（Cargo.lock 残留） |
| 10 | RUSTSEC-2026-0339 | quinn-proto | 0.11.14 | (not published) | (not published) | 不在构建图（Cargo.lock 残留） |
| 11 | RUSTSEC-2026-0338 | quinn-proto | 0.11.14 | (not published) | (not published) | 不在构建图（Cargo.lock 残留） |
| 12 | RUSTSEC-2026-0340 | quinn-proto | 0.11.14 | 7.5 High | CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H | 不在构建图（Cargo.lock 残留） |
| 13 | RUSTSEC-2026-0185 | quinn-proto | 0.11.14 | 7.5 High | CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H | 不在构建图（Cargo.lock 残留） |
| 14 | RUSTSEC-2026-0235 | rkyv | 0.7.46 | (not published) | (not published) | 不在构建图（Cargo.lock 残留） |
| 15 | RUSTSEC-2023-0071 | rsa | 0.10.0-rc.16 | 5.9 Medium | CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:N/A:N | 在构建图内（normal 依赖） |
| 16 | RUSTSEC-2023-0071 | rsa | 0.9.10 | 5.9 Medium | CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:N/A:N | 在构建图内（normal 依赖） |
| 17 | RUSTSEC-2026-0154 | russh | 0.60.2 | 7.5 High | CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H | 在构建图内（normal 依赖） |
| 18 | RUSTSEC-2026-0153 | russh-cryptovec | 0.59.0 | 7.5 High | CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H | 在构建图内（normal 依赖） |
| 19 | RUSTSEC-2026-0346 | rustls | 0.23.40 | 4.0 Medium | CVSS:3.1/AV:L/AC:H/PR:H/UI:R/S:U/C:H/I:N/A:N | 在构建图内（normal 依赖） |
| 20 | RUSTSEC-2026-0285 | rustls | 0.23.40 | 5.3 Medium | CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:L/I:N/A:N | 在构建图内（normal 依赖） |
| 21 | RUSTSEC-2026-0348 | rustls | 0.23.40 | 3.7 Low | CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:N/I:N/A:L | 在构建图内（normal 依赖） |
| 22 | RUSTSEC-2026-0349 | rustls | 0.23.40 | 3.7 Low | CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:L/I:N/A:N | 在构建图内（normal 依赖） |
| 23 | RUSTSEC-2026-0382 | rustls-webpki | 0.103.13 | (not published) | (not published) | 在构建图内（normal 依赖） |
| 24 | RUSTSEC-2026-0383 | webpki-root-certs | 1.0.7 | (not published) | (not published) | 在构建图内（normal 依赖） |
| 25 | RUSTSEC-2026-0367 | zip | 4.6.1 | 7.3 High | CVSS:3.1/AV:L/AC:L/PR:L/UI:R/S:U/C:H/I:H/A:H | 在构建图内（normal 依赖） |
| 26 | RUSTSEC-2026-0368 | zip | 4.6.1 | (not published) | (not published) | 在构建图内（normal 依赖） |
| 27 | RUSTSEC-2026-0369 | zip | 4.6.1 | 9.1 Critical | CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:H/A:H | 在构建图内（normal 依赖） |
