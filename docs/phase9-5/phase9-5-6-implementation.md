# Phase 9.5.6 — Upgrade Integrity Closure & RC Gate

> 日期：2026-11-06
> 分支：`feat/phase9-5-upgrade-integrity`（PR #8 Draft，基于 PR #7）
> 约束：不合并 PR #7/#8、不打 tag、不发布 Release、不改生产密钥/identifier。

## 1. P0 — 证据契约修复

### 根因

`check-upgrade-evidence.mjs` 在通用层硬性要求 `data integrity after B` 与
`B migration`，并用 `migrationFaults` 白名单排除 corrupt/read-only。
`disk-full` 是“预期失败 + 释放空间后恢复”的场景：它没有 B 迁移成功，
但有 `disk-full migration blocked`、`disk-full original data preserved`、
`disk-full backup readable`、`disk-full recovery`。两套白名单冲突，真实
E2E `42068230023` 因此拒绝了行为完全正确的报告。

### 修复

- **单一来源**：通用校验器只保留结构性不变量（artifact 身份/SHA、schema
  前后数组、sourceSha/runId、faultAssessment 一致性、PASS 不得含 FAIL）；
  所有场景语义由 `SCENARIO_CONTRACTS` 声明。
- **三类语义分离**：
  - 普通迁移：`normal` / `restart-idempotent` / `linux-deb` /
    `linux-appimage-full` 要求 `B migration` + `data integrity after B`；
  - 预期失败：`corrupt-db` 要求保留 + 检测；`read-only` 要求保留 +
    无部分迁移 + 恢复；
  - 恢复成功：`read-only` / `disk-full` 新增显式
    `*-recovery data integrity`，恢复后必须做字段级校验。
- **删除白名单**：`migrationFaults`、`faultAssessmentModes` 被移除；
  历史（pre-contract）报告走独立的 legacy 分支，不再影响 v2。
- **Harness 补齐**：corrupt 报告写 `afterUnreadable` + 数组；
  read-only/disk-full 在恢复后写真实 `after` schema；新增恢复数据完整性
  check。
- **负测试**：缺 check、缺事实、部分迁移 FAIL、恢复 FAIL/NOT_RUN、
  PASS+FAIL、错误 SHA 全部拒绝。

### 证据

- 本地：`upgrade-evidence-contract.test.mjs` **16/16**；全量脚本
  **471/469/2/0 fail**。
- 真实报告复算：E2E `42073455418`（`d32ce56`）的 macOS current job
  **success**；下载的 8 份报告（normal/corrupt/readonly/diskfull/
  interrupt/restore/downgrade/restart）全部通过新门禁；disk-full 23 项
  check、五事实 PASS。
- 最终 HEAD E2E 见第 5 节。

## 2. ENOSPC

| 场景 | 结果 |
| --- | --- |
| staged restore ENOSPC | **PASS**：64 MB DMG + Linux tmpfs（CI 457 ms） |
| 产品迁移 disk-full | **PASS（行为）**：满卷 0/2 新列、A 数据可读、释放后收敛；E2E `42061498904` |
| checkpoint busy / WAL 保留 | **PASS**：真实第二连接 |
| 备份写入中途 / migration WAL 精确错误码 | **PARTIAL**：行为已验证，未归因到具体错误码 |
| 安装 B 空间不足、目录 fsync | **NOT_RUN** |

## 3. 跨平台

| 平台 | 结果 |
| --- | --- |
| macOS | A→B、中断、恢复、降级、幂等、Vault 文件解密 **PASS**（E2E current） |
| Linux DEB | 真实 A→B **PASS**；AppImage 仅 payload **PARTIAL** |
| Windows | 隔离预检 + 原生进程树探针（PowerShell `Win32_Process`）测试；NSIS A→B **NOT_RUN** |

## 4. 关键业务能力

- Vault：文件级加密/解密与升级后解密 **PASS**；应用级 unlock/改密 **NOT_RUN**（需 UI 自动化）。
- Team Sync：真实 PG + full AppModule HTTP 同步 **PASS**；跨版本客户端 **NOT_RUN**。
- updater：静态 manifest 契约 **PASS**；运行时下载/验签/安装/重启 **BLOCKED_EXTERNAL**（pubkey 占位）。

## 5. 最终判定

最终修复提交 `eb4883c`，E2E `42079066247` **5/5 success**，同时验证了
disk-full 报告归档门禁、dev.1→dev.2 历史场景的 `expectBackup=false`、
Windows 原生进程树探针（windows-latest 实跑）。

```text
P0_EVIDENCE_CONTRACT_FIXED=PASS
UPGRADE_E2E_VERIFIED=PASS
ENOSPC_RECOVERY_VERIFIED=PARTIAL
MACOS_UPGRADE_VERIFIED=PASS
LINUX_UPGRADE_VERIFIED=PARTIAL（DEB PASS，AppImage 仅 payload）
WINDOWS_UPGRADE_VERIFIED=NOT_RUN
VAULT_APP_LEVEL_VERIFIED=NOT_RUN
TEAM_SYNC_CROSS_VERSION_VERIFIED=NOT_RUN
UPDATER_RUNTIME_VERIFIED=BLOCKED_EXTERNAL
PR_7_INTEGRATION_READY=YES（18 commits，mergeable）
PR_8_INTEGRATION_READY=YES（Draft，stacked on #7）
READY_FOR_RC=NO
READY_FOR_RELEASE=NO
```

## 6. PR 集成审计

- PR #7：head `00715d6`，18 commits，base `main`，mergeable；先合 #7。
- PR #8：head `eb4883c`，base `feat/phase9-4-rc-reliability`；相对 #7 变更
  203 文件（136 docs/phase9-5、31 scripts/verify-install、21 docs/verification、
  4 team-server、2 frontend、2 workflows、2 src-tauri）。
- 证据：`docs/phase9-5/evidence/` 现有 52 个 JSON、1.0 MB，来自 9 个真实
  run；**内容 SHA 无重复**。历史 run 证据保留可追溯，不删除；如需要可另开
  归档 PR，但不属于本轮 RC 门禁。
- 合并顺序：#7 → #8。风险：#8 仅新增脚本/文档与测试，与 #7 的产品代码
  重叠很小；`mergeable=MERGEABLE`。

## 7. 下一轮建议

1. 安装 B 空间不足与目录 fsync 的真实 ENOSPC；
2. Windows NSIS A→B + 原生进程树在真实升级链中的断言；
3. Vault app-level unlock/change_password（UI 自动化）；
4. Team Sync 跨版本客户端；
5. 真实签名后 updater 运行时链；
6. 产品启动时自动恢复状态机。

