# Phase 9.5 — Release Blockers

> 日期：2026-11-05
> 本文件只登记真实阻塞；不把 NOT_RUN 写成 PASS，也不把 updater 签名等同于
> OS 代码签名。

## 1. 身份与迁移

| 项 | 状态 | 事实 |
| --- | --- | --- |
| productName | `Termius`（未改） | `src-tauri/tauri.conf.json` |
| identifier | `com.baicie.termius`（未改） | 同上 |
| 迁移代码 | 不存在 | 本轮禁止修改 identifier |
| T1–T8（legacy→current 复制/校验/失败回滚/幂等） | **NOT_RUN** | 无迁移实现 |
| T9（Vault 保持且可解锁） | **NOT_RUN** | 需真实主密码；不能伪造 |
| T10–T12（新 identifier 安装/冷启动/旧版升级） | **NOT_RUN / BLOCKED_EXTERNAL** | 未改 identifier；需双版本安装包与发行决策 |

进入实现前必须先冻结：legacy/current 目录、复制校验、失败删除目标、源不动、
幂等状态机；四个硬编码 identity 点（`tauri.conf.json`、macOS/Linux 安装脚本、
`run-remote-cold-start-stopwatch.mjs`）必须同一提交修改。

## 2. 代码签名与 updater

| 项 | 状态 | 事实 |
| --- | --- | --- |
| Apple notarization | **BLOCKED_EXTERNAL** | 无 Developer ID / notary 凭据 |
| Apple Developer ID 签名 | **BLOCKED_EXTERNAL** | 同上；开发 DMG 未签名/未公证 |
| Windows Authenticode | **BLOCKED_EXTERNAL** | 无证书 |
| Tauri updater 公钥 | **BLOCKED_EXTERNAL** | `tauri.conf.json` 的 `pubkey` 仍是 `REPLACE_WITH_TAURI_UPDATER_PUBLIC_KEY` |
| updater 运行时下载/安装/重启 | **NOT_RUN** | 当前只有检查更新能力；未验证完整流程 |
| dev.2 历史 `.sig` 资产 | 存在 | 只能证明已发布文件与其签名元数据，**不能**替代运行时更新链 |
| macOS Gatekeeper 弹窗 | **NOT_RUN** | 阻塞式 GUI；需人工 |
| Windows SmartScreen/MOTW | **NOT_RUN** | 需人工 |

禁止：伪造 notarization、把 updater 签名当作 OS 签名、把历史签名产物写成运行时
更新成功、把密钥写入源码/日志、擅自发布更新清单。

## 3. 依赖安全

| 项 | 状态 |
| --- | --- |
| `cargo audit` 基线 | 13 条（8 vulnerabilities + 4 unmaintained + 1 unsound），阻塞门禁 |
| `RUSTSEC-2023-0071`（rsa 0.10.0-rc.18） | **真实、三平台、上游 `patched=[]`**；阻塞发布，不阻塞合并 |
| 可达性评估 | PASS（未发现 PKCS#1 v1.5 解密调用）；不是“无风险” |
| `pnpm audit --prod` | No known vulnerabilities found（公共 registry，快照） |

若 `russh`/`ssh-key`/`rsa` 升级或新增 RSA 解密路径，必须重新评估并更新台账
`docs/phase9-1/security-advisories.md` 与 `src-tauri/security-baseline.json`。

## 4. 安装 / 升级 / 回滚

