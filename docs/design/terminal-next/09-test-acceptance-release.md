---
status: canonical-draft
updated: 2026-11-16
fact_baseline: "main@5f248631e6fff10e824de34cd73b2291fc8ab416"
scope: "Level 1-4 testing, evidence freeze, performance, platform matrix and release blockers"
---

# 09 · 测试、验收、证据与发布

## 1. 四级验收模型

### Level 1 — Code Correctness

目标是证明代码和状态机的局部语义：

- TypeScript typecheck、ESLint、Vitest、source-size、bundle budget。
- Rust fmt、clippy、unit/integration、SQL/Provider/Recovery 状态机。
- Node harness、fixture parser、workflow contract、证据 schema。
- 变异测试：把保护删掉或回退到旧实现时，测试必须变红。

Level 1 通过不能声明 GUI、真实 sshd、Keychain 或产品发布完成。

### Level 2 — Integration

目标是证明真实服务边界：

- Tauri IPC → Rust command →真实 SQLite/Recovery。
- 真实 OpenSSH：password/key/agent/cert/Jump、HostKey、断线/重连。
- 真实 SFTP：staged upload/download、SHA-256、Queue、cancel、Host pin、关闭 Dock。
- Credential Provider：Vault fixture、引用版本、导入/导出、失败补偿。
- Extension Registry/ModelDriver/Inspector fake service 和真实 typed gateway。

CLI fixture 只覆盖协议层；不能替代真实产品 UI→Tauri IPC→Rust→协议。

### Level 3 — Native Desktop

目标是证明真实 Tauri WebView 和系统交互：

- macOS WKWebView、Windows WebView2、Linux WebKitGTK 的真实渲染。
- Window Controls、drag region、DPI 100/125/150%、min window、focus/blur、Mission Control/Taskbar。
- 物理键盘重叠、中文/日文/韩文 IME、Option/dead key、系统粘贴、Vim/tmux、焦点恢复。
- Native GUI E2E 当前 HEAD 的真实 Terminal mount、PTY output、SFTP Dock、布局、错误/权限态。
- Keychain/Credential Manager/文件对话框/系统权限。

Native GUI 最近一次成功 SHA 不得替代当前最终 SHA；无设备或权限时写 `BLOCKED`。

### Level 4 — Release Acceptance

目标是证明可分发和可长期使用：

- 真实安装器、签名、公证/Authenticode、Updater、产品 Identifier。
- A→B 升级、B→A 读取/回退、损坏/只读/磁盘满/SIGKILL/重复启动。
- 三平台安装、启动、PTY、SSH/SFTP、数据保留和清理。
- 7 天 Daily Driver：无 P0/P1、断线/误 Host/IME/资源泄漏记录。

CI 绿、源码测试绿、打包成功都不能单独提升到 Level 4。

## 2. 核心矩阵

| ID | 触发 | 证据 | 最低标准 |
| --- | --- | --- | --- |
| CORE-01 | Focus 1440/1024 | 截图 + xterm actual cols | ≥120/≥80，终端不重建 |
| CORE-02 | Explorer/Dock/字体变化 | layout decision + actual cols | 低于 60 时正确让位 |
| CORE-03 | 100 次开关 Dock/Route | Session/Listener/ACK trace | 不新增 PTY、无 listener 增长 |
| CORE-04 | 2 Pane/Tab/Workspace | shell output + pane IDs | 当前 Core 仅验收双 Pane 的输入/输出、焦点和恢复字段；2×2/4 Pane 另立扩展门禁 |
| CORE-05 | 后台长命令 + 隐藏 | ACK/session trace | 输出继续，恢复可见 |
| CONN-01 | password/key/agent/cert/Jump | sshd fixture + app logs | 真实产品链路成功和准确错误 |
| CONN-02 | locked/unknown/corrupt credential | UI + DB ref diff | 不清 ref，不网络重试 |
| SFTP-01 | Rust staged upload | 双端 SHA + logs | 完整性匹配 |
| SFTP-02 | UI Queue→IPC→Rust | GUI + Rust + SHA | 产品链路完成 |
| SFTP-03 | 上传中关 Dock | 产品 GUI progress + Rust registry/remote SHA | 传输在产品链路中继续或明确取消；最终状态只结算一次并清零，不能只用“Session 未 close”代替字节完整性 |
| SFTP-04 | Host A pin / Tab B | remote paths + GUI | 不串台、不误传 |
| SFTP-05 | 100 次 drag mount | listener/transfer count | 一次拖放一次上传 |
| CRED-01 | Provider write/read/fail | fixture + ref diff | 旧代可读、新代完整 |
| EXT-01 | enable/disable/throw | Registry + PTY count | 无残留、不影响终端 |
| AI-01 | Context Review/Cancel | redacted payload + run trace | 只传批准文本 |
| AI-02 | 401/429/timeout/late chunk | error + runId | 不串新 Host |
| INSPECT-01 | permission/disconnect | probe trace | 不显示假 Healthy |
| SEC-01 | capability allow/deny | same Tauri version log | 限权真实有效 |
| MIG-01 | old→new→old | DB/Vault/backup SHA | 引用/数据不丢 |
| RELEASE-01 | installed app | per-platform boot/GUI | 真实运行，不只打包 |

## 3. 当前证据状态

截至 2026-11-16：

