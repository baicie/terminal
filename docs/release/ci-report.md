# CI 测试报告（P6/P7）

> 更新时间：2026-10-29
> 分支 `codex/terminal-reliability-matrix`；相关提交：`18012ab`（CI 改造）、`835fae8`（版本 0.0.1-dev.2）、`bf3f34d`（draft 需带 prerelease）、`d4b9054`（draft 解析修正）
> 原则：跑过的写 PASS，没跑过的写 NOT_RUN，不把编译成功当成安装验证。

## 1. CI（质量门禁）

**Run `40808864624`（`ci.yml`）→ `completed / success`，8/8 job 绿**，其中 `Team Server container` 是本次修复的那一项（修复前一直 failure）。

| Job | 结果 |
| --- | --- |
| Frontend quality / Team Server quality / Rust quality / Production source-size gate | ✅ success |
| **Team Server container** | ✅ **success**（修复前 failure） |
| Tauri build (macos-latest / ubuntu-latest / windows-latest) | ✅ success |

## 2. Release（unsigned-qa 通道，端到端）

**Run `40811158213`（`release.yml`，`workflow_dispatch` tag=v0.0.1-dev.2 mode=unsigned-qa）→ `completed / success`，9/9 job 绿。**

| Job | 结果 | 说明 |
| --- | --- | --- |
| Validate release metadata | ✅ | tag/commit/三处版本一致；创建 draft+prerelease |
| Build macOS binary (aarch64-apple-darwin) | ✅ | 只出二进制并 upload-artifact |
| Build macOS binary (x86_64-apple-darwin) | ✅ | 同上 |
| Linux ARM64 / Linux x64 | ✅ | AppImage + DEB |
| Windows ARM64 / Windows x64 | ✅ | NSIS |
| **Bundle universal macOS DMG** | ✅ | `lipo` 合成 + `.app` + `create-dmg` |
| Verify release assets | ✅ | 7 个资产非空 → 生成并上传 `SHA256SUMS.txt` → undraft |

**发布结果**：<https://github.com/baicie/terminal/releases/tag/v0.0.1-dev.2>（prerelease，非 draft）

| 资产 | 字节 |
| --- | ---: |
| `Terminal_0.0.1-dev.2_macos-universal.dmg`（该次为 universal；现改为分架构） | 24,477,423 |
| `Terminal_0.0.1-dev.2_windows-x86_64-setup.exe` | 8,194,751 |
| `Terminal_0.0.1-dev.2_windows-aarch64-setup.exe` | 7,354,375 |
| `Terminal_0.0.1-dev.2_linux-x86_64.AppImage` | 88,631,800 |
| `Terminal_0.0.1-dev.2_linux-x86_64.deb` | 14,120,784 |
| `Terminal_0.0.1-dev.2_linux-aarch64.AppImage` | 86,772,232 |
| `Terminal_0.0.1-dev.2_linux-aarch64.deb` | 14,055,838 |
| `SHA256SUMS.txt` | 760 |

## 3. 安装包实测（本机 macOS）

下载发布产物后在本机验证：

> **注意（Phase 8 P8.7 更正）**：下表是**更早一次 universal DMG 构建**的实测记录，不是 `v0.0.1-dev.2`。
> dev.2 已改为**按架构分开**的产物：`Terminal_<ver>_macos-aarch64.dmg` = 12,035,266 字节、
> `Terminal_<ver>_macos-x86_64.dmg` = 12,627,781 字节，**不再是 24,477,423 字节的 universal 包**，
> `lipo -archs` 也只会得到单一架构。把本节数字挂在 dev.2 名下会误导。

| 检查 | 结果 |
| --- | --- |
| 下载 DMG | ✅ 24,477,423 字节 |
| 本地 SHA-256 与发布 `SHA256SUMS.txt` 一致 | ✅ `819e2abe560508f1c31a7ca516bc516eb0b3048b1e82b8be420d765374c93b83` 两侧相同 |
| 挂载 DMG | ✅ `/Volumes/Termius`，含 `Termius.app` 与 `Applications` 软链（拖拽安装布局） |
| **是否真正 universal** | ✅ `lipo -archs` → **`x86_64 arm64`** |
| 版本与标识 | ✅ `CFBundleShortVersionString = 0.0.1-dev.2`，`CFBundleIdentifier = com.baicie.termius` |
| 签名 | ⚠️ `adhoc, linker-signed`、`TeamIdentifier=not set` —— 未用 Developer ID、未公证，符合 unsigned-qa 声明 |
| 启动 smoke | ✅ `open Termius.app` 后 8 秒进程仍在（PID 50550），退出命令可正常关闭，无残留进程 |

## 4. 本地静态/逻辑验证

| 检查 | 结果 |
| --- | --- |
| `actionlint`（含 shellcheck）扫描 4 个 workflow | ✅ 0 problems |
| workflow 结构解析（`yaml.safe_load`） | ✅ 5 job / 2 输入 / verify 三步 |
| nightly 版本改写脚本 | ✅ 三处文件同时变为 `0.0.1-nightly.20261029.abc123def456` |
| nightly `plan` 判定 | ✅ `needed=true`，版本 `0.0.1-nightly.20261029.18012ab5c497` |
| `pnpm verify` | ✅ 退出码 0 |
| 本地 `docker build`（team-server 镜像） | ⚠️ 本机网络 `ECONNRESET` 未完成；镜像构建正确性由 CI 的 `Team Server container` success 证明 |

