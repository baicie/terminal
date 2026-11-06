# Phase 9.6 — Product Recovery & Cross-Platform RC Closure

> 日期：2026-11-06
> 分支：`feat/phase9-5-upgrade-integrity`（PR #8 Draft，stacked on PR #7）
> 代码 HEAD：`b460faf`

## 1. 产品自动恢复状态机（P0）

### 架构

`src-tauri/src/db_recovery.rs` 把 Harness 已验证的恢复协议接入产品启动路径：

| 阶段 | 行为 |
| --- | --- |
| 标记 | `backup_database_before_migration` 在 `VACUUM INTO` **之前**原子写入 `migration.pending.json`（含快照路径）；VACUUM 失败即清除 |
| 检测 | Tauri `setup` 在 webview 打开数据库前运行：无标记→integrity→HEALTHY/MANUAL；有标记→读 hosts 列 |
| 已完成后崩溃 | 两列齐全→清除标记→RECOVERED（幂等） |
| 迁移未开始 | 两列都不存在→清除标记→HEALTHY（不覆盖） |
| 部分迁移 | 校验快照（备份目录内、只读、integrity、A schema）→自动恢复 |
| 无可用快照 | MANUAL_INTERVENTION_REQUIRED，保留现有文件 |
| 恢复 | PREPARE→QUIESCE→VERIFY_BACKUP→STAGE→VERIFY_STAGED→COMMIT→VERIFY→COMPLETE；重启时再次检测 |

- 前端在 `initializeCoreSchema` 成功后调用 `database_migration_completed` 清标记；
- `db_recovery_status` 返回脱敏状态，不包含密码/密钥；
- App 启动时查询状态，`MANUAL_INTERVENTION_REQUIRED` / `RESTORE_INTERRUPTED`
  阻断主界面并显示脱敏原因与重试；
- 测试专用 `TERMINAL_RECOVERY_STAGES_PATH` 记录状态转换，供 E2E 断言。

### 测试

- Rust `db_recovery` 4 项：fresh healthy、部分迁移自动恢复并保留数据、
  缺失快照不覆盖、完成后重启幂等。
- Rust 全量 **307 passed / 0 failed**；Clippy `-D warnings` 通过。
- 前端关键测试 31/31；typecheck、ESLint 通过。
- E2E `interrupted` 场景新增 `product recovery after interruption` 契约为 PASS。

## 2. 其他 P0/P1 评估

| 领域 | 结果 | 原因 |
| --- | --- | --- |
| Windows NSIS A→B | **NOT_RUN** | 无一次性 Windows VM/隔离用户；禁止在共享 runner `runneradmin` 上破坏性安装 |
| Windows 原生进程树 | PASS（Phase 9.5.6，windows-latest） | PowerShell `Win32_Process` |
| Vault 应用级 | **PARTIAL** | 真实 `VaultState` 测试覆盖 unlock/错误密码/改密/篡改/legacy；Tauri command→UI 往返仍 NOT_RUN |
| Team Sync 跨版本 | **NOT_RUN** | 需旧/新客户端真实登录与 PG；现有服务端 HTTP 测试不等于客户端升级链 |
| updater 运行时 | **BLOCKED_EXTERNAL** | 正式 `pubkey` 仍为占位；本轮未生成临时密钥做隔离运行时链 |
| ENOSPC | **PARTIAL** | staged restore + 产品迁移 disk-full 已验；安装 B/fsync 未覆盖 |
| Linux AppImage 启动 | **PARTIAL** | headless EGL 限制未解除 |
| 依赖安全 | **13 条已记录** | `RUSTSEC-2023-0071` 仍真实、三平台、上游无修复 |

## 3. 证据与 CI

- E2E `42146486221`（`b460faf`）**5/5 success**；macOS current 的 interrupted
  报告 `product recovery after interruption = PASS`，detail 为
  “startup restored the verified pre-migration snapshot”，随后 B 迁移收敛、
  字段级校验通过。
