# Terminal 发布就绪规格

> 创建日期：2026-08-09
> 最后验证日期：2026-10-16
> 发布目标：`0.0.1-dev.1`
> 状态：✅ 本机自动发布门禁与多平台安装包验收完成；⚠️ 外部实机项目待执行

## 目标

在不改变现有产品功能和用户数据格式的前提下，将 Terminal 从“功能基本完成”推进到可重复验证的发布候选状态：

1. 前端、Team Server 和 Rust 后端均有可执行、可重复的质量基线。
2. 自动化检查发现的问题全部修复，所有本机可执行检查通过。
3. `AGENTS.md` 规定的生产源码行数限制全部满足。
4. macOS、Windows、Linux 的平台分支经过静态审计；无法在当前设备执行的验证有明确矩阵，不虚报结果。
5. 项目结构、实现状态、遗留项和验证结果在文档中保持一致。

## 假设

- 不做破坏性数据格式或 IPC 变更；允许带旧库迁移和 serde alias 的向后兼容添加式字段。
- 不进行与发布就绪无关的依赖升级；依赖安装使用现有 `pnpm-lock.yaml`。
- 文件拆分优先使用既有模块边界和导出方式，不引入新的状态管理或 UI 框架。
- 当前机器只能证明 macOS 与平台无关逻辑；Windows、Linux、Pageant 和串口硬件结果必须来自真实环境。
- 未经用户明确要求，不创建提交、不推送分支、不修改外部服务数据。

## 技术栈与目录

```text
packages/frontend/     React 19、TypeScript、Vite、Vitest、shadcn/ui
packages/team-server/  NestJS、Prisma、Vitest
src-tauri/             Tauri 2、Rust、russh、russh-sftp
docs/                  项目状态、问题、待办与发布验证记录
```

## 标准命令

### 依赖

```bash
pnpm install --frozen-lockfile
```

### 前端

```bash
pnpm --filter=@terminal/frontend lint
pnpm --filter=@terminal/frontend typecheck
pnpm --filter=@terminal/frontend test
pnpm --filter=@terminal/frontend build:budget
```

### Team Server

```bash
pnpm --filter=team-server exec prisma validate
pnpm --filter=team-server lint
pnpm --filter=team-server typecheck
pnpm --filter=team-server test
pnpm --filter=team-server build
```

### Rust / Tauri

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo check --manifest-path src-tauri/Cargo.toml --locked --all-targets --all-features
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --locked --all-targets --all-features
```

## 代码约束

- 遵循 `AGENTS.md` 的文件行数限制：视图入口 300 行、组件入口 400 行、普通 TSX 200 行、TS 300 行。
- 测试文件、生成文件和第三方产物不计入生产源码行数门禁；`components/ui` 属于仓库生产源码，仍需遵守限制。
- React 组件保持函数组件与现有 hooks 模式；UI 继续使用 shadcn/ui 和语义化 Tailwind 类。
- 拆分只移动职责完整的代码块，公共 API 和导入路径尽量保持稳定。
- Rust 平台代码必须使用 `#[cfg(...)]`，路径和快捷键逻辑不得依赖单一操作系统假设。

## 测试策略

- 行为修复遵循红、绿、重构：先增加可失败的回归测试，再修改实现。
- 纯拆分以现有测试、类型检查和构建结果证明行为保持不变；若覆盖不足，先补测试。
- 每批最多修改约 5 个生产文件，批次结束后运行受影响包的测试、类型检查和构建。
- 最终执行全部标准命令，并记录命令、日期、平台与结果。
- 跨平台实机项目按矩阵逐项记录“通过 / 失败 / 待验证”，不得以静态检查替代实机结果。

## 边界

### 始终执行

- 保留用户已有工作区修改。
- 每批变更后检查文件行数、类型、测试和构建。
- 新增或修复的用户可见文案同步维护中、英、法三语。
- 文档状态只引用已经由代码或命令结果证明的事实。

### 需要单独确认

- 数据库迁移、IPC 破坏性变更、依赖大版本升级。
- 删除功能、改变同步协议或改变认证安全模型。
- 创建提交、推送分支或发布构建产物。

### 禁止

- 删除或跳过失败测试来获得绿色结果。
- 将未执行的 Windows、Linux、Pageant 或硬件测试标记为通过。
- 修改 `node_modules`、Rust `target` 或其他生成目录中的源码。
- 在文档或日志中写入凭据、Token、私钥或用户数据。

## 实施阶段

### 阶段 1：基线

- 安装锁定依赖并记录 Node、pnpm、Rust 工具链。
- 运行全部标准命令，建立失败清单。
- 生成生产源码行数门禁和跨平台验证矩阵。

### 阶段 2：质量门禁修复

- 先修复配置、类型、lint、测试和构建错误。
- 为行为缺陷增加回归测试。
- 建立可重复运行的统一发布检查入口。

### 阶段 3：文件拆分

- 按依赖从低到高拆分：纯工具与类型、服务、store/hooks、组件与视图。
- 每批保持公共接口稳定并执行局部与全量检查。
- 门禁脚本最终报告零个超限生产文件。

### 阶段 4：跨平台与文档

- 审计平台检测、快捷键、SSH Agent、PTY、串口和路径处理。
- 修复可在本机通过静态或单元测试证明的问题。
- 建立并同步实机矩阵，未执行项保持“待验证”。

## 完成标准

- [x] 锁定依赖可安装，lockfile 仅包含清单与安全覆盖产生的预期变化。
- [x] 前端 lint、typecheck、test、build 与 bundle budget 全部通过。
- [x] Team Server Prisma validate、lint、typecheck、test、build 全部通过。
- [x] Rust fmt、check、clippy、test 全部通过且无警告。
- [x] 生产源码行数门禁报告零个超限文件。
- [x] 跨平台代码审计完成，实机验证矩阵已建立并如实标记已验证与待验证项。
- [ ] `AGENTS.md`、`docs/project.md`、`docs/issue.md`、`docs/todo.md` 在当前源码证据和外部实机结果全部更新后再标记一致；当前仍有锁屏 macOS 复验及跨平台硬件项目待完成。
- [x] 最终差异审查与 `git diff --check` 复核。

## 2026-08-11 验证结果

**环境**：macOS 15.7.7、Node.js 24.16.0、pnpm 10.34.3、Rust/Cargo 1.96.0。

| 门禁 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | ✅ 锁文件可重复安装，Prisma Client 7.9.1 生成成功 |
| `pnpm audit --registry=https://registry.npmjs.org --prod --audit-level high` | ✅ No known vulnerabilities found |
| 前端 | ✅ 31 个测试文件、408 项测试；lint/typecheck/build:budget 通过 |
| Team Server | ✅ 25 个测试文件、95 项测试；Prisma validate/lint/typecheck/build 通过 |
| Rust | ✅ 45 项测试；fmt/check/Clippy `-D warnings` 通过 |
| Bundle | ✅ 初始 gzip 227.36 KB / 240 KB，总 gzip 510.09 KB / 550 KB，最大 JS chunk raw 390.87 KB / 500 KB |
| 源码规模 | ✅ 447 个前端/Team Server 生产 TS/TSX 文件，0 个超限 |
| Docker | ⚠️ 当前机器没有 `docker` 命令，未声称本地镜像或 Compose 通过 |
| GitHub Actions | ✅ 提交 `83cd4e8` 的 CI `31409070480` 全绿：三平台 Tauri 编译、PostgreSQL 迁移和 Docker 镜像构建通过 |

## 2026-08-12 v0.0.1-dev.1 验证结果

