# Phase 9.5.1 — Cross-Platform Upgrade & Recovery Hardening

> 日期：2026-11-05
> 分支：`feat/phase9-5-upgrade-integrity`
> PR：#8（Draft，base `feat/phase9-4-rc-reliability`）
> 约束：不自动合并、不打 tag、不发布 Release、不改生产密钥、不访问真实用户数据。

## 1. 交付范围

| # | 工作项 | 结果 |
| --- | --- | --- |
| 1 | 故障五事实拆分与 fail-closed 负测试 | **完成**：`fault-assessment.mjs` + 5 项测试 |
| 2 | 当前 HEAD 的真实 CI 升级链 | **完成**：7 个报告全部 PASS（run `41980039459`） |
| 3 | Linux DEB 真实安装 | **完成**：`apt-get`/dpkg + 版本读回 + 字段级验证 |
| 4 | Linux AppImage 同路径替换 | **部分**：payload-only，替换 + SHA 校验；启动/迁移 NOT_RUN，见 `linux-upgrade-verification.md` |
| 5 | 确定性迁移中断 | **完成**：第一条列提交后 SIGKILL，重启收敛 |
| 6 | 备份恢复端到端 | **完成**：复制备份 + A 启动读回 + SHA 一致 |
| 7 | B→A 降级读取 | **完成（读取）**：A 可读加法 schema，数据哈希未变 |
| 8 | Windows 隔离预检 | **完成（只读）**：共享 runner fail-closed |
| 9 | 独立升级证据门禁 | **完成**：`check-upgrade-evidence.mjs`，22 项脚本测试 |
| 10 | 六份实机证据重采 | **完成**：run `41970525110`，指纹 `b73c5fd2…`，0 problem |

## 2. 代码与脚本

| 文件 | 变更 |
| --- | --- |
| `packages/frontend/src/service/database/connection-schema-core.ts` | smoke-only `VITE_TERMINAL_MIGRATION_DELAY_MS`，生产默认 0 |
| `.github/workflows/upgrade-e2e.yml` | current-version、Linux DEB、Linux AppImage、Windows 预检 job |
| `scripts/verify-install/upgrade-e2e.mjs` | 当前 B 构建、7 种模式、Linux 适配器、真实中途 kill、AppImage 回退 |
| `scripts/verify-install/fault-assessment.mjs` | 五事实与 required facts |
| `scripts/verify-install/check-upgrade-evidence.mjs` | 独立、fail-closed 的升级报告门禁 |
| `scripts/verify-install/asset-metadata.mjs` | AppImage 提取/desktop/AppStream/GL 诊断 |
| `scripts/verify-install/windows-isolation-check.ps1` | 只读 Windows profile 预检 |
| `scripts/verify-install/*.test.mjs` | 新增 fault/evidence 测试；总计 **22 项** |

## 3. 本地与 CI 结果

| 验证 | 结果 |
| --- | --- |
| `node --test scripts/verify-install/*.test.mjs` | **22/22 pass** |
| `pnpm check:source-size` | **568 files pass** |
| 六份证据门禁（本地） | **0 problem** |
| 当前 HEAD CI 升级（`41980039459`） | 7/7 报告 **PASS** |
| Linux DEB（`41972602296`） | **PASS** |
| Windows 预检（`41972602296`） | **success**（隔离拒绝正确） |
| Linux AppImage | 见 `linux-upgrade-verification.md` |

当前 HEAD 构建身份：`sourceSha=94f4b32…`、`version=0.0.1-dev.4-local`、
`B DMG SHA=00afd8ff…`、`instrumentedBuild=true`、`migrationDelayMs=1500`。
证据归档：`docs/phase9-5/evidence/ci-run-41980039459/`。

中断报告记录：`agent_forwarding` 已提交、`shell_integration` 缺失时 SIGKILL；
重启后两列齐全，字段级验证通过，`FAULT_INJECTED`/`ORIGINAL_DATA_PRESERVED`/
`NO_PARTIAL_MIGRATION`/`RECOVERY_SUCCEEDED` 均 PASS。

## 4. 十三项判定

| # | 判定 | 结果 | 依据 |
| --- | --- | --- | --- |
| 1 | `UPGRADE_FAULT_ASSESSMENT_VERIFIED` | **YES** | 五事实拆分 + 5 项负测试 + CI 报告 |
| 2 | `CURRENT_VERSION_CI_UPGRADE_VERIFIED` | **YES（macOS arm64）** | run `41980039459` 7/7 PASS |
| 3 | `CURRENT_B_IDENTITY_VERIFIED` | **YES** | source SHA、版本、DMG SHA 均在 artifact |
| 4 | `PRE_MIGRATION_BACKUP_VERIFIED` | **YES** | `pre-migration-<epoch>.db` + `backup-verify` |
| 5 | `MIGRATION_IDEMPOTENCY_VERIFIED` | **YES** | 第二次 B 启动 19 项检查 PASS |
| 6 | `LINUX_DEB_UPGRADE_VERIFIED` | **YES** | 真实 dpkg + 版本变化 + 字段级数据 |
| 7 | `LINUX_APPIMAGE_REPLACEMENT_VERIFIED` | **PARTIAL** | 同路径替换/SHA 已验；headless bundled WebKit EGL 失败，启动/迁移 NOT_RUN（payload-only） |
| 8 | `MIGRATION_INTERRUPTION_RECOVERY_VERIFIED` | **YES** | 真实中途 kill + 重启收敛 |
| 9 | `BACKUP_RESTORE_VERIFIED` | **YES** | 备份复制 + A 读回 + SHA 一致 |
| 10 | `DOWNGRADE_SAFETY_VERIFIED` | **PARTIAL** | A 可读、数据未破坏；无降级状态机 |
| 11 | `WINDOWS_PROFILE_ISOLATION_VERIFIED` | **PARTIAL** | 只读预检 fail-closed；无一次性 profile/VM |
| 12 | `WINDOWS_UPGRADE_E2E` | **NOT_RUN** | 未安装/升级；共享 profile 禁止 |
| 13 | `VAULT_TEAM_SYNC_UPGRADE_VERIFIED` | **NOT_RUN** | 真实 Vault 解锁需主密码；Team Sync 无服务端/token |

## 5. 未完成与风险

- **Windows 升级 E2E**：需要一次性 Windows profile/VM；本轮只证明共享 profile
  会被拒绝。
- **真实 Vault 解锁**：fixture 是零条目、无主密码的 JSON；不能伪造解密。
- **Team Sync 服务端同步**：只验证本地 5 张表持久化。
- **磁盘满/安装介质只读/Linux 故障注入**：未实现确定性 fixture。
- **自动回滚**：产品没有自动回滚状态机；本轮的恢复是人工复制备份。
- **AppImage 内部版本元数据**：dev.1/dev.2 载荷没有可读版本；A/B 版本比较
  `NOT_RUN`，报告为 `PARTIAL`。
- **六份证据重采**：因 smoke-only 迁移延迟改变指纹，已按官方流程重采；没有
  手工改写旧 manifest。
- **签名/公证/updater/身份迁移**：仍 `BLOCKED_EXTERNAL` / `NOT_RUN`，见
  `release-blockers.md`。

## 6. 判定

- `PHASE_9_5_1_IMPLEMENTATION_COMPLETE = YES`（代码、CI、证据、文档）
- `READY_FOR_RC = NO`（Windows E2E、AppImage stock 启动、Vault/Team Sync、
  签名/公证/身份迁移仍未闭合）
- `READY_FOR_RELEASE = NO`
