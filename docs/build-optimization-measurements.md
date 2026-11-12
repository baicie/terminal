# Release 体积优化实测记录

**平台：macOS arm64（本机）。这是单平台结果，Windows/Linux 未构建验证。**
日期：2026-11-12
Worktree：`~/tn-build-opt`（分支 `build/release-size-optimization`，基线 `main = 4270629`）
工具链：Rust 1.96.0

## 方案定义

| 方案 | 配置 | 承载方式 |
| --- | --- | --- |
| **A 原始** | 默认 `[profile.release]`：无 LTO、16 codegen units、保留符号 | 默认 |
| **B 仅 strip** | `strip = "symbols"`，其余默认 | `--config` 覆盖，不改文件 |
| **C strip+LTO** | `strip = "symbols"` + `lto = "fat"` + `codegen-units = 1` | `[profile.release-small]` 独立 profile |

**关键设计：C 方案没有覆盖默认 `[profile.release]`。** 日常 `cargo build --release`、
CI 编译门禁、`pnpm tauri build` 全部继续走 A 的成本。只有显式
`cargo build --profile release-small` 才付 LTO 的代价。

## 实测结果

| 指标 | A 原始 | B 仅 strip | C strip+LTO |
| --- | --- | --- | --- |
| 可执行文件字节 | **34,373,984** | **28,108,480** | **22,567,264** |
| 大小 | 32.78 MB | 26.81 MB | 21.52 MB |
| 相对 A 节省 | — | 5.98 MB（**18.2%**） | 11.26 MB（**34.3%**） |
| 符号数 | 80,518 | 494 | 436 |
| `__LINKEDIT` | 7,111,008 B | 845,504 B | 285,024 B |
| 构建耗时（冷） | 405s 依赖 + 233s 本体 | **9m01s** | **21m15s** |
| 启动 / DB 恢复 | `state=Healthy` ✓ | `state=Healthy` ✓ | `state=Healthy` ✓ |

### 增量收益分析

- B 相对 A：**−5.98 MB**，几乎零构建成本（strip 是构建后处理）
- C 相对 B：**−5.28 MB**（在 B 基础上再减 19.7%），但构建时间翻倍以上（9m → 21m）
- 也就是说：**B 用 18.2% 的体积换取了全部免费收益；C 用 +12 分钟构建时间再换 5.28 MB**

## 跨平台说明（未验证部分）

| 平台 | strip | lto=fat | 实测状态 |
| --- | --- | --- | --- |
| macOS arm64 | ✓ 已实测 | ✓ 已实测 | **本轮唯一实测平台** |
| Linux x86_64/arm64 | 配置合法（ELF `.symtab`） | 配置合法 | **NOT_RUN** |
| Windows x86_64/arm64 | 配置合法（PDB 独立） | 配置合法（需 link.exe LTO 支持） | **NOT_RUN** |

Cargo 的 `strip` 与 `lto` 都是跨平台选项，配置文件本身三平台可用。
但**本轮只在 macOS 上构建并启动验证过**；Windows/Linux 的实际产物大小、
构建耗时与启动行为均未测量，不得据此外推。

## 崩溃符号化

| 方案 | 崩溃栈可读性 |
| --- | --- |
| A | 保留 80,518 个符号，`atos`/`lldb` 可直接符号化 |
| B / C | 已 strip，崩溃只显示地址 |

**本仓库没有任何 dSYM 归档流程**（`.github/workflows/` 与 `scripts/` 中均无相关步骤，
已 grep 确认）。这意味着：

- A 方案的符号是"碰巧留下的"，不是刻意保留的调试能力
- B/C 一旦上线，**崩溃报告将永久失去符号化能力**，除非同时引入 dSYM 归档

如果未来要采用 B 或 C，**必须同时决定**：归档未 strip 的二进制或 dSYM，
并在发布流程里保存，否则线上崩溃无法定位。这是采用 strip 的前置条件，
不是可选项。

## 未覆盖项

- macOS 正常启动已测（三次均 `state=Healthy`），但**未做终端交互、SSH 连接、
  SFTP 传输的实机验证**
- 未测增量构建耗时（A/B/C 均为冷构建）
- 未测 C 方案产物的运行时性能（PTY/SFTP 吞吐是否受 LTO 影响）
- Windows/Linux 全部 NOT_RUN
