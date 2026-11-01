# 依赖升级执行结果（Phase 9.1）

> 上游文档：`docs/phase9-1/dependency-upgrade-plan.md`（可行性评估）、
> `docs/phase9-1/security-advisories.md`（27 条台账，本轮**未改动**）。
> 本文记录**实际执行**的升级与**实测**验证输出。
>
> 改动范围：只改了 `src-tauri/Cargo.lock`。
> `src-tauri/Cargo.toml` **一个字节都没改**（`git diff --stat` 证据见 §5），产品代码未改。

## 0. 结论先行：修了 2 条，没修 25 条

| | 条数 | 占 27 条 |
| --- | --- | --- |
| ✅ **已修复并验证** | **2** | 7.4% |
| 🔴 **未修复** | **25** | 92.6% |

**本轮只清掉了 27 条中的 2 条。** 任务要求优先处理的「构建图内基准分 7.5 的 6 条」里，
修掉的是其中 **2 条**（quick-xml 0.39.2 上的两条），另外 **4 条**（quick-xml 0.37.5 ×2、
russh、russh-cryptovec）**全部未修**。台账里基准分最高的一条（zip `RUSTSEC-2026-0369`，9.1）
**也未修**。

未修的 25 条按卡点归类（逐条明细见 §3）：

| 卡点 | 条数 | 本机能否解决 |
| --- | --- | --- |
| 离线缓存缺 `.crate` 包（能解析、不能编译） | 5 | ❌ 需联网 |
| 离线缓存缺 `aws-lc-rs ≥1.18`，连解析都失败 | 5 | ❌ 需联网 |
| 升级链在 Windows target 上缺包（zip 组） | 3 | ❌ 需联网 |
| 被父 crate semver 钉死，本侧改不动 | 3 | ❌ 需上游 |
| 上游**无**修复版本（`patched` 为空） | 2 | ❌ 不存在修复 |
| 不在构建图内，无升级目标 | 6 | — 不可达，无需升级 |
| 随 russh 一起走，非独立任务 | 1 | ❌ 同 russh |

**没有任何一条需要改产品代码。** 25 条全部卡在依赖解析或上游，不是调用代码问题
（任务要求「若某条必须改调用代码才能修，先不要改并记录」—— 本轮没有出现这种情况）。

## 1. 环境限制复核（决定了 25 条为什么修不了）

升级计划 §0 的两条限制本轮**重新实测**，结论一致，并补测了第三条：

| 限制 | 本轮实测命令与输出 |
| --- | --- |
| `~/.cargo` 只读 → 本机 `cargo audit` 跑不起来 | `cargo audit --version` → `cargo-audit-audit 0.22.2`（已装）；实跑报 `failed to obtain lock file '/Users/liuzhiwei/.cargo/advisory-db..lock' -> attempted to take an exclusive lock on a read-only path` |
| crates.io / 镜像不可达 | `curl -sS https://mirrors.ustc.edu.cn/crates.io-index/config.json` → `curl: (56) CONNECT tunnel failed, response 403`，沙箱回报 `deny network-outbound mirrors.ustc.edu.cn:443`；`cargo update`（不带 `--offline`）→ `download of config.json failed ... Couldn't connect to server (127.0.0.1 port 7890)` |
| 本地端口不可绑定 / PTY 不可用 | `cargo test` 11 条失败全为 `PermissionDenied: Operation not permitted`，见 §4 基线对照 |

**本轮新增的方法论修正：`cargo update --offline` 成功 ≠ 能编译。**

`--offline` 解析只读 registry **索引**（索引是完整的），但编译需要 `.crate` **归档**。
有 5 条 advisory 的修复版本「解析成功、归档缺失」，只用 `cargo update` 判断会误判成可行。
因此本文每条都额外跑了 `cargo fetch --locked --offline`，它会真正要求归档存在：

