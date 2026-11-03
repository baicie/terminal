# Phase 9.4 — RC Reliability Baseline

> 日期：2026-11-03
> 分支：`feat/phase9-4-rc-reliability`
> 基线：`e44d7ab`（Phase 9.3.2，stacked branch；PR #6 尚未合并）

## 1. 基线事实

| 项 | 值 |
| --- | --- |
| Phase 9.3.2 HEAD | `e44d7ab` |
| `main` | `2f1d68f` |
| PR #6 | Draft / OPEN / MERGEABLE |
| Phase 9.4 分支 | 从 `e44d7ab` 切出，**不是**合并后的 main |
| Node 24.16.0 | CI 使用；本机为 v22.12.0，所有本地命令记录该差异 |
| 证据 manifest | Phase 9.3.2 最终证据在独立 run 重采；本文件不引用旧 manifest |

PR #6 尚未人工合并，因此本阶段**不得**声称已经基于合并后的 `main`。本分支是明确的
stacked branch；PR #6 合并后需要 rebase/重跑本阶段门禁。

## 2. 已有可靠基线

Phase 9.2/9.3/9.3.1 已闭合：

- 双客户端真实 PostgreSQL 同步端到端。
- Share REST BigInt 序列化。
- 前端依赖审计（公共 registry）与 cargo audit 阻塞门禁。
- 六份真实 runner 证据门禁。
- Linux zsh 探针。

仍未闭合：

- `RUSTSEC-2023-0071`（rsa 0.10.0-rc.18）。
- macOS 远程冷启动历史失败率 3/15 = 20%。
- Windows / Pageant / 串口硬件实机矩阵。
- 跨版本安装、升级、回滚。

## 3. 本阶段输入

| 文档 | 用途 |
| --- | --- |
| `docs/phase9-2/final-report.md` | Phase 9.2 判定口径 |
| `docs/phase9-3/merge-blocker-closure.md` | 9.3.1 合并阻断收口 |
| `docs/phase9-3/bootstrap-probe-starvation.md` | Linux zsh 与 probe 饥饿 |
| `src-tauri/security-baseline.json` | 13 条已记录 advisory |
| `docs/release/workflow-rules.md` | 发布与证据规则 |
| `docs/phase9-2/identity-migration-plan.md` | T1–T12 迁移前置 |

## 4. 本机门禁快照

| 门禁 | 结果 |
| --- | --- |
| 前端 | 151 文件 / 1364 项 |
| Team Server 单测 | 25 文件 / 119 项 |
| Team Server 真实 PG | 11 文件 / 94 项 |
| Rust | 302 单测 + 3 集成 |
| 脚本 | 371 项（Phase 9.4 新增 2 项后为 373） |
| 生产源码规模 | 563 文件 |
| Bundle budget | initial gzip 130.28 KB / total 572.71 KB |
| npm 生产审计 | 公共 registry：No known vulnerabilities found |
| cargo audit | CI 通过；本机 yanked 查询受网络阻塞，见 `rsa-threat-model.md` |

## 5. 本阶段边界

- 不新增业务功能。
- 不修改产品 identifier / productName。
- 不自动合并 PR、不打 tag、不发布 Release。
- 不删除用户数据，不修改旧证据指纹。
- 外部硬件或签名缺失时保留 `BLOCKED_EXTERNAL` / `NOT_RUN`。