| 项 | 状态 |
| --- | --- |
| 单版本安装 + 数据内容保留 | PASS（三平台历史 CI） |
| dev.1 → dev.2 真实升级 | **PASS**（macOS DMG、Linux x64 DEB；见 `upgrade-e2e.md`） |
| dev.1 → 当前源码升级 | **PASS**（macOS CI 当前 HEAD 构建；见 `ci-current-version-upgrade.md`） |
| Linux AppImage 同路径替换 | 见 `linux-upgrade-verification.md`（内部版本元数据不可读） |
| 跨版本回滚 B→A | **PASS（读取）/ PARTIAL**；无产品回滚状态机 |
| 升级失败自动回滚 | **PASS（Phase 9.6，部分迁移）**：启动检测未完成迁移并从已验证快照自动恢复；无有效快照时 MANUAL，不覆盖数据库。E2E `42146486221` 的 interrupted 报告 `product recovery after interruption=PASS`。完整回滚到旧安装包仍 **NOT_RUN** |
| migration 抛错/只读/损坏/重启 | **PASS**（见 `rollback-and-recovery.md`） |
| 升级中途 kill | **PASS**（第一条列提交后 SIGKILL，重启收敛） |
| WAL/恢复顺序 | **PASS（恢复协议）**：checkpoint/sidecar/最早备份/A 启动 + 8 阶段真实崩溃矩阵；ENOSPC 仅 staged restore |
| 不兼容降级 | **NOT_RUN**：加法 schema 读取已验，未来 schema 拒绝未实现 |
| updater 运行时链 | **NOT_RUN**：只有 latest.json 静态契约；下载/验签/安装/重启未验证 |
| 进程生命周期 | **PASS（macOS/Linux，Phase 9.5.5）**：stop 严格 fail-closed + 四事实 quiescence（process/streams/process-tree/lsof DB）；E2E 10 份报告全 PASS；Windows 无 pgrep，NOT_RUN |
| 真实 crash-point | **PASS（Phase 9.5.4）**：独立 worker 在 8/8 阶段真实 SIGKILL + control；PID 归属、精确文件集、integrity/content 全断言（见 `real-crash-point-matrix.md`） |
| ENOSPC | **PARTIAL（Phase 9.5.5）**：staged restore（macOS DMG + Linux tmpfs）与产品迁移 disk-full（64 MB DMG：0/2 新列、数据可读、释放后收敛）均实测；安装 B/fsync **NOT_RUN**，迁移失败点未归因到具体错误码（见 `enospc-verification.md`） |
| 恢复 crash point / 重试 | **PASS**：Harness 独立 retry + 产品启动 `db_recovery` 状态机（`src-tauri/src/db_recovery.rs`）自动恢复；中断恢复 E2E 实测 |
| 备份恢复 | **PASS**（端到端复制备份并用 A 读回；Harness 恢复已改为独立 worker） |
| 磁盘满/安装介质只读 | **NOT_RUN**（未实现确定性 fixture） |
| Linux 故障注入 | **NOT_RUN**（本轮只做正常 A→B） |
| 真实 Vault 主密码解锁 | **PARTIAL（Phase 9.5.2）**：真实 Argon2id/AES fixture 与升级后独立解密 PASS；app-level `vault_unlock` NOT_RUN |
| Team Sync 服务端升级 | **PARTIAL（Phase 9.5.2）**：full AppModule 真实 HTTP 同步 PASS；A→B 跨版本客户端链 NOT_RUN |
| Windows 升级 E2E | **NOT_RUN**；隔离预检 **PARTIAL**（见 `windows-isolation.md`） |
| Windows/Pageant/串口硬件 | **NOT_RUN** |
| 物理键盘/中文 IME | **NOT_RUN** |

## 5. 证据绑定

升级 harness 产出的 JSON/Markdown **当前不在** `FINGERPRINT_PATHS`；Phase 9.5.1
新增的 `check-upgrade-evidence.mjs` 是**独立**门禁，在 `Upgrade E2E` workflow 中
阻塞该 workflow，但不改动六份实机证据 manifest。若要把升级报告并入 release
指纹，需要：

1. 把 `scripts/verify-install/**` 与 `.github/workflows/upgrade-e2e.yml` 纳入
   `FINGERPRINT_PATHS`；
2. 在纳入后的源码上重新采集六份实机证据；
3. 在 release 门禁中把升级报告的 A/B SHA、平台、schema、数据域结果作为阻塞项。

未完成以上三步前，升级报告只能作为工程证据，不能冒充六份 release evidence 的
一部分；但 `check-upgrade-evidence.mjs` 已经会拒绝缺 A/B SHA、缺数据完整性、
缺备份或故障事实不全的报告。

注意：Phase 9.5.1 的 smoke-only 迁移延迟位于 `packages/frontend/src`，因此六份
证据的源码指纹从 `d14fb1d1…` 变为 `b73c5fd2…`。本轮已通过官方
`fetch-verification-evidence.mjs --run-id 41970525110` 重采，门禁 0 problem；
没有手工改写旧 manifest 或指纹。

## 5.1 Phase 9.6.1 恢复安全收口

- 启动门禁 fail-closed：只有 HEALTHY/RECOVERED 挂载业务 App；Tauri 状态查询
  异常、非法对象、RECOVERY_REQUIRED/RESTORING/RESTORE_INTERRUPTED/MANUAL
  均阻断；`getDb()` 在 pending/blocked 抛错。前端 14 项负向测试。
- 后端持久化本次启动裁决（`RecoveryVerdict`），`db_recovery_status` 只读，
  `db_recovery_retry` 显式重跑。
