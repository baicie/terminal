# 发布模式（三级签名）

`release.yml` 由 `workflow_dispatch` 的 `release_mode` 输入选择模式；**推送 tag 永远只走 `unsigned-qa`**，需要密钥的模式必须由人显式派发，避免一个 tag 意外产生签名产物。

| 模式 | OS 代码签名 | Updater 签名 | 需要 Secrets | 产物 | 可见性 |
| --- | --- | --- | --- | --- | --- |
| `unsigned-qa`（默认） | 无 | 无 | 无 | **8 个安装包**：macOS `aarch64` / `x86_64` 各一个 DMG、Windows ARM64/x64 NSIS、Linux ARM64/x64 各 AppImage + DEB | draft → 校验通过后转 prerelease |
| `updater-signed` | 无 | 有（`.sig` + `latest.json`） | `TAURI_SIGNING_PRIVATE_KEY`（可选 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`）+ `TAURI_UPDATER_PUBKEY` | 上述 8 个安装包 + macOS 逐架构 `.app.tar.gz` 与 `.sig` + **全部 8 个 bundle 各自的 `.sig`（含 aarch64 与 deb，不只 x64）** + 唯一 `latest.json` | draft → 全部门禁通过后转 prerelease |
| `fully-signed`（预留） | Developer ID + 公证 / Authenticode | 有 | Apple 与 Windows 证书 | — | **本阶段启用即失败**，等待付费证书 |

## unsigned-qa

- 不需要任何证书或密钥；构建失败不会静默降级成别的东西（因为没有可降级的东西）。
- 不生成 updater 产物（`tauri.conf.json` 里 `createUpdaterArtifacts` 保持缺省）。
- 不更新任何 `latest.json`，不触碰既定更新源。
- Release 说明与 `verify-release` 的输出都显式写明「unsigned QA，无 Apple/Windows 代码签名、无公证、无 updater 签名」。
- 允许使用 macOS 自带的 ad-hoc 签名（Tauri 默认行为，实测为 `adhoc, linker-signed`）。**ad-hoc 不等同 Developer ID 签名，也不构成公证**，Gatekeeper 仍会拦截首次打开。

## updater-signed

- 前置条件：secrets 里同时存在 `TAURI_SIGNING_PRIVATE_KEY`（私钥）与 `TAURI_UPDATER_PUBKEY`（公钥，且不能是占位符值）。任一缺失时 `Validate the release mode` 步骤直接失败——**不会自动降级成 unsigned 产物**，因为那会让「已签名」的声明变成假话。
- 通过 `--config {"bundle":{"createUpdaterArtifacts":true}}` **内联**开启 updater 产物，仓库里的 `tauri.conf.json` 不变，所以普通发布仍是干净产物。
- `verify-release` 的门禁：
  1. `bundle-macos` 必须为本架构产出 `*.app.tar.gz`，并已带上 `.sig`（缺 payload 或 `.sig` 都失败）；
  2. Windows 与 Linux 的更新载荷就是各自的安装包本身（`Terminal_<ver>_windows-x86_64-setup.exe`、`Terminal_<ver>_linux-x86_64.AppImage`），各自必须有同名 `.sig`；
  3. 用真实的 `.sig` 内容生成唯一 `latest.json`，**只有 4 个平台条目**：`darwin-aarch64` 与 `darwin-x86_64` 各指向本架构的 `.app.tar.gz`，加 `windows-x86_64` 与 `linux-x86_64`；
  4. `tauri-action` 被设为 `uploadUpdaterJson: false`，`latest.json` 只能由 `verify-release` 生成，避免各平台各发一份；
  5. 只有以上都通过，draft 才会被 undraft。
- **覆盖范围是有限的**：`windows-aarch64` 与 `linux-aarch64` 没有更新条目，这两个架构的安装包只能手动下载安装。
- **本阶段状态**：**已在真实密钥下执行过**——`v0.0.1-dev.2`（2026-10-30）产出 8 个真实 minisign `.sig` 与 `latest.json`（Phase 8 P8.7 核实）。原「从未执行过」的判断已作废。仍需注意两点：仓库内的 `tauri.conf.json:51` pubkey 保持占位符；`latest.json` 只含 4 个平台，windows-aarch64 与 linux-aarch64 无更新条目。
- 仍然没有 OS 代码签名：Gatekeeper / SmartScreen 警告照旧，文档和 Release 说明必须如实写。
- **运行时消费**：`tauri-plugin-updater` 已注册，前端有只读的「检查更新」（不自动下载安装）。仓库里 `plugins.updater.pubkey` 仍是占位符（因此 unsigned QA 构建的检查会 fail-closed 并在 UI 提示未配置）；`updater-signed` 构建通过 CI 的 `--config` 注入真实公钥，只有签名构建才具备可用的更新校验。细节见 `docs/release/signing-keys.md` 第 4 节。

## fully-signed（预留，不在本阶段启用）

需要：Apple Developer ID Application 证书 + notarization 凭据（`APPLE_ID`/`APPLE_PASSWORD`/`APPLE_TEAM_ID`）、Windows Authenticode 或 Azure Artifact Signing。当前命中该模式会在 `Validate the release mode` 步骤直接失败并说明原因，避免出现「看起来签过、其实没签」的发布。

## 与现有 Electron 发布的关系

本仓库没有 Electron 代码，也没有 electron-builder / `latest.yml` / `CSC_*` 变量，因此不存在「用 Electron 的签名机制冒充 Tauri 发布」的情况。工作区里的其他仓库（AI-Novel-Writing-Assistant、todo、sql-studio-next）不在本任务范围，未做任何修改。
