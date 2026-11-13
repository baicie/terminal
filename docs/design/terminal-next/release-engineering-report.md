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

每项的证据见 §7。

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

| 变体 | release 配置差异 | 二进制 | vs baseline | 构建耗时 | 前端嵌入 |
| --- | --- | --- | --- | --- | --- |
| `release` | 无（Cargo 默认） | **34,390,448 B / 32.80 MiB** | — | 基线 | ✅ 102 个 JS 引用 |
| `release-strip` | `strip = "symbols"` | **28,125,072 B / 26.82 MiB** | **−5.98 MiB（−18.2%）** | 660 s | ✅ 5/5 入口 |
| `release-lto` | `lto = "fat"` + `codegen-units = 1` | **25,650,304 B / 24.46 MiB** | **−8.34 MiB（−25.4%）** | 约 900 s | ✅ |
| `release-strip-lto` | 两者 | （见 4.1b） | | | |

**反直觉但重要**：**LTO 单独比 strip 单独省得更多**（−25.4% vs −18.2%）。
`build-optimization.md` 此前的表述是「strip 的 18.2% 几乎免费，LTO 的额外 5.28 MB 要
+12 分钟」，暗示 LTO 只是锦上添花。实测在本 commit 上，LTO 单独就已经超过 strip，
两者叠加才是最小。**这个结论只在 macOS arm64 上测得，不能外推到 Windows/Linux。**

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
| `release-strip-lto` | （见 4.3） | | | |

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

UUID 匹配是关键：一个属于**别的**构建的 dSYM 会给出行号错误的栈，比没有符号更糟。

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

CI run `43343241289`（`d6f3878`）：`Tauri build (macos-latest)` / `(ubuntu-latest)` /
`(windows-latest)` **三者全部 success**。本轮新增的 `custom-protocol` feature 不影响它们
（`pnpm tauri build` 本就加这个 feature）。

### 6.2 运行时（PARTIAL）

`real-machine-matrix` run `43259056123`：macOS real SSH / Windows PowerShell+cmd /
Linux real SSH smoke **3/3 success**。但：

- 只有 macOS 有本轮的 GUI 实测（§4）；
- Windows 未覆盖 Pageant、串口硬件、NSIS 安装→升级；
- Linux AppImage stock 启动仍 NOT_RUN。

---

## 7. 证据索引

| 判定 | 证据 |
| --- | --- |
| `DEVELOPMENT_BUILD_READY` | §1.2 实验对照；本地全量门禁退出码 0（前一报告 §6.1） |
| `SIGNED_RELEASE_READY` | §2.1 表：无 Apple/Windows 证书；§5.4 无 dSYM 归档 |
| `UPDATER_READY` | §2.2 策略 A；§2.1 占位符 + fail-closed 实测 |
| `RELEASE_SMALL_GUI_READY` | §4 四变体 GUI 截图 + shell 子进程验证 |
| `IDENTITY_MIGRATION_READY` | §3.3 方案；§3.4 未执行理由 |
| `CROSS_PLATFORM_BUILD_READY` | §6.1 CI run `43343241289` |
| `CROSS_PLATFORM_RUNTIME_READY` | §6.2 matrix run `43259056123` |
| `RC_READY` | 综合：`SIGNED_RELEASE_READY=FAIL` 且 `IDENTITY_MIGRATION_READY=NOT_RUN` |
