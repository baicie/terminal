# 10 · Engineering Execution Plan

## 1. 总规则

- 每个 PR 有独立 base/head、worktree、影响目录、不涉及范围、回滚方式和完成定义。
- 代码 PR 按一个资源 owner 或一个用户能力切片；视觉 PR 不混 Credential/Rust 生命周期；Release PR 不混 AI/Extension。
- 已合入的 UX-1a/b/c、F0、SFTP 和 GUI harness 不重新安排为“从零实现”。新的 PR 只做剩余差距、当前 HEAD 重采或新能力。
- 源码指纹路径变化后，先完成全部本地门禁，再冻结证据。任何追加修复都会使之前证据失效。
- 每个 PR 先在旧实现/失败边界上获得 RED，再在修复 SHA 上 GREEN；不能改断言、跳过真实链路或提高预算掩盖问题。
- 所有 PR 先开 Draft PR；不自动 merge、Tag、Release。

## 2. 本设计交付（当前分支）

### TN-DESIGN-00 · 统一设计与参考资产

- **目标**：建立本目录唯一入口、UX-1～UX-4 统一规格、架构/安全/测试/PR/治理文档和 10 张已核对桌面参考图。
- **依赖**：当前 `main=5f24863`、用户提供 v2.0、现有事实文档。
- **涉及**：`docs/design/terminal-next/**`、README/AGENTS/项目索引（不改生产代码）。
- **不修改**：`packages/frontend/src`、`src-tauri/src`、Cargo、迁移、CI workflow、产品 Identifier。
- **测试**：链接扫描、引用扫描、文档事实审查、图像尺寸核对、git diff/status。
- **完成定义**：唯一入口可按角色阅读；旧设计映射明确；未验证项不写 PASS；Draft PR 记录用户待批准决策。
- **回滚**：删除本设计入口和索引变更即可，不影响运行时。

### TN-DESIGN-01 · 文档治理独立提交

- **目标**：把已被统一规格取代的旧 Draft 设计移入 archive，保留验收/安全/迁移历史。
- **依赖**：TN-DESIGN-00 内容稳定。
- **涉及**：`docs/design/terminal-next/archive/legacy-drafts/**`、旧文档引用。
- **不修改**：真实 evidence、release reports、phase10/phase9、安全审计和代码引用目标。
- **测试**：全仓 Markdown link scan、`rg` 检查旧路径引用、文档索引核对。
- **回滚**：git revert 文档移动；历史文件内容不丢失。

## 3. 已合入、无需重新施工的能力

| 已合入能力 | 主要依据 | 后续动作 |
| --- | --- | --- |
| UX-1a Activity Rail/StatusBar/TitleBar | PR #36、当前 `components/activity-rail`/`status-bar` | 只做统一规格和 Native GUI 当前 SHA 验收 |
| UX-1b Explorer/Recent/单左面板 | PR #37、当前 `features/connection-explorer` | 只补管理态、错误和 GUI 证据 |
| UX-1c SFTP Dock/Pin/deferred release | PR #39、当前 `right-panel`/SFTP binding | 以后扩展 occupant，不重写 SFTP owner |
| F0 布局和 Registry | PR #44、当前 `use-panel-layout`/`sftp.rs` | 保持不变量，针对新改动重采 |
| SFTP staged/Queue/GUI/command E2E | PR #47～#84 | 新功能复用 fixture 和 evidence gate |
| Credential boundary/导入/清除/Vault 审计 | Phase 10.1～10.4、PR #82 | UX-2a 产品化；不重新实现写入安全基础 |
| Upgrade/Recovery/CI evidence | Phase 9.x、PR #83/#84/#86 | 作为所有后续 PR 的证据基础 |

## 4. Core 先行 PR

### TN-UX1-01 · Current HEAD Native Workspace Acceptance

