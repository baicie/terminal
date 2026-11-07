# Phase 9.7 WP4 — Signed Updater Runtime E2E

> 分支 `feat/phase9-7-product-acceptance`（Draft PR #9）
> 基线：`42990ce`；P0-A.2 代码 `5e8ce13`

## 1. 当前事实

- `src-tauri/tauri.conf.json` 的 `plugins.updater.pubkey` 仍是占位
  `REPLACE_WITH_TAURI_UPDATER_PUBLIC_KEY`，endpoint 指向 GitHub Release。
- 前端 `service/updates.ts` 只有检查更新与失败分类；没有运行时下载/安装闭环。
- 因此：

```text
UPDATER_RUNTIME_CHECK_VERIFIED=NOT_RUN
UPDATER_SIGNED_DOWNLOAD_VERIFIED=NOT_RUN
UPDATER_INSTALL_RESTART_VERIFIED=NOT_RUN
UPDATER_DATA_PRESERVATION_VERIFIED=NOT_RUN
UPDATER_NEGATIVE_MATRIX_VERIFIED=NOT_RUN
```

## 2. 计划中的隔离闭环（未执行）

1. `tauri signer generate` 生成**本轮临时** updater 密钥；私钥只放一次性目录，
   不进 artifact、不提交。
2. 构建低版本 A（临时公钥 + loopback endpoint 通过 config overlay 注入）。
3. 构建高版本 B，生成 macOS updater bundle 与 `.sig`（临时私钥签名）。
4. 本地 loopback HTTP 提供真实 `latest.json`、bundle、`.sig`。
5. 安装并启动 A；触发检查更新（smoke 构建内的 updater probe 或真实 UI）。
6. A 下载 B、真实验签、安装、退出；B 重启。
7. 验证 B 版本/二进制 SHA、A 的 Host/Settings/Vault 数据仍在。

不得触碰生产 updater pubkey、正式签名私钥、公开 latest.json、GitHub Release
或真实用户数据。

## 3. 负向矩阵（待执行）

篡改 bundle、错误签名、缺失签名、错误架构、版本回退、HTTP 超时、下载中断、
截断、安装写入失败、退出失败、重启失败、数据权限不足；每条区分
“拒绝成功 / 下载失败 / 验签失败 / 安装失败 / 数据损坏 / 可重试”。

## 4. 阻塞原因

不是外部密钥阻塞（临时密钥可生成），而是本轮没有完成：

- A/B 双构建与临时 key overlay；
- loopback 更新服务与真实签名 bundle；
- 可触发的运行时下载/安装入口（当前前端只有 check）。

正式 notarization/Authenticode/生产 pubkey 仍独立标记 **BLOCKED_EXTERNAL**。
