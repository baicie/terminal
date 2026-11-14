# Release Engineering — Updater、产品身份与原生构建验收

- 审查角色：Tauri Release Engineer
- 日期：2026-11-13
- 源码基线：`f5c0434`（`docs/terminal-next-integrated-acceptance`）
- 前置审查：[`integrated-acceptance-report.md`](./integrated-acceptance-report.md)（`TERMINAL_NEXT_RC_READY=FAIL`）
- 本文档**不执行**任何会导致用户数据目录变化的改名；身份迁移只给方案（§3）

---

## 0. 判定速览

| 判定项 | 结果 |
| --- | --- |
| `DEVELOPMENT_BUILD_READY` | **PASS** |
| `SIGNED_RELEASE_READY` | **FAIL** |
| `UPDATER_READY` | **NOT_RUN**（策略已定，见 §2） |
| `RELEASE_SMALL_GUI_READY` | **PASS** |
| `IDENTITY_MIGRATION_READY` | **NOT_RUN**（方案已给，未执行，见 §3） |
| `CROSS_PLATFORM_BUILD_READY` | **PASS** |
| `CROSS_PLATFORM_RUNTIME_READY` | **PARTIAL** |
| `RC_READY` | **FAIL** |

### 为什么 `RC_READY = FAIL`

三项**互不重叠**的阻断，每一项都不是「再测一轮就能变绿」：

1. `SIGNED_RELEASE_READY=FAIL` —— 无 Apple Developer ID、无 Windows Authenticode、
   `release.yml` 没有 dSYM 归档步骤。这是外部凭据与流程问题。
2. `IDENTITY_MIGRATION_READY=NOT_RUN` —— 身份迁移代码不存在，新名字未定，
   迁移方案本身还需要产品决策。
3. ~~六份验收证据待重采~~ —— **已重采**（run `43400523659`，指纹 `b94a26ee…`，见 §7.0）。

`RELEASE_SMALL_GUI_READY=PASS` 是本轮唯一一个从「未知」推进到「已证实」的项，
但它不改变 RC 判定。

---

---

## 1. 本轮最重要的一条：灰屏根因已定位并修复

前一轮 UX-1i 的文档记录了「用裸 `cargo build --release` 构建的二进制灰屏，且
`origin/main` 干净检出也一样」，并推测缺 `custom-protocol` feature。**这个推测是对的**，
本轮用实验证实了它，而不是接受结论。

### 1.1 证据链

```rust
// tauri-2.12.5/build.rs:253-257
let dev = !custom_protocol;
alias("custom_protocol", custom_protocol);
alias("dev", dev);
println!("cargo:dev={dev}");
```

```rust
// tauri-build-2.7.4/src/lib.rs:606-610
pub fn is_dev() -> bool {
  env::var_os("DEP_TAURI_DEV")
    .expect("missing `cargo:dev` instruction, please update tauri to latest")
    == "true"
}
// :714
cfg_alias("dev", is_dev());
```

`terminal` crate 里没有 `dev` 的消费方，但**有** `generate_context!`（`src-tauri/src/lib.rs:402`），
它按 `custom-protocol` 决定嵌入 `frontendDist` 还是连 dev server。

### 1.2 实验对照（同一 commit、同一 `dist/`）

| 构建方式 | `build/terminal-*/output` 中的 cfg | 二进制里的 JS 资源引用 | 窗口 |
| --- | --- | --- | --- |
| 旧：`pnpm tauri build`（11-12 15:41） | `desktop` | **3** | 正常渲染 |
| 旧：裸 `cargo build --release`（灰屏那次） | `desktop` + **`dev`** | **0** | **灰屏** |
| 今：`cargo build --release --features custom-protocol` | `desktop` | **102** | 正常渲染 |
| 今：`--profile release-strip --features custom-protocol` | `desktop` | **5/5 入口** | 正常渲染 |

`--features custom-protocol` 是关键变量。零 JS 引用即空壳，即灰屏。

### 1.3 修复

`src-tauri/Cargo.toml` 补上标准 feature（Tauri 2 模板本来就有，本仓库漏了）：