- **目标**：在最终代码 SHA 上重采 Focus/Explorer/Dock/Split/错误/Window Controls/PTY 保活证据。
- **依赖**：当前 UX-1 代码；不依赖 UX-2～UX-4。
- **模块**：`e2e/gui/**`、`scripts/run-gui-e2e.mjs`、`docs/verification/**`（若按官方流程生成）。
- **不修改**：SessionManager、Credential、AI、Extension；不为 GUI 通过改生产逻辑。
- **测试**：Level 1 全门禁、Level 2 SFTP/SSH、Level 3 Native GUI；当前 HEAD evidence gate。
- **回滚**：证据为追加资产；失败保持 NOT_RUN/BLOCKED，不改变产品。
- **完成定义**：当前 SHA 的证据清单完整；缺平台逐项标注。

### TN-UX1-02 · Native Input and Platform Matrix

- **目标**：物理键盘重叠、IME、Option/dead key、Vim/tmux、系统粘贴、窗口焦点、DPI、Window Controls。
- **依赖**：TN-UX1-01；macOS/Windows 设备和权限。
- **模块**：仅必要的 GUI probe/spec、验收文档和小范围输入 bug 修复。
- **不修改**：不得重建 I/O FIFO、OUTPUT ACK、Session lifecycle 以适应截图。
- **测试**：每种输入源真实 GUI；自动 `term.input()` 只作为辅助，不代替物理输入。
- **回滚**：输入修复独立提交；证据不通过就保留旧实现。
- **完成定义**：真实平台矩阵，明确 `PASS/NOT_RUN/BLOCKED`。

### TN-UX1-03 · Right Panel Occupant Contract

- **目标**：把未来 `snippets/inspector/ai` 的单占位者、overlay、关闭不影响 Session、焦点返回和 lazy boundary 变成公共契约。
- **依赖**：UX-1 当前 `rightPanel`；不先实现 AI/Inspector。
- **模块**：`store/right-panel*`、layout tests、public type contract。
- **不修改**：不改 SFTP worker/Queue owner，不迁移 Credential。
- **测试**：互斥 occupant、窄屏 overlay、开关 100 次、Session/ACK/Transfer 数稳定。
- **完成定义**：新增 occupant 只需注册 union/case；测试能阻止第二布尔状态回归。

### TN-CORE-01 · Typed IPC/Capability Audit

- **目标**：在不破坏兼容调用链的情况下，给 Vault/SQL/FS/Session 建立调用点清单和最小 Gateway 方向。
- **依赖**：当前 B01 审计、Tauri 版本、Upgrade 证据。
- **模块**：`src-tauri/capabilities`、命令边界测试、文档；必要时新增 typed command。
- **不修改**：不删除 `vault_get`/SQL 兼容路径，不在本 PR 改 Provider 或 AI。
- **测试**：真实 Tauri allow/deny、main WebView ACL、secret access audit、无回归全量门禁。
- **完成定义**：明确哪些能力保留兼容、哪些只能被未来 Gateway 使用；不把“无 scope”写成任意 FS 已证明。

## 5. UX-2 PR

### TN-UX2A-01 · Connect-Time Credential Experience

- **目标**：认证与保存分离；首次连接可一次性输入；成功后保存；Vault 三态内联恢复；清除/切换认证。
- **依赖**：TN-CORE-01、现有 Credential boundary、HostDialog/launcher。
- **模块**：`view/hosts`、`features/terminal/services`、`service/credential-*`、i18n、component tests。
- **不修改**：不新增系统 Keychain，不自动迁移明文，不改 Rust 密码学。
- **测试**：错误凭据不保存、成功后保存、locked/uninitialized/unusable、Agent/Jump 两侧、切换 key/password/agent、真实 Tauri launcher/sshd。
- **回滚**：feature flag/旧 HostDialog 保存路径保留；数据只加字段不删旧列。
- **完成定义**：用户能“只本次连接”，错误提示提供正确下一步且不消耗网络重试预算。

### TN-UX2A-02 · Provider Registry and Resolver Dispatch

