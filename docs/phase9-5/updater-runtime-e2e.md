# Phase 9.5.3 — Updater Runtime E2E

> 日期：2026-11-05
> 判定：`UPDATER_RUNTIME_E2E_VERIFIED = NOT_RUN`

## 1. 当前基础

- `updater-manifest.mjs`：验证 `latest.json` semver、平台、URL/签名配对、
  deb/AppImage bundle 类型、版本单调性；
- 4 项静态负测试通过；
- `tauri-plugin-updater`/`@tauri-apps/plugin-updater` 2.14.1 已注册；
- 产品只有 check，没有 download/install UI，也没有 restart API。

## 2. 为什么不是运行时 PASS

静态 manifest 校验不执行：

- loopback HTTP 下载；
- minisign 签名验证；
- `.app` 安装；
- 重启与 version readback；
- 错误签名、截断、篡改、下载中断、错误平台/类型；
- 用户数据保留。

本轮没有生成临时 minisign key、没有构建 A/B bundle、没有启动 loopback server，
因此不能把 `UPDATER_E2E_FOUNDATION` 写成运行时验证。

## 3. 下一步可执行链

1. `pnpm tauri signer generate -w <tmp>` 生成本轮临时 key；
2. loopback static server 提供 `latest.json` + B `.app.tar.gz` + `.sig`；
3. A 构建低版本、临时 pubkey、`dangerousInsecureTransportProtocol=true`；
4. 从 disposable `.app` 启动 A，驱动 check/download/install；
5. 负例：错误签名、篡改 manifest、截断下载、版本不递增、错误平台/类型；
6. 安装后重启，读取版本与保留的 fixture 数据；
7. 不修改生产 pubkey、`updater-latest`、GitHub Release。

## 4. 判定

`UPDATER_RUNTIME_E2E_VERIFIED = NOT_RUN`
`UPDATER_E2E_FOUNDATION = PARTIAL`（静态契约）
