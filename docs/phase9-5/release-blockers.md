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
| dev.1 → dev.2 真实升级 | 见 `upgrade-e2e.md`（macOS） |
| 跨版本回滚 B→A | **NOT_RUN**（无产品回滚状态机） |
| 升级失败自动回滚 | **NOT_RUN** |
| migration 抛错/只读/损坏 | 见 `failure-recovery.md`（第一版覆盖） |
| 磁盘满/安装介质只读 | **NOT_RUN**（未实现确定性 fixture） |
| 升级中途 kill | **NOT_RUN**（迁移窗口太短，不伪造） |
| 真实 Vault 主密码解锁 | **NOT_RUN** |
| Team Sync 服务端升级 | **NOT_RUN**（本地表持久化已覆盖） |
| Windows/Pageant/串口硬件 | **NOT_RUN** |
| 物理键盘/中文 IME | **NOT_RUN** |

## 5. 证据绑定

升级 harness 产出的 JSON/Markdown **当前不在** `FINGERPRINT_PATHS`。若要把升级
报告作为 release 证据，需要：

1. 把 `scripts/verify-install/**` 与 `.github/workflows/upgrade-e2e.yml` 纳入
   `FINGERPRINT_PATHS`；
2. 在纳入后的源码上重新采集六份实机证据；
3. 在 release 门禁中把升级报告的 A/B SHA、平台、schema、数据域结果作为阻塞项。

未完成以上三步前，升级报告只能作为 Phase 9.5 工程证据，不能冒充六份 release
evidence 的一部分。

## 6. 判定

| 判定 | 结果 |
| --- | --- |
| `READY_FOR_RC` | **NO** |
| `READY_FOR_RELEASE` | **NO** |
| 发布阻塞项是否已全部列出 | **YES**（含 BLOCKED_EXTERNAL） |
