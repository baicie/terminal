# 依赖升级可行性评估（Phase 9.1）

> 配套文档：漏洞台账 `docs/phase9-1/security-advisories.md`（27 条逐条事实）。
> 本文不是台账，而是**下一轮能否安全升级**的判定：每条给出锁定版本、advisory 要求的
> 修复版本、**实测**依赖链、影响面，以及「升级后要跑什么才算验证过」。
>
> 本轮**没有**对共享工作树的 `Cargo.toml` / `Cargo.lock` 做任何改动。
> 全部实验在隔离副本 `$TMPDIR/qxtest`、`$TMPDIR/qxbase` 中进行，
> 共享树 `Cargo.lock` 的 sha256 前缀始终为 `87bdd651d1aea286`（实验前后各验证一次）。

## 0. 本轮环境限制（决定了哪些结论是实测、哪些是 NOT_RUN）

| 限制 | 实测证据 | 影响 |
| --- | --- | --- |
| crates.io 不可达 | `cargo update` 报 `curl ... Failed to connect to 127.0.0.1 port 7890` | 只能升级到**离线缓存里已有**的版本 |
| `~/.cargo` 只读 | `cargo audit` / `cargo deny` 报 `attempted to take an exclusive lock on a read-only path` | 本机**无法重跑 cargo audit**；本文漏洞数据沿用 `/tmp/audit91.json` |
| 本地端口不可绑定 | `cargo test` 11 条失败全部是 `PermissionDenied: Operation not permitted` | 这 11 条**与升级无关**，见 §1.4 的基线对照 |

离线缓存里已有的相关版本（`ls ~/.cargo/registry/src/*/`，实测）：

```
rustls-0.23.40 / 0.23.41 / 0.23.45 / 0.23.46      rustls-webpki-0.103.13 / 0.103.15 / 0.103.16
quick-xml-0.37.5 / 0.39.2 / 0.42.0                plist-1.9.0 / 1.10.1
h2-0.4.13 / 0.4.15                                 tauri-plugin-updater-2.12.0 / 2.14.1
russh-0.60.2（没有 0.60.3）                         zip-2.6.1 / 4.6.1（没有 9.x）
aws-lc-rs-1.16.3（只有这一个）                       webpki-root-certs-1.0.7（没有 1.0.10）
```

## 1. 第一组：quick-xml ×4（基准分 7.5）—— 部分可实测修复

### 1.1 这 4 条其实是两条链，必须分开处理

`cargo audit` 把它报成 4 条，是因为 2 个 advisory × 2 个**并存**的 quick-xml 版本。
两个版本来自完全不同的父链，可达平台也不同：

| 锁定版本 | 依赖链（`cargo tree --invert quick-xml@<ver> --target all` 实测） | 可达平台 |
| --- | --- | --- |
| 0.37.5 | `quick-xml 0.37.5 ← tauri-winrt-notification 0.7.2 ← notify-rust 4.16.1 ← tauri-plugin-notification 2.3.3 ← terminal` | **仅 Windows** |
| 0.39.2 | `quick-xml 0.39.2 ← plist 1.9.0 ← tauri 2.11.0 / tauri-codegen / tauri-utils ← terminal` | 全平台 |

平台结论是逐 target 实测的，不是看 cfg 猜的：

```
cargo tree --invert quick-xml@0.37.5 --target x86_64-pc-windows-msvc   -> 打印完整链
cargo tree --invert quick-xml@0.37.5 --target x86_64-unknown-linux-gnu -> nothing to print
cargo tree --invert quick-xml@0.37.5 --target aarch64-apple-darwin     -> nothing to print
```

对应 `notify-rust` 的 `[target.'cfg(target_os="windows")'.dependencies.winrt-notification]`。

两条 advisory：
`RUSTSEC-2026-0194`（为重复属性名做检查时运行时间退化为平方级）、
`RUSTSEC-2026-0195`（`NsReader` 命名空间声明分配无上界，可被用于内存耗尽）。
两条的 `patched` 都是 `>=0.41.0`。

### 1.2 这不是 patch 级升级 —— 父 crate 的 semver 约束不允许

任务描述里假设「可能能通过 patch 级 `cargo update` 解决」。**实测否定了这个假设**，
`cargo update` 永远不会把 quick-xml 升到 0.41+，因为父 crate 钉的是次版本号：

| 父 crate | 它对 quick-xml 的 req（实测自缓存里的 Cargo.toml） | `>=0.41.0` 落在范围内？ |
| --- | --- | --- |
| `tauri-winrt-notification 0.7.2` | `version = "0.37"` → `>=0.37.0, <0.38.0` | ❌ |
| `plist 1.9.0` | `version = "0.39.2"` → `>=0.39.2, <0.40.0` | ❌ |

