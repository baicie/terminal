# 00 — Terminal Next 总体架构 ADR

- 状态：**提案（Draft）**，未实施
- 日期：2026-11-11
- 基线：`main = fa2ea71`（功能合并 `e234091`，PR #33）
- 设计包：`terminal-next-design-package-v1.md`
- 本文档的每个结论都基于对真实代码的审查，不是设计包的自述。审查证据以 `file:line` 标注。

---

## 1. 决策

保留 Tauri 2 + React + shadcn/ui + xterm 架构；把应用从「模块化后台」改为 **Terminal Canvas 常驻 + 按需面板**；凭据默认走**系统钥匙串**，Vault 降为可选；插件与 AI 分阶段引入。

## 2. 为什么改

设计包给出的四条理由，逐条对照当前代码：

| 理由 | 代码证据 |
| --- | --- |
| Vault 使用繁琐 | `VAULT_STATE` 是进程内内存（`src-tauri/src/vault.rs:933`），**每次启动必为锁定**；所有写路径的前置检查会因此拒绝（`host-credentials.ts:106`） |
| 布局过于后台化 | 11 条路由全部是整页模块（`router/nav-config.tsx:45-104`），终端层只是其中一条 |
| 缺插件机制 | 全仓无插件相关抽象 |
| 无 AI 能力 | `Cargo.toml` 无 AI 依赖 |

## 3. 但对设计包的两处修正

### 3.1 UX-2（Keychain 默认）有一个 P0 前置阻断：代码签名

**审查结论**：`tauri.conf.json` 无 `signingIdentity`、无 entitlements；发布工作流也未配置签名身份。当前所有构建是 `adhoc` 签名（实测 `codesign -dv` → `Signature=adhoc`）。

macOS Keychain 条目的 ACL **绑定代码签名身份**。未签名或身份变化的构建会导致：

- 每次重新构建都被重新询问授权
- 用户点「始终允许」不生效
- 身份变更后读不到旧条目

**后果**：如果先做 Keychain 再做签名，用户体验会从「输一次主密码」变成「每次连接弹系统授权框」。**这比现状更差。**

**决策**：UX-2 拆成两步。

| 步骤 | 内容 | 前置条件 |
| --- | --- | --- |
| UX-2a | 凭据交互与状态机（连接时输入、认证成功后保存、内联解锁） | 无 |
| UX-2b | Keychain provider 接入 | **Developer ID 签名落地** |

UX-2a 可以先做，它解决的是「必须提前建 Vault」这个真实痛点，与 provider 无关。

### 3.2 UX-4（Rig）的 MSRV 差距已实测确认

| 项 | 值 | 来源 |
| --- | --- | --- |
| 本项目 `rust-version` | **1.96** | `src-tauri/Cargo.toml:8` |
| `rig-core 0.46.0` 要求 | **1.97.1** | `cargo generate-lockfile` 实测输出 |
| `reqwest` 冲突 | **无** | 两者都是 0.13.x，实测 0.13.5 |
| 1.97.1 下可编译 | **是** | `cargo +1.97.1 check` 退出码 0（本机已装该工具链） |

**决策**：UX-4 前需要一份独立的 MSRV 提升 ADR，覆盖三平台 CI、`Cargo.lock` 全量重解析、以及所有现有依赖在 1.97.1 下的兼容性。**不在设计阶段偷偷升级。**

另有一个成本项：`rig-core 0.46` 引入 **238 个依赖**（含与现有重叠部分）。这对编译时间与 `cargo audit` 基线都有影响，需要在 ADR 里评估。

## 4. 不可破坏的不变量（来自终端审查）

这是本次重构最重要的产出。**每一条都是可测的断言**，违反后的用户可见故障已在审查里定位。

