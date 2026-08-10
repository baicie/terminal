# Terminal 发布就绪规格

> 创建日期：2026-08-09
> 最后验证日期：2026-08-10
> 发布目标：`0.0.1-dev.0`
> 状态：✅ 本机自动发布门禁完成；🔄 多平台安装包待远端工作流验收；⚠️ 外部实机项目待执行

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
- [x] 跨平台代码审计完成，实机验证矩阵齐全且状态真实。
- [x] `AGENTS.md`、`docs/project.md`、`docs/issue.md`、`docs/todo.md` 状态一致。
- [x] 最终差异审查与 `git diff --check` 复核。

## 2026-08-10 验证结果

**环境**：macOS 15.7.7、Node.js 24.16.0、pnpm 10.34.3、Rust/Cargo 1.96.0。

| 门禁 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | ✅ 锁文件可重复安装，Prisma Client 7.9.1 生成成功 |
| `pnpm audit --registry=https://registry.npmjs.org --prod --audit-level high` | ✅ No known vulnerabilities found |
| 前端 | ✅ 31 个测试文件、408 项测试；lint/typecheck/build:budget 通过 |
| Team Server | ✅ 25 个测试文件、95 项测试；Prisma validate/lint/typecheck/build 通过 |
| Rust | ✅ 44 项测试；fmt/check/Clippy `-D warnings` 通过 |
| Bundle | ✅ 初始 gzip 227.36 KB / 240 KB，总 gzip 510.09 KB / 550 KB，最大 JS chunk raw 390.87 KB / 500 KB |
| 源码规模 | ✅ 447 个前端/Team Server 生产 TS/TSX 文件，0 个超限 |
| Docker | ⚠️ 当前机器没有 `docker` 命令，未声称本地镜像或 Compose 通过 |

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

当前开发版没有 Apple Developer ID/notarization 或 Windows Authenticode 配置。DMG 与 NSIS 构建成功只能证明可打包，Release 说明必须明确“macOS 未公证、Windows 未签名”。Linux/Windows runner 通过也不能替代 Issue #39 的 Pageant、PTY、Jump Host、快捷键与串口硬件实机矩阵。

## 实机验证矩阵

| 场景 | 环境 | 当前状态 | 通过标准 |
| --- | --- | --- | --- |
| macOS 自动门禁 | macOS 15.7.7 | ✅ 通过 | `pnpm verify` 全绿 |
| Windows OpenSSH Agent | Windows 10/11 | ⚠️ 待实机 | 单/多 key 登录、无 key、服务未启动和错误管道均符合预期 |
| Pageant | Windows 10/11 + Pageant | ⚠️ 待实机 | `russh` Pageant transport 可登录，未运行时返回明确错误 |
| Jump Host | Windows / Linux | ⚠️ 待实机 | 跳板端与目标端 password/key/agent 组合、断开与连接池复用正确；certificate 当前应明确报“不支持” |
| 本地 PTY | Windows / Linux | ⚠️ 待实机 | 从用户主目录启动，输入/resize/EOF/关闭状态正确 |
| 串口 | macOS / Windows / Linux + 硬件 | ⚠️ 待实机 | 精确写入、主动断开、运行中拔线均清理 session |
| 快捷键 | Windows / Linux / 非美式键盘 | ⚠️ 待实机 | 不覆盖系统快捷键，`Ctrl+Shift+\` 可触发垂直分屏 |
| Team Server 容器 | Docker + PostgreSQL 16 | ⚠️ 当前机器无 Docker | 镜像构建、迁移、`/api/v1/health/ready` 与关停钩子通过 |
| Tauri 三平台编译 | macOS / Ubuntu / Windows CI | 🔄 macOS、Ubuntu 已通过；Windows `Send` 修复待重跑 | `.github/workflows/ci.yml` 三平台 `tauri build --no-bundle --ci` 通过 |
| Release 安装包 | 六个原生 GitHub runner | 🔄 工作流已建立，资产待实际上传验收 | 八个安装资产非空且系统/架构命名正确，`SHA256SUMS.txt` 可校验 |
| S3 服务端集成 | AWS S3 或兼容服务 | ⚠️ 待外部服务 | 固定向量之外，验证实际签名、UTF-8 key、分页列表、上传下载与删除 |
| Agent forwarding | 全平台 | 📋 入口未实现 | 独立设置开启后显式调用 `channel.agent_forward(...)` 并完成双向请求 |
