# 签名密钥与 Secrets

## 1. 生成 Tauri Updater 签名密钥（免费）

```bash
pnpm tauri signer generate -w ~/.tauri/terminal-updater.key
```

命令会交互式要求设置私钥密码（可留空），并输出：

- 私钥文件：`~/.tauri/terminal-updater.key`（**绝不入库**）
- 私钥内容：写入 GitHub Secret `TAURI_SIGNING_PRIVATE_KEY`（整段文本，含 `untrusted comment:` 行）
- 公钥：写入 `src-tauri/tauri.conf.json` 的 `plugins.updater.pubkey`（将来接入 updater 插件时）

签名单个文件用于人工校验：

```bash
pnpm tauri signer sign -f ~/.tauri/terminal-updater.key -p "<password>" <file>
```

## 2. 需要配置的 GitHub Secrets

| Secret | 模式 | 是否必需 | 说明 |
| --- | --- | --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | updater-signed | 必需 | `tauri signer generate` 产出的私钥全文 |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | updater-signed | 可选 | 生成私钥时设置的密码；未设置则不传 |
| `APPLE_CERTIFICATE` / `APPLE_CERTIFICATE_PASSWORD` / `APPLE_SIGNING_IDENTITY` | fully-signed | 预留 | Developer ID Application，本阶段不使用 |
| `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID` | fully-signed | 预留 | 公证用，本阶段不使用 |
| `WINDOWS_CERTIFICATE` / `WINDOWS_CERTIFICATE_PASSWORD` | fully-signed | 预留 | Authenticode，本阶段不使用 |

**任何密钥、证书、密码都不得提交到仓库**。CI 只在运行时从 secrets 注入环境变量。

## 3. 密钥轮换

1. 生成新密钥对；
2. 先把新公钥写进 `plugins.updater.pubkey` 并发布一版**用旧密钥签名**的更新（否则旧客户端读不到新公钥）；
3. 之后改用新私钥签名；
4. 旧私钥作废。

在 updater 尚未接入运行时之前，轮换没有兼容负担，但仍应遵守「私钥不落库」的规则。

## 4. 运行时接入状态

插件侧已经接好（本次改动）：

1. `src-tauri/Cargo.toml` 增加 `tauri-plugin-updater = "2"`，前端增加 `@tauri-apps/plugin-updater`；
2. `src-tauri/src/lib.rs` 注册 `tauri_plugin_updater`，`capabilities/default.json` 增加 `updater:default`；
3. `src-tauri/tauri.conf.json` 增加 `plugins.updater`：`endpoints` 指向 `https://github.com/baicie/terminal/releases/download/updater-latest/latest.json`，`pubkey` **仍是占位符** `REPLACE_WITH_TAURI_UPDATER_PUBLIC_KEY`；
4. 前端有 `packages/frontend/src/service/updates.ts`（只检查、不下载）与设置对话框里「检查更新」按钮。

**还差你一步**：把 `tauri signer generate` 输出的**公钥**替换 `tauri.conf.json` 里的占位符。在替换之前：

- 运行时：`check()` 会因公钥无效而失败，UI 显示「Updater is not configured in this build」，不会静默通过；
- CI：`updater-signed` 模式的 `Validate the release mode` 步骤检测到占位符会**直接失败**，避免发布一个所有客户端都会拒绝的 manifest。

替换后，`updater-signed` 运行会把 `latest.json` 同时上传到该次 release 与固定的 `updater-latest` 通道 tag，应用端只轮询后者。

**仍未做**：「下载并安装」按钮。当前只实现「检查 → 展示可用版本」，安装动作留给用户从 release 页面手动下载，避免在未签名的构建上自动替换二进制。