- 主线 CI `43814394847`：当前 `5f24863` 成功，覆盖前端、Rust、Team Server、脚本、源规模和发布门禁。
- Upgrade E2E `43814394934`：当前成功，包含 macOS 当前版本升级/恢复、Vault app-level、磁盘满、历史升级、Linux DEB、AppImage replacement、Windows profile isolation preflight、临时 updater runtime。
- Native GUI E2E 最近成功 run `43811877940` 对应 `71542f5`，不能作为当前 `5f24863` 的 GUI 证据；当前设计 Draft 不修改代码，最终实施 PR 必须按最终 SHA 重采。
- SFTP GUI/命令级 E2E、staged transfer、Session Claim/Registry 相关实现已合入主线；当前 GUI 证据仍需确认 seed fixture 与每个 spec 的 `GUI_E2E_HOME` 使用同一数据库，且上传中关闭 Dock 的通过标准必须包含远端 SHA/字节结果，而不只是 Session 未关闭。每个新源代码改动仍会使指纹证据按仓库规则失效。
- 当前 main protection ruleset 要求单一聚合 context `required`；Native GUI E2E 不在 required set。PR 绿灯不能推导 Native GUI 已通过，最终验收必须显式读取 Level 3 结果。仓库侧证据见 [`../../ci/final-acceptance.md`](../../ci/final-acceptance.md)：`WINDOWS_GUI_E2E_READY=FAIL（有修复，未验证）`、`LINUX GUI E2E` 同为 informational、`SIGNED_RELEASE_READY=NOT_RUN`。
- macOS/Windows 正式签名、公证、正式 Updater key、Identifier 迁移和部分平台实机项仍是 Level 4 的独立边界。

## 4. 证据冻结流程

1. 冻结最终 SHA，`git status --short` 必须只含预期文件；记录 worktree、Node/pnpm/Rust/OS/arch。
2. 运行仓库官方 quality gates：frontend、Team Server、Rust、scripts、source-size、bundle、audit、evidence。
3. 对所有 `FINGERPRINT_PATHS` 计算源码指纹；记录 debug/release/test binary SHA 和 frontend dist hash。
4. 真实 GUI/安装器/升级使用同一最终 SHA；截图带真实窗口尺寸、环境、fixture 和 artifact 路径。
5. 报告每个场景的 `PASS/FAIL/PARTIAL/NOT_RUN/BLOCKED` 和具体原因。
6. 不手工改 manifest、旧 JSON 或截图描述让门禁变绿；源码再改必须取消旧证据并重采。
7. Draft PR 的 CI 必须是 PR 最终 SHA 的 run，不能引用 base/main 的旧绿灯。

## 5. 性能和体积

| 指标 | 计量 | 目标/规则 |
| --- | --- | --- |
| First Terminal | spawn→真实输入回显 | 固定环境 n≥20；较基线回归 >10% 要解释 |
| Tab switch | click→focus/visible buffer | 不重建 PTY，报告 p95 |
| Dock first open | click→真实列表 | 懒加载不阻塞终端 |
| Layout reflow | 100 次拖拽/字体变化 | 无 remount/thrash；最终 cols 准确 |
| Bundle | Initial/All gzip/raw | 同时报告，新增依赖给 delta |
| Binary | release/strip/LTO/strip+LTO | 同 SHA、同 dist、符号配对 |
| RAM | idle/2 pane/SFTP/AI | 当前 Core 以双 Pane 测量；未来 2×2 需另行建立预算 |
| Transfer | 固定大小真实 sshd | SHA、速度、CPU、资源回收分开记录 |

二进制 `release-small`、strip 和 LTO 是独立发布工程议题；未归档 dSYM/PDB/debug symbols 前不能只看体积决定上线 profile。

## 6. 发布阻断

### P0

- Secret/credential ref 丢失、明文泄漏、Provider 迁移不可回滚。
- 错 Host/错 Pane/错路径操作，Session 或 SFTP Registry 泄漏。
- Native GUI 无法可靠输入、窗口控件不可用、升级损坏数据。
- 正式更新链没有有效签名/公钥，或默认启用 fail-closed 之外的未签名 updater。

### P1

- Windows/Linux 真实运行、Pageant/PTY/串口、Keychain、IME 或安装升级没有证据。
- AI/Inspector/Extension 误影响核心终端、默认启动产生额外网络/CPU。
- 真实 7 天日用记录缺失；关键功能只通过浏览器/Mock。

### 外部阻断

- Apple Developer ID/Notarization、Windows Authenticode、平台设备、屏幕录制/Accessibility 权限、Linux stock WebKit/桌面环境。
- 每项必须写为 `BLOCKED`，不能改成代码 PASS。

## 7. 每个 PR 的验收模板

```ini
BASE_SHA=
HEAD_SHA=
WORKTREE=
SCOPE=
NOT_IN_SCOPE=
LEVEL1=
LEVEL2=
LEVEL3_MAC=
LEVEL3_WINDOWS=
LEVEL3_LINUX=
LEVEL4=
REAL_SSH=
REAL_SFTP=
CREDENTIAL_PROVIDER=
GUI_CURRENT_HEAD=
IME=
BUNDLE_INITIAL_GZIP=
BUNDLE_ALL_GZIP=
SOURCE_FINGERPRINT=
EVIDENCE_RUN=
ROLLBACK=
REMAINING_P0=
REMAINING_P1=
MERGE_ALLOWED=NO
```

## 8. Daily Driver 判定

Daily Driver 不是自动化测试总数。需要：

- 固定版本和设备/OS 记录。
- 至少 7 个连续日历日真实使用，覆盖 Local、SSH、Jump、SFTP、Split、Workspace、凭据锁定/保存、Command Palette、复制粘贴和窗口恢复。
- 每个故障记录 Host/Session/步骤/是否可复现/是否数据丢失。
- 物理输入、IME、网络切换和 sleep/wake 分开写证据。
- `DAILY_DRIVER_READY=YES` 只在无未解释 P0/P1 且核心路径真实通过后设置；AI/Inspector 不是 Core Ready 的必要条件，但不能把它们的缺口隐藏。