- **目标**：`CredentialRefV2`、Provider Registry、按 ref.provider dispatch、SSH key 三态、模型 namespace 预留。
- **依赖**：TN-UX2A-01、TN-CORE-01。
- **模块**：`credential-boundary/ref/resolver`、Host/SSH key database、Rust import/export policy。
- **不修改**：默认 provider 仍 Vault；不实现 OS provider。
- **测试**：Vault fake/real provider、unknown/unsupported version、跨 provider negative、真实 SQLite import/export、旧 Vault fixture。
- **完成定义**：未知 provider 保留/报告；resolver 不再固定 Vault；秘密不会被空引用遮蔽。

### TN-UX2A-03 · Provider Migration and Recovery

- **目标**：Provider→Provider 新代写入、读回、引用切换、旧版清理、marker/compensation。
- **依赖**：TN-UX2A-02、Recovery/backup 机制。
- **模块**：migration runner/ledger、Provider implementations、upgrade E2E。
- **不修改**：不默认执行现有用户迁移；不修改 Identifier。
- **测试**：每个 crash point、只读/磁盘满/Provider deny、重复重试、旧版本拒绝、完整 ref/secret 对账。
- **完成定义**：失败保留旧 ref，恢复可重试，报告不混淆 data loss/reference loss/rebind。

### TN-UX2B-01 · System Provider Spike

- **目标**：macOS Keychain、Windows Credential Manager、Linux Secret Service 的实际可用性和稳定访问报告。
- **依赖**：TN-UX2A-02；真实签名/平台环境。
- **模块**：provider adapter、隔离 fixture、平台 E2E；不立即改默认。
- **不修改**：不删除 Vault，不自动迁移，不改品牌/Identifier。
- **测试**：创建/重启/升级/回退/路径变化/权限拒绝/删除/多 profile。
- **完成定义**：每平台明确 PASS/PARTIAL/BLOCKED；产品负责人依据报告决定默认策略。

## 6. UX-3 PR

### TN-UX3-01 · Built-in Extension Registry

- **目标**：Manifest、API version、Registry、Disposable、feature toggle、diagnostics、异常隔离。
- **依赖**：TN-UX1-03、TN-CORE-01。
- **模块**：`features/extensions`、Action Registry、menu/dock bridge、内存 settings schema。
- **不修改**：不加载第三方 JS，不改 PTY/Secret/SQL capability。
- **测试**：register/activate/deactivate/retry/duplicate/throw/async late callback/resource count。
- **完成定义**：一个内置扩展异常不影响 Terminal；停用无命令、菜单、listener、timer 残留。

### TN-UX3-02 · Snippet Dock Extension

- **目标**：用真实已有 Snippet 功能验证命令、context menu、Right Dock occupant 和权限。
- **依赖**：TN-UX3-01、TN-UX1-03。
- **模块**：Snippet adapter、`RightPanelMode`、Context Menu、Palette。
- **不修改**：不迁移完整 SFTP；不依赖 AI；不执行未确认命令。
- **测试**：Snippet 搜索/插入/Save、变量缺失、停用/重启、PTY/Transfer 保活。
- **完成定义**：一个简单真实功能经过完整 extension lifecycle，主核心仍由原 service 拥有。

### TN-UX3-03 · Capability Gateway

- **目标**：selected text、read-only session events、send-text approval 的 typed Gateway。
- **依赖**：TN-CORE-01、TN-UX3-01。
- **模块**：Rust command/permission tests、TS SDK、approval ledger。
- **不修改**：不开放任意 FS/SQL/Secret/PTY；不实现社区 runtime。
- **测试**：缺 capability、错误 session、过期/重复/hash 改变 approval、Tauri ACL。
- **完成定义**：Extension API 权限可测且不依赖主 UI 任意 `invoke`。

## 7. UX-4 PR

### TN-UX4-01 · ModelDriver MSRV/Dependency ADR

- **目标**：用当前 crates.io、工具链和三平台 CI 重新决定 ModelDriver/Rig adapter。
- **依赖**：无生产 AI；TN-CORE-01 设计结论。
- **模块**：ADR、临时 spike branch、Cargo audit/size/build measurement。
- **不修改**：不把 Rig 直接合入生产，不升级 Rust MSRV 作为副作用。
- **测试**：Rig 0.46 feature matrix、Rust 1.96/1.97.1、lockfile、audit、体积、编译时间。
- **完成定义**：有推荐方案、替代方案、实际成本、风险和复现命令；默认 AI feature 仍关闭。

