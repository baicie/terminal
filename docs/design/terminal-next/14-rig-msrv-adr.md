---
status: adr
updated: 2026-11-17
scope: "TN-UX4-01 — Rig 的 MSRV / 依赖 / 体积 / Audit / 三平台兼容性评估"
---

# ADR：是否为 ModelDriver 引入 Rig

> 设计 `07-ux4-ai-inspector.md` 第 3 节要求：先实现最小 `ModelDriver` + OpenAI-compatible
> HTTP adapter，Rig **只做独立评估**，「无明确收益不升级 Rust 工具链，不引入常驻 Node Sidecar」。
> 本文是那份评估。

## 结论

**不采用 Rig。维持现有最小 ModelDriver（Rust `ai` feature + `reqwest`），不升级工具链。**

| 判据 | 实测 | 结论 |
| --- | --- | --- |
| MSRV | Rig 0.46 / 0.45 要求 **1.97.1**；我们锁 1.96 | **阻断** |
| 可用的最低版本 | 0.44 要求 1.95.0，能配 1.96 | 需要降两个 minor |
| 依赖增量 | 0.44 引入 **20 个**我们当前没有的 crate（共 231 个） | 显著 |
| 体积代价（实测） | 空程序 + 一次 API 调用：**428 KB → 6.57 MB**（strip 后 5.48 MB） | **+6.14 MB / +5.05 MB** |
| 编译时间（实测） | 230 包冷构建 **108 s** | 可接受 |
| Audit | 231 依赖扫描 **0 vulnerabilities** | 干净 |
| 现有替代 | `src-tauri/src/ai/` 已实现 ModelDriver、SSE、取消、超时、错误分类，且已在 `ai` feature 后 | 已覆盖 |

---

## 1. MSRV：硬冲突

```
$ cargo info rig-core@0.46.0 --registry crates-io
rust-version: 1.97.1

$ cargo info rig-core@0.45.0 --registry crates-io
rust-version: 1.97.1

$ cargo info rig-core@0.44.0 --registry crates-io
rust-version: 1.95.0
```

本项目 `rust-toolchain.toml` 固定 `1.96.0`，`Cargo.toml` 声明 `rust-version = "1.96"`，
CI 三个 job 均 pin `1.96.0`。

设计明确写着「**无明确收益不升级 Rust 工具链**」。为了用一个把现有 271 行 transport
重写一遍的库而升级整条工具链，收益与代价不成比例。

`cargo generate-lockfile` 自己也把这件事说出来了：

```
Adding rig-core v0.44.0 (available: v0.46.0, requires Rust 1.97.1)
```

## 2. 依赖增量

用 0.44（唯一能配 1.96 的版本，且已落后两个 minor）实测：

- 整个依赖图 **231 个包**
- 相对本项目现有 `Cargo.lock` 新增 **20 个**我们尚无的 crate

对一个只做「一次 POST + SSE 解析」的需求，这是把一棵供应商中立的应用框架树引进来。

## 3. 体积：实测 +6.14 MB

这是本条决定里最具体的一个数字，而且我第一版测法错了，值得记下来。

**第一次测量是无效的。** 我用空 `main()` 分别链接「含 rig」与「不含 rig」两个 crate，得到
**完全相同的 428048 字节**。原因是链接器把未被引用的代码全部裁掉了 —— 那个测量只反映了一个
空程序，与 Rig 无关。

**正确的测法**：让 `main()` 真的碰一下 Rig 的公开 API。

```rust
use rig_core::providers::openai::{self, OpenAI};
fn main() {
    let _model = OpenAI::from_env().map(|c| c.chat(openai::GPT_5_2));
}
```

| 构建 | 二进制 |
| --- | --- |
| 不带 rig（reqwest + tokio + serde_json 的空程序） | **428,048 B** |
| 带 rig，真实调用 API | **6,574,528 B（6.57 MB）** |
| 同上，`strip` 后 | **5,484,712 B（5.48 MB）** |

**增量 +6.14 MB，strip 后仍 +5.05 MB。** 对一个只做「一次 POST + SSE 解析」的需求，这个代价
买到的是一棵完整的 LLM 应用框架树。

冷构建 231 个包 **108 秒**；增量重建 5.3 秒。编译时间本身不是问题，问题在体积。

## 4. Audit

```
$ cargo audit    # 在 rig-probe 的 231 依赖上
Loaded 1527 security advisories
Scanning Cargo.lock for vulnerabilities (231 crate dependencies)
→ 0 vulnerabilities
```

干净。这是支持 Rig 的唯一一条正面数据 —— 但它抵不过 MSRV 与依赖增量。

## 5. 现有实现的覆盖度

`src-tauri/src/ai/` 已经提供设计要求的全部能力，且每条都有测试：

| 设计要求 | 现状 |
| --- | --- |
| Profile CRUD、Endpoint、Model ID | `ai/profile.rs`、`ai/endpoint.rs` |
| 连接测试 | `ai_available` + 不带 terminal context 的探测 |
| Streaming | `ai/transport.rs` 的 SSE 解析，含跨 TCP 读的多字节字符 |
| Cancel | 按 `requestId` 的 `AiRuns`，重复 id 显式拒绝 |
| Timeout | profile 的 `timeout_ms`，clamp 到上下界 |
| 结构化错误 | `AiFailureKind`，401/403/429/超时/断流/空流各自可辨 |
| Key 不进 WebView | key 在 Rust 内从 vault 取用，前端无字段可放 |

Rig 能带来的增量是「多 provider 抽象」与「tool/agent loop」。设计**明确不做** Agent Loop
（`10-pr-implementation-plan.md`：「不实现 Agent Loop、不执行远程命令」），所以那部分价值
本期不存在。

## 6. 三平台

无法完整验证：本机只有 macOS。Rig 0.44 的依赖含 `rig-tungstenite`（websocket）等可选树，
默认不开。**Windows / Linux 的实际编译与运行 `NOT_RUN`** —— 按要求不得外推。

---

## 决定

**不引入 Rig。** 理由是 MSRV 硬冲突（0.45+ 要 1.97.1）与依赖增量（+20 crate），而现有实现
已覆盖本期全部需求，且设计的「不做 Agent Loop」使 Rig 的主要增量失去意义。

## 何时重新评估

- 本项目**自行**决定升级到 ≥ 1.97.1（例如为了别的能力）；
- Rig 的 MSRV 回落到我们锁定的版本；
- 设计放开「多 provider / Agent Loop」，届时 Rig 的抽象才开始有对应价值。

## 复现

```bash
mkdir -p /tmp/rig-probe/src && cd /tmp/rig-probe
cat > Cargo.toml <<'TOML'
[package]
name = "rig-probe"
version = "0.0.0"
edition = "2021"
rust-version = "1.96"
[dependencies]
rig-core = { version = "0.44", default-features = false, features = ["reqwest", "rustls"] }
TOML
echo 'fn main() {}' > src/main.rs
cargo generate-lockfile && cargo audit && cargo build --release
```
