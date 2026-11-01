# RustSec 漏洞台账（Phase 9.1）

> 由 scripts/build-security-ledger.mjs 从 cargo audit --json 自动生成，未手工编辑。
> 可达性来自 cargo tree，不是「读产品代码猜它用不用某种协议」。

**共 27 条。**

| # | advisory | crate | 锁定版本 | CVSS 向量 | 可达性 |
| --- | --- | --- | --- | --- | --- |
| 1 | RUSTSEC-2026-0387 | crypto-bigint | 0.5.5 | (not published) | normal dependency |
| 2 | RUSTSEC-2026-0387 | crypto-bigint | 0.7.0-rc.28 | (not published) | normal dependency |
| 3 | RUSTSEC-2026-0385 | ctutils | 0.4.2 | (not published) | normal dependency |
| 4 | RUSTSEC-2026-0258 | h2 | 0.4.13 | (not published) | normal dependency |
| 5 | RUSTSEC-2026-0195 | quick-xml | 0.37.5 | (not published) | normal dependency |
| 6 | RUSTSEC-2026-0194 | quick-xml | 0.37.5 | (not published) | normal dependency |
| 7 | RUSTSEC-2026-0195 | quick-xml | 0.39.2 | (not published) | normal dependency |
| 8 | RUSTSEC-2026-0194 | quick-xml | 0.39.2 | (not published) | normal dependency |
| 9 | RUSTSEC-2026-0342 | quinn-proto | 0.11.14 | (not published) | absent-from-build-graph |
| 10 | RUSTSEC-2026-0339 | quinn-proto | 0.11.14 | (not published) | absent-from-build-graph |
| 11 | RUSTSEC-2026-0338 | quinn-proto | 0.11.14 | (not published) | absent-from-build-graph |
| 12 | RUSTSEC-2026-0340 | quinn-proto | 0.11.14 | (not published) | absent-from-build-graph |
| 13 | RUSTSEC-2026-0185 | quinn-proto | 0.11.14 | (not published) | absent-from-build-graph |
| 14 | RUSTSEC-2026-0235 | rkyv | 0.7.46 | (not published) | absent-from-build-graph |
| 15 | RUSTSEC-2023-0071 | rsa | 0.10.0-rc.16 | (not published) | normal dependency |
| 16 | RUSTSEC-2023-0071 | rsa | 0.9.10 | (not published) | normal dependency |
| 17 | RUSTSEC-2026-0154 | russh | 0.60.2 | (not published) | normal dependency |
| 18 | RUSTSEC-2026-0153 | russh-cryptovec | 0.59.0 | (not published) | normal dependency |
| 19 | RUSTSEC-2026-0346 | rustls | 0.23.40 | (not published) | normal dependency |
| 20 | RUSTSEC-2026-0285 | rustls | 0.23.40 | (not published) | normal dependency |
| 21 | RUSTSEC-2026-0348 | rustls | 0.23.40 | (not published) | normal dependency |
| 22 | RUSTSEC-2026-0349 | rustls | 0.23.40 | (not published) | normal dependency |
| 23 | RUSTSEC-2026-0382 | rustls-webpki | 0.103.13 | (not published) | normal dependency |
| 24 | RUSTSEC-2026-0383 | webpki-root-certs | 1.0.7 | (not published) | normal dependency |
| 25 | RUSTSEC-2026-0367 | zip | 4.6.1 | (not published) | normal dependency |
| 26 | RUSTSEC-2026-0368 | zip | 4.6.1 | (not published) | normal dependency |
| 27 | RUSTSEC-2026-0369 | zip | 4.6.1 | (not published) | normal dependency |
