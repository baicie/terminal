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
| `Terminal_0.0.1-dev.2_macos-universal.dmg` | 24,477,423 |
| `Terminal_0.0.1-dev.2_windows-x86_64-setup.exe` | 8,194,751 |
| `Terminal_0.0.1-dev.2_windows-aarch64-setup.exe` | 7,354,375 |
| `Terminal_0.0.1-dev.2_linux-x86_64.AppImage` | 88,631,800 |
| `Terminal_0.0.1-dev.2_linux-x86_64.deb` | 14,120,784 |
| `Terminal_0.0.1-dev.2_linux-aarch64.AppImage` | 86,772,232 |
| `Terminal_0.0.1-dev.2_linux-aarch64.deb` | 14,055,838 |
| `SHA256SUMS.txt` | 760 |

## 3. 安装包实测（本机 macOS）

下载发布产物后在本机验证：

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

## 5. NOT_RUN 及原因

| 项目 | 原因 |
| --- | --- |
| `nightly.yml` 端到端 | 会创建 nightly prerelease；且其 `NIGHTLY_BRANCH=main`，需合并到 main 才有意义。未执行 |
| `updater-signed` 模式 | 仓库无 `TAURI_SIGNING_PRIVATE_KEY`；按规则不伪造密钥 |
| `fully-signed` | 本阶段不购买证书，命中即失败（设计如此） |
| Windows 安装/启动/SmartScreen、Linux AppImage 启动 | 本机是 macOS，无对应环境 |
| 卸载重装、SQLite 首次初始化、旧数据兼容、用户数据目录不被覆盖 | 需要真机安装并运行应用；本轮只做了「启动即可运行」的 smoke，未做数据层验证 —— **不虚构结论** |

## 6. 最终状态：`RELEASE_QA_ONLY`

- **unsigned-qa 通道已端到端验证属实**：9/9 job 绿、发布 8 个资产、校验和一致、DMG 真 universal、应用可启动。
- 但产物**没有任何 OS 代码签名/公证**（ad-hoc），因此只能称 QA 版本，不能称正式签名发布 → 停在 `RELEASE_QA_ONLY`，而不是 `RELEASE_VERIFIED`。
- updater-signed 与 fully-signed 仍未验证；运行时自动更新插件仍未接入。

### 剩余问题（按优先级）

1. **P1**：`nightly.yml` 从未真实运行，需要先合入 `main` 再观察一次定时/手动触发。
2. **P1**：若要让 `updater-signed` 可用，需配置 `TAURI_SIGNING_PRIVATE_KEY` 并跑一次；同时最早那次会验证 `latest.json` 生成与 `.sig` 校验逻辑（该逻辑尚未被真实执行过）。
3. **P2**：运行时自动更新（`tauri-plugin-updater` + `plugins.updater.pubkey` + UI 流程）尚未实现，产物目前无人消费。
4. **P2**：安装/升级/卸载与 SQLite 兼容性验证仍是 NOT_RUN。
