# Phase 9.5.2 — Updater E2E Foundation

> 日期：2026-11-05
> 代码：`scripts/verify-install/updater-manifest.mjs` + 4 项测试
> 判定：`UPDATER_E2E_FOUNDATION = PARTIAL`

## 1. 现状审计

- `tauri-plugin-updater` 2.14.1 与前端 `@tauri-apps/plugin-updater` 2.14.1 已注册；
- 产品只有 settings 里的 “Check for updates”，`check()` 返回的 `Update` 被降级为
  `{version, body}`，`download()/install()` 没有调用入口；
- `tauri.conf.json` 的 `pubkey` 仍是占位符，但占位符只影响下载/安装的签名验证，
  `check()` 仍可请求生产 manifest；
- capability 已授予完整 updater 权限，但没有 install UI/restart API；
- release workflow 的 `latest.json` 只有 linux-x86_64 一个 URL，指向 AppImage；
  deb 客户端会下载 AppImage 后 `install_deb` 失败；arm64 平台缺条目；
- `verify-release` 只检查 `.sig` 文件存在，没有验证 minisign 签名；
- 共享 `updater-latest` 通道按 tag 并发上传，后写覆盖先写。

## 2. 本轮实现

`updater-manifest.mjs` 是 **静态契约**，不下载、不验签、不安装：

- manifest 必须是 semver，且必须新于当前版本；
- 每个平台必须 http(s) URL、非空 signature、URL 不重复；
- `*-deb` 必须指向 `.deb`，`*-appimage` 必须指向 `.AppImage`；
- 必须包含 darwin-aarch64、darwin-x86_64、windows-x86_64、linux-x86_64-appimage；
- 拒绝全平台共用同一 URL（避免 deb/AppImage 混用）。

测试覆盖：完整 manifest、缺 signature/平台、非单调版本、deb/AppImage URL
不匹配、版本比较（稳定版 > prerelease）。

```bash
node --test scripts/verify-install/updater-manifest.test.mjs
node scripts/verify-install/updater-manifest.mjs --manifest latest.json --current 0.0.1-dev.2
```

## 3. 可行性结论

本地隔离 updater E2E 可行，但本轮未实现：

1. `pnpm tauri signer generate` 生成临时 key；
2. 本机 127.0.0.1 静态服务器提供 `latest.json`、B 的 `.app.tar.gz` 与 `.sig`；
3. A 构建带 `updater.endpoints` 指向 loopback、临时 pubkey、较低版本；
4. B 构建较高版本；
5. 驱动 `check → download → verify signature → install → relaunch`；
6. 负例：篡改 manifest 版本、错误签名、截断下载、降级。

macOS 需要从 disposable `.app` 运行，不能直接跑裸二进制；HTTP 需要
`dangerousInsecureTransportProtocol=true`（仅测试构建）。不修改生产 pubkey、
`updater-latest` 或 GitHub Release。

## 4. 仍未完成

- 运行时 download/verify/install/restart：**NOT_RUN**；
- 生产签名/公证/updater 公钥：**BLOCKED_EXTERNAL**；
- Windows/Linux 更新链、deb manifest 修复：**NOT_RUN**。

## 5. 判定

`UPDATER_E2E_FOUNDATION = PARTIAL`：有可执行、可测试的静态 manifest 门禁和
负例；没有真实下载/安装/重启链。不得把 manifest 测试写成 updater 运行时 PASS。