```
$ cargo update -p h2 --precise 0.4.16 --offline
    Updating h2 v0.4.13 -> v0.4.16          # 解析通过，看起来可行

$ cargo fetch --locked --offline            # 真实判定
error: failed to download `h2 v0.4.16`      # 归档不在缓存里 -> 编译不了
```

缓存归档实测（`ls ~/.cargo/registry/cache/*/`）：

```
PRESENT  plist-1.10.1   quick-xml-0.42.0   base64-0.23.1
PRESENT  rustls-0.23.46 rustls-webpki-0.103.16   tauri-2.12.3   tauri-plugin-updater-2.14.1
MISSING  h2-0.4.16   zip-9.0.0   russh-0.60.3   webpki-root-certs-1.0.10
MISSING  ctutils-0.4.4   aws-lc-rs-1.18.0   aws-lc-rs-1.19.0   webview2-com-0.39.1
```

## 2. 已修复的 2 条（唯一的改动）

### 2.1 改动内容

```bash
cargo update -p plist --precise 1.10.1 --offline
```

真实输出：

```
      Adding base64 v0.23.1
    Updating plist v1.9.0 -> v1.10.1
    Updating quick-xml v0.39.2 -> v0.42.0
```

| advisory | crate | 旧版本 | 新版本 | `patched` 要求 | 满足？ |
| --- | --- | --- | --- | --- | --- |
| `RUSTSEC-2026-0194` | quick-xml | 0.39.2 | **0.42.0** | `>=0.41.0` | ✅ |
| `RUSTSEC-2026-0195` | quick-xml | 0.39.2 | **0.42.0** | `>=0.41.0` | ✅ |

载体 `plist 1.9.0 → 1.10.1`（它把 quick-xml req 从 `0.39.2` 提到 `0.42.0`），
附带 `base64 0.23.1` 新增。`Cargo.lock` sha256：
`87bdd651d1aea286…` → `bb3b5e09ff8ec035…`。

### 2.2 依赖图证据（旧版本已出图 / 新版本已入图）

```
$ cargo tree --invert quick-xml@0.39.2 --target all --offline
error: package ID specification `quick-xml@0.39.2` did not match any packages
help: there are similar package ID specifications:
  quick-xml@0.37.5
  quick-xml@0.42.0
```

```
$ cargo tree --invert quick-xml@0.42.0 --target all --offline
quick-xml v0.42.0
└── plist v1.10.1
    ├── tauri v2.11.0
    │   ├── tauri-plugin-dialog v2.7.2
    │   │   └── terminal v0.0.1-dev.2
    │   ├── tauri-plugin-fs v2.5.1
    │   ├── tauri-plugin-updater v2.12.0
    │   └── ...（共 8 个 tauri-plugin-* 父节点）
    ├── tauri-codegen v2.6.0
    └── tauri-utils v2.9.0
```

`Cargo.lock` 中 quick-xml 现存版本：`0.37.5` 与 `0.42.0`（`0.39.2` 已消失）。
0.42.0 三平台均可达（`--target x86_64-pc-windows-msvc` / `x86_64-unknown-linux-gnu` /
`aarch64-apple-darwin` 逐个实测，都打印出 `quick-xml v0.42.0`）。

### 2.3 真实 `cargo audit` 前后对照（本轮意外取得的证据）

升级计划把本机 `cargo audit` 判为 NOT_RUN。本轮找到一个可行办法：把只读的陈旧
advisory-db 克隆**复制到可写目录**再用 `--offline` 跑，绕开了只读锁：

```bash
cp -R ~/.cargo/advisory-dbs/advisory-db-3157b0e258782691 "$TMPDIR/advdb"   # 1226 条 advisory
cargo audit --db "$TMPDIR/advdb" --offline --no-fetch -f src-tauri/Cargo.lock --json
```

| | 漏洞条数 | 退出码 |
| --- | --- | --- |
| 升级前（lock `87bdd651…`） | **10** | 1 |
| 升级后（lock `bb3b5e09…`） | **8** | 1 |