```toml
custom-protocol = ["tauri/custom-protocol"]
```

**默认仍为空**，所以 `cargo build`（debug）保持 dev-server 行为不变；
`pnpm tauri build` 本来就会加这个 feature，因此 **CI 与发布链路行为完全不变**——
这一点很重要：修复不改变任何已有的门禁或产物，只让裸 `cargo build --release` 不再产出坏二进制。

### 1.4 修复暴露了一条此前被掩盖的构建依赖（CI 实测发现）

加上 `custom-protocol` 后，`Rust quality` 的
`cargo check --all-features` **失败**了：

```
error: proc macro panicked
  --> src/lib.rs:402:16
   | .build(tauri::generate_context!())
   = help: message: The `frontendDist` configuration is set to `"../dist"`
     but this path doesn't exist
```

原因：`--all-features` 现在包含 `custom-protocol`，`generate_context!` 会真的去读
`../dist` 并嵌入；而这个 job 从来不构建前端。之前它走 dev 分支，从不读 `dist`，
所以这条依赖一直存在但被掩盖。

本地复现确认（移走 `dist/` → 同样的 panic；移回 → 通过）。

**修复**：在 `ci.yml` 的 `rust` job 里加 `pnpm install` + `vite build`。
不能靠调整步骤顺序绕开——不启用 `custom-protocol` 的编译产物正是无法渲染的灰屏二进制，
而那个门禁存在的意义就是拦住它。

> 这条值得单独记：**一个「加一行 feature」的修复，让一条隐藏的构建期依赖浮出水面。**
> 如果只跑本地（本地一直有 `dist/`），永远发现不了。

---

## 2. Updater 策略

### 2.1 现状（逐项核实）

| 项 | 状态 | 证据 |
| --- | --- | --- |
| `tauri.conf.json` 的 `pubkey` | **占位符** `REPLACE_WITH_TAURI_UPDATER_PUBLIC_KEY` | `tauri.conf.json:51` |
| endpoint | 指向 `releases/download/updater-latest/latest.json` | 同上 |
| 插件注册 | 已注册，无条件 | `lib.rs:237` |
| 占位符行为 | **fail-closed**：每次检查失败，不会信任未签名清单 | `lib.rs:234-236` 注释 |
| 私钥 | 本机 `~/.tauri/terminal-updater.key`（0600，348 B，2026-10-29 生成） | `ls -la ~/.tauri/` |
| 私钥是否入过库 | **否**。`git log --all --diff-filter=A -- '*.key'` 为空 | 实测 |
| 公钥有效性 | **真实 minisign 公钥**，key ID `2705CA64B67A87D7` | base64 解码确认 |
| 发布工作流 | `updater-signed` 模式要求 `TAURI_SIGNING_PRIVATE_KEY` + `TAURI_UPDATER_PUBKEY` secret，缺一即 fail-closed | `release.yml:111-128` |
| OS 代码签名 | **无**（无 Apple Developer ID、无 Windows Authenticode） | `release.yml` 无相关步骤 |
| `fully-signed` 模式 | `exit 1`，明示保留 | `release.yml:130+` |

**关键事实**：密钥对**早已存在**，只是公钥从未写进配置文件。所以这不是「要不要生成密钥」
的问题，而是「要不要启用」的问题。

### 2.2 策略结论：**选 A —— 当前阶段明确不启用自动更新**

理由（按重要性）：

1. **OS 层未签名**。自动更新把一个未签名、未公证的二进制下载到用户机器并替换，
   在没有 Apple Developer ID 的前提下，macOS Gatekeeper 会在下一次启动时拦下它。
   更新「成功」但应用打不开，比不更新更糟。
2. **产品身份即将变更**（§3）。updater 的 `latest.json` 按 identifier 与 bundle 结构匹配；
   在 `Termius` → 新名字迁移完成前启用，等于给一个即将改名的应用建立更新链，
   迁移时还要再拆一次。
3. **尚无已发布版本可更新到**。`0.0.1-dev.2` 是 dev 通道，没有稳定用户群。

**明确不做的三件事**（任务书要求）：