### TN-UX4-02 · Model Profiles and Read-only AI Actions

- **目标**：Profile CRUD、API key Provider、ModelDriver、Context Review、stream/cancel/error、四类只读动作。
- **依赖**：TN-UX2A-02、TN-UX3-03、TN-UX4-01。
- **模块**：Rust `ai` feature、ModelDriver、`ai_model_profiles` migration、AI Dock。
- **不修改**：不实现 Agent Loop、不执行远程命令、不读取全量 scrollback。
- **测试**：fake HTTP、真实可控 provider、401/429/timeout/cancel/late response、key leak scan、feature-off build。
- **完成定义**：用户能审查和删除上下文；模型只能返回解释/摘要/草稿。

### TN-UX4-03 · Server Inspector

- **目标**：按需只读 Probe、时间戳、权限/断线/stale 状态、Inspector Dock。
- **依赖**：TN-UX3-03、SSH typed probe boundary；可与 TN-UX4-02 分开。
- **模块**：Rust probe、Inspector extension、Right Dock。
- **不修改**：不建监控历史库、不常驻采集、不把 probe 输出写交互 Shell。
- **测试**：Linux/macOS/Windows capability、permission denied、command missing、切 Host、关闭 Dock、1h resource bound。
- **完成定义**：真实只读数据、无假 Healthy、无 Session/Process/Timer 泄漏。

## 8. Release PR

### TN-RELEASE-01 · Identity/Signing/Updater

- **目标**：在产品负责人批准品牌/Identifier 后，独立完成路径迁移、正式签名、公证/Authenticode、Updater key 和回滚。
- **依赖**：Core Level 2/3、Provider 稳定性、Upgrade E2E、外部证书/密钥。
- **模块**：`tauri.conf.json`、release workflows、migration runner、installer tests、docs/release。
- **不修改**：不和 UI/AI/Extension PR 合并；没有有效签名不启用正式自动更新。
- **测试**：A/B/A、安装/升级/降级、Vault/DB/Workspace/WebView/cache、签名验证、真实重启。
- **完成定义**：Signed RC 或明确 `DEV_ONLY`；正式 updater fail-closed；完整证据归档。

### TN-RELEASE-02 · Daily Driver Acceptance

- **目标**：固定 SHA/设备/环境，运行 7 天真实使用和问题闭环。
- **依赖**：UX-1/2a Core，TN-RELEASE-01 的发布策略可分开。
- **模块**：验收记录、截图/录屏、问题和固定 SHA 关联。
- **不修改**：不把人工结果改写成自动化 PASS。
- **完成定义**：Core 日用状态明确，未验证 AI/Windows/Linux/IME 项不隐藏。

## 9. 集成顺序

```text
TN-DESIGN-00/01
  → TN-UX1-01/02 + TN-CORE-01
  → TN-UX2A-01 → TN-UX2A-02 → TN-UX2A-03
  → TN-UX1-03 → TN-UX3-01 → TN-UX3-02/03
  → TN-UX2B-01 (独立平台门禁)
  → TN-UX4-01 → TN-UX4-02 / TN-UX4-03
  → TN-RELEASE-01 → TN-RELEASE-02
```

TN-UX1-01/02 与 TN-CORE-01 可以并行，因为不写同一生产模块；涉及同一 `FINGERPRINT_PATHS` 的证据必须按最终合并顺序重新采集。UX-4 可以在 UX-3 API 稳定后实施，但 AI feature 不能拖慢 Core。

## 10. 每个 PR 的 Done Definition

- 代码/文档范围与“不改什么”写在 PR body。
- 先红后绿证据来自真实入口，不是只测 helper。
- Level 1/2/3/4 分别列结果；未运行平台写理由。
- 数据变更有 migration、backup、rollback 和旧版本行为。
- `git status` 无临时脚本、日志、数据库、生成包；源码指纹与 evidence run 对齐。
- Draft PR 停止，等待人工审查；本任务不自动合并或发布。