逐条 diff：

```
REMOVED (fixed):
  - RUSTSEC-2026-0194 quick-xml 0.39.2
  - RUSTSEC-2026-0195 quick-xml 0.39.2
ADDED (new vulns introduced):
  (none)
```

**这是真实测量，不是推断**：少掉的正好是目标的 2 条，且没有引入新漏洞。

⚠️ **这份证据的边界，必须连带说明**：该 db 的 HEAD 是 **2026-08-12**（`69f93e1d`），
只收录了 27 条中的 **10 条**，另外 **17 条它根本没有**（`rustls` ×4、`zip` ×3、
`quinn-proto` ×4、`h2`、`rustls-webpki`、`webpki-root-certs`、`ctutils`、`crypto-bigint` ×2）。
所以：

* `10 → 8` 是**实测**的；
* `27 → 25` 是**投影**（把实测删除的 2 行映射回 27 条台账），
  **NOT_RUN**：未用当前 advisory-db 复算。联网环境必须重跑
  `cargo audit --json` + `node scripts/build-security-ledger.mjs` 确认条数确为 25。

## 3. 未修复的 25 条（逐条给卡点）

### 3.1 离线缓存缺归档：能解析，不能编译（5 条）

这 5 条在联网环境下**立刻可修**，`Cargo.toml` 都不用改。

| advisory | crate | 锁定 → 目标 | 实测 |
| --- | --- | --- | --- |
| `RUSTSEC-2026-0154` | russh | 0.60.2 → 0.60.3 | 解析 OK，`cargo fetch` → `failed to download russh v0.60.3` |
| `RUSTSEC-2026-0153` | russh-cryptovec | 0.59.0 → 0.60.3 | 同上（与 russh 原子联动） |
| `RUSTSEC-2026-0258` | h2 | 0.4.13 → 0.4.16 | 解析 OK，fetch → `failed to download h2 v0.4.16`（缓存只有 0.4.15，**不满足** `>=0.4.16`） |
| `RUSTSEC-2026-0383` | webpki-root-certs | 1.0.7 → 1.0.10 | 解析 OK，fetch → `failed to download webpki-root-certs v1.0.10` |
| `RUSTSEC-2026-0385` | ctutils | 0.4.2 → 0.4.4 | 解析 OK，fetch → `failed to download ctutils v0.4.4` |

**russh 的原子性在本轮得到实测确认**（升级计划 §2.3 的推断成立）：

```
$ cargo update -p russh --precise 0.60.3 --offline
    Updating russh v0.60.2 -> v0.60.3
    Updating russh-cryptovec v0.59.0 -> v0.60.3     # 两者必须同时动
```

即 `-0154` 与 `-0153` 是一次操作，不能拆成两次提交。
本轮**没有**对 russh 做任何编译或测试，**没有任何升级后证据**（NOT_RUN）。
升级计划 §2.5 / §2.6 列出的验证要求（SSH 实机矩阵、RSA-8192、>100 MB SFTP）依然全部待做。

### 3.2 `aws-lc-rs` 墙：连解析都失败（5 条）

| advisory | crate | 目标版本 |
| --- | --- | --- |
| `RUSTSEC-2026-0346` / `-0348` / `-0349` | rustls | 0.23.46 |
| `RUSTSEC-2026-0285` | rustls | 0.23.45 |
| `RUSTSEC-2026-0382` | rustls-webpki | 0.103.16 |

三条命令（`-p rustls --precise 0.23.46` / `0.23.45` / `-p rustls-webpki --precise 0.103.16`）
报的是**同一个**错误，退出码 101：

```
error: failed to select a version for `aws-lc-rs`.
    ... required by package `rustls v0.23.46`         （req: ^1.18）
versions that meet the requirements `^1.18` are: 1.19.0, 1.18.2, 1.18.1, 1.18.0
all possible versions conflict with previously selected packages
  previously selected package `aws-lc-rs v1.16.3`
    ... which satisfies dependency `aws-lc-rs = "^1.16.2"` of package `russh v0.60.2`
```

