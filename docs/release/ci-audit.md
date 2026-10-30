# Tauri 2 Release CI 审计（P0）

> 审计对象：本仓库 `terminal`（Tauri 2 + React 19 桌面应用）。
> 审计时间：2026-10-29，分支 `codex/terminal-reliability-matrix`，审计时 HEAD `fcc8e7e`（工作树干净，仅 `.workbuddy/` 未跟踪）。
> 工作区里另有 `AI-Novel-Writing-Assistant`、`todo`、`sql-studio-next` 三个仓库，属于**其他项目**，本次不修改：本任务只针对当前工作目录的 Tauri 应用。

## 1. 现有发布链路清单

| 项目 | 现状 |
| --- | --- |
| CI | `.github/workflows/ci.yml`，触发 `push` / `pull_request` / `workflow_dispatch`，`contents: read`。jobs：`frontend`（lint/typecheck/test/build:budget）、`team-server`（prisma validate/generate/typecheck/lint/test/build + PostgreSQL 迁移）、`source-size`、`rust`（fmt/check/clippy -D warnings/test）、`docker`（compose config + docker build）、`tauri`（macos/ubuntu/windows 三平台 `tauri build --no-bundle --ci`） |
| 实机矩阵 | `.github/workflows/real-machine-matrix.yml`，`workflow_dispatch` + 每周 cron（周一 03:30），`contents: read`，macOS/Linux/Windows 原生 runner |
| Release | `.github/workflows/release.yml`，`v*` tag + `workflow_dispatch(tag)`；`prepare-release`（校验 tag/commit/三处版本一致 + 解析或创建 prerelease）→ `build-macos-binary`（分架构出二进制）→ `bundle-macos`（lipo 合成 universal → `.app` → create-dmg）→ `build-release`（Windows/Linux 四个原生 runner）→ `verify-release`（7 个资产非空 + `SHA256SUMS.txt`） |
| Nightly | **不存在** |
| Electron 发布 | 本仓库无 Electron 代码，也无 electron-builder / latest.yml / CSC 变量，无需迁移 |
| R2 / CDN | 本仓库无 R2、Cloudflare 或自定义更新源；更新分发只有 GitHub Release |

## 2. 关键配置

- `src-tauri/tauri.conf.json`：`productName = Termius`，`version = 0.0.1-dev.1`，`identifier = com.baicie.termius`，`bundle.targets = all`，**无 `createUpdaterArtifacts`**，**无 `plugins` 段**。
- `src-tauri/Cargo.toml`：package `terminal` v0.0.1-dev.1，`rust-version = 1.96`，edition 2021；插件：shell、notification、dialog、fs、sql(sqlite)、window-state（capabilities 里还有 global-shortcut 权限）。
- `package.json`：monorepo `@terminal/monorepo` v0.0.1-dev.1，`packageManager = pnpm@10.34.3`，devDependencies 含 `@tauri-apps/cli@2.11.0`；`pnpm.patchedDependencies` 指向 `patches/@baicie__xterm@0.1.7.patch`。
- 版本工具链固定：`.node-version = 24.16.0`，`rust-toolchain.toml = 1.96.0`（含 clippy、rustfmt），`pnpm-lock.yaml` 冻结安装。
- 前端产物：`build.beforeBuildCommand = pnpm --filter=@terminal/frontend build`，`frontendDist = ../dist`。
- SQLite：`tauri-plugin-sql` + sqlite，schema/migration 逻辑在前端 `packages/frontend/src/service/database/connection-schema-*.ts`，数据落在 Tauri 应用数据目录；安装包升级不会覆盖该目录（由 Tauri 默认行为保证，需在 P6 实测确认）。

## 3. Updater 现状

- **完全没有** updater：Cargo 无 `tauri-plugin-updater`，tauri.conf 无 `plugins.updater.endpoints`，`bundle.createUpdaterArtifacts` 未开启，仓库无 `latest.json`。
- 现有 release 工作流显式关闭了 `uploadUpdaterJson` / `uploadUpdaterSignatures`。
- 结论：要实现 updater-signed 模式，需要**新增**插件依赖、capabilities 权限、`createUpdaterArtifacts: true`、公钥配置与签名密钥；这属于产品改动，不能只在 CI 里假装。

## 4. 签名现状

