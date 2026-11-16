# 00 · Product Blueprint

## 1. 产品定义

Terminal Next 是面向开发者、SRE 和独立运维人员的跨平台桌面终端工作台。它以本地 Shell 和 SSH 终端为主体，用连接管理、SFTP、Snippet、日志、凭据、轻量 Inspector 和可选 AI 缩短终端工作流。

产品的核心承诺是：

1. 打开应用后不需要先配置云服务即可输入本地命令。
2. 从主机搜索到新 Tab 的路径短，并且每次操作都明确落在哪个 Host、Session 和 Pane。
3. 侧栏、Dock、路由和主题变化不会中断 PTY、SSH、OUTPUT ACK 或传输。
4. 凭据保存是用户明确选择的行为；认证成功和保存凭据永远分开。
5. AI 是可关闭的人工辅助，不是默认 Agent，不代替用户执行远程命令。
6. 所有在线、健康、速度、最近连接和模型响应都有真实数据来源和时间语义。

这不是 IDE、监控平台、云开发环境或团队管理后台。它应当有 Tabby 级别的终端效率、VS Code 风格的轻量工作区和低摩擦的安全凭据体验，但不复制这些产品的全部范围。

## 2. 目标用户与工作任务

| 用户 | 首要任务 | Terminal Next 必须先解决的问题 |
| --- | --- | --- |
| 单机开发者 | 本地 Shell、分屏、命令历史、Snippet | 首屏可输入、窗口变化不丢输出、快捷键不抢 readline |
| 多主机开发者 | 收藏/分组/最近连接、Jump Host | 找得到正确主机，连接失败知道下一步 |
| SRE/运维人员 | 多 Pane、日志、SFTP、只读诊断 | 知道当前 Host，操作不串台，传输不中断 |
| 安全敏感用户 | 密码、私钥、Agent、HostKey | 不把凭据落入明文，不因锁定/损坏引用静默降级 |
| 进阶用户 | Workspace、Port Forward、团队同步 | 高级能力可达但不挤压终端首屏 |

## 3. 核心场景

### S1：首次打开与本地工作

启动 → Bootstrap/Recovery Gate → 本地 Tab 可输入 → 用户输入命令 → xterm 显示回显。没有 Host、Vault 或网络也不能阻塞这条路径。

### S2：从终端连接已保存主机

Terminal Canvas → Activity Rail 的 Connections → Explorer 搜索/Recent/Favorites/Group → 明确 Connect → HostKey/凭据解析 → 新建 Tab → Focus Pane。Explorer 不离开终端，也不拥有 Session。

### S3：首次连接并决定是否保存

用户填写 Host 和认证方式 → 本次输入或 Provider 解析 → HostKey 检查 → SSH 成功 → 用户选择“仅本次”或“保存” → 保存失败时保留表单并给出创建/解锁/检查存储的操作。认证失败不自动保存错误凭据。

### S4：终端旁的 SFTP

在 SSH Tab 中打开 Files → 显式 Pin Host 或跟随当前 Tab → 浏览远端文件 → 入队上传/下载 → 关闭 Dock → Transfer 继续 → 完成后刷新列表并释放 Session。Full `/sftp` 与 Compact Dock 复用同一服务和 Queue。

### S5：错误解释与命令草稿

用户选中一段错误 → AI Dock 展示 Host/Session/上下文预览 → 用户删除或脱敏 → 明确批准发送 → ModelDriver 流式返回解释 → 用户可以复制或保存 Snippet。命令草稿不自动写入 Shell；未来的发送动作也必须重新审批。

## 4. 产品范围

### Core Terminal

- Local PTY、SSH password/key/agent/certificate、Jump Host、Known Hosts。
- Tab、Split、Workspace 恢复、命令面板、快捷键、终端搜索、粘贴保护和三语国际化。
- Connection Explorer、Host CRUD、OpenSSH 导入、Recent/Favorites/Groups。
- SFTP Full View、Compact Dock、Transfer Queue、staged upload/download、校验和资源释放。
- Vault 凭据存储、结构化错误、导出/导入边界、凭据清除和迁移审计。
- Snippet、Logs、Port Forward、Settings、主题和平台窗口交互。

### Next Plus

- 可信内置 Extension Registry v0。
- 按需、只读、带时间戳的 Server Inspector。
- OpenAI-compatible API 优先的 AI MVP：解释选区、解释错误、摘要、命令草稿、保存 Snippet。
- 系统 Keychain/Windows Credential Manager Provider，只有通过跨版本稳定读取门禁后才进入默认发布路径。

## 5. 非目标

以下能力不进入本轮 Terminal Next Core，也不应被设计图暗示为已存在：