机制（逐个 crate 的 Cargo.toml 实测）：

```
rustls-0.23.40         aws-lc-rs = "1.14"    <- 当前锁定，与 1.16.3 相容
rustls-0.23.45/.46     aws-lc-rs = "1.18"    <- 修复版本要求
rustls-webpki-0.103.16 aws-lc-rs = "1.18"
russh-0.60.2           aws-lc-rs = "1.16.2"  （default features 含 aws-lc-rs）
缓存里只有 aws-lc-rs-1.16.3
```

`^1.16.2` 与 `^1.18` 的交集 `>=1.18.0, <2.0.0` **非空**，联网取 1.18/1.19 即可同时满足
—— 这是**离线缓存假象，不是真实 semver 冲突**，与升级计划 §3.1 判断一致。

**对升级计划的一处修正**：计划把 `rustls-webpki`（`-0382`）与 rustls 组并列、未单独标注卡点。
实测它撞的是**同一道** `aws-lc-rs` 墙（因为 rustls 0.23.40 要 `webpki ^0.103.5`，
而 webpki 0.103.15/0.103.16 都把 aws-lc-rs 提到了 `1.18`），
**不能**作为「更干净的单条」先修。这一组 5 条必须一起过。

另：`aws-lc-rs` 在 rustls 里是 `optional = true`，理论上可用 `ring` 后端绕开，
但它是 **russh 的 default feature**（`default = ["flate2", "aws-lc-rs", "rsa"]`），
关掉等于换 SSH 加密后端 —— 那是产品决策，超出「只改依赖版本」的约束，本轮不做。

### 3.3 zip 组：升级链在 Windows target 上断裂（3 条，含最高分 9.1）

| advisory | 基准分 | crate | 目标 |
| --- | --- | --- | --- |
| `RUSTSEC-2026-0369` | **9.1（27 条里最高）** | zip | ≥9.0.0 |
| `RUSTSEC-2026-0368` | — | zip | ≥9.0.0 |
| `RUSTSEC-2026-0367` | 7.3 | zip | ≥9.0.0 |

直接升 zip 不可能（父 crate 钉死）：

```
$ cargo update -p zip --precise 9.0.0 --offline
error: failed to select a version for the requirement `zip = "^4"`
candidate versions found which didn't match: 9.0.0
required by package `tauri-plugin-updater v2.12.0`
```

走计划 §3.2 指出的链式路径，本轮**实测到比计划更具体的结论**：

```
$ cargo update -p tauri-plugin-updater --precise 2.14.1 --offline
    Updating tauri v2.11.0 -> v2.12.3
    Updating zip v4.6.1 -> v9.0.0
    （共 58 个 crate 变动）
解析：OK

$ cargo fetch --locked --offline --target <T>
  aarch64-apple-darwin      OK
  x86_64-unknown-linux-gnu  OK
  x86_64-pc-windows-msvc    FAIL -> failed to download `webview2-com v0.39.1`
```

**关键矛盾**：zip 只在 Windows 可达
（`[target.'cfg(target_os = "windows")'.dependencies.zip]`，macOS/Linux 下
`cargo tree --invert zip` 为 `nothing to print`），而这条升级链**恰好只在 Windows target 上缺包**。
也就是说，本机能编译的两个平台根本不需要这个修复，真正需要它的平台编译不了。
强行应用会让 `Cargo.lock` 在 CI 的 Windows 作业上 fetch 失败 —— 等于用一个确定的
构建中断去换一个本机无法验证的修复。**故不应用。**

状态 **NOT_RUN**：未应用、未编译、未测试。联网后按「升 tauri 次版本」处理，
需三平台编译 + Windows 实机走完整自动更新（下载→验签→解压→替换）。

### 3.4 被父 crate semver 钉死，本侧改不动（3 条）