- ❌ 不把占位符替换成一个「看着像密钥」的无效值；
- ❌ 不把私钥提交到仓库；
- ❌ 不声称 `UPDATER_READY=PASS`。

### 2.3 转为 B 的启用条件（可执行清单）

当以下**全部**满足时，再启用自动更新：

1. Apple Developer ID 证书 + notarization 凭据就位（`fully-signed` 模式落地）；
2. 产品身份迁移完成（§3），identifier 稳定；
3. `TAURI_SIGNING_PRIVATE_KEY` 与 `TAURI_UPDATER_PUBKEY` 写入 GitHub Secrets
   （**不是**写进仓库文件）；
4. `tauri.conf.json` 的 `pubkey` 用 `--config` 在构建时注入，仓库保持占位符
   ——现有 `release.yml` 已经是这个设计，无需改动；
5. `scripts/verify-install/updater-e2e.mjs`（已存在，9 用例）在真实签名产物上跑通；
6. 私钥离线备份 + 轮换流程写入 `docs/release/`。

第 4 条要点：**仓库里保留占位符是正确的**，因为发布工作流用 `--config` 覆盖它。
把真实公钥写进 `tauri.conf.json` 反而会让本地构建与 CI 构建产生身份漂移。

### 2.4 本轮对 updater 做的唯一改动

无。`tauri.conf.json` 未改。原因是：策略 A 下它已经处于正确状态（占位符 + fail-closed），
改成任何别的值都会让「明确不启用」变成「半启用」。

---

## 3. 产品身份：`Termius` / `com.baicie.termius`

### 3.1 依赖面调查（任务书列的 9 项，逐项核实）

| 资源 | 是否由 identifier 派生 | 实际路径 / 机制 |
| --- | --- | --- |
| **数据目录** | ✅ 是 | `app_config_dir()` → `~/Library/Application Support/com.baicie.termius`（`lib.rs:167`、`db_recovery.rs:425`） |
| **SQLite** | ✅ 是（同上） | `terminal.db`、`-wal`、`-shm` |
| **备份** | ✅ 是 | 同目录下 `backups/pre-migration-<epoch>.db` |
| **Vault** | ❌ **否** | `dirs::config_dir()/terminal/vault.json`（`vault.rs:937-943`）——硬编码 `"terminal"` |
| **单实例锁** | ✅ 是 | `app_config_dir()/instance.lock`（`db_recovery.rs:159`） |
| **恢复锁** | ✅ 是 | 同目录 `recovery.lock` |
| **窗口状态** | ✅ 是 | 同目录 `.window-state.json`（`tauri-plugin-window-state`） |
| **WebKit 数据** | ✅ 是 | `~/Library/WebKit/com.baicie.termius` |
| **缓存** | ✅ 是 | `~/Library/Caches/com.baicie.termius` |
| **HTTPStorages** | ✅ 是 | `~/Library/HTTPStorages/com.baicie.termius` |
| **Keychain** | ❌ 当前未使用 | 代码里只有 `credential_ref` 的 `provider: "system-keychain"` **字样**，没有真实 keyring 调用 |
| **Bundle 名** | ✅ 是 | `Termius.app`（`productName`） |
| **DMG 卷名** | ✅ 是 | `create-dmg --volname "Termius"`（`release.yml:369`） |
| **桌面快捷方式** | ⚠️ 由 bundle 派生 | `.app` 名即快捷方式名 |
| **自动更新映射** | ✅ 是 | `latest.json` 的 bundle 匹配 |

### 3.2 本机实测：identifier 已经改过多次，每次都产生全新数据目录

```
~/Library/Application Support/com.baicie.terminal      (2026-03-24)
~/Library/Application Support/com.baicie.terminal.dev  (2026-10-10)
~/Library/Application Support/com.baicie.terminal1     (2026-03-24)
~/Library/Application Support/com.baicie.termius       (2026-11-12)  ← 当前
~/Library/Application Support/com.baicie.termius.coldstart
```

**五个目录**。这是最有力的证据：改 identifier 不会迁移任何东西，只会让下一次启动
在一个空目录里重新开始——用户的主机、密钥引用、命令历史全部「消失」（实际还在旧目录里）。

