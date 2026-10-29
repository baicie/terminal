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

## 4. 接入运行时（尚未做，属于产品改动）

要真正启用自动更新，还需要：

1. `src-tauri/Cargo.toml` 增加 `tauri-plugin-updater = "2"`，前端增加 `@tauri-apps/plugin-updater`；
2. `src-tauri/src/lib.rs` 注册插件；`capabilities/default.json` 增加 `updater:default`；
3. `tauri.conf.json` 增加：

```json
{
  "plugins": {
    "updater": {
      "pubkey": "<上一步的公钥>",
      "endpoints": ["https://github.com/baicie/terminal/releases/download/{{tag}}/latest.json"]
    }
  }
}
```

4. 前端实现「检查更新 → 下载 → 校验签名 → 重启」的 UI 流程。

在这四步完成之前，`updater-signed` 模式只保证**产物与签名可审查**，不代表用户会被自动更新。