- 仓库与 workflow 中**不存在**任何 `APPLE_*`、`CSC_*`、`TAURI_SIGNING_*`、Azure/Windows 签名变量。
- 本地构建产物的签名状态：`adhoc, linker-signed`（`codesign -dv` 实测），即未用 Developer ID 签名、未公证。
- 现有 Release 说明已声明「macOS 未公证、Windows 未 Authenticode 签名」。

## 5. 版本编号

- SemVer 带 prerelease（`0.0.1-dev.1`），三处必须一致（`package.json`、`tauri.conf.json`、`Cargo.toml`），`prepare-release` 已经强制校验，并校验 tag 指向的 commit 等于 checkout commit。这一条**已经满足 P4 的 1/2 步**。

## 6. 阻断项：CI 当前是红的（P0 必须修）

- 实测 `gh run list`：最近两次 push 的 CI run `40800980388`、`40798218743` 均为 **failure**。
- `40800980388` 逐 job 结果：7 个 job 全绿（frontend、team-server、source-size、rust、tauri×3 OS），**只有 `Team Server container` 失败**，失败步骤是 `Build image`：

```
#16 ERROR: process "/bin/sh -c pnpm install --frozen-lockfile --filter=team-server --prod" did not complete successfully: exit code: 254
#17 ERROR: process "/bin/sh -c pnpm install --frozen-lockfile --filter=team-server" did not complete successfully: exit code: 254
```

- **根因（本地已复现）**：`packages/team-server/Dockerfile` 只 COPY 了 `package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml` 与 team-server 的清单，但根 `package.json` 声明了 `pnpm.patchedDependencies`，冻结安装会去读 `patches/@baicie__xterm@0.1.7.patch`。镜像里没有 `patches/`，pnpm 直接 ENOENT 退出（Docker 里表现为 exit 254）。
  模拟方式：把 Dockerfile 的 COPY 集合复制到临时目录后执行同一条 pnpm 命令，得到

```
ENOENT ENOENT: no such file or directory, open '/private/tmp/docker-ctx/patches/@baicie__xterm@0.1.7.patch'
```

  补上 `patches/` 后同一条命令 **exit 0**（`Done in 1m 0.8s using pnpm v10.34.3`）。
- 修复：Dockerfile 的 `builder` 与 `production` 两个阶段都加上 `COPY patches patches`。
- 验证：提交 `18012ab` 推送后，CI run `40808864624` 的 `Team Server container` job 结论由 `failure` 变为 **`success`**（其余 7 个 job 此前已绿）。

## 7. 风险清单（按严重程度）

| # | 风险 | 影响 | 处置 |
| --- | --- | --- | --- |
| R1 | `Team Server container` job 因缺 `patches/` 一直失败 | 主分支/分支 CI 永远红，任何「门禁通过」的说法都不成立 | ✅ **已修复**：Dockerfile 两个阶段补 `COPY patches patches`；CI run `40808864624` 里该 job 已 `success` |
| R2 | 没有 Nightly 通道 | 无法验证「只有新提交才发」的预发布流程，也无独立更新源 | 曾新增 `nightly.yml` 并跑通（run `40875289443`），**后按项目决定移除**；仓库现在只有 `ci.yml`、`release.yml`、`real-machine-matrix.yml`，历史 nightly prerelease 与 tag 保留 |
| R3 | 没有 updater（插件/密钥/latest.json 全无） | 无法自动更新；也不能宣称已支持 | 提供 updater-signed 模式与密钥指南，默认关闭 |
| R4 | 无商业签名证书 | macOS Gatekeeper / Windows SmartScreen 会警告 | 只预留 Mode C，不购买证书；文档明确声明 |
| R5 | release 只有 tag 触发、无模式区分 | 一旦打 tag 就会走完整发布，无法先出 unsigned QA 包 | ✅ 增加 `release_mode`（unsigned-qa / updater-signed / fully-signed），tag push 固定 unsigned-qa，且 Release 改为先 draft 后 undraft |
| R6 | CI 无 concurrency 取消、无 path filter | 连续 push 会排队跑满 6 个 job，浪费配额 | ✅ `ci.yml` 增加 concurrency（PR 取消旧跑）与 paths-ignore（纯文档改动不跑） |
| R7 | 版本号已含 prerelease（`0.0.1-dev.1`）且与既有 GitHub Release 同名 | 新包若沿用同号会造成「同号不同物」 | 发布新包前必须升版本号；workflow 已强制 tag==三处版本 |
| R8 | 没有安装/升级 smoke 测试 | 编译成功不等于装得上、起得来 | P6 做本地实测（DMG 挂载 + 启动 + 版本号） |