**发布提交**：`412136d`，标签 `v0.0.1-dev.1` 解析到同一提交。

| 门禁 | 结果 |
| --- | --- |
| 本机 `pnpm verify` | ✅ 前端 411 项、Team Server 95 项、Rust 45 项测试通过；lint、typecheck、build budget、Clippy 与 453 个生产源码文件行数门禁通过 |
| Push CI | ✅ 工作流 `31553345929` 全绿：前端、Team Server、Rust、Docker 镜像、PostgreSQL 迁移及 macOS/Windows/Linux Tauri 编译通过 |
| Pull Request CI | ✅ 工作流 `31553348495` 全绿，独立重复同一提交的完整门禁 |
| Release | ✅ 工作流 `31554163901` attempt 2 全绿，六个原生 runner 打包任务和最终资产校验通过 |
| Release 资产 | ✅ 8 个安装包与 `SHA256SUMS.txt` 均非空；清单 8 行与 GitHub 服务端 SHA-256 digest 逐项一致 |

Release 首次执行的六个平台打包任务均成功，最终校验调用 `gh release download` 时短暂返回 `release not found`；仅重跑失败 job 后校验成功，未重新构建或替换安装包。

## 安装包发布门禁

`.github/workflows/release.yml` 只接受现有语义版本标签，校验标签提交以及 `package.json`、`tauri.conf.json`、`Cargo.toml` 三处版本一致后，向同一 prerelease 上传以下资产：

| 系统 | 架构 | 原生 runner | 目标 | 资产 |
| --- | --- | --- | --- | --- |
| macOS | Apple Silicon | `macos-15` | `aarch64-apple-darwin` | DMG |
| macOS | Intel | `macos-15-intel` | `x86_64-apple-darwin` | DMG |
| Windows | ARM64 | `windows-11-arm` | `aarch64-pc-windows-msvc` | NSIS EXE |
| Windows | x64 | `windows-latest` | `x86_64-pc-windows-msvc` | NSIS EXE |
| Linux | ARM64 | `ubuntu-24.04-arm` | `aarch64-unknown-linux-gnu` | AppImage、DEB |
| Linux | x64 | `ubuntu-24.04` | `x86_64-unknown-linux-gnu` | AppImage、DEB |

工作流要求八个安装资产全部存在且大小大于 0，随后下载同一批资产生成 `SHA256SUMS.txt`。资产命名为 `Terminal_<version>_<platform>-<arch>`，Windows NSIS 额外带 `-setup` 后缀。`tauri-action` 的 updater JSON 和 updater signature 上传已关闭，因为项目尚未配置 updater 签名密钥。

**历史发布证据**：Release 工作流 `31431531040` 全绿，标签 `v0.0.1-dev.0` 指向提交 `6965f3a`。GitHub Release API 返回以下非空资产；8 个安装包的服务端 SHA-256 digest 与 `SHA256SUMS.txt` 逐项一致。

| 资产 | 字节 | 大小 |
| --- | ---: | ---: |
| `Terminal_0.0.1-dev.0_macos-aarch64.dmg` | 11,292,978 | 10.77 MiB |
| `Terminal_0.0.1-dev.0_macos-x86_64.dmg` | 11,830,964 | 11.28 MiB |
| `Terminal_0.0.1-dev.0_windows-aarch64-setup.exe` | 6,770,726 | 6.46 MiB |
| `Terminal_0.0.1-dev.0_windows-x86_64-setup.exe` | 7,626,056 | 7.27 MiB |
| `Terminal_0.0.1-dev.0_linux-aarch64.AppImage` | 84,855,304 | 80.92 MiB |
| `Terminal_0.0.1-dev.0_linux-aarch64.deb` | 13,180,004 | 12.57 MiB |
| `Terminal_0.0.1-dev.0_linux-x86_64.AppImage` | 86,735,352 | 82.72 MiB |
| `Terminal_0.0.1-dev.0_linux-x86_64.deb` | 13,235,590 | 12.62 MiB |
| `SHA256SUMS.txt` | 862 | 0.84 KiB |

**当前发布证据**：Release 工作流 `31554163901` attempt 2 全绿，标签 `v0.0.1-dev.1` 指向提交 `412136d`。Release 为已发布的 prerelease、非草稿；以下 8 个安装包与校验清单均非空，清单中的 SHA-256 与 GitHub 服务端 digest 逐项一致。

| 资产 | 字节 | 大小 |
| --- | ---: | ---: |
| `Terminal_0.0.1-dev.1_macos-aarch64.dmg` | 11,298,182 | 10.77 MiB |
| `Terminal_0.0.1-dev.1_macos-x86_64.dmg` | 11,836,800 | 11.29 MiB |
| `Terminal_0.0.1-dev.1_windows-aarch64-setup.exe` | 6,774,711 | 6.46 MiB |
| `Terminal_0.0.1-dev.1_windows-x86_64-setup.exe` | 7,623,977 | 7.27 MiB |
| `Terminal_0.0.1-dev.1_linux-aarch64.AppImage` | 84,843,016 | 80.91 MiB |
| `Terminal_0.0.1-dev.1_linux-aarch64.deb` | 13,184,794 | 12.57 MiB |
| `Terminal_0.0.1-dev.1_linux-x86_64.AppImage` | 86,735,352 | 82.72 MiB |
| `Terminal_0.0.1-dev.1_linux-x86_64.deb` | 13,230,012 | 12.62 MiB |
| `SHA256SUMS.txt` | 862 | 0.84 KiB |

当前开发版没有 Apple Developer ID/notarization 或 Windows Authenticode 配置。DMG 与 NSIS 构建成功只能证明可打包，Release 说明必须明确“macOS 未公证、Windows 未签名”。Linux/Windows runner 通过也不能替代 Issue #39 的 Pageant、PTY、Jump Host、快捷键与串口硬件实机矩阵。

## 实机验证矩阵

> ⚠️ 下表的状态列冻结于 2026-10-17/10-24 的历史快照，其中标注「当前源码待重采」的条目已在 2026-10-28 重采。**当前状态以《2026-10-28 当前源码实机证据状态》一节为准**（debug 冷启动、远程 prompt、13-case SSH、shell 14+7 全绿；release 冷启动/远程 prompt/shell 矩阵通过；仅 release 10-case 认证矩阵待解锁采集）。