quick-xml 也**不是**本项目的直接依赖（`grep quick-xml src-tauri/Cargo.toml` 无结果），
所以我们无法直接改它的版本号。要修，只能升**父 crate**。

### 1.3 可行路径：升 plist，清掉 0.39.2 这一对（已实测通过）

`plist 1.10.1` 把它的 quick-xml req 改成了 `version = "0.42.0"`，而 0.42.0 和 1.10.1
都已在离线缓存里。于是这条路**不需要联网**就能走完并验证：

```bash
cargo update -p plist --precise 1.10.1 --offline
```

在隔离副本里实跑的结果：

```
      Adding base64 v0.23.1
    Updating plist v1.9.0 -> v1.10.1
    Updating quick-xml v0.39.2 -> v0.42.0
```

升级后副本里 quick-xml 只剩 `0.37.5` 和 `0.42.0`，`0.39.2` 消失
（`cargo tree --invert quick-xml@0.39.2` 报 `did not match any packages`）。
**清掉 4 条中的 2 条**（0.39.2 上的 -0194 / -0195）。

### 1.4 验证结果（在隔离副本上实跑，CI 的 Rust 作业用的就是这 4 条命令）

| 命令（`--offline` 外与 `.github/workflows/ci.yml` 的 `rust` 作业一致） | 退出码 |
| --- | --- |
| `cargo check --locked --all-targets --all-features` | **0** |
| `cargo clippy --locked --all-targets --all-features -- -D warnings` | **0**（无 warning 输出） |
| `cargo fmt --check` | **0** |
| `cargo test --locked`（lib） | 290 passed; **11 failed** |

这 11 条失败**不是升级造成的**。为了证明，我用同一套命令跑了一个**未升级**的副本
（`Cargo.lock` sha256 前缀 `87bdd651d1aea286`，与共享树一致），两边结果逐条相同：

```
baseline: test result: FAILED. 290 passed; 11 failed
upgraded: test result: FAILED. 290 passed; 11 failed
失败测试名集合 diff: (identical)
```

11 条全部 panic 在 `PermissionDenied: Operation not permitted`，位置是
`TcpListener::bind`（`session/ssh.rs:2752`、`:2796`、`:3387`、`storage.rs:1154`、
`port_forward.rs`）和本地 PTY（`session/local.rs` 的 shell 集成 / setup_pty）。
这是沙箱禁止本地端口绑定与 PTY，不是代码缺陷，也不是 quick-xml 的行为变化。

### 1.5 为什么本轮仍然没有把它写进共享树

三个理由，任一成立就不该现在改：

1. **协作边界**：这一轮有另外两个会话共用同一个 checkout，其中一个正在重写
   `scripts/build-security-ledger.mjs`。`Cargo.lock` 变了，台账的可达性结论
   （它是 `cargo tree` 现算的）会在那个会话脚下变化。
2. **本机测试不完整**：§1.4 的 11 条 bind/PTY 测试在沙箱里跑不起来。它们恰好覆盖
   SSH 传输与本地 PTY，是本项目最该回归的部分。「其余 290 条过了」不等于回归干净。
3. **没有联网复算 audit**：改完 lock 后无法在本机重跑 `cargo audit` 确认条数真的
   从 27 降到 25。拿不出前后对照，就只是「看起来变好了」。

**建议下一轮执行**（联网环境，单独提交）：

```bash
cargo update -p plist --precise 1.10.1
pnpm verify:rust                      # fmt + check + clippy + test，不带 --offline
cargo audit --json > /tmp/audit-after.json
node scripts/build-security-ledger.mjs --input /tmp/audit-after.json   # 条数应为 25
```

### 1.6 0.37.5 这一对：本轮无路可走

`tauri-winrt-notification` 缓存里只有 0.7.2，`notify-rust` 只有 4.16.1，
都没有更新版本可试；而 0.7.2 钉死 `quick-xml ^0.37`。
结论：**必须等上游** `notify-rust` / `tauri-winrt-notification` 升 quick-xml，
或者 `tauri-plugin-notification` 换掉 `notify-rust`。我们这一侧改不动。
缓解事实：仅 Windows 可达，且攻击面是解析**本地构造的通知 XML**，不是网络输入。

## 2. 第二组：russh / russh-cryptovec（基准分 7.5，核心 SSH 链路）—— 本轮不升级

### 2.1 实测依赖链（都在最短路径上，没有中间层可挡）