| advisory | crate | 版本 | 卡点（实测） |
| --- | --- | --- | --- |
| `RUSTSEC-2026-0194` | quick-xml | 0.37.5 | `tauri-winrt-notification 0.7.2` 声明 `quick-xml = "0.37"` → `>=0.37.0, <0.38.0`，不含 `>=0.41.0` |
| `RUSTSEC-2026-0195` | quick-xml | 0.37.5 | 同上 |
| `RUSTSEC-2026-0387` | crypto-bigint | 0.5.5 | `elliptic-curve 0.13.8` 声明 `crypto-bigint = "^0.5"`，不含 `>=0.7.6` |

```
$ cargo update -p quick-xml@0.37.5 --precise 0.41.0 --offline
error: failed to select a version for the requirement `quick-xml = "^0.37"`
candidate versions found which didn't match: 0.41.0
required by package `tauri-winrt-notification v0.7.2`

$ cargo update -p crypto-bigint@0.5.5 --precise 0.7.6 --offline
error: failed to select a version for the requirement `crypto-bigint = "^0.5"`
required by package `elliptic-curve v0.13.8`
```

父 crate 缓存里也没有更新版本可试（`tauri-winrt-notification` 只有 0.7.2、
`notify-rust` 只有 4.16.1、`tauri-plugin-notification` 只有 2.3.3），
所以**即使联网也可能无解**，要等上游 `notify-rust` / `tauri-winrt-notification` 升 quick-xml。

quick-xml 0.37.5 的缓解事实（本轮复测确认）：**仅 Windows 可达**。

```
--target x86_64-pc-windows-msvc    -> quick-xml v0.37.5 ← tauri-winrt-notification ← notify-rust
--target aarch64-apple-darwin      -> warning: nothing to print.
--target x86_64-unknown-linux-gnu  -> warning: nothing to print.
```

### 3.5 上游无修复版本（2 条）

| advisory | crate | 版本 | `patched` |
| --- | --- | --- | --- |
| `RUSTSEC-2023-0071` | rsa | 0.9.10 | **`[]` 空** |
| `RUSTSEC-2023-0071` | rsa | 0.10.0-rc.16 | **`[]` 空** |

Marvin Attack（时序侧信道）。上游至今未发布修复版本，`cargo update` 对它**永远无效**。
这不是升级任务；彻底消除只能改为不使用 RSA 密钥（ed25519 / ECDSA），属产品决策。
**不为了让条数好看而假装它可以升级。**

### 3.6 随 russh 一起走，非独立任务（1 条）

| advisory | crate | 版本 | 链路 |
| --- | --- | --- | --- |
| `RUSTSEC-2026-0387` | crypto-bigint | 0.7.0-rc.28 | `← crypto-primes ← rsa 0.10.0-rc.16 ← russh 0.60.2` |

卡点同 §3.1 的 russh（归档缺失）。

### 3.7 不在构建图内，无升级目标（6 条）

| advisory | crate | 实测 |
| --- | --- | --- |
| `RUSTSEC-2026-0185` / `-0338` / `-0339` / `-0340` / `-0342` | quinn-proto 0.11.14 | `cargo tree --invert quinn-proto --target all` → `nothing to print` |
| `RUSTSEC-2026-0235` | rkyv 0.7.46 | `cargo tree --invert rkyv --target all` → `nothing to print` |

两者都**在 `Cargo.lock` 里**（所以 `cargo audit` 报它们），但**不在任何 target 的依赖图中**，
不会被编译进产物。它们不是「修不了」，而是**没有需要修的东西**。
升级计划与台账的 `absent-from-build-graph` 分类本轮复测成立。

## 4. 验证输出（任务要求的两条命令，逐字记录）

命令与任务要求一致，均带 `--locked --all-targets --all-features`，加 `--offline`（本机无网）。