| 场景 | 环境 | 当前状态 | 通过标准 |
| --- | --- | --- | --- |
| macOS 自动门禁 | macOS 15.7.7 | ✅ 通过 | `pnpm verify` 全绿 |
| macOS 本地 Tauri/PTY 初次 smoke | macOS 15.7.7 arm64 | ✅ 通过 | 8 MiB 输出、10 轮 session、连续四步 resize（132×43→90×30→120×40→97×31）精确回读、尾部可见、资源回收；Node 24.16.0 下首次连接 1612ms，总耗时 7639ms |
| macOS 本地 Tauri/PTY 重连 smoke | macOS 15.7.7 arm64 | ✅ 通过 | 11 个唯一 session、旧输出拒绝、连续四步 resize 精确回读、重连可见、资源回收；Node 24.16.0 下首次连接 1441ms，总耗时 8586ms |
| macOS 应用冷启动（AX request-to-ready） | macOS 15.7.7 arm64 | ✅ 观测通过 | 既有三次 Local/Connected/Terminal input/zsh prompt readiness 为 4477–5840ms；该观测包含 UI automation 请求开销 |
| macOS release bundle 冷启动窗口 readiness             | macOS 15.7.7 arm64                            | 🟡 历史窗口观测，严格证据待重采                                                                            | 旧 release 记录的 AX 数值属于 `readyAt: window`；历史 bundle hash `ab209317…` 与当前磁盘上的 no-bundle 产物 `60753136…` 不同，门禁不接受它们互相代表。解锁 macOS 后需对当前源码重新构建 bundle，并用 `pnpm smoke:local-cold-start` 重采至少三次 `readyAt: terminal`。旧记录见 [`2026-10-11-macos-release-terminal-gate.json`](verification/2026-10-11-macos-release-terminal-gate.json) |
| macOS debug binary 冷启动窗口 readiness               | macOS 15.7.7 arm64                            | 🟡 历史窗口观测，严格证据待重采                                                                            | 旧 instrumented debug binary `4368d6c8…` 的 4768/4146/4464ms 只证明 `readyAt: window`；当前源码指纹为 `77c02c87…`，证据门禁已拒绝旧指纹及缺少 terminal marker 的 JSON。解锁 macOS 后需重建并采集严格 `readyAt: terminal` 结果。旧记录见 [`2026-10-11-macos-cold-start-current.json`](verification/2026-10-11-macos-cold-start-current.json) |
| macOS 真实 SSH 认证与重连（release） | macOS 15.7.7 arm64 + OpenSSH/ssh-agent/Docker | 🟡 历史 10/10 通过，当前 binary 待重采 | 历史 bundle `ab209317…` 的 10 case 结果保留为历史记录；当前磁盘 no-bundle 产物 `60753136…` 哈希不同，且由 Phase 6.99 之前源码构建，不能作为当前证据。解锁后需基于当前源码重建并在同一 release bundle 上复跑 SSH 与冷启动矩阵。旧记录见 [`2026-10-11-macos-release-ssh-matrix.json`](verification/2026-10-11-macos-release-ssh-matrix.json) |
| macOS 真实 SSH 认证与重连（debug）                    | macOS 15.7.7 arm64 + OpenSSH/ssh-agent/Docker | 🟡 历史结果，当前源码待重采                                                                      | 旧 instrumented debug binary `4368d6c8…` 的 13/13 结果仍保留为历史上下文；当前源码指纹为 `77c02c87…`，旧 JSON 缺少严格 case success 标记，证据门禁拒绝它作为当前证据。解锁后需重建并重跑完整 13 case。旧记录见 [`2026-10-11-macos-ssh-matrix-current.json`](verification/2026-10-11-macos-ssh-matrix-current.json) |
| macOS 真实 SSH 应用冷启动到远端 shell prompt observed | macOS 15.7.7 arm64 + localhost OpenSSH        | 🟡 历史结果，当前源码待重采                                                                | 旧 instrumented debug binary `4368d6c8…` 的 2742ms marker 结果只代表此前源码；当前源码指纹为 `77c02c87…`，证据门禁拒绝旧指纹。解锁后需重建并复跑远端 prompt marker。旧记录见 [`2026-10-11-macos-remote-shell-prompt-rerun.json`](verification/2026-10-11-macos-remote-shell-prompt-rerun.json) |
| SSH host-key 预检瞬时网络错误与配置变更 | 前端 hook / Tauri IPC | ✅ 共享预算自动化通过，实机待验收 | timeout、连接 reset/refused/closed、DNS/no-route、transport closed 及 Windows Winsock 10054/10060/10061/11001 按 250ms/1s/3s 有界重试；host key changed、凭据拒绝和非超时 known_hosts 错误 fail-closed；host/jump route key 变化会撤销旧 ready。direct/jump preflight 与首次 SSH session create 共用一条前端单调 10 秒预算，Rust 预检/建连分别受 8 秒/9 秒 cap；跨进程传递预留 100ms margin，剩余毫秒在传给 Rust `u64` IPC 前向下取整。Windows/macOS 真实 VPN/DNS/路由切换、Jump Host 和当前源码 GUI 矩阵仍待验收 |
| 本地 PTY 跨 CPU 挂起/恢复 | macOS 15.7.7 arm64 | ✅ 观测通过 | `/bin/zsh -i` 经 SIGSTOP 2.5s 后 SIGCONT，同一算术标记命令前后均正常返回，据此本地会话才被排除在唤醒恢复之外；真实合盖与电源管理切换仍待实机观测 |
| 远程 SSH Shell Integration（显式 host opt-in）        | macOS localhost OpenSSH                       | ✅ bash loopback 通过                                                              | `off` 默认不注入；选择 `bash`/`zsh` 时发送 guarded integration script 并保留 startup command。当前 instrumented binary `4368d6c8…` 的 bash prompt marker 为 2742ms；另有默认 `/bin/sh` 真实 SSH shell 交互 7/7，全过程不冒充 bash/zsh integration 证据；fish/zsh 远程 prompt、未知 shell、tmux/screen 和 Windows 仍待负向/跨平台矩阵                                                                                                       |
| 远程 SSH 用户冷启动到可输入 prompt | macOS 远端服务 | ✅ marker round-trip 已观测 | prompt marker 已穿过 xterm 输入、Tauri IPC、SSH PTY 与输出链路；当前 fixture 自行发 OSC 133，不能代替 per-host injection 验收；人工可视/物理键盘矩阵仍待验收 |
| macOS 真实 Tauri/PTY raw input | macOS 15.7.7 arm64 | ✅ 3/3 通过 | SGR mouse、bracketed paste、raw X10 均有严格 hex 回读结果；记录见 [`2026-10-10-macos-raw-input.json`](verification/2026-10-10-macos-raw-input.json) |
| macOS 真实 Tauri/PTY shell 交互（release） | macOS 15.7.7 arm64 | ✅ 3/3 通过 | release bundle 上 `cat-eof`、readline history、readline Tab 补全分别 289/212/374ms，证据见 [`2026-10-11-macos-release-ssh-matrix.json`](verification/2026-10-11-macos-release-ssh-matrix.json) |
| macOS 真实 Tauri/PTY shell 交互（debug）              | macOS 15.7.7 arm64                            | 🟡 历史结果，当前源码待重采                                                                      | 旧 binary `4368d6c8…` 上 bash/zsh 各七 case 的 14/14 自动输入结果保留为历史上下文；当前源码指纹为 `77c02c87…`，旧 JSON 未满足严格 case success contract。解锁后需重建并重跑 bash/zsh 与真实 SSH shell matrix。旧记录见 [`2026-10-11-macos-shell-interaction-current.json`](verification/2026-10-11-macos-shell-interaction-current.json) |
| macOS 人工物理键盘与中文 IME | macOS WKWebView + 物理键盘 | ⚠️ 待人工 | 30 轮重叠 `a/s/d`、中文 IME composition、Option/dead key；Ctrl+C、vim、nano、PTY resize 已有自动化覆盖但仍缺真人物理键盘确认 |
| 产品 host-wake 生命周期恢复                           | macOS WKWebView                               | ✅ 代码与定向测试通过，实机待验收                                                  | `useTerminalHostWake` 增加 15 秒 wall-clock 漂移检测，并监听 `pageshow`/`document.resume`；hook 定向测试 6/6。真实合盖、VPN/蜂窝切换仍待实机                                                                                                                                                                                                                                                                                               |
| Windows OpenSSH Agent | Windows 10/11 | ⚠️ 待实机 | 单/多 key 登录、无 key、服务未启动和错误管道均符合预期 |
| Pageant | Windows 10/11 + Pageant | ⚠️ 待实机 | `russh` Pageant transport 可登录，未运行时返回明确错误 |
| Jump Host | Windows / Linux | ⚠️ 待实机 | 跳板端与目标端 password/key/agent/cert 组合、加密私钥、断开与连接池复用正确 |
| 本地 PTY | Windows / Linux | ⚠️ 待实机 | 从用户主目录启动，输入/resize/EOF/关闭状态正确 |
| 串口 | macOS / Windows / Linux + 硬件 | ⚠️ 待实机 | 精确写入、主动断开、运行中拔线均清理 session |
| 快捷键 | Windows / Linux / 非美式键盘 | ⚠️ 待实机 | 不覆盖系统快捷键，`Ctrl+Shift+\` 可触发垂直分屏 |
| Team Server 容器 | Docker Desktop 29.7.2 + PostgreSQL 16.15 | ✅ 本机 Compose 生命周期通过：迁移、health/readiness、SIGTERM 与重启恢复均符合预期 | Compose 启动后 closed/token/open、迁移、`/api/v1/health/ready` 与关停钩子通过 |
| Tauri 三平台编译 | macOS / Ubuntu / Windows CI | ✅ CI `31553345929` 与 `31553348495` 三平台通过 | `.github/workflows/ci.yml` 三平台 `tauri build --no-bundle --ci` 通过 |
| Release 安装包 | 六个原生 GitHub runner | ✅ `v0.0.1-dev.1` 工作流 `31554163901` 全绿；8 个安装包与 checksum 已核验 | 八个安装资产非空且系统/架构命名正确，`SHA256SUMS.txt` 可校验 |
| S3 服务端集成 | AWS S3 或兼容服务 | ⚠️ 待外部服务 | 固定向量之外，验证实际签名、UTF-8 key、分页列表、上传下载与删除 |
| Agent forwarding | 全平台 | ⚠️ 代码完成，待实机 | 默认关闭；opt-in 时显式请求；未授权主动 channel 被拒绝；池内启用/禁用连接隔离 |
| Team 注册准入 | Docker / PostgreSQL | ✅ 自动化与容器运行均通过 | 生产默认 closed；错误 token 不新增用户；正确 token/open 可注册；缺失/非法环境配置拒绝启动 |

## 当前源码实机证据重采顺序（runbook）

证据门禁把 `scripts/check-verification-evidence.mjs` 与全部产品源码纳入源码指纹（见 `FINGERPRINT_PATHS`），所以顺序不能颠倒：先采集、后改代码，会让刚采的证据被自己的编辑作废。

1. **冻结源码**：所有 fingerprinted 路径的改动先落完（`packages/frontend/src`、`src-tauri/src`、`scripts/run-*.mjs`、门禁脚本本身等）。
2. **重建 debug 产物**：`VITE_TERMINAL_SMOKE_BUILD=1 pnpm tauri build --debug --no-bundle`。两个前提缺一不可：必须是内嵌前端的产物（裸 `cargo build` 的二进制会读 `build.devUrl`，渲染空白窗口并 fail-closed），并且必须带 `VITE_TERMINAL_SMOKE_BUILD=1`——smoke/probe 入口与 experiments 导航项只有 smoke 构建才编进前端，普通构建的二进制会被 `scripts/run-terminal-smoke.mjs` 显式拒绝。release 侧同理用 `VITE_TERMINAL_SMOKE_BUILD=1 pnpm tauri build --no-bundle`。记录两个产物的 `sha256`。
3. **先改门禁再采集**：把上一步的哈希写进 `scripts/check-verification-evidence.mjs` 的 `PROFILE_REVIEWED_HASH['debug']`。这一步本身会改变源码指纹，因此必须排在采集之前。
4. **采集 debug 证据**（同一个 binary，中途不得重链接或重构建）：
   - `pnpm smoke:local-cold-start -- --app-path $PWD/src-tauri/target/debug/terminal` ×3 → `2026-10-11-macos-cold-start-current.json` 的 `measurement.terminalRuns` 需要 3 条 `readyAt: terminal`、`terminalReady: true`、`spawnToReadyMs ≤ 10000`。
   - `pnpm smoke:ssh-matrix --reuse-binary` → 13 个 case 且名称顺序与门禁的 `DEBUG_SSH_CASES` 完全一致。
   - `pnpm smoke:shell-probe:matrix -- cat-eof,readline-history,readline-tab,vim-edit,nano-edit,pty-resize,ctrl-c-interrupt` → bash/zsh 各 7 共 14/14；再按同一 case 列表跑真实 SSH 7/7。
   - `pnpm smoke:remote-cold-start -- --app-path $PWD/src-tauri/target/debug/terminal` → `measurement.markerReady: true`。
5. **采集 release 证据**：`pnpm tauri build` 后记录 release 产物哈希，再用 `pnpm smoke:cold-start`（3 次 terminal marker）与 release SSH 矩阵（10 个 case）产出两份 release 证据。门禁会把 release 证据与磁盘上的 `src-tauri/target/release/terminal` 哈希逐一对齐。
6. **最后跑 `pnpm verify`**：`source` 分组必须全绿。若仍报 fingerprint 不一致，说明第 1 步被破坏（采集期间又改了源码），必须回到第 2 步重来。

证据 JSON 里的 `source.fingerprint`、`binary.sha256`、`measurement.*` 必须来自 runner 的真实输出，禁止手改或用历史数值填充。

### 六份证据的必填字段（门禁实际校验的部分）

| 证据文件 | 必须成立 |
| --- | --- |
| `2026-10-11-macos-cold-start-current.json` | `kind = tauri-process-cold-start-stopwatch-current-worktree`；`measurement.terminalRuns` ≥3 且每条 `readyAt: 'terminal'`、`terminalReady: true`、`0 ≤ spawnToReadyMs ≤ 10000`；`source.fingerprint` = 当前指纹 |
| `2026-10-11-macos-remote-shell-prompt-rerun.json` | `kind = tauri-remote-cold-start-shell-prompt-observed-rerun`；`measurement.markerReady: true` 且 `0 ≤ spawnToPromptObservedMs ≤ 10000`；`source.fingerprint` = 当前指纹 |
| `2026-10-11-macos-ssh-matrix-current.json` | `allCasesPassed: true`，`cases` 名称顺序与门禁 `DEBUG_SSH_CASES`（key、key-reconnect、key-outage-reconnect、key-outage-wake-reconnect、key-first-connect-outage、password、password-reconnect、agent、agent-reconnect、cert、cert-reconnect、jump、jump-reconnect）完全一致且每条 `ok: true` |
| `2026-10-11-macos-shell-interaction-current.json` | `matrixRunsExecuted = matrixRunsPassed = 14`、`cases` 中 bash 与 zsh 各自的 case 序列等于 `SHELL_PROBE_CASES` 且全部 `ok: true`；`sshRunsExecuted = sshRunsPassed = 7`、`sshCases` 序列等于 `SHELL_PROBE_CASES` 且全部 `ok: true`；`allCasesPassed: true` |
| `2026-10-11-macos-release-terminal-gate.json` | `kind = tauri-release-ten-second-terminal-gate`；`local.terminalRuns` ≥3 且每条 terminal-ready、`spawnToReadyMs ≤ 10000`；记录里的二进制哈希必须等于磁盘 `src-tauri/target/release/terminal` |
| `2026-10-11-macos-release-ssh-matrix.json` | `kind = tauri-release-ssh-and-shell-matrix`；`sshMatrix.passed = 10`、`failed = 0`，`cases` 名称顺序等于门禁 `RELEASE_SSH_CASES` 且全部 `ok: true`；二进制哈希同上 |

`SHELL_PROBE_CASES` 顺序为：cat-eof、readline-history、readline-tab、vim-edit、nano-edit、pty-resize、ctrl-c-interrupt。

## 2026-10-28 当前源码实机证据状态

源码 fingerprint `04bb5973…`（Phase 6.104 修复提交 `52c8cf8` 与门禁复核哈希固定提交 `94ed89c` 之后的工作树），插桩产物 debug `d7a4dd4c…`、release `1e68ba73…`。

| 场景 | 结果 | 实测 |
| --- | --- | --- |
| debug 本地冷启动（三次） | ✅ 通过 | 6654 / 2127 / 1225 ms，均 `readyAt: terminal` |
| 远程 bash prompt 冷启动 | ✅ 通过 | 4575 ms（loopback sshd 的 OSC 133 marker 往返） |
| debug 真实 SSH 13-case 矩阵 | ✅ 13/13 | 首连 985–9125 ms；outage/wake 重连 14.3–23.9 s；每 case 10–11 个唯一 session |
| bash/zsh shell 交互矩阵 | ✅ 14/14 | 单例 218–1071 ms |
| 真实 SSH shell 矩阵 | ✅ 7/7 | 单例 501–1071 ms |
| release 本地冷启动（三次） | ✅ 通过 | 1827 / 1319 / 1421 ms，均 `readyAt: terminal` |
| release 远程 prompt 冷启动 | ✅ 通过 | 3069 ms，锁屏状态下也可测量（该 runner 不需要窗口激活） |
| release shell 矩阵 | ✅ 14/14 + 7/7 | 本地 bash/zsh 14 例与真实 SSH 7 例，同样在锁屏下完成 |
| release 真实 SSH 10-case 认证矩阵 | ✅ 10/10 | 解锁后一次整跑全绿：首连 775–4214 ms，每 case 10–11 个唯一 session；binary `1e68ba73…`。命令为 `pnpm smoke:ssh-matrix --reuse-binary --release key,key-reconnect,password,password-reconnect,agent,agent-reconnect,cert,cert-reconnect,jump,jump-reconnect` |

`2026-10-11-macos-release-ssh-matrix.json` 因此仍是旧构建（`ab209317…`）的历史记录，`pnpm verify` 的 source 分组会继续以这两条报错退出。补齐方式：

```bash
pnpm smoke:ssh-matrix --reuse-binary --release key,key-reconnect,password,password-reconnect,agent,agent-reconnect,cert,cert-reconnect,jump,jump-reconnect
```

注意 `--release` 默认跑的是 13-case 全集，而证据契约要求的是上面这 10 个且顺序一致，所以必须带位置过滤。采集时显示器必须处于解锁状态且没有其它 GUI 自动化在跑，否则会出现 `expected process X to be frontmost, got <loginwindow pid>`。

2026-10-28 23:25–00:16 挂过一个「解锁即跑」的无人值守作业，99 次检查全部为锁屏后按上限退出；02:16–05:37 的 v2 作业再检查 200 次仍锁屏后退出。最终在 07:24 解锁窗口内一次整跑 10/10 全绿，证据落盘后 `check-verification-evidence.mjs` 从「2 项失败」变为 **passed for 6 current evidence file(s)**。

**仍需人在场的验收**（自动化不能替代）：macOS 物理键盘 30 轮重叠输入、中文 IME 组合输入、Option/dead key；真实合盖休眠与唤醒、VPN/蜂窝切换；Windows OpenSSH Agent/Pageant/ConPTY、Linux 桌面 PTY 与串口硬件。

## 2026-10-17 当前工作树复验

- ✅ 产品 host-wake hook 已增加 timer 漂移与 Page Lifecycle 兜底；定向 Vitest 6/6 通过。该修复尚未在解锁的 WKWebView、真实合盖或网络切换上复验。

- ⚠️ 2026-10-18 复跑同一 `08ba7338…` binary 的普通 outage、wake outage、首连 outage 全部超时；wake case IPC 事件只到 6673ms。已新增独立 loopback renderer heartbeat 与 visibility/focus 观测，相关前端/Node/Rust 定向测试通过，尚未完成新 binary 的 WKWebView 复验。此前 3/3 通过记录不能作为当前无回归结论。

- 🟡 host-wake timer 增量诊断：instrumented binary `08ba73384672cf39eb0f3cdc97de622ba6fa370aca69cd6f498f3dd8fb22cff4` / source fingerprint `941f7253cff716c624338d1a2b956c91773c8a2c020c22650fa5984d6caf5ed6` 上，`key-outage-reconnect`、`key-outage-wake-reconnect`、`key-first-connect-outage` 3/3 通过。一次 wake run 在相对 elapsed 5.387 秒后出现约 57 秒无 timer 事件，随后于 64.286 秒发布 checkpoint；同 binary 复跑 wake case 为 21.492 秒。记录见 [`2026-10-17-macos-host-wake-timer-diagnostic.json`](verification/2026-10-17-macos-host-wake-timer-diagnostic.json)。renderer heartbeat 的周期上报走独立 loopback `fetch`，只有初始配置 `invoke` 与 host-wake checkpoint 共用 Tauri IPC；该诊断仍不是完整 SSH 矩阵、冷启动或发布证据。

- ⚠️ 当前 instrumented debug binary `4368d6c8…`（源码指纹 `de8e49cb…`）的本地冷启动三次为 4768/4146/4464ms，报告的是 `readyAt: window`（Local/Connected/Terminal input AX 条件）；远程 bash prompt marker 2742ms 才报告 `readyAt: terminal`。两者均低于 10 秒，但不能把前者单独称为可靠 shell ready。对应证据为 [`2026-10-11-macos-cold-start-current.json`](verification/2026-10-11-macos-cold-start-current.json) 与 [`2026-10-11-macos-remote-shell-prompt-rerun.json`](verification/2026-10-11-macos-remote-shell-prompt-rerun.json)。
- ✅ 同一已审 release binary `ab209317…` 的 2026-10-13 单次复验再次通过：本地 spawn→readiness 为 4973ms，远程 SSH prompt marker 为 3627ms；记录见 [`2026-10-13-macos-release-cold-start-rerun.json`](verification/2026-10-13-macos-release-cold-start-rerun.json)。
- ✅ `pnpm smoke:ssh-matrix --reuse-binary` 在同一 binary 上 13/13 全绿，包含 5 秒 outage、20 秒 `key-outage-wake-reconnect` 和首连 outage（首次连接 9629ms）；wake case 覆盖重连退避、stale output 拒绝与资源回收。完整记录见 [`2026-10-11-macos-ssh-matrix-current.json`](verification/2026-10-11-macos-ssh-matrix-current.json)。
- ⚠️ 重新采集证据时，`jump` 在 `c35ae453…` 上因主机负载失败过一次：报错说 10 秒内未连接，而 READY 标记已在输出中、状态已是 connected；那一轮所有用例耗时约为平时两倍。单独重跑 `jump` 通过（1077ms），干净重跑完整矩阵也通过（1256ms）。判定为主机负载而非回归，两次运行都记在证据文件里，没有被静默丢弃。
- ✅ local PTY shell 交互七个 case 在 bash 与 zsh 上 14/14 全绿，同七个 case 经真实 loopback sshd 默认 `/bin/sh` fixture 为 7/7 全绿。这些输入由 `term.input()` 自动注入，不替代真人物理键盘、中文 IME 或 Option/dead key 验收。
- ⚠️ 这些 macOS 复验发生在 dirty worktree；最近 real-machine run `38997341490` 的三平台 job 通过，但没有覆盖当前未提交改动。Windows OpenSSH Agent/Pageant/ConPTY、串口硬件、真实合盖睡眠/唤醒与 VPN/蜂窝切换仍未取得本轮实机证据。
- ✅ bash Shell Integration 不再安装 `DEBUG` trap（Issue #96）：`trap ... DEBUG` 在 bash 里整体替换而非叠加，实测两种顺序都会静默顶掉用户 `.bashrc` 自带的 trap 或让 `133;B` 消失。改为只靠 `PROMPT_COMMAND` 发 `133;D;$?`/`133;A`/OSC 7，真实 bash PTY 上用户 trap、`133;D;0`、`133;D;1`、`133;A` 与 OSC 7 同时存在；zsh 的 `add-zsh-hook` 本就叠加，用户 precmd 与 `133;B` 共存。bash 下 `command-start`/`command-output` 不再产生，因为只写入无消费者的 phase 字段。
- ✅ OSC 133 退出码接入终端面板头部（Issue #97）：`lastExitCode` 此前只写不读，`snapshot()` 在生产代码里零调用点，命令失败对用户不可见。现在成功显示绿色状态、非零显示退出码与 `text-destructive`；**没有信号时不渲染**，避免把「没观测到」误报成成功。
- ✅ Issue #99 的远程 SSH Shell Integration 已按主机显式 opt-in 接线并完成 bash loopback 证据：默认 `off`，仅选择 `bash` 或 `zsh` 时组合 guarded script；zsh startup 等待首个 shell 输出，marker 探针处理 OSC 同 chunk。当前记录未单独采集 zsh prompt stopwatch；fish/sh/未知 shell、tmux/screen 和 Windows shell 仍未取得证据。
- ⚠️ 曾在宿主负载 13–25 时采集到一轮失败的 SSH 矩阵；判定为宿主负载而非回归，该轮测量**未**沿用。当前证据文件记录的是随后完成的 13/13 干净一轮。
- ✅ 首次连接失败现在与断线共用同一套自动重连预算（Issue #98）：此前自动重连只由 I/O 错误路径触发，而该路径要求已有 sessionId，从未建立起来的连接没有 sessionId，因此首次握手失败完全不进重连循环、面板永久停在 error。现在可重试的首次远程失败会消耗指数退避预算；认证/host key 等不可重试失败不消耗预算，本地 PTY 与串口不参与自动重连。除状态机注入测试外，真实 SSH smoke 让 sshd 在应用启动前不可达 6 秒，当前二进制在 9629ms 自行建立首个连接并完成 10 个 session；随机握手丢包、VPN/DNS 尚未就绪仍需 macOS 实机验证。
- ✅ 首次连接 outage 已加入真实 SSH smoke：本轮 runner 在旧 sshd 完全停止后才启动应用；sshd 在应用启动前保持不可达 6 秒，当前 instrumented binary 在 9629ms 建立首个连接并完成 10 个 session，证明首次失败重试走的是实际 Tauri → russh → OpenSSH 链路。

## 2026-10-14 Windows shell dialect CI 覆盖

- ✅ `.github/workflows/real-machine-matrix.yml` 新增 `windows-shell-matrix` job，在 `windows-latest` 原生 runner 上用真实 ConPTY 分别执行 PowerShell（`cat-eof,pty-resize,ctrl-c-interrupt`）与 cmd（`cat-eof,ctrl-c-interrupt`）dialect。Windows dialect 只能在这两个命令行上解析，此前的 CI 完全没有对应 job，意味着这两种命令语言会未经执行就发布。
- ✅ shell 探针 runner 的 `--shells` 校验已接入 `SUPPORTED_WINDOWS_SHELLS`，并在 dialect 未声明某用例时 fail-fast，避免运行结果小于请求范围却被当成完整运行。未在 `dialect-cases.ts` 声明的用例仍拒绝运行。
- ✅ workflow 契约测试比对 Windows job 的用例过滤串与前端 `DIALECT_CASES`，两侧不一致只会表现为数分钟后的 Windows CI 失败，因此前置到本地门禁。
- ⚠️ 该 job 尚未在远端 runner 上 dispatch 成功执行；在拿到 runner 输出前，不能声称 Windows shell dialect 已验证。Windows OpenSSH 服务、Pageant 与串口硬件仍需已安装服务或外接硬件的实机环境，hosted runner 无法覆盖。
- ✅ 本机真实 PTY 复验（instrumented debug 二进制）：默认 shell 四个 case 全绿——`cat-eof` 479ms、`readline-history` 254ms、`pty-resize` 1348ms、`ctrl-c-interrupt` 1028ms；显式 `--shells bash` 路径同样通过（438ms / 1319ms）。这证明本轮改动过的 matrix runner 在真实执行路径上可用，但不能证明 Windows dialect——本机没有 PowerShell，`--shells powershell` 按预期以「executable unavailable」拒绝而非静默换用别的 shell。
- ✅ 参数层 fail-fast 在真实 CLI 上确认：未知 shell 报 `unknown shell probe shell 'nope'; expected one of bash/zsh/fish/powershell/cmd`，未知 case 报出七个合法 case 名。

## 2026-10-09 输入与 IME 增量

- `@baicie/xterm` 组合态 Escape 修复已同步到补丁脚本、patch 和 lockfile；组合态取消不再向 PTY 发送 Escape，定向 xterm 测试 8/8 通过。
- 输入探针诊断和脚本契约现在要求真实 composition 生命周期；Apple Pinyin 的 CGEvent 自动注入复验未产生 composition 事件，故中文 IME 三个场景保持待人工物理键盘验证。不能用该自动注入结果替代 IMK 验收。
- Node 24.16.0 下前端 104 文件/888 项、Team Server 103 项、Rust 181+3 项、Node 脚本 56 项，以及 lint/typecheck/build budget/fmt/Clippy/511 文件规模和 `git diff --check` 全部通过。

## 2026-10-11 真实 SSH 矩阵复跑

- ✅ `PATH=/Users/liuzhiwei/n/bin:$PATH pnpm smoke:ssh-matrix` 在 macOS 15.7.7 arm64、Node 24.16.0、Docker 29.7.2 下 10/10 全绿：key、key-reconnect、password、password-reconnect、agent、agent-reconnect、cert、cert-reconnect、jump、jump-reconnect。
- ✅ real-machine workflow 的 macOS job 现在同时执行 `pnpm smoke:shell-probe:matrix -- cat-eof,readline-history,readline-tab,vim-edit,nano-edit,pty-resize,ctrl-c-interrupt` 和 `pnpm smoke:remote-cold-start -- --app-path "$GITHUB_WORKSPACE/src-tauri/target/debug/terminal"`，将真实 Tauri/WKWebView + local PTY 日常 shell 交互及远程 SSH prompt marker cold-start 纳入远端 runner 门禁；workflow 修复尚未推送，不能将新增步骤计为远端通过。
- ✅ 当前工作树最新复跑首次连接 925–4410ms；key/password/agent/cert/jump 五种重连用例均产生 11 个唯一 session；每个用例包含 10 轮隔离会话、8 MiB 输出、97×31 resize、旧输出拒绝和资源回收。
- 逐用例耗时、当前二进制 SHA-256 与限制见 [`2026-10-11-macos-ssh-matrix-current.json`](verification/2026-10-11-macos-ssh-matrix-current.json)；历史基线见 [`2026-10-10-macos-ssh-matrix.json`](verification/2026-10-10-macos-ssh-matrix.json)。该记录仍不等同于普通用户冷启动到首个可输入终端的 stopwatch，也不覆盖 Windows/Pageant/串口/真人 IME。
- ✅ 修复 real-machine workflow 对历史 `main` 缺失 `.node-version` 的隐式依赖：macOS/Linux job 现在显式使用 Node 24.16.0；YAML 解析与本地脚本门禁通过。下一次 GitHub workflow dispatch 仍需重新取得远端 runner 结果，不能用旧 scheduled failure 代替。

## 2026-10-09 macOS 本地冷启动复验

- ✅ 正式 debug bundle 从无运行进程启动到 AX tree 同时出现 Local、已连接、Terminal input 和可见 zsh prompt 的三次 request-to-readiness 观测为 5408ms、4477ms、5840ms，均低于 10 秒。
- 逐次状态证据、二进制 SHA-256 与测量边界见 [`2026-10-09-macos-cold-start.json`](verification/2026-10-09-macos-cold-start.json)。该结果包含 UI automation 请求与 AX 轮询开销，不是严格 OS process stopwatch，也不等同于真实远程 SSH 首个 prompt。

## 2026-10-10 macOS 进程级冷启动 stopwatch

- ✅ 新增 `pnpm smoke:cold-start -- --app-path /absolute/path/to/Termius.app/Contents/MacOS/terminal`。驱动只接受 macOS，要求绝对可执行文件路径，从 `ChildProcess` 的 `spawn` 事件开始计时，并用 Accessibility API 同时确认 Local 标签、已连接状态和 Terminal input 文本区；默认结果明确标为 `readinessTarget: window`/`readyAt: window`。AX 探针仍记录 shell prompt 字段供诊断，但不把 canvas 中不可稳定暴露的 prompt 作为终端证据。严格 `--readiness-target terminal` 必须同时提供新鲜的端到端 marker 证据，可重复传入 `--marker-check <absolute-path> <exact-content>`；marker 尚未就绪时 fail-closed。marker 应由本次 PTY/SSH 交互生成，不能用预先存在的文件冒充 shell readiness。
- ✅ 新增 `pnpm smoke:local-cold-start -- --app-path /absolute/path/to/terminal`：每次运行生成唯一 nonce，复用真实 shell probe 的 `term.input` → `session_write` → local PTY 回读链路；Rust 仅在成功结果发布后创建精确 marker，stopwatch 以 `readyAt: terminal` 结束。marker 路径和内容均隔离到本次临时 HOME，stale marker 会 fail-closed。
- 该驱动默认使用隔离临时 `HOME`，结束时发送 SIGTERM，超时升级 SIGKILL 并清理临时目录；AX helper 与 Swift 编译器超时同样有界回收。输出同时包含二进制 SHA-256、`requestToReadyMs` 与严格定义的 `spawnToReadyMs`，便于绑定构建产物并区分启动请求开销和进程已创建后的耗时。native helper 的 Swift 编译发生在 stopwatch 起点前，不计入这两个应用启动指标。
- 若需对照旧桥接，可显式传入 `--ax-probe osascript`；该模式只用于诊断，不作为 WKWebView AX 子树可靠性的默认证据。原生 helper 编译失败、权限/API 禁用或输出格式异常均保持失败，不降级为窗口存在。
- `node scripts/verify.mjs scripts` 当前包含 93 项 Node 脚本测试；历史 56/63/67/71/78/80/83/89/90/91 项记录保留在对应日期段落中，不作为本次计数。
- Node 24.16.0 下原生 helper、回退模式及失败路径的 11 项 Node 回归通过；历史复跑曾取得 `spawnToReadyMs=4885`，当前四次复测为 5648/4920/4647/4595ms。此前锁屏失败边界保留在 [`2026-10-10-macos-cold-start-blocked.json`](verification/2026-10-10-macos-cold-start-blocked.json)，既有 request-to-AX 记录仍受上一节的测量边界限制。

## 2026-10-10 xterm 输入协议事件级回归

- ✅ 新增 3 项前端回归：真实打开兼容版 `@baicie/xterm@0.1.7`，启用 SGR mouse、DECSET 2004 bracketed paste 和 X10/default mouse 后，验证 `registerTerminalInput` 分别收到精确文本报告、bracketed paste 包装和高位 `Uint8Array` 原始字节。
- ✅ Node 24.16.0 下该测试文件、既有 WebKit 输入、FIFO 和 session I/O 定向测试共 29 项通过；前端 typecheck 与该文件 lint 通过。
- ⚠️ 该回归使用 jsdom synthetic DOM 事件，只证明兼容版 xterm 到前端输入桥接的编码边界；真实 Tauri IPC、PTY 回读、非 UTF-8 原始输入及物理鼠标/粘贴仍按 Issue #48 保持待实机。后续 2026-10-10 raw-input probe 已在下一节补充真实回读。

## 2026-10-10 真实 Tauri/PTY raw 输入探针

- ✅ 新增显式 `TERMINAL_RAW_INPUT_PROBE=1` gate 和 `pnpm smoke:raw-input` runner；仅 macOS 启动 debug Tauri binary，使用真实 local PTY 回读字节。
- ✅ 三个固定 case 已纳入代码契约：SGR mouse 文本报告、DECSET 2004 bracketed paste、X10/default mouse 高位 raw bytes；前端 protocol/bootstrap 11 项、Node runner 4 项和 Rust state 2 项定向测试通过。
- ✅ Node 24.16.0 下当前定向与全量门禁：前端 109 文件/925 项、Team Server 103 项、Rust 189+3 项、Node 脚本 114 项，lint/typecheck/build budget/fmt/Clippy/源码规模均通过；本轮新增启动恢复有界重试与并发加载取消保护、生命周期、远程 prompt marker、shell 交互和连续 resize 定向门禁均通过。
- ✅ 修复探针 shell marker 顺序以及 PTY 的 CR→LF 输入转换后，2026-10-10 在当前 debug binary 上取得三个真实 Tauri/WKWebView/PTY 成功结果：Node 24.16.0 下 SGR mouse 525ms、bracketed paste 350ms、raw X10 367ms；完整回读值见 [`2026-10-10-macos-raw-input.json`](verification/2026-10-10-macos-raw-input.json)。此前锁屏超时记录 [`2026-10-10-macos-raw-input-blocked.json`](verification/2026-10-10-macos-raw-input-blocked.json) 保留为失败边界，不计入通过。
- ⚠️ 该探针仍不替代人工物理鼠标/粘贴、中文 IME、Option/dead key、连续 resize 或 Windows/Pageant/PTY/串口实机矩阵。

## 2026-10-11 本地 shell 交互探针

- ✅ 新增显式 `TERMINAL_SHELL_PROBE=1` gate、固定 case/trace/input 契约和 `pnpm smoke:shell-probe[:matrix]` runner；普通产品启动不启用该模式。
- ✅ 真实 Tauri/WKWebView + local PTY 七个 case 全绿：当前工作树 `cat-eof` 4047ms、`readline-history` 354ms、`readline-tab` 489ms、`vim-edit` 1909ms、`nano-edit` 4611ms、`pty-resize` 1328ms、`ctrl-c-interrupt` 1103ms；`cat` 使用 canonical 行提交后空读边界 EOT，精确验证 EOF payload；`pty-resize` 依次 resize 到 132x43/90x30/120x40/97x31 并用 `stty size` 逐档回读真实 PTY 几何。当前完整记录见 [`2026-10-11-macos-shell-interaction-current.json`](verification/2026-10-11-macos-shell-interaction-current.json)，旧二进制记录见 [`2026-10-11-macos-shell-interaction-probe.json`](verification/2026-10-11-macos-shell-interaction-probe.json)。
- ✅ Node 24.16.0 下 shell protocol、Node runner/matrix、Rust state 定向测试通过；当前定向门禁计数为前端 109 文件/925 项、Team Server 103 项、Rust 189+3、Node 脚本 114 项。
- ⚠️ 所有输入均由 `term.input(data, true)` 自动送入 xterm/PTY，不是物理键盘、系统粘贴或中文 IME；Option/dead key 及 Windows/Pageant/PTY/串口仍待实机。

## 2026-10-10 会话生命周期增量

- ✅ Remote attempt ID 在事件监听注册前创建；关闭/重连发生在监听注册挂起期间时会立即取消，监听迟到后不会启动已退休会话。
- ✅ SSH 发布守卫覆盖 pool 发布到 reader task 接管的取消窗口；取消会关闭 transport 并释放 pool/registry，reader 接管后才提交守卫。
- ✅ SSH host-key direct/jump preflight 统一 8 秒绝对 deadline；网络连接与 `known_hosts` blocking 检查共用该 deadline，超时进入既有可重试错误状态，不改变未知/变更 key 信任流程。
- ✅ 启动恢复超过 2 秒时先提供临时本地 terminal；恢复结果只替换该临时 fallback，不覆盖用户在恢复期间创建的 tab。
- ✅ 关闭 tab 等待所有重叠 start/reconnect promise；connection attempt cancellation、generation retirement 与 lifecycle buffer overflow 均按 session 隔离，迟到 session 不会重新发布或污染后续 tab。
- ✅ 前端会话回归、Rust 发布守卫回归及 `git diff --check` 已通过；真人键盘、中文 IME、Windows/Pageant/PTY 和串口硬件仍待实机。

## 2026-10-11 本地 Tauri/PTY 主流程 smoke

- ✅ `pnpm smoke:terminal` 在 macOS 15.7.7 arm64、Node 24.16.0 下通过：8 MiB 输出、10 轮隔离会话、连续四步 resize 精确回读、尾部可见性和资源回收均通过。
- ✅ 最新一次首次连接 `firstConnectionMs=1612`，总耗时 7639ms；二进制 SHA-256 与完整结果见 [`2026-10-10-macos-terminal-smoke.json`](verification/2026-10-10-macos-terminal-smoke.json)。
- ✅ `pnpm smoke:terminal:reconnect` 同样通过：重连后 11 个唯一 session、`reconnectObserved=true`、`staleOutputRejected=true`，首次连接 1441ms、总耗时 8586ms；完整结果见 [`2026-10-10-macos-terminal-reconnect-smoke.json`](verification/2026-10-10-macos-terminal-reconnect-smoke.json)。主动终止 fixture 的 teardown 可能产生非致命 SSH channel-close warning，不影响资源回收结果。
- 该结果证明本地 PTY 主流程与会话生命周期 smoke，不等同于普通用户冷启动 stopwatch、远程 SSH 首个 prompt、物理键盘/IME 或跨平台硬件实机验收。

## 2026-09-22 macOS 输入验收增量

- ✅ macOS 15.7.7 arm64 / WKWebView / 真实本地 PTY：`pnpm smoke:input-probe -- --inject swift --input-source ascii` 严格 30 轮通过，每轮只注入一次且精确回读 `617364`，退出码 0，总测试耗时 111547ms。原输入源恢复失败会使测试失败。
- ✅ 前端 lint/typecheck、104 文件/880 项（`--maxWorkers=2`）、生产构建预算（首屏/总 gzip 128.15/547.15 KB）、Node 脚本 56 项、511 文件规模与 `git diff --check` 通过；本轮 Team Server 103 项与 Rust 177+3 项也已复验。
- 逐轮原始结果、输入源与构建二进制摘要见 [macOS 输入验收记录](verification/2026-09-22-macos-input-probe.json)。CGEvent 证明原生事件路径，不等同于人类操作硬件键盘；人工输入、中文 IME、Option/dead key 和其他交互矩阵继续验收。
- 用户确认目前无 Windows 测试机/串口设备，先完成 macOS；Windows/Pageant/串口继续保留为未验证。

## 2026-09-06 feat/mvp 增量验证结果

**范围**：SSH 建链主动取消、xterm parser 可见 ready marker 计时、完整启动/重连 smoke，以及行数门禁修复。

| 门禁 | 结果 |
| --- | --- |
| `pnpm verify` | ✅ 全部通过：前端 102 文件/875 项、Team Server 25 文件/103 项、Rust 177 单测 + 3 集成、Node smoke 39 项；lint/typecheck/build budget/fmt/Clippy/源码门禁均通过 |
| `pnpm smoke:ssh-matrix` | ✅ 7 用例全绿；本次首次连接 905–2313 ms，password/key/agent/cert/jump 与断线重连均产生预期隔离 session |
| `pnpm smoke:terminal` | ✅ 8 MiB 输出、10 轮、97×31 resize、资源回收全绿；总耗时 5966 ms，`firstConnectionMs=2831` |
| Rust cancel 回归 | ✅ 建链取消、cancel/create 竞态和 tombstone 上限测试通过；`session_cancel_connection` 对旧 IPC 调用保持可选 attemptId 兼容 |

**未完成实机项**：macOS 物理键盘 30 轮重叠 `a/s/d`、中文 IME composition 与 Option/dead key 仍待人工（用户当前不方便敲键）；Windows OpenSSH/Pageant/PTY 与串口硬件因无可用测试机与硬件而保持待验证。

## 2026-08-19 feat/mvp 验证结果

| 门禁 | 结果 |
| --- | --- |
| 本机 `pnpm verify` | ✅ 前端 63 个文件/561 项、Team Server 25 个文件/103 项、Rust 47 项单测 + 2 项集成测试全部通过 |
| 静态质量 | ✅ Prisma validate、lint、typecheck、Nest/Vite build、Rust fmt/check/Clippy `-D warnings` 与 462 个生产源码文件规模门禁通过 |
| Bundle | ✅ 初始 gzip 237.68 KB / 240 KB，总 gzip 524.42 KB / 550 KB，最大 JS chunk raw 401.56 KB / 500 KB |
| 供应链 | ✅ `deepmerge-ts` 固定到修复版 8.0.1；`pnpm audit --prod --audit-level high` 为 0 个已知漏洞 |
| Compose | ✅ 配置解析、PostgreSQL 16.15、2 个 Prisma 迁移、三类 health、closed/token/open、5 类非法环境、SIGTERM 退出码 0 与重启 readiness 全部通过 |
| SSH 高级能力 | ✅ Agent forwarding 授权/池隔离和 Jump Host certificate 自动化通过；⚠️ 真实 Agent、CA、服务端与跨平台矩阵待执行 |

本机系统代理无法完成 `auth.docker.io` TLS 握手，因此运行时验收从 AWS Public ECR 的官方 Docker Library 镜像源按 arm64 digest 导入 Node/PostgreSQL 基础镜像，并以 frozen lockfile 和完整性校验构建当前源码；原始 Dockerfile 的无替换构建继续由 CI 结果证明。验收结束后已删除容器、网络和测试数据卷。

本轮未创建发布标签或安装包，也未改写 `v0.0.1-dev.1` 的既有发布证据。代码与本机容器运行时达到可合并门禁；发布前仍需按上表完成真实 SSH、跨平台与硬件验收。
