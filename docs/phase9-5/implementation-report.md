# Phase 9.5 — Implementation Report

> 日期：2026-11-05
> **Phase 9.5.1 后续交付见 `docs/phase9-5/phase9-5-1-implementation.md`**：当前
> HEAD CI 升级 7/7、Linux DEB、真实迁移中断/备份恢复、Windows 隔离预检与
> AppImage payload-only 结果以该文档为准。
> 分支：`feat/phase9-5-upgrade-integrity`
> Base：`a7a65bc`（PR #7 HEAD，stacked；不是 main）
> 本轮不合并 PR、不打 tag、不发布 Release。

## 1. 完成内容

| 交付 | 文件/命令 | 状态 |
| --- | --- | --- |
| Phase 9.4.2 归档 | `docs/phase9-4/phase9-4-2-closure.md` | 完成 |
| PR #6/#7 集成方案 | `docs/phase9-5/design.md` | 完成 |
| 资产元数据校验 | `scripts/verify-install/asset-metadata.mjs` + 4 项测试 | 完成 |
| 版本兼容 seed/verify | `scripts/verify-install/data-retention.mjs` 扩展 + 5 项测试 | 完成 |
| 双版本升级 harness | `scripts/verify-install/upgrade-e2e.mjs` | 完成（macOS） |
| 真实 A→B E2E | dev.1→dev.2、dev.1→当前源码 | **PASS**（本机 macOS + CI `41954815468`） |
| 故障恢复测试 | corrupt-db、read-only、restart、backup | **PASS** |
| CI 工作流 | `.github/workflows/upgrade-e2e.yml` | **success**（run `41954815468`） |
| 结构化证据 | `docs/phase9-5/evidence/**/upgrade-report.{json,md}` | 已归档 |

## 2. 实际运行结果

| 运行 | A | B | 结果 |
| --- | --- | --- | --- |
| 1 | 发布 `0.0.1-dev.1`（`73cf7483…`） | 发布 `0.0.1-dev.2`（`2c9a0ca3…`） | **PASS**，backup NOT_RUN（dev.2 无备份命令） |
| 2 | 发布 `0.0.1-dev.1` | 当前源码 `0.0.1-dev.3-local`（`66f2465d…`） | **PASS**，backup PASS |
| fault 1 | dev.1 | 当前源码 | corrupt DB 保留，应用日志 `file is not a database` |
| fault 2 | dev.1 | 当前源码 | 只读目录保留 DB，应用日志 `readonly database` |
| fault 3 | dev.1 | 当前源码 | 第二次 B 启动幂等 |
| fault 4 | dev.1 | 当前源码 | backup integrity ok，seeded 行可读 |

运行 2 的 schema：A 的 hosts 20 列 → B 的 22 列，新增
`agent_forwarding`、`shell_integration`；settings 全键、workspaces/layout、
Team Sync 本地 5 表逐字段 PASS。

## 3. 测试与门禁

| 门禁 | 结果 |
| --- | --- |
| `scripts/verify-install/data-retention.test.mjs` | 5/5 pass |
| `scripts/verify-install/asset-metadata.test.mjs` | 4/4 pass |
| 升级 harness 本机真实运行 | 4 次 PASS（2 次 A→B + corrupt/read-only/restart） |
| actionlint `upgrade-e2e.yml` | pass |
| 证据归档 | `docs/phase9-5/evidence/` |

已运行：`upgrade-e2e.yml` 的真实 GitHub runner run `41954815468`，A→B 与
corrupt/read-only/restart 全部 success。

未运行：Linux/Windows 适配器；迁移中断/磁盘满/自动恢复/B→A 降级；真实 Vault
解锁；Team Sync 服务端同步。CI 的 B 是 dev.2，因此备份与当前产品应用日志检查
在 CI 报告中为 NOT_RUN；当前 B 的这两项由本机运行 2 覆盖。

## 4. 九项判定

## 3.1 集成执行结果（2026-11-05）