### 3.3 迁移方案（**不执行**，仅设计）

#### 3.3.1 核心约束

1. **Vault 不在 identifier 派生的路径下**（`vault.rs:940`），所以改 identifier
   **不会**丢 Vault 文件。这是唯一的利好，但也是陷阱：新目录里的 `terminal.db`
   会带着 `credential_ref` 指向一份「还在旧位置」的 Vault —— 如果 Vault 也能被找到，
   秘密就还能解开；如果迁移逻辑处理错了，会出现「库能读但秘密全失效」。
2. **必须在应用内迁移，不能用安装脚本**。安装脚本不知道用户是否正在运行旧版本，
   也无法处理单实例锁与 `-wal` 的正确快照。
3. **旧目录不能删**。迁移后保留只读副本至少一个发布周期。

#### 3.3.2 建议的迁移时序

```
新版本首次启动
  └─ db_recovery 之前，插入 identity_migration 阶段
       1. 取 RuntimeLock（必须，否则与旧版本并发）
       2. 探测：新 identifier 目录是否已存在 terminal.db？
            ├─ 是 → 已完成过，跳过（幂等）
            └─ 否 → 继续
       3. 探测：旧 identifier 目录是否有 terminal.db？
            ├─ 否 → 全新安装，跳过
            └─ 是 → 继续
       4. 用 SQLite 在线备份 API（VACUUM INTO）把旧库快照到新目录（不直接 copy -wal）
       5. 复制 backups/（保留 pre-migration 快照）
       6. 校验：快照 integrity_check + 表行数 + 关键表 SHA
       7. 写 identity-migration marker（成功后留痕，供审计）
       8. 清理：旧目录保留，写一份 README 说明可安全删除
```

#### 3.3.3 必须同时改的 CI 断言（否则 CI 会正确报红）

这些是**门禁**，不是路径逻辑，必须与 identifier 同批更新：

| 文件 | 行 | 内容 |
| --- | --- | --- |
| `.github/workflows/upgrade-e2e.yml` | 71,166,178,190,202,214,226,238,250,262 | `--expect-identifier com.baicie.termius` ×10 |
| `scripts/verify-install-macos.sh` | 42 | `EXPECTED_ID=com.baicie.termius`（注释明写 "product identity changed" 即 fail） |
| `scripts/verify-install-linux.sh` | 45 | 同上 |
| `scripts/verify-install/single-instance-e2e.mjs` | 42 | `const IDENTIFIER` |
| `.github/workflows/cold-start-stress.yml` | 73-75, 94-96 | WebKit/Caches/HTTPStorages 清理路径 |
| `.github/workflows/release.yml` | 369 | `--volname "Termius"` |
| `scripts/run-remote-cold-start-stopwatch.mjs` | 17 | `APP_BUNDLE_ID` |
| `scripts/run-cold-start-stopwatch.test.mjs` | 多处 | `/Applications/Termius.app/...` fixture |

**注意**：`upgrade-e2e.yml` 的 10 处断言的是**历史已发布产物**（`0.0.1-dev.1`/`dev.2`）
的 identifier。那些产物永远是 `com.baicie.termius`，所以这些断言**不应该改**——
它们验证的是「我们下载到的历史 DMG 没被篡改」。需要改的是**新版本**的断言，
这需要区分「A 产物 identifier」与「B 产物 identifier」两个参数。

#### 3.3.4 新 identifier 的命名建议

不做推荐，因为这是产品决策。但如果采用，必须满足：

- 反向 DNS，全小写，只含字母数字与点；
- 与 `productName` 语义一致；
- **不要**再包含 `termius`（那是第三方产品的商标），这既是迁移问题也是商标风险。

### 3.4 为什么本轮不执行

任务书明确要求「不直接执行会导致用户数据目录变化的重命名」。除此之外：

- 迁移代码尚不存在（`git grep` 确认没有目录迁移逻辑，只有 schema 迁移）；
- 新名字未定；
- 改了会让全部 6 份验收证据的指纹失效，且 upgrade E2E 的 10 处断言需要重新设计。

---

## 4. release-small 四方对照