| 命令 | 退出码 | 输出 |
| --- | --- | --- |
| `cargo check --manifest-path src-tauri/Cargo.toml --locked --all-targets --all-features` | **0** | `Finished \`dev\` profile ... in 30.88s` |
| `cargo test --manifest-path src-tauri/Cargo.toml --locked --all-targets --all-features` | 101 | `test result: FAILED. 290 passed; 11 failed; 0 ignored` |

额外补跑 CI `rust` 作业的另外两条（`.github/workflows/ci.yml`）：

| 命令 | 退出码 |
| --- | --- |
| `cargo clippy --locked --all-targets --all-features -- -D warnings` | **0**（warning/error 行数 0） |
| `cargo fmt --check` | **0**（输出 0 行） |

### 4.1 那 11 条失败是沙箱环境，不是回归（升级前后逐条对照）

按任务要求，**升级前先跑了基线**，再用「失败集合有没有变化」判断：

```
基线 (lock 87bdd651…): test result: FAILED. 290 passed; 11 failed; ... finished in 13.48s
升级后 (lock bb3b5e09…): test result: FAILED. 290 passed; 11 failed; ... finished in 10.10s

失败测试名集合 diff: IDENTICAL -- no regression introduced
```

两次完全相同的 11 条：

```
port_forward::tests::bind_tcp_listener_reports_a_port_that_is_already_bound
session::local::tests::bash_shell_integration_is_silent_and_still_emits_the_parsed_sequences
session::local::tests::force_kill_local_process_group_stops_a_shell_ignoring_sighup
session::local::tests::setup_pty_preserves_echo_and_requested_size
session::local::tests::setup_pty_runs_a_real_shell_round_trip_at_the_requested_size
session::local::tests::zsh_shell_integration_is_silent_and_still_emits_the_parsed_sequences
session::ssh::tests::committed_connection_publication_keeps_transport_and_pool_key
session::ssh::tests::dropped_connection_publication_releases_transport_and_pool_key
session::ssh::tests::tcp_kex_timeout_closes_transport_before_returning
ssh_host_key::tests::direct_probe_kex_timeout_closes_transport_before_returning
storage::tests::storage_client_times_out_a_request_that_never_answers
```

升级后仍有 11 次 `Operation not permitted` / 10 次 `PermissionDenied` panic，
位置在 `TcpListener::bind` 与本地 PTY —— 沙箱禁止端口绑定与 PTY，与依赖升级无关。

⚠️ **这 11 条在升级前后都从未真正执行过**，所以「失败集合未变」只能证明
**没有引入新的失败**，不能证明这 11 条覆盖的 SSH 传输与本地 PTY 行为没有回归。
它们必须在能绑定本地端口的环境（`pnpm verify:rust` / CI）里补跑。
本次改动不触及 SSH 链路（只动了 plist/quick-xml，属 plist 解析与 tauri 资源处理路径），
但这是**代码路径推断**，不是测试证明。

### 4.2 三平台 lockfile 可解析性

新 lock 在 CI 的三个目标上都能完成 `cargo fetch --locked --offline`（0 个下载失败）：

```
x86_64-pc-windows-msvc    fetch EXIT=0   0 download-failures
x86_64-unknown-linux-gnu  fetch EXIT=0   0 download-failures
aarch64-apple-darwin      fetch EXIT=0   0 download-failures
```

即本改动**不会**让任何平台的 CI 作业因缺包而失败（与 §3.3 的 zip 链形成对比）。
注意这只证明依赖可获取，**不等于** Windows/Linux 能编译通过（本机未做跨平台编译，NOT_RUN）。

## 5. 改动清单

```
$ git status --porcelain
 M src-tauri/Cargo.lock
?? docs/phase9-1/dependency-upgrade-result.md      # 本文

$ git diff --stat -- src-tauri/Cargo.toml
（无输出 —— Cargo.toml 未改动）

$ git diff --stat -- src-tauri/Cargo.lock
 src-tauri/Cargo.lock | 18 ++++++++++------
 1 file changed, 12 insertions(+), 6 deletions(-)
```

