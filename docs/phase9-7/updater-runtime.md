# Phase 9.7 WP4 — Signed Updater Runtime E2E

> 分支 `feat/phase9-7-product-acceptance`（Draft PR #9）
> 代码：`src-tauri/src/updater_probe.rs`、`scripts/verify-install/updater-e2e.mjs`

## 1. 结论

```text
UPDATER_RUNTIME_CHECK_VERIFIED=PASS
UPDATER_SIGNED_DOWNLOAD_VERIFIED=PASS
UPDATER_INSTALL_RESTART_VERIFIED=PASS
UPDATER_DATA_PRESERVATION_VERIFIED=PASS
UPDATER_NEGATIVE_MATRIX_VERIFIED=PASS
UPDATER_PLATFORM_SCOPE=macOS-arm64
```

这是**运行时链路**的证据：真实两版应用、真实 minisign 签名、真实 loopback HTTP、
真实安装替换与重启。生产 `plugins.updater.pubkey`、正式签名私钥、公开 Release 均未触碰。

## 2. 产品代码（仅测试构建）

- `Cargo.toml` 新增 `smoke-updater` feature；`src-tauri/src/updater_probe.rs` 只在该
  feature 下编译，生产二进制里不存在这段代码。
- `setup` 中按环境变量触发：`TERMINAL_UPDATER_PROBE_ACTION=check|install`、
  `TERMINAL_UPDATER_PROBE_RESULT=<path>`、`..._RESTART`、`..._EXIT`。
  正常启动没有任何这些变量，行为完全不变。
- 执行阶段与报告：`config → check → install`，每阶段前缀写入 JSON（`status`、
  `currentVersion`、`availableVersion`、`error`），供 harness 区分"没有更新 / 网络失败 /
  验签失败 / 安装失败"。
- 安装成功后按 `..._RESTART=1` 调 `app.restart()`；重启进程通过编译期路径记录 boot 痕迹，
  便于诊断（不作为唯一判定）。

## 3. 隔离

| 维度 | 做法 |
| --- | --- |
| 密钥 | `tauri signer generate` 临时 minisign 密钥，只存在于工作目录，不提交、不进 artifact |
| 端点 | loopback HTTP + `dangerousInsecureTransportProtocol`（仅测试构建） |
| 身份 | 测试构建使用 `com.baicie.termius.updater-e2e`，不碰生产数据目录与单实例 socket |
| 产物 | A/B 各构建一次；B 的 `.app.tar.gz` + `.sig` 由临时私钥签名 |
| 工作目录 | 必须在无符号链接的路径（macOS `/tmp`、`/var` 是符号链接，Tauri 更新器会拒绝） |

## 4. 用例矩阵（本机 macOS arm64）

A = `0.0.1-updater.1`，B = `0.0.1-updater.2`。

| 用例 | 服务器提供 | 期望 | 实测 |
| --- | --- | --- | --- |
| prepare | 合法 B manifest | `available` | PASS |
| positive | 合法 B manifest + 签名 | 安装并重启为 B | PASS（新 PID 57931，版本 B） |
| downgrade | B 之前版本 | `up_to_date`，不安装 | PASS |
| wrong-platform | 只给另一个架构 | 拒绝（platform） | PASS |
| missing-artifact | manifest URL 404 | 拒绝（network） | PASS |
| missing-signature | 空签名 | 拒绝（signature） | PASS |
| wrong-signature | 篡改签名 | 拒绝（signature） | PASS |
| tampered | 篡改 payload | 拒绝（signature） | PASS |
| truncated | 截断 payload | 拒绝（signature） | PASS |

所有负向用例后安装目录版本仍为 A，未发生半安装。

数据保留：更新前在应用自己的 SQLite 写入 `updater_probe_marker=before-update`，
更新并重启后读回同一值；测试 identifier 的数据目录在结束后清理。

## 5. 重启判定

macOS 的 `app.restart()` 经由 LaunchServices 启动新进程，**不会继承 harness 环境**，
因此不能用环境变量传结果。判定改为操作系统事实：安装完成后，出现一个 PID 不同于
原进程、且从已替换为 B 的 bundle 启动的进程（`pgrep` + bundle 版本），随后显式结束它。
测试进程同时保留编译期 boot 记录作为诊断。

## 6. 复现

```bash
node --experimental-sqlite scripts/verify-install/updater-e2e.mjs
```

CI 在 `Upgrade E2E` 的 `macOS updater runtime (temporary key)` job 中执行，
报告与构建日志作为 artifact 上传。`--experimental-sqlite` 只为本机 Node 22；
CI 使用 Node 24。

## 7. 未覆盖

- Windows NSIS/MSI 与 Linux AppImage/deb 的运行时安装：各自平台的安装语义不同，
  仍 **NOT_RUN**。
- 生产 Apple notarization / Windows Authenticode / 正式 updater 公钥仍 **BLOCKED_EXTERNAL**。
- 下载超时、断点续传、代理与限速未做；当前负向矩阵覆盖完整性、签名、平台与 404。
- UI 上的"检查更新"入口未做自动化；本轮触发点是测试构建内的 Rust autorun。