同一 commit `f5c0434`、同一 `dist/`（指纹 `dbebadc6…`）、全部带 `--features custom-protocol`。

### 4.1 体积

| 变体 | release 配置差异 | 二进制 | vs baseline | 前端嵌入 |
| --- | --- | --- | --- | --- |
| `release` | 无（Cargo 默认） | **34,390,448 B / 32.80 MiB** | — | ✅ 5/5 |
| `release-strip` | `strip = "symbols"` | **28,125,072 B / 26.82 MiB** | **−5.98 MiB（−18.2%）** | ✅ 5/5 |
| `release-lto` | `lto = "fat"` + `codegen-units = 1` | **25,650,304 B / 24.46 MiB** | **−8.34 MiB（−25.4%）** | ✅ 5/5 |
| `release-strip-lto` | 两者 | **22,583,776 B / 21.54 MiB** | **−11.27 MiB（−34.3%）** | ✅ 5/5 |

`release-strip-lto` 与既有 `[profile.release-small]` **配置逐字相同**，所以最后一行
就是 `release-small` 的实测结论。

**两条与 `build-optimization.md` 不同的实测结论**：

1. **LTO 单独比 strip 单独省得更多**（−25.4% vs −18.2%）。此前文档的叙述是
   「strip 的 18.2% 几乎免费，LTO 的额外 5.28 MB 要 +12 分钟」，暗示 LTO 只是锦上添花。
   在本 commit 上，只开 LTO 就已经超过只开 strip。
2. **strip + LTO 是 −34.3%，不是「18.2% + 额外一点」**。两者不是简单相加。

**仅 macOS arm64 测得，不外推到 Windows/Linux**（那两个平台连构建都没跑）。

**构建耗时**：本文档初稿曾写 strip 660 s / LTO 约 900 s，那是首次全量编译的墙钟时间，
包含了共享依赖的编译。四个变体各自是一次独立的 `target/<profile>` 全量构建，
把耗时当作「某个 profile 的开销」是不成立的——**依赖编译占总时间的绝大部分，
profile 只影响最后的优化与链接**。因此表中不再列耗时，避免误导。

`release-strip-lto` 与既有 `[profile.release-small]` **配置逐字相同**，因此
「strip + LTO 的实测结论」就是 `release-small` 的结论。

### 4.2 GUI 与功能验收（真实启动，非 mock）

方法：隔离 `HOME=/tmp/re-matrix/home/<arm>`，启动二进制，等待 fallback deadline，
通过 `CGWindowListCopyWindowInfo` 取窗口 ID 后 `screencapture -l` 按窗口截图，
并用 `ps -ax -o pid,ppid` 确认是否真的拉起了 shell 子进程。

| 变体 | 窗口渲染 | shell 子进程 | 状态栏 | 截图 |
| --- | --- | --- | --- | --- |
| `release`（首次启动） | ✅ 完整 | ✅ `/bin/zsh`（pid 26366） | `Connected · 142×43` | `gui/fresh-release.png` |
| `release-strip`（首次启动） | ✅ 完整 | ✅ `/bin/zsh`（pid 33128） | `Connected · 142×43` | `gui/strip-final.png` |
| `release-lto`（首次启动） | ✅ 完整 | ✅ `/bin/zsh`（pid 63126） | `Connected · 142×43` | `gui/lto-win.png` |
| `release-strip-lto`（首次启动） | ✅ 完整 | ✅ `/bin/zsh`（pid 86305） | `Connected · 142×43` | `gui/strip-lto-win.png` |

**两次都是空 HOME 的首启动**，条件相同。看到的画面完全一致：
Activity Rail、`Local` 标签页、`... %` 提示符、底部状态栏。

### 4.3 一个差点被误判的陷阱（重要）

第一次截 `release-strip` 时，画面是「Activity Rail 在、`Local` 标签在、**终端区空白、
没有状态栏、没有 shell 子进程**」。这看起来像 strip 特有的缺陷。

实际原因是**首次启动的 8 秒 fallback 空窗**：

```
08:17:56.780  tauri app starting up
08:17:59.977  fallback-opened      ← 3.2 s 后终端才真正打开
```