## 5. Nightly 通道（曾验证通过，**后按项目决定移除**）

> 2026-10-29 更新：`nightly.yml` 已删除。下面是移除前的验证记录，保留作为历史；现在仓库只有 `ci.yml`、`release.yml`、`real-machine-matrix.yml`。

**run `40875289443`（`nightly.yml` 在 main 上 `workflow_dispatch`）→ `completed / success`，5/5 job 绿**：

| Job | 结果 |
| --- | --- |
| Decide whether a nightly is needed | ✅（版本 `0.0.1-nightly.<日期>.<短SHA>`，没有新提交时直接跳过） |
| Build nightly (macOS universal) | ✅ |
| Build nightly (Windows x64) | ✅ |
| Build nightly (Linux x64) | ✅ |
| Publish nightly prerelease | ✅ |

前三次失败暴露并修掉了三个真实缺陷，均已落到 main：rustup 不认 `universal-apple-darwin`（改为矩阵里的 `rust_targets`）、版本改写没同步 `Cargo.lock`（`--locked` 拒绝）、Windows CRLF 让正则静默不匹配（改为行尾无关 + 失败即抛错 + `cargo metadata --locked` 自检）。

## 6. Updater 运行时（PR #3）— 已合并 ✅，公钥待填

**PR #3 → `main` 已合并**（merge commit `48b75c0`），8 个 PR 检查全绿。

- Rust：`tauri-plugin-updater` 依赖 + `lib.rs` 注册 + `updater:default` 权限；
- 配置：`plugins.updater` 的 endpoint 指向固定通道 `updater-latest/latest.json`；**`pubkey` 仍是占位符** `REPLACE_WITH_TAURI_UPDATER_PUBLIC_KEY`；
- 前端：只读的「检查更新」（`service/updates.ts` + 设置对话框按钮 + 5 个单测），不自动下载安装；
- CI：`updater-signed` 模式检测到占位公钥直接失败；发布时把 `latest.json` 镜像到 `updater-latest`。

因为改动触及 `src-tauri/**` 与 `packages/frontend/src/**`，源码指纹变为 `07d420c0…`，六份证据已按 runbook 重采：

| 场景 | 新产物上的实测 |
| --- | --- |
| debug 冷启动 ×3 | 3685 / 2345 / 2432 ms |
| debug 远程 prompt | 3279 ms |
| debug 真实 SSH 13-case | **13/13** |
| debug shell 矩阵 | **14/14** + 真实 SSH **7/7** |
| release 冷启动 ×3 | 1640 / 1736 / 1357 ms |
| release 10-case 认证矩阵 | **10/10**（首连 990–4901 ms） |

插桩产物：debug `827b7e01…`、release `5c008f04…`；`pnpm verify` 在本分支 **EXIT=0**（前端 1149、Team Server 103、Rust、脚本、源码规模、evidence gate 全绿）。

> 首次采集时两个 password case 失败，根因是 Docker 守护进程未运行；启动 Docker 后两个矩阵重跑全绿。证据写入器拒绝写入不干净的矩阵（`attempt is not clean: password,password-reconnect`），fail-closed 生效。

## 7. NOT_RUN 及原因

| 项目 | 原因 |
| --- | --- |
| `updater-signed` 模式 | 仓库仍无 `TAURI_SIGNING_PRIVATE_KEY`，且 `pubkey` 是占位符；按规则不伪造密钥 |
| `fully-signed` | 本阶段不购买 Apple/Windows 证书，命中即失败（设计如此） |
| Windows 安装/启动/SmartScreen、Linux AppImage 启动 | 本机是 macOS，无对应环境 |
| 卸载重装、SQLite 首次初始化、旧数据兼容、用户数据目录不被覆盖 | 需要真机安装并运行应用；本轮只做了「启动即可运行」的 smoke，未做数据层验证 |
| 「下载并安装更新」 | 有意不做：未签名构建不应自动替换用户二进制；当前只提供检查与提示 |

## 8. 最终状态：`RELEASE_QA_ONLY`

- **unsigned-qa 通道端到端验证属实**：Release run `40811158213` 9/9 绿、`v0.0.1-dev.2` 发布 8 个资产、SHA-256 与清单一致、DMG `lipo -archs` = `x86_64 arm64`、应用可启动。
- **打包改为 macOS 分芯片架构**：`aarch64` 与 `x86_64` 各出一份 DMG，`updater-signed` 下也各有一份 `.app.tar.gz` + `.sig`，不再用 `lipo` 合成 universal。
- 但产物**没有 Apple/Windows 代码签名与公证**（ad-hoc），所以只能称 QA 版本 → 停在 `RELEASE_QA_ONLY`。

### 要往前推还差两步

1. 配置 `TAURI_SIGNING_PRIVATE_KEY`（私钥）并把 `tauri.conf.json` 的 `plugins.updater.pubkey` 换成对应公钥 → 之后派发一次 `updater-signed` 运行，第一次真跑 `.sig` 与 `latest.json` 校验；
2. 购买并配置 Developer ID / Authenticode（本阶段明确不做，仅记录）。
