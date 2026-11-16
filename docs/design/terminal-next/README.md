---
status: canonical-index
updated: 2026-11-16
fact_baseline: "main@5f248631e6fff10e824de34cd73b2291fc8ab416"
scope: "Terminal Next product, architecture, UX, security, acceptance and document governance entry"
---

# Terminal Next 统一设计规格

> 版本：3.0 设计收口稿
> 更新：2026-11-16
> 事实基线：`main` / `5f248631e6fff10e824de34cd73b2291fc8ab416`
> 输入：用户提供的 v2.0 合订版（2026-11-13，外部文件）与仓库真实代码、测试和发布记录
> 状态：设计 Draft；本目录不代表 UX-2～UX-4 已实现，也不改变运行时代码

这是 Terminal Next 的唯一设计入口。编码 Agent 从本文件开始，先读现状和架构，再读对应 UX 规格与 PR 计划。旧版设计草稿已经移入 [`archive/legacy-drafts/`](archive/legacy-drafts/)，真实验收、发布、安全审计和迁移历史继续保留在原路径，不能用设计文档替代它们。

## 先读什么

| 角色 | 阅读顺序 |
| --- | --- |
| 任何实现者 | [`01-current-state-and-gap.md`](01-current-state-and-gap.md) → [`02-architecture-and-invariants.md`](02-architecture-and-invariants.md) → [`10-pr-implementation-plan.md`](10-pr-implementation-plan.md) |
| UI/交互 | [`03-ui-ux-blueprint.md`](03-ui-ux-blueprint.md) → [`04-ux1-terminal-workspace.md`](04-ux1-terminal-workspace.md) |
| 凭据/安全 | [`05-ux2-credentials.md`](05-ux2-credentials.md) → [`08-data-security-migration.md`](08-data-security-migration.md) |
| 插件/AI | [`06-ux3-extension-platform.md`](06-ux3-extension-platform.md) → [`07-ux4-ai-inspector.md`](07-ux4-ai-inspector.md) |
| 测试/发布 | [`09-test-acceptance-release.md`](09-test-acceptance-release.md) → [`11-document-governance.md`](11-document-governance.md) |
| 产品负责人 | [`00-product-blueprint.md`](00-product-blueprint.md) → [`12-final-review-and-open-decisions.md`](12-final-review-and-open-decisions.md) |

## 文档地图

| 文件 | 内容 |
| --- | --- |
| `00-product-blueprint.md` | 定位、用户、范围、里程碑、版本边界、成功判据 |
| `01-current-state-and-gap.md` | 当前 HEAD 的代码事实、证据等级、已有/部分/未验证/仅设计能力 |
| `02-architecture-and-invariants.md` | Shell、Session、SFTP、Credential、Extension、AI、Inspector 的统一架构与不变量 |
| `03-ui-ux-blueprint.md` | 信息架构、页面地图、设计 Token、状态、键盘、IME、平台和参考图约束 |
| `04-ux1-terminal-workspace.md` | Terminal Workspace 的现状复审、交互、布局算法、生命周期契约和剩余验收 |
| `05-ux2-credentials.md` | 凭据交互状态机、Provider 抽象、系统存储门禁和安全验收 |
| `06-ux3-extension-platform.md` | 可信内置扩展 v0、SDK、Registry、Capability Gateway 和隔离边界 |
| `07-ux4-ai-inspector.md` | AI MVP、ModelDriver、Context Review、审批和 Server Inspector |
| `08-data-security-migration.md` | 数据模型、IPC、迁移、回滚、产品 Identifier 与跨版本兼容 |
| `09-test-acceptance-release.md` | Level 1～4 验收、证据冻结、性能、发布阻断和跨平台矩阵 |
| `10-pr-implementation-plan.md` | 已合并能力、补齐任务、新能力和可独立 Draft PR 顺序 |
| `11-document-governance.md` | 旧文档映射、保留/归档/删除、引用迁移和文档门禁 |
| `12-final-review-and-open-decisions.md` | 独立架构复审、已解决冲突、风险与需要产品负责人确认的事项 |

## 事实等级

设计中使用以下严格状态，不允许把较弱状态写成完成：

- `IMPLEMENTED`：当前 HEAD 中有生产实现，并有与该断言对应的自动化或代码证据。
- `PARTIAL`：实现存在，但有明确链路、平台或行为缺口。
- `UNVERIFIED`：代码或测试存在，当前没有足够的真实环境证据。
- `DESIGN_ONLY`：只有本目录或历史设计，没有生产实现。
- `BLOCKED`：有明确外部前置条件，例如签名身份、设备、权限或平台环境。
- `OBSOLETE`：旧设计被当前规格取代，不得作为编码依据。

`PASS` 只表示指定 SHA、指定环境和指定证据均通过；`NOT_RUN`、`PARTIAL`、`BLOCKED` 不属于 PASS 的同义词。

## 输入资料与参考图

本轮已经完整读取用户提供的 v2.0 合订版：

用户提供的 v2.0 合订版（2275 行；外部原件，不作为仓库内编码依赖）

v2.0 的文档头部声称基线为 `1a24eed`，并声称 10 张桌面图与 4 张 Windows 图已经位于 `assets/reference/`。本轮重新核对后，以当前仓库 HEAD 为准：

- 当前 `main` 是 `5f248631e6fff10e824de34cd73b2291fc8ab416`，不能继续使用 v2.0 旧 SHA 作为现状。
- 找到并纳入本目录的 10 张 1586×992 桌面参考图：[`assets/reference/desktop/`](assets/reference/desktop/)。
- 当前执行环境没有找到 v2.0 声称的 4 张 Windows 参考图；本规格把它们标记为缺失，不用其他图片代替。
- 参考图是视觉输入，不是产品截图，不是功能或数据证据。对应关系见 [`03-ui-ux-blueprint.md`](03-ui-ux-blueprint.md) 和 [`12-final-review-and-open-decisions.md`](12-final-review-and-open-decisions.md)。

## 不能绕过的仓库规则

- 保留 Tauri 2 + Rust + React 19 + TypeScript + Vite + Zustand + shadcn/ui + xterm.js；设计阶段不重写稳定的 PTY、SSH、OUTPUT ACK、数据库恢复和 SFTP 传输底层。
- Terminal Canvas 的可见性不拥有 Session 生命周期。路由、面板、主题、窗口尺寸和 Dock 变化不能重建 PTY/SSH。
- SFTP Transfer Queue、Lease 和 Registry 由服务层拥有，Dock 只显示它们。
- 任何秘密只通过 Provider 解析；SQLite、localStorage、普通日志、AI 上下文和扩展 API 不保存明文。
- 可信内置扩展不等于第三方沙箱。主 WebView 中的动态 JavaScript 不得被称为隔离插件。
- AI 默认只生成解释、摘要和命令草稿；模型输出不能直接写入 Shell，也不能拥有 SSH Secret、raw PTY handle 或 Session owner 权限。
- 指纹路径有改动时，按 [`docs/release/workflow-rules.md`](../../release/workflow-rules.md) 重新冻结和采集证据，不手工修改旧 manifest。

## 实施停止线

本轮只提交设计、索引、治理文件和参考资产。不得借设计 PR 顺手实现 UX-2、UX-3、UX-4，也不得改产品 Identifier、启用正式 Updater、切换默认 Credential Provider 或合并任何代码 PR。实施顺序、依赖和每个 PR 的完成定义见 [`10-pr-implementation-plan.md`](10-pr-implementation-plan.md)。
