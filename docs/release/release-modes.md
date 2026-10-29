# 发布模式（三级签名）

`release.yml` 由 `workflow_dispatch` 的 `release_mode` 输入选择模式；**推送 tag 永远只走 `unsigned-qa`**，需要密钥的模式必须由人显式派发，避免一个 tag 意外产生签名产物。

| 模式 | OS 代码签名 | Updater 签名 | 需要 Secrets | 产物 | 可见性 |
| --- | --- | --- | --- | --- | --- |
| `unsigned-qa`（默认） | 无 | 无 | 无 | 7 个安装包（macOS universal DMG、Windows ARM64/x64 NSIS、Linux ARM64/x64 AppImage+DEB） | draft → 校验通过后转 prerelease |
| `updater-signed` | 无 | 有（`.sig` + `latest.json`） | `TAURI_SIGNING_PRIVATE_KEY`（可选 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`） | 上述 7 个安装包 + 各平台更新载荷 + `.sig` + 唯一 `latest.json` | draft → 全部门禁通过后转 prerelease |
| `fully-signed`（预留） | Developer ID + 公证 / Authenticode | 有 | Apple 与 Windows 证书 | — | **本阶段启用即失败**，等待付费证书 |

## unsigned-qa

- 不需要任何证书或密钥；构建失败不会静默降级成别的东西（因为没有可降级的东西）。
- 不生成 updater 产物（`tauri.conf.json` 里 `createUpdaterArtifacts` 保持缺省）。
- 不更新任何 `latest.json`，不触碰既定更新源。
- Release 说明与 `verify-release` 的输出都显式写明「unsigned QA，无 Apple/Windows 代码签名、无公证、无 updater 签名」。
- 允许使用 macOS 自带的 ad-hoc 签名（Tauri 默认行为，实测为 `adhoc, linker-signed`）。**ad-hoc 不等同 Developer ID 签名，也不构成公证**，Gatekeeper 仍会拦截首次打开。

## updater-signed

- 前置条件：secrets 里存在 `TAURI_SIGNING_PRIVATE_KEY`。缺失时 `Validate the release mode` 步骤直接失败——**不会自动降级成 unsigned 产物**，因为那会让「已签名」的声明变成假话。
- 通过 `--config {"bundle":{"createUpdaterArtifacts":true}}` **内联**开启 updater 产物，仓库里的 `tauri.conf.json` 不变，所以普通发布仍是干净产物。
- `verify-release` 的门禁：
  1. 每个平台必须有一个更新载荷（`*.app.tar.gz` / `*.nsis.zip` / `*.AppImage.tar.gz`）；
  2. 每个载荷必须有同名 `.sig`，缺一个就失败；
  3. 用真实的 `.sig` 内容生成唯一 `latest.json`（`darwin-aarch64`、`darwin-x86_64` 指向同一份 universal 载荷；`windows-x86_64`；`linux-x86_64`）；
  4. 只有以上都通过，draft 才会被 undraft。
- 仍然没有 OS 代码签名：Gatekeeper / SmartScreen 警告照旧，文档和 Release 说明必须如实写。
- **运行时消费**：`tauri-plugin-updater` 已注册，前端有只读的「检查更新」（不自动下载安装）。**但 `plugins.updater.pubkey` 还是占位符**，在维护者填入真实公钥之前，检查会 fail-closed 并在 UI 明确提示未配置；CI 在 `updater-signed` 模式下也会拒绝带占位符的发布。细节见 `docs/release/signing-keys.md` 第 4 节。

## fully-signed（预留，不在本阶段启用）

需要：Apple Developer ID Application 证书 + notarization 凭据（`APPLE_ID`/`APPLE_PASSWORD`/`APPLE_TEAM_ID`）、Windows Authenticode 或 Azure Artifact Signing。当前命中该模式会在 `Validate the release mode` 步骤直接失败并说明原因，避免出现「看起来签过、其实没签」的发布。

## 与现有 Electron 发布的关系

本仓库没有 Electron 代码，也没有 electron-builder / `latest.yml` / `CSC_*` 变量，因此不存在「用 Electron 的签名机制冒充 Tauri 发布」的情况。工作区里的其他仓库（AI-Novel-Writing-Assistant、todo、sql-studio-next）不在本任务范围，未做任何修改。
