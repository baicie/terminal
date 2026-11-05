# Phase 9.5.2 — Upgrade Trust & Secure Data Continuity

> 日期：2026-11-05
> 分支：`feat/phase9-5-upgrade-integrity`（PR #8 Draft）
> HEAD：`a82bd45`（代码）+ 本轮文档提交
> 约束：不合并 PR #7/#8、不打 tag、不发布 Release、不改生产密钥/identifier。

## 1. 完成内容

| # | 工作项 | 结果 |
| --- | --- | --- |
| 1 | 场景级升级证据契约 | **完成**：10 个场景、22 项契约/负测试、`--require-contract` |
| 2 | Windows 隔离状态机 | **完成（PARTIAL）**：身份/路径/owner/reparse/existing data/cleanup/VM attestation + 8 项负测试 |
| 3 | Windows A→B | **NOT_RUN**：无一次性 profile/VM，禁止在共享 runner 安装 |
| 4 | 真实 Vault 加密 fixture | **完成（PARTIAL）**：Node 24 Argon2id/AES-GCM + Rust 已知答案 + 升级后独立解密 |
| 5 | Team Sync 服务端 HTTP E2E | **完成（PARTIAL）**：full AppModule + 真实 fetch + 真实 PostgreSQL；非跨版本客户端链 |
| 6 | 备份/WAL/恢复加固 | **完成（PARTIAL）**：checkpoint 校验、sidecar 顺序、最早备份、A 启动证据、B 快照降级 |
| 7 | 磁盘满 | **NOT_RUN**：未建立确定性小容量卷 |
| 8 | 不兼容降级 | **PARTIAL**：加法 schema A 读取 + B 列保留；未来 schema 拒绝未实现 |
| 9 | Updater 基础 | **PARTIAL**：静态 manifest 契约与负测试；运行时下载/安装/重启 NOT_RUN |
| 10 | 文档 | 7 份新增 + 既有文档更新 |

## 2. 代码与测试

| 文件 | 变更 |
| --- | --- |
| `scripts/verify-install/upgrade-evidence-contract.mjs` | 场景 required checks/facts、状态策略、来源/SHA 校验 |
| `scripts/verify-install/check-upgrade-evidence.mjs` | `--require-contract`、artifact status/problems/expected SHA、legacy 兼容 |
| `scripts/verify-install/windows-isolation-classify.mjs` | 可测试的 Windows 隔离状态机 |
| `scripts/verify-install/windows-isolation-check.ps1` | 证据收集 + Node 分类器调用 + safe OutFile |
| `scripts/verify-install/vault-crypto.mjs` | Node 24 Argon2id/AES-GCM fixture 生成/验证 |
| `scripts/verify-install/updater-manifest.mjs` | latest.json 静态契约 |
| `scripts/verify-install/upgrade-e2e.mjs` | 真实 Vault 条目、A/B 启动证据、B 快照降级、最早备份、sidecar 顺序 |
| `scripts/verify-install/data-retention.mjs` | checkpoint 结果校验、`--forbid-columns`、`--vault-allow-encrypted`、最早备份 |
| `packages/team-server/src/teams/team-response.ts` | TeamMember BigInt HTTP 序列化 |
| `packages/team-server/src/__tests__/pg/real-server-sync.pg-spec.ts` | full AppModule 真实 HTTP 同步 |
| `src-tauri/tests/fixtures/vault-node-fixture.json` | Node 生成的已知答案 Vault |
| `src-tauri/src/vault_tests.rs` | Rust 解密外部 fixture + 错误密码拒绝 |

测试：

- `node --test scripts/verify-install/*.test.mjs`：**46 passed / 2 skipped**（Node 22
  跳过 Argon2；CI Node 24 全过）。
- Team Server PG：**12 files / 96 tests passed**（含新增 2 项真实 HTTP）。
- Team Server 单测：**25 files / 119 tests passed**。
- Rust：**303 passed**。
- 前端：**153 files / 1394 tests passed**。
- `pnpm check:source-size`：**569 production files passed**。
- 本地 normal / restore / downgrade / interrupted：**PASS**，含
  `vault crypto unlock after B`、`restored A launch`、`downgrade preserved B columns`。

## 3. 真实运行

| 项 | 值 |
| --- | --- |
| 代码 HEAD | `a82bd45` |
| Upgrade E2E | `41997387782`（macOS current 7/7、Linux DEB、AppImage payload-only、Windows 预检） |
| 普通 CI | `41997394538`（代码提交；evidence gate 因源码指纹变化需重采） |
| 证据重采 | 见第 5 节；最终 run 号会回写 |
| 本地测试 DB | `team_server_e2e_952`（PostgreSQL 17.10） |

## 4. 十三项判定