- 标记 v2：`targets[]` + `migrationId`，Core/Team 共用、合并写入、v1 兼容；
  完成清除由后端校验所有目标列 + integrity。
- 备份快照 canonicalization：拒绝备份目录之外的符号链接与 live DB。
- Windows 目录 fsync 使用 `FILE_FLAG_BACKUP_SEMANTICS`；仅
  `ERROR_INVALID_FUNCTION` 视为该卷不支持。真实 Windows `cargo test` **NOT_RUN**。
- 多实例恢复锁 **NOT_RUN**。
- E2E `42179513200`（`efb96aa`）5/5，interrupted/corrupt 通过；证据 `42179506989` 指纹 `3fd0148a…`，门禁 0。

## 5.2 Phase 9.6.2 迁移事务与恢复并发

- 标记损坏/未知版本 fail-closed：`read_marker`/`validate_marker` 返回错误，
  新事务不会覆盖；备份失败只回滚本次创建的标记。
- 活动快照 pin：`active_snapshot` + `prune_old_snapshots(pinned)`。
- 跨进程恢复锁：`RecoveryLock`（OS 文件锁），启动与备份持有到完成；
  第二实例 fail-closed。真实双进程并发 E2E **NOT_RUN**。
- 前端门禁缓存绕过：`getDb` 先断言门禁，`select` 传播拒绝；4 项测试。
- Windows：windows-latest 实跑 `cargo test --lib db_recovery` **9 passed**
  （job `127803321020`）；修复目录 flush `ERROR_ACCESS_DENIED`；
  完整文件系统矩阵/NSIS A→B 仍 **NOT_RUN**。
- E2E `42189361366`（`af33ea2`）5/5；证据 `42214762202`（`7df9e3a`）指纹
  `c138d564…`，门禁 0 problem。

## 5.3 Phase 9.6.3 最终数据安全收口

- 标记 v3 事务所有权：`transaction_id` + 进程令牌；旧事务只允许同一进程扩展，
  扩展前验证快照不含新目标列；完成/回滚/清除均核对事务 ID。
- `VACUUM INTO` 失败按原始字节回滚标记；下一次启动恢复事务 A。
- 恢复互斥：OS 文件锁（跨进程）+ tokio 进程内互斥 + `migration_active`；
  启动每次探测锁，第二实例 fail-closed；真实双进程 E2E 通过。
- 恢复/重试语义：标记清除失败不报告完成；retry 的锁失败与迁移进行中均写入
  一致的阻断裁决；恢复后不残留锁。
- Windows：目录 `ERROR_ACCESS_DENIED` 先做可写探测；windows-latest 19 项
  `db_recovery` 测试通过（含打开中数据库不得半替换）。
- Team 应用级 SIGKILL：1/3/5/10 目标点、Core 完成/Team 未完成、快照、恢复、
  幂等、字段级数据全部 PASS（E2E `42249215589`）。
- 证据：官方矩阵 run `42245189022`（`151c990`）3/3，指纹 `9bad378d…`，门禁 0 problem。
- 未闭合：已运行实例在另一实例恢复期间的普通写入（无全程实例锁）、
  Windows reparse/ACL/NSIS A→B。RC/Release 仍 **NO**。

## 5.4 Phase 9.7 P0-A 单实例与运行时锁

- 单实例：`tauri-plugin-single-instance v2.5.5` 首个注册插件；第二次启动激活首进程。
- 运行时锁：`instance.lock` 在 setup 中、任何数据库访问前持有；`RuntimeLockHandle`
  校验 inode，锁文件被删除/替换即失效。
- Retry 绕过已封堵：`retry_recovery(..., runtime_held)` 未持锁一律 Manual；
  完成迁移、备份命令与前端 `getDb` 均校验所有权。
- plugin-sql 无法按进程动态禁用；`getDb` 在打开前查询 `runtime_instance_lock_held`，
  直接调用 `plugin:sql|load` 的恶意 webview 不在本轮信任模型内（已记录）。
- Vault 应用级：smoke 构建 + 隔离目录标记的服务级 probe，覆盖创建/锁定/解锁/
  错误密码/改密/重启持久化；UI 自动化与 A→B 跨版本仍 NOT_RUN。
- 真实进程 E2E 与最终 CI：待本轮 run 回填。

## 6. 判定

| 判定 | 结果 |
| --- | --- |
| `READY_FOR_RC` | **NO** |
| `READY_FOR_RELEASE` | **NO** |
| 发布阻塞项是否已全部列出 | **YES**（含 BLOCKED_EXTERNAL） |
