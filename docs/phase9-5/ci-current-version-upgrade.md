# Phase 9.5.1 — CI Current-Version Upgrade

> 日期：2026-11-05
> 工作流：`.github/workflows/upgrade-e2e.yml` 的 `macos-current-upgrade`
> 运行：`41980039459`（`94f4b32`，macOS arm64 native runner）
> 判定：`CURRENT_VERSION_CI_UPGRADE_VERIFIED = YES`（macOS arm64；Linux/Windows
> 分开记录，见 `linux-upgrade-verification.md` 与 `windows-isolation.md`）

## 1. 为什么这轮 B 不是历史发布包

历史 dev.2 是 2026-10-30 构建的，不能代表当前源码的 schema 或备份逻辑。
本轮在 CI 里构建当前 HEAD，并把构建身份写进 artifact：

| 项 | 值 |
| --- | --- |
| source SHA | `94f4b32cdfbbe92390fd374015e58dd09e6e9fbb` |
| B 版本 | `0.0.1-dev.4-local` |
| 构建类型 | `current-source-test-build` |
| 注入 | `VITE_TERMINAL_SMOKE_BUILD=1`、`VITE_TERMINAL_MIGRATION_DELAY_MS=1500` |
| B DMG SHA256 | `00afd8ff0752f9c9f80337a489c500d3e0a7ebf4f07d640aa17cda1ea6c08f0e` |
| B DMG | `Termius_0.0.1-dev.4-local_aarch64.dmg` |
| 记录文件 | `current-b-build.json`、`current-b.sha256` |
| A | 发布资产 `0.0.1-dev.1`，SHA256 `73cf7483…` |
| 隔离 | 临时 `HOME`（`~/Library/Application Support/com.baicie.termius`）与临时 Applications 目录；不接触真实用户数据 |

`0.0.1-dev.4-local` 只用于标识 A→B 的版本差，不是发布资产，也没有被写成发布包。
迁移延迟只在 smoke 构建中生效；生产默认是 0。

## 2. 七个真实场景

同一套 A/B 与隔离环境，依次执行：

| # | 场景 | 结果 | 关键检查 |
| --- | --- | --- | --- |
| 1 | 正常升级 | **PASS** | schema 20→22 列；字段级数据；Team Sync 本地 5 表；backup 可读 |
| 2 | 迁移中途 kill | **PASS** | 第一条列已提交、第二条缺失时 SIGKILL；重启收敛 |
| 3 | 备份恢复 | **PASS** | 备份复制回 DB；A 启动并读回；SHA 与备份一致 |
| 4 | B→A 降级读取 | **PASS** | A 读加法 schema；数据哈希未变 |
| 5 | 损坏 DB | **PASS** | DB SHA 不变；日志 `file is not a database` |
| 6 | 只读数据目录 | **PASS** | DB SHA 不变；日志 `readonly database`；恢复后 B 迁移成功 |
| 7 | 第二次 B 启动 | **PASS** | 不重复迁移；字段级验证仍通过 |

报告 check 数：正常 15、中断 19、恢复 17、降级 17、损坏 15、只读 18、重启 19。
全部由 `check-upgrade-evidence.mjs` 检查；该步骤失败会让 job 红，**没有**
`continue-on-error`。

## 3. 真正中途迁移中断的证据

CI 报告（`upgrade-current-interrupt-report/upgrade-report.json`）：

```
interrupted mid-migration  PASS
  committed ... agent_forwarding; missing shell_integration
pre-migration backup       PASS
B migration                PASS
data integrity after B     PASS
interrupted migration recovery PASS
fault.FAULT_INJECTED       PASS
fault.ORIGINAL_DATA_PRESERVED PASS
fault.NO_PARTIAL_MIGRATION PASS
fault.RECOVERY_SUCCEEDED   PASS
```

中断不是“等到某个 stage 后固定睡一会儿”：harness 轮询 `pragma_table_info('hosts')`，
在 `agent_forwarding` 已提交、`shell_integration` 仍缺失时立即 `SIGKILL`。
重启后两列齐全，`data-retention verify` 逐字段通过。

## 4. 备份与恢复

- B 的 Rust 端 `backup_database_before_migration` 产出
  `backups/pre-migration-<epoch>.db`；报告记录路径并做 `backup-verify`。
- `restore-backup` 把备份复制为 `terminal.db`，删除 WAL/SHM，启动 **A** 副本，
  等待 schema，读回 seeded 行；报告断言恢复后 SHA 与备份一致。
- `downgrade` 用 A 启动 B 迁移后的 DB，验证 A 能读取加法 schema，且数据哈希
  未变。**这不等同于正式降级支持**：产品没有降级状态机。

## 5. 门禁

`check-upgrade-evidence.mjs` 检查：

- A/B 的 SHA256、版本、identifier、arch；
- A/B identifier 一致、版本不同；
- schema 前后列集合与新增列一致；
- `B migration` 与 `data integrity after B` 必须 PASS（迁移故障模式除外）；
- `pre-migration backup` 结果；`--expect-backup` 时必须 PASS；
- 故障五事实：required 不能 FAIL；PARTIAL 必须列出 missing；PASS 不能含 FAIL；
- 缺字段、重复 check、伪造/矛盾字段一律失败。

该门禁独立于六份冷启动/SSH 证据；旧 manifest 未被修改。Phase 9.5.1 因前端
smoke-only 迁移延迟改变源码指纹，已按官方流程重采六份证据
（run `41970525110`，指纹 `b73c5fd2…`，门禁 0 problem）。

## 6. 不能声称的事

- 只覆盖 macOS arm64；Linux/Windows 的升级证据在各自文档，Windows 只有预检。
- WKWebView localStorage 位于真实用户 home，不受 `HOME` 重定向；本轮未读取或
  清理该目录，也没有把跨样本 WKWebView 状态纳入判定。
- 真实 Vault 主密码解锁、Team Sync 服务端同步 **NOT_RUN**。
- 当前 B 是测试构建（`0.0.1-dev.4-local`），不是签名/公证/updater 发布链。
- CI 的 success 只证明这七个场景在该 runner 上通过；不证明所有 Linux 桌面、
  所有 GPU/驱动或所有历史 schema 都能升级。

## 7. 判定

- `CURRENT_VERSION_CI_UPGRADE_VERIFIED = YES`（macOS arm64，当前 HEAD 构建）
- `CURRENT_B_IDENTITY_VERIFIED = YES`（source SHA、版本、B DMG SHA 均记录）
- `PRE_MIGRATION_BACKUP_VERIFIED = YES`（当前 B）
- `MIGRATION_IDEMPOTENCY_VERIFIED = YES`（第二次 B 启动）
- `MIGRATION_INTERRUPTION_RECOVERY_VERIFIED = YES`（真实中途 kill + 重启收敛）
- `BACKUP_RESTORE_VERIFIED = YES`
- `DOWNGRADE_SAFETY_VERIFIED = PARTIAL`（A 可读、数据未破坏；无降级状态机）