| ID | 不变量 | 违反的后果 |
| --- | --- | --- |
| INV-1 | 全局恰好一个 `[data-terminal-workbench]` 挂载点 | 两个 xterm 抢输出；输入发两遍 |
| INV-2 | 一个 tabId 最多一个 TerminalContainer | 一屏黑；粘贴执行两次 |
| INV-3 | 已挂载 pane 不因切 tab/路由卸载 | 丢滚动历史；严重时后端会话被重建 |
| INV-4 | **终端层永不卸载，只可隐藏** | ACK 中断 → Rust 10 秒后判会话死 |
| INV-5 | 「终端是否可见」只有一个判定源 | 改路由名后 7 处字面量不同步 |
| INV-6 | 布局持久化字段集合不可缺项 | 重启后侧栏/分屏/焦点丢失 |
| INV-7 | 恢复持久化订阅点不可移除 | 每次启动只剩一个本地终端 |
| INV-8 | `prune` 只按完整 tab 集合关闭 | 切 workspace 回来终端全断 |
| INV-9 | tab id 跨恢复稳定 | 旧 id 会话被杀，UI 上消失又出现 |
| INV-10 | 快捷键三层保护同时存在 | `Ctrl+W` 关标签而不是删词 |
| INV-11 | 输入/输出只有一条有序通路 | 输入乱序；ACK 计数不一致 |
| INV-12 | 窄窗口与侧栏由 store + 单一断点驱动 | 切 workspace 后状态不一致 |
| INV-13 | SFTP 主机绑定必须显式 | Dock 钉在 A，切到 B 后目录树串台 |
| INV-14 | SFTP 连接不被「切 tab/关面板」终止 | 上传到一半失败 |
| INV-15 | 启动门禁与恢复编排保持为布局祖先 | 未授权状态下读写数据库；首屏空白 4 秒 |
| INV-16 | `packages/frontend/src` 任何改动都会让证据失效 | 必须按官方流程重采 |

### 4.1 三条最容易被忽略的

**INV-4 不是审美问题，是物理前提。** 终端层用 `invisible` 而非卸载，是因为卸载会停止 ACK；`src-tauri/src/session/terminal_output.rs:440-450` 在 10 秒无 ACK 后返回错误，**后台跑着 `npm install` 的会话会被判死**。这条在前端测试里完全看不出来。

**`data-terminal-workbench` 是 CSS 契约。** 移动端底部安全区靠它抬升（`index.css:351-353`），改属性名会让终端被 BottomNav 遮住 56px。

**`Ctrl+F` 现在就被应用吃掉**（不在 xterm 放行名单）。UX-1 若再把 `Ctrl+P`/`Ctrl+N`/`Ctrl+R` 绑给新功能，会直接破坏 readline —— 而这些键**目前没有任何测试保护**。

## 5. 阶段划分（修订后）

```text
UX-0  设计审查与交付（本文档集）           ← 当前
UX-1  Terminal-first Workspace             （16 条不变量为门禁）
UX-2a 凭据交互与状态机（provider 无关）
UX-2b Keychain provider                    ← 前置：Developer ID 签名
UX-3  Extension API v0（内置插件）
UX-4  Rig AI MVP                           ← 前置：MSRV ADR
```

**与设计包原始顺序的差异**：UX-2 拆成 a/b，UX-2b 增加签名前置；UX-4 增加 MSRV 前置。

## 6. 非目标（明确不做）

- 不复制 Tabby 的密码学实现
- 不修改 `russh`、PTY/XTerm 核心
- 不让 AI 进程持有 SSH 凭据
- V1 不做插件商店、远程代码安装、自动执行命令
- 不删除旧路由，只降级为高级入口

## 7. 判定

```
UX_DESIGN_APPROVED             = PENDING（等用户确认本文档）
KEYCHAIN_DEFAULT_PATH          = BLOCKED（Developer ID 签名未落地）
LEGACY_VAULT_COMPAT            = PASS（读方向；写方向见 01 号文档风险 2）
TERMINAL_CANVAS_DEFAULT        = NOT_IMPLEMENTED
SINGLE_PTY_LIFECYCLE           = PASS（现有，16 条不变量为回归门禁）
```

`TABBY_REPLACEMENT_READY` 保持 **NO** —— 真机与 7 天验收未完成。