```
russh 0.60.2           ← terminal                       （直接依赖，src-tauri/Cargo.toml:28）
russh-cryptovec 0.59.0 ← russh 0.60.2 ← terminal
```

* `RUSTSEC-2026-0154`（russh）：Unbounded 32-bit allocation，`patched: >=0.60.3`
* `RUSTSEC-2026-0153`（russh-cryptovec）：Unchecked `CryptoVec` allocation and growth handling，`patched: >=0.60.3`

### 2.2 一处需要修正上一轮的判断：这是 patch 升级，不是跨大版本

上一轮的说法是「跨大版本升级会改变认证/会话语义」。按 audit JSON 的实际数据，
**修复版本是 0.60.3**，而我们锁的是 0.60.2 —— 差一个 patch。
我们的 req 是 `russh = "0.60"`（`^0.60` = `>=0.60.0, <0.61.0`），
**0.60.3 本来就在范围内，连 `Cargo.toml` 都不用改**，`cargo update -p russh` 即可。

但「版本号跨度小」不等于「可以不验证就升」—— 见 §2.4。上一轮**不升级**的结论依然正确，
只是理由应当换成「核心链路 + 本机无法回归」，而不是「跨大版本」。

### 2.3 一个必须一起处理的耦合：-0153 无法单独修

`russh 0.60.2` 对 cryptovec 的 req 是 `version = "0.59.0"` → `>=0.59.0, <0.60.0`，
**不包含** `0.60.3`。所以：

> 只要 russh 停在 0.60.2，`RUSTSEC-2026-0153` 就**无法**通过升 cryptovec 修掉；
> 它必须跟着 russh 一起升。两条是一个原子操作，不能拆成两次提交。

### 2.4 本轮状态：NOT_RUN

`russh 0.60.3` **不在**离线缓存里（只有 0.60.2），`cargo update -p russh --offline`
报 `Locking 0 packages`（无可用新版本）。本机无法下载、无法编译、无法测试。
**没有实跑任何 russh 升级，也没有任何升级后证据。**

### 2.5 语义风险点（升级时要重点看的地方）

两条 advisory 都在**分配路径**上。修复必然引入长度/容量上界，风险因此落在边界行为：

1. **`CryptoVec` 的增长策略**：它承载密钥材料与报文缓冲。若修复改了 `resize`/`extend`
   的语义（例如超限返回 `Err` 而非 panic 或静默截断），调用方的错误处理需要跟着改。
2. **大报文拒绝的位置**：新上界可能让此前能协商成功的大 `KEXINIT`、超长 banner、
   大体积公钥（RSA-8192、证书链）被拒。**认证成败**会随之变化。
3. **SFTP 大块读写**：`russh-sftp 2.1.2` 走同一套缓冲。上界若小于现有 chunk size，
   表现为大文件传输中断，而不是报错。
4. **Agent forwarding**：转发的是 agent 协议帧，同样经过 CryptoVec。

### 2.6 升级后必须跑的验证（缺一不可）

本仓库已有的实机入口（`package.json` 实测，不是猜的）：

| 命令 | 覆盖 |
| --- | --- |
| `pnpm smoke:ssh-matrix` | 真实 SSH 认证矩阵（password / key / agent / cert）—— **最关键** |
| `pnpm smoke:terminal` / `pnpm smoke:terminal:reconnect` | 会话建立与重连 |
| `pnpm smoke:input-probe` / `pnpm smoke:raw-input` | 交互输入（Ctrl+C、vim、行编辑） |
| `pnpm smoke:shell-probe:matrix` | shell 集成（注意：Linux 该门禁**当前本就失败**，见 `AGENTS.md` 问题 60，须与升级无关地先区分开） |
| `pnpm verify:rust` | fmt + check + clippy + test（**需在能绑定本地端口的环境**，以覆盖 §1.4 那 11 条） |
| `.github/workflows/real-machine-matrix.yml` | macOS / Windows / Linux 三平台 |

另外两项，自动化覆盖不到，必须人工：

* **大体积密钥/证书登录**：RSA-8192 与 SSH 证书各登录一次，确认新上界没把它们挡掉。
* **SFTP 大文件**：传一个 >100 MB 的文件，确认没有静默截断。

## 3. 第三组：其余在构建图内的条目（按组给结论，不逐条深挖）

### 3.1 rustls ×4 + rustls-webpki + webpki-root-certs —— 看似 patch，实际本轮验证不了

链路（实测）：`rustls 0.23.40 ← hyper-rustls / tokio-rustls / rustls-platform-verifier
← reqwest 0.13.3 ← tauri + tauri-plugin-updater ← terminal`。
即**更新检查与 HTTPS 下载**路径，不是 SSH 路径。

