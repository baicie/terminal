# R08 — 回归结果（macOS 本地 / 三平台以 CI 为准）

> R08 要求真实三平台回归。**本机只有 macOS**，Windows 与 Linux 的结论必须来自 CI，
> 不能由本机结果外推。本文把两类分开写。

---

## 一、macOS 本地实跑（本机，2026-11-23）

### 门禁

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| 前端测试 | `vitest run`（`packages/frontend`） | **327 文件 / 3017 项通过** |
| TypeScript | `tsc --noEmit` | 通过 |
| ESLint | `eslint`（改动文件） | 0 problem |
| 前端构建 | `vite build` | 通过，1.58 s |
| 打包体积 | `analyze:bundle` | 前端 `dist/` **2.50 MB** |
| 源码行数 | `check-source-size.mjs` | **769 个生产文件**通过 |
| 脚本套件 | `node --test scripts/*.test.mjs` | **819 / 819** |
| Rust 单测 | `cargo test --lib` | **456 通过 / 0 失败 / 16 ignored** |
| Rust 格式 | `cargo fmt --check` | 通过 |
| Rust lint | `cargo clippy --all-targets` | 仅 4 个既有 dead-code warning（见 §三） |
| GUI 隔离 | `check-gui-e2e-isolation.mjs` | **7/7 断言** |

### GUI 真实 WebView（macOS WKWebView）

| spec | 结果 |
| --- | --- |
| e2e-01 / 02 / 03 / 04 / 05 / 06 | 全部通过 |
| t09-refresh-hit-test | 通过 |
| t11-overlay-interaction | 6/6 |
| **r04-focus-hook-regression**（本轮新增） | **5/5，1.5 s** |

整轮 `run-gui-e2e.mjs` `exit 0`。

### 真实 sshd / SFTP

| 场景 | 结果 |
| --- | --- |
| 无整形基线 | **8/8，20 s** |
| `slow-uplink-only`（512 KiB/s 上行） | 8/8，151 s |
| `cut-download` | 6 过 / 2 失败（声明内），37 s |
| `handshake-reset` | 6/8 失败（声明内），56 s |
| `silent-server` | 8/8 失败（声明内），166 s |
| `cut-upload` | **无 verdict** → `TEST_INFRA_FAILURE` |
| fixture 生命周期 | 5/5，3.7 s，零残留 |

---

## 二、Windows / Linux

**本机没有这两个平台，不作任何外推。** 它们的结论只能来自 CI 的
`Native GUI E2E` 与三平台编译 job。

本轮新增的 `r04-focus-hook-regression.e2e.mjs` 会在 CI 的三个 GUI job 里运行，
但**本机无法预判它在 Windows / Linux 上的结果**。特别是：

- 阈值 1000 ms 在两个 runner 上是否够松，本机无法验证；
- `data-testid="rail-connections"` 在这些平台上是否存在，取决于构建配置而非平台。

若 CI 上这两个平台失败，应按 spec 自己写出的 `notRun` 与失败信息判断，不能用
「macOS 绿了」推断它们也会绿。

---

## 三、4 个 clippy warning 是既有的

```
enum `VaultReadError` is never used
function `application_pool` is never used
function `vault_read_secret` is never used
method `kind` is never used
```

`git show main:src-tauri/src/vault.rs` 里已有 `vault_read_secret`，即这 4 条在
`main = e2a2e58` 上就存在，不是本轮引入的。本轮不顺手修它们：`VaultReadError`
与 `vault_read_secret` 是一个未接线的功能面（Phase 10.3 记录过 `passphrase_encrypted`
无消费方），删掉会掩盖「有功能没接上」这个事实。

---

## 四、R08 判定

```
MACOS_LOCAL_GATES                 = PASS
MACOS_GUI_REAL_WEBVIEW            = PASS
MACOS_REAL_SSHD_SFTP              = PASS（cut-upload 除外，见 R03）
WINDOWS_GATES                     = NOT_RUN（需 CI）
LINUX_GATES                       = NOT_RUN（需 CI）
WINDOWS_GUI                       = NOT_RUN（需 CI）
LINUX_GUI                         = NOT_RUN（需 CI）
```
