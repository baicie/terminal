# Phase 8 · P8.7 Release Candidate 工程审查

> 只读审查结论。所有条目附文件路径与行号。

## 1. 产品身份 —— 【禁止在本阶段变更】

同一产品存在四种拼写：

| 位置 | 值 |
| --- | --- |
| `tauri.conf.json:3` productName | **Termius** |
| `tauri.conf.json:5` identifier | `com.baicie.termius` |
| `tauri.conf.json:17` 窗口标题 | `termius` |
| `src-tauri/Cargo.toml:2` package name | `terminal`（lib: `terminal_lib`） |
| `release.yml:35` 资产前缀 | `Terminal` |
| `release.yml:369` DMG 卷名 | **Termius**（硬编码） |
| `mainBinaryName` | **未设置**（全仓库无此字段） |

### 为什么不能改

| 改动 | 后果 |
| --- | --- |
| 改 `identifier` | **破坏性，禁止**。`app_config_dir` 由 identifier 推导，DB 落在 `<config_dir>/com.baicie.termius/terminal.db`；换 identifier → 新进程打开空库 → 主机/SSH 密钥/设置全部失联。macOS 侧 CFBundleIdentifier 变化会被视为另一个 App（TCC 授权、登录项、更新身份全部重建，DMG 并存而非覆盖升级）；Windows NSIS 安装身份同样按标识判定。 |
| 改 `productName` | 破坏性较轻：macOS 会生成新名字的 .app 与旧版并存；identifier 不变则数据目录与更新身份不变，**用户数据不丢**。但 `release.yml:369` 的 DMG 卷名硬编码 Termius，改名后卷名与 .app 名不一致。 |

**Keychain 失联这件事在当前代码里不存在**：`src-tauri` 全库对 keychain/keyring 零命中，Cargo.lock 无相关依赖。`README.md:13` 的 Keychain integration 指的是应用内 SSH 密钥库（`view/keychain` + `ssh_keys` 表），不是 macOS Keychain。所以没有条目可丢。

**结论**：RC 阶段不得改 identifier，也不得改 productName。商标问题（Termius 是既存商业产品名，`docs/design.md:3` 自述参考其功能集）真实存在，但属产品决策，需要单独的迁移设计（首次启动拷贝旧 `app_config_dir` + 旧 identifier 更新通道多留一版 + `vault.json` 也在迁移范围），不能夹带进 RC。

## 2. 许可证 —— 声明与事实不一致

| 位置 | 现状 |
| --- | --- |
| 仓库根 | **无 LICENSE / LICENSE.md / COPYING**（find 零命中） |
| 根 `package.json` | **无 license 字段** |
| `packages/frontend/package.json` | **无 license 字段** |
| `packages/team-server/package.json:7` | `"license": "MIT"` |
| `src-tauri/Cargo.toml` | **无 license / license-file 字段**；`description = "A Tauri App"`、`authors = ["you"]`（会进 .deb control） |
| `README.md:136-138` | `## License` + `MIT` |

README 与 team-server 声明 MIT，根/前端/Rust 三处未声明，且**仓库没有任何许可证正文**。MIT 的生效要求正文与版权声明随分发提供，而当前 DMG / NSIS / deb 里都不会带。

若确定采用 MIT，需补齐 6 处：根 LICENSE 正文 + 根 package.json 与 frontend package.json 的 license 字段 + Cargo.toml 的 license 字段 + `tauri.conf.json` 的 `bundle.licenseFile`（使安装包内可见）+ team-server 已合规无需改。

第三方依赖 license 字段（只读，不做法律判断）：npm 侧 104 个包全部落在 MIT / ISC / Apache-2.0 / BSD / 0BSD / Unlicense / CC0 之内，无 GPL/AGPL。Rust 直接依赖中**唯一非 MIT/Apache 的是 `serialport = MPL-2.0`**（`Cargo.toml:57`），文件级弱 copyleft，可与 MIT 共存，但必须写进发布说明的第三方许可清单。**限制声明**：未做全传递闭包扫描（`cargo metadata --offline` 因本地 registry 缓存不全失败）。

## 3. 发布资产矩阵 —— 8 个资产已逐项核实