`layout-absent` 时启动流程会 `action=defer` 等到 deadline 才 `action=create` 建 tab。
截图时刚好处在「tab 已创建、PTY 尚未完成握手」的窗口内。

用 `release` 在同条件（空 HOME）复测，等待同样时间后 `/bin/zsh` 起来了；
再回测 `release-strip` 等待充分后也正常。**两边一致，不是变体差异。**

这条记录的用处：后续任何 GUI 验收都必须等过 fallback deadline，
否则会把启动时序当成构建配置的回归。

### 4.4 功能项

| 项 | release | strip | 说明 |
| --- | --- | --- | --- |
| 本地 PTY | ✅ | ✅ | 提示符 `user@host <home> %`，`pwd` 为隔离 HOME |
| SSH | ✅ | ✅ | 真实 sshd fixture，独立于构建 profile（见 §4.5） |
| SFTP | ✅ | ✅ | **本轮新增真实子系统测试 3/3 通过**（见 §4.5） |
| 数据库恢复 | ✅ | ✅ | 日志 `db recovery stage="database-recovery" state=Healthy` |
| 冷启动 | ✅ | ✅ | 3.2 s 到 `fallback-opened` |
| 符号化 | ✅ dSYM UUID 匹配 | ✅ dSYM UUID 匹配 | §5.2 |

### 4.5 SFTP 真实性：补上了上一轮的缺口

上一轮报告记 `PRODUCT_SFTP_E2E = NOT_RUN`，理由是 fixture 没有 `Subsystem sftp`。
本轮核实并修复了这个根因：

- `scripts/terminal-smoke-sshd.mjs` 的 `daemonConfiguration()` **从未写过 `Subsystem` 行**；
- 更关键的是 `authorized_keys` 里的 `command="<wrapper>"` 会**劫持所有会话**，
  包括 sftp 子系统请求 —— 光加 `Subsystem` 行不够。

修复（opt-in，默认关闭，既有 21 项 fixture 测试行为不变）：

```js
// 只在 enableSftp 时插入
lines.push(`Subsystem sftp ${quoteSshdPath(server)}`)

// wrapper 里把 SSH_ORIGINAL_COMMAND 交还给 sftp-server
if [ -n "${SSH_ORIGINAL_COMMAND:-}" ]; then
  exec '/usr/libexec/sftp-server' -e
fi
```

新增测试 `packages/frontend/src/features/sftp/sftp-subsystem-live.e2e.test.ts`，**3/3 通过**：

| 用例 | 结果 |
| --- | --- |
| the daemon accepts the sftp subsystem | ✅ |
| uploads a 4 MiB payload byte-exactly（SHA-256 双侧一致） | ✅ |
| replacing an existing file leaves no backup or staging residue | ✅ |

**仍然 NOT_RUN 的部分**：这些是 `sftp` CLI 驱动的传输，**不是** Tauri 应用的
`sftp_upload` 命令驱动的。产品命令级 E2E 仍需打包应用，见 §7。

**记录两个我自己踩的坑**（都会伪装成「服务器坏了」）：
- `sftp` 不接受 `-oKey=Value` 合并写法（`ssh` 接受），必须是 `-o Key=Value`；
- `sftp` 不接受 `-b -`（从 stdin 读批处理），必须给文件路径。
两者都只是打印 usage 并 exit 1。

---

## 5. 符号管理

### 5.1 已有能力

本轮新增 `scripts/release-engineering/archive-symbols.mjs`，为每个变体产出
`symbols/<profile>/symbols.json`，记录 `binarySha256` + `symbol artifact` + `commit` +
**UUID 配对结果**。

### 5.2 macOS（已实测 PASS）

| 变体 | 二进制 | dSYM | UUID 匹配 | pairingComplete |
| --- | --- | --- | --- | --- |
| `release` | 34,390,448 B | 8,704,000 B | `E6DBC00C-2BAF-39C5-AF3A-87EE8E9BD293` ✅ | **true** |
| `release-strip` | 28,125,072 B | 2,490,368 B | ✅ | **true** |
| `release-lto` | 25,650,304 B | ✅ | ✅ | **true** |
| `release-strip-lto` | 22,583,776 B | ✅ | ✅ | **true** |