| 动作 | 结果 |
| --- | --- |
| PR #6 | **MERGED**，merge commit `9a0ca15`，main 已更新 |
| PR #7 rebase | `git rebase --onto origin/main 47b9a6e`：18/18、0 冲突、门禁 0、source-size 568；head `00715d6` |
| PR #7 retarget | base 已改为 `main`，diff 62 文件 |
| PR #8 rebase | 重放到 `00715d6`：5/5、0 冲突；head `1f04c91`，diff 40 文件 |
| 误触发的 300 次压测 | 已取消（`41961803975`、`41961588916`），不重复无意义压测；GitHub 将其记为 cancelled/fail check，属预期副作用 |
| 重放后的 Upgrade E2E | run `41961803808` **success** |
| main CI（PR #6 merge 后） | run `41961359521` **success**（11/11） |
| PR #7 push CI | run `41961588850` **success** |
| PR #7 pull_request CI | run `41961595884` **success** |
| PR #8 push CI | run `41961803954` **success** |
| PR #8 pull_request CI | run `41961809894`：Windows build 待完成；其余 job success |

## 4. 九项判定

| 判定 | 结果 | 依据 |
| --- | --- | --- |
| `PHASE_9_4_2_ENGINEERING_CLOSED` | **YES** | `docs/phase9-4/phase9-4-2-closure.md` |
| `PR_6_READY_FOR_HUMAN_MERGE` | **YES** | `mergeStateStatus=CLEAN`，11/11 checks，evidence 0 |
| `PR_7_INTEGRATION_READY` | **YES（条件：先人工合并 #6）** | 模拟 post-#6 main + rebase：18 提交、0 冲突、门禁 0、source-size 568 |
| `PHASE_9_5_FOUNDATION_COMPLETE` | **YES** | harness、真实 E2E、故障测试、CI 工作流、7 份文档、9 项新测试 |
| `REAL_TWO_VERSION_UPGRADE_VERIFIED` | **YES（macOS 本机 + CI）** | 真实发布 dev.1→dev.2 + dev.1→当前源码；CI run `41954815468` success |
| `UPGRADE_DATA_INTEGRITY_VERIFIED` | **YES（macOS 本机）** | hosts/settings/workspaces/layout/Team Sync 本地/vault 文件/schema/backup |
| `FAILURE_RECOVERY_VERIFIED` | **PARTIAL** | corrupt/read-only/restart/backup PASS；中断/磁盘满/自动恢复/B→A NOT_RUN |
| `READY_FOR_RC` | **NO** | 跨版本升级仅 macOS 本机、无回滚、硬件/签名/身份迁移未闭合 |
| `READY_FOR_RELEASE` | **NO** | 同 RC，另加 notarization/Authenticode/updater 真实签名 |

## 5. Phase 9.5.1 可直接执行的开发提示词

> 在 `feat/phase9-5-upgrade-integrity` 上继续 Phase 9.5.1：
> 1) 实现 Linux 升级适配器：真实 `dpkg -i`/AppImage，禁止解包回退；A/B
>    `.deb`/AppImage 元数据从产物读取；Xvfb 使用唯一 display；把 A→B 加入
>    `upgrade-e2e.yml` 的 Linux job。
> 2) 实现 Windows 一次性用户 profile 或 VM 的升级适配器；禁止在真实
>    `%APPDATA%` 上运行故障注入；按 identifier/version 精确定位卸载项。
> 3) 实现确定性的迁移中断（可注入延迟/锁）与磁盘满 fixture；实现从
>    `pre-migration-*.db` 恢复的端到端测试；验证 B→A 降级策略。
> 4) 用当前源码→下一版本（含 updater 下载/安装/重启）完成一条升级链；
>    updater 真实签名仍 BLOCKED_EXTERNAL。
> 5) 若要把升级报告纳入 release 证据，把 `scripts/verify-install/**` 与
>    `.github/workflows/upgrade-e2e.yml` 加入 `FINGERPRINT_PATHS`，然后重采
>    六份实机证据；在此之前升级报告只是 Phase 9.5 工程证据。
> 6) PR #6 人工合并后，按 `design.md` §4.3 执行 `git rebase --onto main 47b9a6e`，
>    重跑 CI 与证据检查；不要自动合并/tag/release。