macOS arm64 DMG、macOS x86_64 DMG、Windows x86_64 NSIS、Windows aarch64 NSIS、Linux x86_64 AppImage + deb、Linux aarch64 AppImage + deb = **8 个**，与 README、`release-readiness.md:180-187`、`release.yml:532-541` 三处一致，并用真实 v0.0.1-dev.2 资产核对过（全部存在且非空）。

**结构性脆弱点（不是事实缺陷，是「改一处必坏」）**：资产命名有三个真源——`release.yml:361` 的 `RELEASE_ASSET_PREFIX`、`:513` tauri-action 的 `releaseAssetNamePattern`（前缀硬编码 Terminal）、`:533-540` verify-release 的 `expected_assets`（同样硬编码）；DMG 卷名又是第四个名字 Termius。只改 env 前缀会让 8 个资产里 2 个改名、verify-release 立即失败。

**架构缺失（必须点名）**：`latest.json` 只挑 darwin-aarch64 / darwin-x86_64 / windows-x86_64 / linux-x86_64 四个载荷（`release.yml:580-583`）。**windows-aarch64 与 linux-aarch64 没有更新条目**——这两个架构能装，但不能自动更新。

## 4. Updater —— fail-closed 成立，但有重要落差

- `tauri.conf.json:51` pubkey = `REPLACE_WITH_TAURI_UPDATER_PUBLIC_KEY`，**确认是占位符**。
- `:52-54` endpoint 指向固定通道 `updater-latest/latest.json`，该 release 真实存在（2501 字节，含 4 平台条目与真实签名），不是死链。
- 插件无条件注册（`lib.rs:162`），权限在 `capabilities/default.json:39`。仓库里的占位符永远保留，真实公钥只在 `workflow_dispatch + release_mode=updater-signed` 时经 `--config` 内联。

**真实密钥缺失时的行为（有代码证据）**：`check()` 解析占位 pubkey 必然报错 → `updates.ts:44-45` 命中 `UNCONFIGURED_HINTS` → 状态 `unconfigured`，UI 如实提示未配置；签名不匹配单独归为 `signature`（`:43,78`），不会被并到温和文案。**`updates.ts` 全文没有任何 download / install 调用**（`:127-153` 只调 `bridge.check()`），`lib.rs:158-161` 注释说明占位公钥让每次检查 fail-closed。

一句话：**当前配置在真实密钥缺失时 = 更新检查稳定失败并如实告知「未配置」，不下载、不安装、不信任任何清单。**

**落差**：走「推 tag → unsigned-qa」产出的安装包永远无法完成更新校验；而 **v0.0.1-dev.2（2026-10-30T09:54:11Z，draft=false）带真实签名**（8 个 .sig + latest.json，`.sig` 解码首行 `untrusted comment: signature from tauri secret key`）。因此可用的自动升级链**从 dev.2 才开始**，dev.1 → dev.2 的自动升级不存在。

## 5. 文档声称 vs 配置实际 —— 10 处不一致

「把未签名说成 fully signed」的表述**未发现**（README、release.yml 的 notes、workflow-rules、ci-report、AGENTS.md 都诚实标注了未公证/未 Authenticode）。

但存在**反向失真**——把已发生的说成没发生：

| # | 文档声称 | 实际 |
| --- | --- | --- |
| 1 | `release-readiness.md:202/217/285`「updater-signed 尚未在真实密钥下跑过 / NOT_RUN」 | dev.2 已产出 8 个真实 .sig 与 latest.json |
| 2 | `release-modes.md:30`「该模式从未在真实密钥下执行过」 | 同上 |
| 3 | `ci-report.md:113/127`「仓库仍无 TAURI_SIGNING_PRIVATE_KEY」 | 同上 |
| 4 | `ci-audit.md:20`「version = 0.0.1-dev.1、无 plugins 段」 | `tauri.conf.json:4` 是 dev.2，`:49-56` 有 plugins.updater |
| 5 | `ci-audit.md:35`「不存在任何 TAURI_SIGNING_* 变量」 | `release.yml:101-102/250-251/322-323/500-501` 都在读 |
| 6 | `ci-report.md:50-53` 把旧 universal DMG（24,477,423 字节、lipo 双架构）记在 dev.2 名下 | dev.2 是两份按架构分开的 12.0/12.6 MB DMG |
| 7 | `workflow-rules.md:39`「仓库 pubkey 是占位符 → 直接失败」 | 实际校验 secret `TAURI_UPDATER_PUBKEY`（`release.yml:117-127`），占位符不会让流程失败 |
| 8 | `release-modes.md:8` 把 updater-signed 的 .sig 只列成 2 个 | 实际 8 个 bundle 都有 .sig（含 aarch64 与 deb） |
| 9 | `AGENTS.md:535` 只记到 dev.1 | dev.2 已发布（20 个资产） |
| 10 | `README.md:136-138` 声称 MIT | 仓库无 LICENSE，根/前端/Cargo 三处无 license 字段 |