UUID 匹配是关键：一个属于**别的**构建的 dSYM 会给出行号错误的栈，比没有符号更糟。

**strip 后 dSYM 也变小了**（8.70 MB → 2.49 MB），因为符号表本身随 strip 变化。
但交付体积（二进制 + dSYM）仍然净减少：

| 变体 | 二进制 + dSYM | vs baseline |
| --- | --- | --- |
| `release` | 34,390,448 + 8,704,000 = **43,094,448 B** | — |
| `release-strip` | 28,125,072 + 2,490,368 = **30,615,440 B** | **−12,479,008 B（−29.0%）** |

这条值得记：**只报二进制大小会低估 strip 的收益，也会漏掉 dSYM 的成本**。
打包与分发时如果把 dSYM 一起归档，实际净收益比二进制的 −18.2% 更大（−29.0%）。

### 5.3 Linux / Windows

- Linux：脚本支持 `objcopy --only-keep-debug` + build-id，但本轮在 macOS 上**NOT_RUN**；
- Windows：PDB 由 MSVC 链接器在 Windows 主机产生，macOS 上无法生成，
  脚本显式记 `NOT_RUN` 而不是伪造 PASS。

### 5.4 与发布产物的对应关系

当前 `release.yml` **没有任何符号归档步骤**。这是 `SIGNED_RELEASE_READY=FAIL` 的一部分：
即使将来签名了，没有 dSYM 归档的 strip 产物上线后崩溃不可符号化。
建议在 `release.yml` 的 bundle 步骤后加：
`dsymutil target/<triple>/release/terminal -o release-assets/terminal.dSYM` 并上传为 artifact。

---

## 6. 跨平台

### 6.1 构建（PASS）

**两个** CI run 都证明了三平台可编译：

| run | commit | macOS | Ubuntu | Windows |
| --- | --- | --- | --- | --- |
| `43343241289` | `d6f3878`（本轮改动之前） | success | success | success |
| `43397442700` | `dbdb82a`（**含本轮 custom-protocol 改动**） | success | success | success |

第二行是关键：它证明 `custom-protocol` feature 与新增的 `release-*` profile
**没有破坏任何平台的 `pnpm tauri build`**。

`Rust quality` 在同一 run 里 `check` / `clippy -D warnings` / `test` / `vault_probe`
四步全 success，验证了 §1.4 的 CI 修复确实解决了 `--all-features` 的
`generate_context!` panic。

### 6.2 运行时（PARTIAL）

`real-machine-matrix` run `43259056123`：macOS real SSH / Windows PowerShell+cmd /
Linux real SSH smoke **3/3 success**。但：

- 只有 macOS 有本轮的 GUI 实测（§4）；
- Windows 未覆盖 Pageant、串口硬件、NSIS 安装→升级；
- Linux AppImage stock 启动仍 NOT_RUN。

---

## 7. 证据索引

### 7.0 本轮改动会让六份验收证据失效（预期行为，未规避）

`src-tauri/Cargo.toml` 与 `scripts/terminal-smoke-sshd.mjs` 都在 `FINGERPRINT_PATHS` 内，
所以本轮 PR 的 `Repository gates` 会**失败**，断言原文：

```
2026-10-11-macos-cold-start-current.json was recorded against source fingerprint
8129680b… but the terminal sources now fingerprint as b94a26ee…
This file describes an older checkout. Re-run the scenario on the current sources
instead of citing measurements taken before this change.
```

**这是规则正确工作的表现，不是缺陷。** 按 AGENTS.md：

- ❌ 不改旧 manifest 让门禁变绿；
- ❌ 不改 `FINGERPRINT_PATHS` 把 `Cargo.toml` 排除掉（那会让「改 Cargo.toml 不影响
  构建产物」这个明显错误的假设写进门禁）；
- ✅ 用官方流程重采：`workflow_dispatch` 触发 `Real-machine terminal matrix`，
  下载产物后由 `build-verification-evidence.mjs` 生成新 manifest。

**已按该流程重采**：