lock 实际变动只有三处：新增 `base64 0.23.1`、`plist 1.9.0→1.10.1`、
`quick-xml 0.39.2→0.42.0`（含 checksum）。

按任务要求**未执行 `git commit`**，也**未改动** `docs/phase9-1/security-advisories.md` /
`.json`（那是另一条线的产物）。

> 工作树基线说明：本 worktree 原本切自 `main`，而 `docs/phase9-1/` 与计划文档在
> `feat/phase9-1-security-hardening`（及其后继 `feat/phase8-rc-hardening`）上。
> 已用 `git merge --ff-only feat/phase8-rc-hardening` 快进到含该文档的提交 `3bf36b8`，
> 快进后 `Cargo.lock` sha256 为 `87bdd651d1aea286…`，**与升级计划实测的基线完全一致**。

## 6. NOT_RUN 清单（本文所有未实跑的部分）

* **当前 advisory-db 的 `cargo audit` 复算：NOT_RUN。** §2.3 的 `10 → 8` 用的是
  2026-08-12 的陈旧 db（只覆盖 27 条中的 10 条）。`27 → 25` 是投影，未复算。
* **russh / rustls / h2 / zip / tauri / webpki-root-certs / ctutils 的任何升级：NOT_RUN。**
  未改、未编译、未测试。
* **那 11 条 bind/PTY 测试：从未真正执行**（升级前后都因沙箱跑不起来）。
* **跨平台编译：NOT_RUN。** 本机只做到 `cargo fetch` 级别的三平台校验，
  未在 Windows/Linux 上实际编译。
* **实机验证：NOT_RUN。** `pnpm smoke:ssh-matrix` 等实机入口本轮一个都没跑
  （本次改动不涉及 SSH 链路，但这是推断，不是证明）。

## 7. 下一轮（联网环境）建议顺序

沿用升级计划 §4，并按本轮实测结果调整：

| 顺序 | 对象 | 可清条数 | 需要的验证 | 本轮实测补充 |
| --- | --- | --- | --- | --- |
| ~~1~~ | ~~`plist` → 1.10.1~~ | ~~2~~ | — | ✅ **本轮已完成** |
| 1 | `aws-lc-rs` → ≥1.18，带起 `rustls` 0.23.46 + `rustls-webpki` 0.103.16 | **5** | `verify:rust` + 一次真实更新检查 | `rustls-webpki` 必须与 rustls 同组，**不能单独先修**（§3.2 修正计划） |
| 2 | `h2` → 0.4.16、`webpki-root-certs` → 1.0.10、`ctutils` → 0.4.4 | 3 | `verify:rust` | 三条都只缺归档，`cargo update` 已验证解析通过 |
| 3 | `russh` + `russh-cryptovec` → 0.60.3（原子） | 2 | **全套 SSH 实机矩阵** + RSA-8192 / 证书登录 + >100 MB SFTP | 原子联动已实测确认 |
| 4 | `tauri` 2.12.3 → `tauri-plugin-updater` 2.14.1 → `zip` 9.0.0 | 3（含 9.1） | 三平台编译 + Windows 实机自动更新 | 58 个 crate 变动；Windows target 需补 `webview2-com 0.39.1` |
| — | `quick-xml` 0.37.5 ×2 | 0 | — | 等上游 `notify-rust`/`tauri-winrt-notification` |
| — | `rsa` ×2 / `crypto-bigint` 0.5.5 | 0 | — | 无修复版本或被 `elliptic-curve` 钉死 |
| — | `quinn-proto` ×5 / `rkyv` | 0 | — | 不在构建图内，无需处理 |

1~4 全部做完，27 条最多可再清 **13 条**（降到 12 条左右）；
剩下的是上游未修、被钉死或不可达的。**任何一步都不要在没有对应验证的情况下合并。**

---

_文档生成时间: 2026-11-01 ｜ 基线 lock `87bdd651d1aea286…` → 升级后 `bb3b5e09ff8ec035…`_