## 6. 升级与回滚 —— 存在真实缺口

- **没有升级前备份/迁移机制**：`VACUUM INTO` / backup / `.bak` / `PRAGMA user_version` 在 src-tauri 与前端源码中**全部零命中**。
- schema 是纯增量：`connection-schema-core.ts:5-26` 全是 `CREATE ... IF NOT EXISTS`，`:33-47` 的 `ALTER TABLE ADD COLUMN` 逐条 try/catch 吞掉「列已存在」，全库无 `DROP TABLE`/`DROP COLUMN`/`RENAME TO`。写入用显式列名，读取用 `SELECT *`。
- **升级（旧库→新版）**：可打开、可补列、可读 ✓（有迁移测试覆盖）。
- **回滚（新库→旧版）**：因只加列 + 显式列名 + `SELECT *` 容忍多余列，旧版本**通常**仍可用——但这是**代码推论，未经任何验证**：没有 schema 版本号、没有「旧版本打开新库」的测试或 runbook。

明确缺口：a) 升级前无 DB 快照/回滚点；b) 无 schema 版本闸门；c) 「回滚后数据可读」无验收项（`release-readiness.md:284` 整体标 NOT_RUN）；d) `vault.json` 在 `dirs::config_dir()/terminal/vault.json`（`vault.rs:683-689`），**与 DB 不同目录且不随 identifier 走**，任何迁移/回滚方案都必须把它算进去，当前无文档提及。

## 7. 三平台验收状态

| 平台 | 已验证 | 未验证（硬阻塞） |
| --- | --- | --- |
| macOS Gatekeeper | 8 资产非空 + SHA-256 与清单一致；本机挂载 `/Volumes/Termius` 含 .app、open 后 8 秒进程存活；实测签名 `adhoc, linker-signed`、`TeamIdentifier=not set` | 带 `com.apple.quarantine` 下载后的首次打开与「无法验证开发者」弹窗路径、拖入 /Applications、卸载重装、旧库复用 |
| Windows SmartScreen | 仅证明「能编译能打包」（CI 三平台 tauri build 通过） | **完全未验证**：下载拦截、MOTW、安装目录、卸载注册表残留、覆盖安装后 DB 保留 |
| Linux 安装升级 | 同上 | **完全未验证**：AppImage 直接启动（用户命名空间/沙箱）、`dpkg -i` 与依赖修复、升级降级后 DB 可读、glibc 下限（runner 是 24.04，22.04 用户能否运行未知） |

**三平台共同结论：安装 + 升级 + 用户数据保留全部 NOT_RUN。** 只有「资产存在、非空、命名正确、SHA-256 与清单一致」被自动验证。这是 RC 的硬阻塞项，CI 全绿不能替代。

## 8. 本阶段判定

- 身份变更：**BLOCKED**（需产品决策 + 迁移设计，不得夹带进 RC）
- 许可证：**可修**（6 处小改动，本轮实施）
- 资产矩阵：**VERIFIED_EXISTING**（8 个已核实，无需改动）
- Updater fail-closed：**VERIFIED_EXISTING**（有代码证据）
- 文档反向失真：**可修**（10 处，本轮修正）
- 升级/回滚机制：**PARTIAL**（升级可，回滚未验证，无备份点）
- 三平台安装验收：**NOT_RUN / BLOCKED_EXTERNAL**（需真机人工）