所有父 crate 的 req 都是 `^0.23` 或 `^0.23.27`，而修复版本是 0.23.45 / 0.23.46，
缓存里也有 —— 看起来是最干净的一组。但 `cargo update -p rustls --precise 0.23.46 --offline`
实测失败：

```
error: failed to select a version for `aws-lc-rs`.
    ... required by package `rustls v0.23.46`   （req: ^1.18）
  previously selected package `aws-lc-rs v1.16.3`
    ... which satisfies dependency `aws-lc-rs = "^1.16.2"` of package `russh v0.60.2`
```

**这是离线缓存假象，不是真的 semver 冲突**：russh 要 `^1.16.2`，rustls 0.23.46 要 `^1.18`，
两者交集 `>=1.18.0, <2.0.0` 非空，联网时 cargo 取 1.18/1.19 即可同时满足。
缓存里只有 aws-lc-rs 1.16.3，所以离线解不出来。

状态 **NOT_RUN**。下一轮联网时这一组优先做：它只影响更新器的 TLS 栈，
`pnpm verify:rust` + 一次真实更新检查即可覆盖，不需要 SSH 实机矩阵。
其中 `RUSTSEC-2026-0349`（未认证的 ServerHello 可把后续连接降级为经典密钥交换）
和 `RUSTSEC-2026-0382`（证书校验可能接受已不受信的中间证书）值得优先，
因为它们削弱的是更新包下载的信任链。

### 3.2 zip ×3 —— 本组含全部 27 条里**最高**的一条（9.1），但是链式升级

链路（实测，**仅 Windows**）：
`zip 4.6.1 ← tauri-plugin-updater 2.12.0 ← terminal`
（`[target.'cfg(target_os = "windows")'.dependencies.zip]`；
macOS / Linux target 下 `cargo tree --invert zip` 均为 `nothing to print`）。

三条都要求 `>=9.0.0`，跨 5 个大版本：

* `RUSTSEC-2026-0369`（**基准分 9.1**，向量 `AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:H/A:H`）：
  `extract()` 透过符号链接施加 Unix 权限，且不限制目标位置。
* `RUSTSEC-2026-0368`：`extract()` 会创建指向目标目录之外的符号链接。
* `RUSTSEC-2026-0367`（7.3）：解压时保留 SUID/SGID 位。

> 台账与本文都按基准分排序，于是这条 9.1 排在 6 条 7.5 **之前**。
> 任务描述里的「6 条 7.5」是正确的，但它不是最高的一条 —— 下一轮排优先级时别漏了它。
> 缓解事实：该路径解压的是**我们自己签名的更新包**（`minisign-verify` 先验签），
> 不是用户任意提供的 zip；且仅 Windows 可达。这降低了可利用性，但不改变 advisory 本身。

升级路径是**链式**的：`tauri-plugin-updater 2.14.1` 才把 zip req 提到 `version = "9"`，
而 2.14.1 要求 `tauri >= 2.12`，我们锁的是 `tauri 2.11.0`。
我们自己的 req（`tauri = "2.10"`、`tauri-plugin-updater = "2"`）都允许，
不用改 `Cargo.toml`；但 zip 9.x 与 tauri 2.12+ 都不在缓存里。

状态 **NOT_RUN**。下一轮要把它当作「升 tauri 次版本」来对待：
需要全平台编译 + Windows 实机走一次完整自动更新（下载→验签→解压→替换）。

### 3.3 rsa ×2（5.9）—— 没有修复版本可升

`RUSTSEC-2023-0071`（Marvin Attack，时序侧信道可能导致私钥恢复），
`patched` 字段为**空**：上游至今没有发布修复版本。两处链路（实测）：

```
rsa 0.9.10        ← ssh-key 0.6.7 ← terminal
rsa 0.10.0-rc.16  ← russh 0.60.2 ← terminal（及其 internal-russh-forked-ssh-key）
```

**升级不是选项**，`cargo update` 对它永远无效。下一轮只能做判定并记录：
受影响的是 RSA 解密/签名的时序；本产品用它做客户端认证签名，
攻击者需要能大量触发签名并做高精度计时测量。要彻底消除只能不使用 RSA 密钥
（改 ed25519 / ECDSA），那是产品决策，不是依赖升级。
**不要为了让条数变好看而假装它可以升级。**

### 3.4 crypto-bigint ×2 / ctutils / h2 —— 低优先，其中 h2 可单独试