- 完整 IDE、编辑器、云端开发环境或远程容器平台。
- Prometheus/Grafana 替代品、持续采集、历史时序库、告警后台和 Top Processes 常驻 Agent。
- 默认无人值守 AI Agent、自动 Shell 执行、批量 AI 远程运维。
- 第三方社区插件商店、在主 WebView 中 `eval/import()` 非可信 JavaScript。
- 为了引入 AI 整体移植 Harness、默认常驻 Node Sidecar 或另建 Agent 平台。
- 为了视觉重构替换 xterm、SessionManager、PTY、SSH/SFTP 传输或数据库恢复底层。
- 在系统凭据 Provider 未证明跨升级稳定前强制迁移既有 Vault 数据。

## 6. 里程碑与质量门槛

阶段是依赖门禁，不是日期承诺。

| 阶段 | 目标 | 当前状态 | 进入条件 | 退出条件 |
| --- | --- | --- | --- | --- |
| UX-1 | Terminal Workspace | `IMPLEMENTED`，持续做原生验收 | 当前 UX-1a/b/c、F0、SFTP 和 GUI harness 事实冻结 | 真实 GUI/IME/平台矩阵补齐；核心不变量持续通过 |
| UX-2a | Provider 无关的凭据交互 | `PARTIAL` | UX-1 生命周期稳定 | 连接时输入、成功后保存、内联 Vault 状态、清除/切换认证、真实 SSH 负向路径 |
| UX-2b | 系统 Provider | `DESIGN_ONLY` | UX-2a、Provider Registry、稳定签名/升级环境 | macOS/Windows/Linux 对应存储的创建/重启/升级/回退证据；默认 Provider 由产品决定 |
| UX-3 | 可信内置扩展 v0 | `DESIGN_ONLY` | IPC 权限审计、右 Dock 单占位者、Extension API | 启停/异常/异步回调清理不影响 PTY；没有第三方沙箱误声明 |
| UX-4 | Optional AI + Inspector | `DESIGN_ONLY` | UX-2 Secret boundary、UX-3 Gateway、ModelDriver MSRV ADR | 真实可控 Provider/Inspector、Context Review、取消/迟到响应、无自动执行 |
| RC | 跨平台发布与日用 | `PARTIAL/BLOCKED` | Core 通过 Level 2/3，身份/签名/Updater 决策完成 | macOS/Windows/Linux 运行、签名、升级/回滚、7 天 Daily Driver |

## 7. 北极星指标

这些指标必须有可重复的计量方法，不能由图片或 Mock 代替：

- 首次可交互终端：冷启动到真实 PTY 输入并回显；以固定环境 `n≥20` 的中位数和 p95 记录，较基线回归超过 10% 必须解释。
- 资源唯一性：一次用户意图不会产生重复 SSH/PTY/SFTP Session、重复拖放监听器或重复上传。
- 布局稳定性：切 Tab、切路由、开关面板、调整字体、拖动分屏不 remount TerminalContainer，不中断 ACK。
- 传输完整性：真实 UI→Tauri IPC→Rust→OpenSSH 的文件 SHA-256 一致；关闭 Dock 不会中断已启动任务。
- 日用稳定性：7 天真实使用无无故断会话、误 Host 操作、幽灵监听器、凭据静默丢失和严重 IME 故障。
- 安全：SQLite、localStorage、日志、错误对象、导出和 AI payload 中无明文 Secret；未知 Provider/损坏引用 fail-closed。

## 8. 版本边界

### Core Daily Driver

默认构建必须只包含 Terminal、Host、SFTP、凭据、Snippet、日志、设置等日用能力。AI、Inspector、第三方扩展和系统 Provider 都可以通过 feature/注册表状态关闭，不得增加首个终端关键路径的网络、CPU、Bundle 或 Session 成本。

### Optional Intelligence

AI 与 Inspector 是可选增强。它们可以在同一产品中交付，但失败时必须只影响自己的 Dock、Run 或 Probe，不能修改 Terminal Session 状态，也不能阻止本地终端启动。

### Release

在产品名、Identifier、签名、Keychain 稳定读取和 Updater 签名没有完成前，发布状态只能是内部开发体验或未签名 QA。不能把 CI 构建通过写成正式发布就绪。

## 9. 最终成功判据

Terminal Next 只有同时满足以下条件，才可以声明 Core Daily Driver Ready：

1. UX-1 核心不变量、真实 SSH/SFTP、Workspace 恢复和错误恢复在 Level 1/2 通过。
2. macOS 和 Windows 的真实 GUI、窗口、DPI、键盘、IME、焦点和至少一套真实 Agent/PTY 路径在 Level 3 通过；Linux 只在具备对应运行证据后进入 RC。
3. 凭据错误、Provider 不可用、损坏引用、导入导出、升级回退都不会静默丢失或降级。
4. Extension/AI/Inspector 关闭、异常、取消、迟到响应不会关掉核心终端。
5. 发布资产、身份迁移、签名、公证/Authenticode、Updater 和数据保留在 Level 4 有独立证据。
6. 7 天日用记录没有未解释的 P0/P1，所有未测项仍按 `NOT_RUN/BLOCKED` 明确列出。

这套判据允许“Core Ready、AI 未启用、正式签名未完成”等分层结果，但禁止用一个全局绿灯掩盖发布阻断项。