| # | 判定 | 结果 | 依据/边界 |
| --- | --- | --- | --- |
| 1 | `PHASE_9_5_2_COMPLETE` | **PARTIAL** | 工程交付完成；Windows E2E、磁盘满、真实 app-level Vault、运行时 updater 未闭合 |
| 2 | `UPGRADE_EVIDENCE_CONTRACT_VERIFIED` | **YES** | 10 场景契约、22 项测试、CI 报告通过（Linux DEB/AppImage 已过；macOS 见 run） |
| 3 | `WINDOWS_ISOLATION_VERIFIED` | **PARTIAL** | 状态机 + 8 负测试 + 共享 runner fail-closed；无真实一次性 profile/VM |
| 4 | `WINDOWS_UPGRADE_E2E` | **NOT_RUN** | 未安装/升级；共享 profile 禁止 |
| 5 | `VAULT_UNLOCK_AFTER_UPGRADE` | **PARTIAL** | 真实 Argon2id/AES 条目、Rust 外部 fixture、B 后独立解密；app UI unlock NOT_RUN |
| 6 | `TEAM_SYNC_AFTER_UPGRADE` | **PARTIAL** | 真实 Nest HTTP 同步 + PostgreSQL；跨版本客户端升级链 NOT_RUN |
| 7 | `BACKUP_RECOVERY_SAFETY_VERIFIED` | **PARTIAL** | checkpoint/sidecar/最早备份/恢复前 A 快照/A 启动证据；busy checkpoint 负测/崩溃窗口/ENOSPC 未测 |
| 8 | `DISK_FULL_RECOVERY_VERIFIED` | **NOT_RUN** | 无确定性小容量卷 fixture |
| 9 | `DOWNGRADE_GUARD_VERIFIED` | **PARTIAL** | A 读取加法 schema、B 快照字段保留；未来不兼容 schema 拒绝未实现 |
| 10 | `UPDATER_E2E_FOUNDATION` | **PARTIAL** | 静态 manifest 契约/负测试；运行时下载/验签/安装/重启 NOT_RUN |
| 11 | `LINUX_APPIMAGE_FULL_UPGRADE` | **PARTIAL** | payload-only 替换/SHA PASS；启动/迁移仍 NOT_RUN |
| 12 | `READY_FOR_RC` | **NO** | Windows E2E、磁盘满、app-level Vault、Team Sync 跨版本、签名/身份迁移未闭合 |
| 13 | `READY_FOR_RELEASE` | **NO** | 同 RC，另加 notarization/Authenticode/updater 运行时链 |

## 5. 证据重采说明

本轮改动了 `src-tauri/src/vault_tests.rs`（新增外部 fixture 测试），它位于
`FINGERPRINT_PATHS` 的 `src-tauri/src` 下，因此六份实机证据的源码指纹会变化。
按规则必须：

1. 在最终代码上 dispatch `real-machine-matrix`；
2. 用 `fetch-verification-evidence.mjs --run-id <id>` 安装新证据与原始日志；
3. `check-verification-evidence.mjs` 必须 0 problem；
4. 不修改旧证据冒充新源码。

最终 fingerprint/run 号在证据重采后回写；在此之前普通 CI 的
`Repository gates` 会因指纹失配而红，这是正确阻断，不是产品回归。

## 6. 未完成与风险

- Windows 一次性 profile/VM 与 NSIS A→B。
- 磁盘满、busy checkpoint 负测、恢复中途 crash point、WAL 崩溃窗口。
- app-level Vault unlock（需要 probe/GUI）与 change_password 升级链。
- Team Sync 跨版本客户端、冲突/离线/删除传播。
- Updater 运行时下载/签名验证/安装/重启；release workflow 的 deb/arm64
  manifest 与签名验证缺陷。
- AppImage 真实桌面/VM 启动。
- 签名/公证/身份迁移/RC/Release。

## 7. Phase 9.5.3 可直接执行的提示词

> 在 `feat/phase9-5-upgrade-integrity` 继续 Phase 9.5.3：
> 1) 建立 Windows 一次性本地用户或 disposable VM 任务：预检
>    `ISOLATED_DEDICATED_USER`，真实 NSIS dev.1→dev.2/current，A/B 数据字段、
>    vault 文件、Team Sync 本地表、卸载项；结束后按 SID 销毁，不在共享
>    `%APPDATA%` 上安装。
> 2) 增加 Vault app-level probe（`TERMINAL_VAULT_PROBE=1`）：A 创建/写入、
>    B 解锁/读回、错误密码、change_password、legacy verifier 补齐；只使用
>    测试密码与临时路径。
> 3) 将 `real-server-sync` 扩展为 A→B 两版本客户端真实 fetch 链，覆盖
>    断网→dirty row→恢复、REMOTE/LOCAL 冲突、删除传播。
> 4) 增加 busy checkpoint、stale WAL、restore crash point、ENOSPC 小卷
>    fixture；恢复失败必须保留可用备份。
> 5) 实现隔离 updater E2E：临时 minisign key、loopback server、A/B bundle、
>    正确/错误签名、篡改 manifest、下载中断、安装后 version readback；
>    不修改生产 pubkey/latest.json。
> 6) 若再改 `FINGERPRINT_PATHS`，重采六份证据并保持 0 problem；不跑无意义
>    300 次冷启动压测。