| advisory | crate | 链路（实测） | 结论 |
| --- | --- | --- | --- |
| `RUSTSEC-2026-0387` | crypto-bigint 0.5.5 | `← elliptic-curve ← ecdsa/p256/p384/p521 ← ssh-key ← terminal` | 要 `>=0.7.6`，跨大版本，受 ssh-key 0.6.7 钉死，本侧改不动 |
| `RUSTSEC-2026-0387` | crypto-bigint 0.7.0-rc.28 | `← crypto-primes ← rsa 0.10.0-rc.16 ← russh` | 随 russh 一起走（§2） |
| `RUSTSEC-2026-0385` | ctutils 0.4.2 | `← crypto-bigint 0.7.0-rc.28 ← ... ← russh` | 同上 |
| `RUSTSEC-2026-0258` | h2 0.4.13 | `← hyper 1.9.0 ← hyper-rustls/reqwest ← tauri` | 要 `>=0.4.16`；缓存只有 0.4.15，离线可升到 0.4.15 但**不够**。NOT_RUN |

前三条都是常量时间性质问题（非常量时间的掩码生成、`u128` 比较、
本应常量时间的运算存在时序差异），和 §3.3 的 rsa 同源：都在 russh / ssh-key 的
密钥运算栈里，且都被父 crate 的 semver 钉住。它们的实际修复依赖
`ssh-key` 与 `russh` 升级，不构成独立的升级任务。

## 4. 汇总：下一轮的建议顺序

按「风险可控程度」而不是按分数排，因为高分未必好修：

| 顺序 | 对象 | 可清条数 | 需要的验证 | 本轮状态 |
| --- | --- | --- | --- | --- |
| 1 | `plist` → 1.10.1（带起 quick-xml 0.42.0） | 2 | `pnpm verify:rust` | ✅ 隔离副本已实测 check/clippy/fmt 全 0，测试与基线逐条相同 |
| 2 | `rustls` 组 → 0.23.46 / webpki 0.103.16 | 4~6 | `verify:rust` + 一次真实更新检查 | NOT_RUN（缓存缺 aws-lc-rs ≥1.18） |
| 3 | `h2` → ≥0.4.16 | 1 | `verify:rust` | NOT_RUN（缓存只到 0.4.15） |
| 4 | `russh` + `russh-cryptovec` → 0.60.3（原子） | 2 | **全套 SSH 实机矩阵** + 大密钥/大文件人工项 | NOT_RUN（缓存无 0.60.3） |
| 5 | `tauri` 2.12+ → `tauri-plugin-updater` 2.14.1 → `zip` 9 | 3（含 9.1） | 全平台编译 + Windows 实机自动更新 | NOT_RUN（缓存无 zip 9.x） |
| — | `rsa` / `crypto-bigint` / `ctutils` | 0 | — | 无修复版本或被父 crate 钉死，不是升级任务 |

顺序 1~5 全部做完，27 条中最多可清 12~14 条。其余是上游未修或无法单独修的。
**任何一步都不要在没有对应验证的情况下合并。**

## 5. NOT_RUN 清单（本文档所有未实跑验证的部分）

* `cargo audit` 本机复跑：**NOT_RUN**（`~/.cargo` 只读）。本文漏洞数据来自既有快照
  `/tmp/audit91.json`，未重新采集。
* `cargo-deny` 对**当前真实** advisory db 的检查：**NOT_RUN**。本机只能跑到
  2026-08-12 的陈旧本地克隆（`~/.cargo/advisory-dbs/advisory-db-3157b0e258782691`，
  需复制到可写目录并加 `--offline`）。该陈旧库**不含** 27 条中的大部分。
  已验证的只是 `src-tauri/deny.toml` 能被 cargo-deny 0.20.2 正确解析、
  ignore 机制确实生效、且**没有**误伤在构建图内的条目（详见 `deny.toml` 头部注释）。
* `russh` / `rustls` / `h2` / `zip` / `tauri` 的任何升级：**NOT_RUN**，未改、未编译、未测试。
* `plist` → 1.10.1：**已在隔离副本实测**（check/clippy/fmt 退出码 0；
  test 290 passed / 11 failed，与未升级基线逐条相同，失败全为沙箱 bind/PTY 限制）。
  但**未应用到共享工作树**，也未在联网环境下用 `cargo audit` 复算条数。
* `.github/workflows/ci.yml` 新增的 `cargo-audit-diagnostic` 作业：**NOT_RUN**。
  本机无法执行 GitHub Actions。已做的是 YAML 解析校验、`continue-on-error: true`
  断言、以及每个 shell 片段的 `bash -n` 语法校验，全部通过。
* §1.4 那 11 条 bind/PTY 测试：在任何配置下都**未真正执行过**（沙箱限制），
  升级前后都只是「同样跑不起来」。它们必须在能绑定本地端口的环境里补跑。
