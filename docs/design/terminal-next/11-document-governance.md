---
status: canonical-governance
updated: 2026-11-16
fact_baseline: "main@5f248631e6fff10e824de34cd73b2291fc8ab416"
scope: "Canonical source rules, historical archives, supersession notes, references and document gates"
---

# 11 · 文档治理、旧设计清理与引用迁移

## 1. 唯一来源规则

`docs/design/terminal-next/README.md` 是 Terminal Next 的唯一设计入口。新产品、架构、UX、数据、安全、测试、PR 和开放问题只能在本目录的 canonical 文件中修改。其他目录保留历史事实、审计、发布和问题复现，不得继续承担新的产品规范。

每个 canonical 文档只能有一个权威结论；实现记录引用它，但不复制另一套状态机或 Token。若历史记录与当前设计不同，历史记录保留原时点事实，canonical 文档写当前决策和迁移关系。

## 2. 旧设计映射

| 旧文件/区域 | 处理 | 新来源 | 原因 |
| --- | --- | --- | --- |
| `docs/design/terminal-next/archive/legacy-drafts/terminal-next-design-package-v1.md` | 归档 | `00`～`12` | v1 产品/架构/阶段被统一规格取代 |
| `docs/design/terminal-next/archive/legacy-drafts/00-adr-architecture.md` | 归档，保留历史 ADR 证据 | `02-architecture-and-invariants.md` | 旧基线和 UX-0 状态过时，关键不变量已吸收 |
| `docs/design/terminal-next/archive/legacy-drafts/01-credential-keychain-vault.md` | 归档 | `05-ux2-credentials.md`、`08-data-security-migration.md` | 单 Provider 时代的 Draft，作为历史审查输入保留 |
| `docs/design/terminal-next/archive/legacy-drafts/02-terminal-workspace.md` | 归档 | `03-ui-ux-blueprint.md`、`04-ux1-terminal-workspace.md` | UX-1 已经多轮合入，旧实现计划不再作为施工单 |
| `docs/design/terminal-next/archive/legacy-drafts/03-extension-platform.md` | 归档 | `06-ux3-extension-platform.md` | v0 API 和第一个扩展选择已重审 |
| `docs/design/terminal-next/archive/legacy-drafts/04-rust-rig-ai.md` | 归档 | `07-ux4-ai-inspector.md` | Rig/MSRV 事实需要当前重新核对，推荐先 ModelDriver |
| `docs/design/terminal-next/archive/legacy-drafts/05-test-matrix-and-rollback.md` | 归档 | `09-test-acceptance-release.md` | 测试层级、当前证据和发布规则已扩展 |
| `docs/design/terminal-next/ux1a-review-fixes.md`、`ux1b-connection-explorer.md`、`ux1c-context-dock.md` | 保留为交付记录 | `04-ux1-terminal-workspace.md` | 它们含已执行的 PR/测试/变异/证据，不能删除 |
| `docs/design/terminal-next/f0-*`、`tn-sftp-*` | 保留为交付/审计记录 | `04`、`09` | 真实生命周期和 E2E 证据可追溯 |
| `docs/design/terminal-next/integrated-acceptance-report.md` | 保留 | `09` 引用 | 真实集成验收记录，不是设计重复 |
| `docs/design/terminal-next/release-engineering-*`、`release-engineering-evidence/**` | 保留 | `09` 引用 | 构建、符号和体积是发布证据 |
| `docs/design.md` | 保留并加 legacy banner | `00`、`README` | 根文档仍被项目索引/历史链接引用，内容需明确不再是 TN 权威规范 |
| `docs/plans/terminal-workbench-rebuild.md`、`terminal-reliability-rebuild.md` | 保留并标历史计划 | `02`、`04`、`09` | 含实现历史和可靠性事实，不能误删 |
| `docs/phase9*`、`docs/phase10*`、`docs/phase-b/**`、`docs/ci/**` | 保留 | `01`、`08`、`09` 引用 | 安全、恢复、CI、发布和迁移原始证据必须可审计 |
| `docs/project.md`、`docs/todo.md`、`docs/issue.md` | 保留并更新入口/当前摘要 | `README` + `01` + `10` | 项目状态索引，不把它们当作新的 UX 规范 |

## 3. 清理执行顺序

1. 先创建 canonical 文档和 `archive/legacy-drafts/README.md`。
2. 使用 `git mv` 归档 6 个纯 Draft 设计文件，保留 git history。
3. 全仓搜索旧路径并修复 README、AGENTS、project/todo/design 中的引用。
4. 对 `docs/design.md`、旧 plans 加“Legacy / historical”说明和 canonical 链接，不直接删除仍被引用的文件。
5. 对真实 evidence、安全审计、迁移/恢复、发布报告、CI 规则不做批量清理。
6. 运行 Markdown link scan、路径存在性检查、`git diff --check`。
7. 把文档治理作为独立 commit；代码/运行时 PR 不得依赖未审查的路径移动。

## 4. Archive 规则

`archive/legacy-drafts/` 中的文件只用于了解历史决策，不能作为编码输入。每个归档文件在顶部添加：

```md
> Archived on 2026-11-16. Canonical Terminal Next design is ../../README.md and the numbered blueprint files. This file is retained for historical traceability only.
```

归档文件不能被新的 PR 追加产品决策；如有历史事实错误，改为在 canonical 现状审计中说明，而不是重写历史记录。

## 5. 引用规则

- 设计文档引用相对路径和稳定的仓库文件路径；不引用 `/Users/.../Downloads` 作为编码依赖。
- 外部 v2 provenance 只记录版本、行数和“外部原件”属性，不把个人机器的绝对路径写进仓库；提交的 10 张图在 `assets/reference/desktop` 有稳定路径。
- 真实运行证据必须指向 `docs/verification`、`docs/phase-*`、`docs/ci` 或 GitHub run；设计图链接不能承担证据作用。
- PR body 指向本目录的章节和实际 source/test 文件；实现完成后回写 current-state/PR plan 的状态，但不复制整段规格。

## 6. 文档门禁

- 所有 canonical 文档必须有状态、日期、适用范围和事实来源。
- `PASS` 句子必须带 SHA/环境/证据，或使用 `IMPLEMENTED` 明确只表示代码事实。
- 文档链接、归档路径和参考资产路径必须存在。
- 设计 Token、快捷键、状态机、CredentialRef、RightPanel occupant 不能在多个 canonical 文件中定义相互矛盾的版本。
- 生成式合订版若重新生成，必须从 canonical 文件生成并标记生成来源；不能手改一份孤立合订版继续作为权威。