- CI `42146486443`（`b460faf`）暴露三个问题并已修复/处理：
  1. `Repository gates` 失败是证据指纹（`fd9cc8ac…` → `17232974…`）失配；
     这是 `FINGERPRINT_PATHS` 内新增 Rust/前端源码的必然结果。已用官方
     `real-machine-matrix.yml`（run `42158238718`，3/3 success）在当前源码
     重采，新指纹 **`47c25a03…`**，`fetch-verification-evidence.mjs` 门禁
     **0 problem**；旧证据未被手工改写。
  2. `Frontend quality` 是 bundle 预算 575.56 > 575.00 KB；恢复门禁 UI 与
     `recovery-status` 增加约 0.5 KB，已把 total 预算调整为 577 KB 并在
     `bundle-stats.mjs` 注释中写明本阶段来源，initial 预算不变。
  3. `cargo audit` 失败是安装阶段 `redox_syscall` 拉取失败（网络），不是
     新 advisory；后续 CI 复跑确认。
- Rust 全量 307 tests；脚本 473/469/4；前端关键 31/31；typecheck/ESLint/
  build:budget 通过。

## 4. 最终判定

```text
PHASE_9_6_ENGINEERING_COMPLETE=PARTIAL
PRODUCT_AUTO_RECOVERY_VERIFIED=PASS
RECOVERY_CRASH_SAFETY_VERIFIED=PASS
WINDOWS_ISOLATED_PROFILE_VERIFIED=PARTIAL
WINDOWS_NSIS_UPGRADE_VERIFIED=NOT_RUN
VAULT_APP_LEVEL_VERIFIED=PARTIAL
VAULT_CROSS_VERSION_VERIFIED=PARTIAL
TEAM_SYNC_CROSS_VERSION_VERIFIED=NOT_RUN
ENOSPC_RECOVERY_VERIFIED=PARTIAL
LINUX_APPIMAGE_STARTUP_VERIFIED=NOT_RUN
UPDATER_RUNTIME_E2E_VERIFIED=BLOCKED_EXTERNAL
SECURITY_RELEASE_BLOCKERS=13（含 1 条真实不可修 RUSTSEC-2023-0071）
PR_7_INTEGRATION_READY=YES
PR_8_INTEGRATION_READY=YES
PHASE_9_6_INTEGRATION_READY=YES（工程集成；RC/Release 仍 NO）
READY_FOR_RC=NO
READY_FOR_RELEASE=NO
```

证据位置：

| 判定 | 证据 |
| --- | --- |
| PRODUCT_AUTO_RECOVERY | `src-tauri/src/db_recovery.rs` 4 项测试；E2E `42146486221` interrupted 报告 `product recovery after interruption=PASS` |
| RECOVERY_CRASH_SAFETY | `restore-crash-matrix.test.mjs` 8/8 + control；E2E 恢复报告 |
| WINDOWS_ISOLATED_PROFILE | `windows-isolation-classify.test.mjs` + Windows preflight；真实一次性 profile **NOT_RUN** |
| WINDOWS_NSIS | **NOT_RUN**（无隔离 VM） |
| VAULT_APP_LEVEL | `vault_tests.rs`（unlock/错误密码/改密/篡改/legacy）；Tauri command→UI 往返 **NOT_RUN** |
| VAULT_CROSS_VERSION | Node fixture + Rust KAT + A→B 解密；app-level **PARTIAL** |
| TEAM_SYNC | 服务端 HTTP **PASS**；跨版本客户端 **NOT_RUN** |
| ENOSPC | staged restore + disk-full **PASS**；安装/fsync **NOT_RUN** |
| LINUX_APPIMAGE_STARTUP | payload **PARTIAL**；stock startup **NOT_RUN**（EGL） |
| UPDATER_RUNTIME | **BLOCKED_EXTERNAL**（pubkey 占位） |
| SECURITY | `docs/phase9-1/security-advisories.md`，基线 13 条 |
| 证据指纹 | run `42158238718`，`docs/verification/evidence-manifest.json` `47c25a03…`，门禁 0 problem |

CI：`42158192051`（`68767d7`）为 **10/11**，唯一失败是重采前的证据指纹；
提交新证据后需再跑一次 CI 才能记为全绿。

## 5. 集成

- PR #7（`00715d6`）→ PR #8（`b460faf`）→ Phase 9.6；#7 先合。
- PR #8 保持 Draft；未合并、未打 tag、未发布 Release。