| 项 | 值 |
| --- | --- |
| runId | `43400523659` |
| commit | `85a5b04`（源码冻结点） |
| 三平台 job | macOS real SSH / Linux real SSH / Windows shell 全 **success** |
| 指纹 | `8129680b…` → **`b94a26ee…`**（= 当前源码实算值） |
| 入库内容 | 六份 JSON + `evidence-manifest.json` + `raw/43400523659/` 七份原始日志 |

未改旧 manifest、未改 `FINGERPRINT_PATHS`、未手填任何数字。

**重采后的实测值**（不是只看门禁过没过）：

| 项 | 值 |
| --- | --- |
| debug SSH 矩阵 | **11/11 case `ok=true`**，`allCasesPassed: true` |
| 各 case 首连耗时 | 1392–2725 ms（中位数约 2500 ms） |
| 证据内 `revision` | `commit: 85a5b04`、`dirtyWorktree: false` |

`dirtyWorktree: false` 证明采集期间源码确实处于冻结状态——这是「先冻结再派发」
这条规则是否被遵守的直接证据，而不是靠声明。

### 7.1 判定与证据对照

| 判定 | 证据 |
| --- | --- |
| `DEVELOPMENT_BUILD_READY` | §1.2 实验对照；`cargo check` 默认与 `--features custom-protocol` 两种模式均通过；本地 typecheck / lint / source-size / 398 项脚本测试通过 |
| `SIGNED_RELEASE_READY` | §2.1 表：无 Apple/Windows 证书；§5.4 `release.yml` 无 dSYM 归档步骤 |
| `UPDATER_READY` | §2.2 策略 A；§2.1 占位符 + `lib.rs:234-236` fail-closed |
| `RELEASE_SMALL_GUI_READY` | §4.2 四变体真实启动 + 截图 + shell 子进程验证 |
| `IDENTITY_MIGRATION_READY` | §3.3 方案；§3.4 未执行理由；§3.2 五个历史目录实测 |
| `CROSS_PLATFORM_BUILD_READY` | §6.1 CI run `43343241289` 三平台 success |
| `CROSS_PLATFORM_RUNTIME_READY` | §6.2 matrix run `43259056123` 3/3 |
| `RC_READY` | 综合：`SIGNED_RELEASE_READY=FAIL` + `IDENTITY_MIGRATION_READY=NOT_RUN` |

---

## 8. 证据重采：操作步骤（本轮已执行）

按 `docs/release/workflow-rules.md` §1 的固定顺序，**不可跳步、不可并行**：

```bash
# 1. 先冻结源码：重采期间不得再改任何 FINGERPRINT_PATHS 内的文件
git status --porcelain            # 必须干净

# 2. 派发 macOS 证据 job（约 30 分钟）
gh workflow run "Real-machine terminal matrix" --ref <当前分支>

# 3. 等 run 结束，下载产物
node scripts/fetch-verification-evidence.mjs --latest --with-binaries

# 4. 过门禁（必须 0 problem）
node scripts/check-verification-evidence.mjs

# 5. 一起提交：六份 JSON + manifest + raw/<runId>/ 日志
```

**本轮已执行**（run `43400523659`，commit `85a5b04`）：

```bash
gh workflow run "Real-machine terminal matrix" --ref feat/release-engineering-acceptance
# → run 43400523659，三平台 job 全 success
node scripts/fetch-verification-evidence.mjs --run-id 43400523659 --with-binaries
# → 六份 JSON + manifest + raw/43400523659/ 七份日志
node scripts/check-verification-evidence.mjs
# → Verification evidence gate passed for 6 current evidence file(s).
```

指纹 `8129680b…` → `b94a26ee…`（= 当前源码实算值），源码冻结点 `85a5b04`。

**为什么是现在采**：本轮改动已全部完成，剩余的待定项（是否把 `release-small`
提为默认）是**产品决策**，不落地就不改 `Cargo.toml`；一旦要改，届时再按同一流程
重采一次即可，规则本来就要求如此。

**没有做的事**：未改旧 manifest、未改 `FINGERPRINT_PATHS`、未手填任何数字。
