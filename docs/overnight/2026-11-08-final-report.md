# Terminal — Overnight Engineering Sprint 最终报告

- 截止：2026-11-08 12:00 +08:00
- 分支：`feat/phase9-7-product-acceptance`
- 基线：`main` = `3b23e8c`
- 源码冻结：`e9858c9`（其后仅文档/证据提交）
- PR #9：Open，**非 Draft**，未合并

## A. 实际完成的代码

### 1. 源码体积门禁（CI 恢复）
- 问题：`fr/app.ts` 301 行超过 300；i18n 扫尾使两个组件文件超限。
- 修复：`common.*` 键拆到 `locales/<lang>/common.ts`；命令面板快捷动作与 SFTP
  对话框各自拆出。`check-source-size` 584 文件通过。
- commit `b9b7893`。

### 2. SFTP 跨主机隔离
- 根因：`loadDir` 闭包沿用旧 `sessionId`；在途列表返回后覆盖新主机目录；旧会话
  不释放；并发创建会话泄漏。
- 修复：session 记录所属 hostKey；切换即 close；每次 load 取 generation，过期响应
  丢弃；删除/重命名/mkdir 只发往当前 host 的 session；在途 Promise 复用；卸载后
  resolve 的会话关闭。
- commit `f67f86c`；测试 `use-sftp-remote.test.tsx`（旧实现 2/2 失败，新实现 4/4 通过）。

### 3. 云团队创建
- 根因：UI 调用的 `createTeam` 只写本地 SQLite，从未调用 `POST /teams`。
- 修复：`createCloudTeamWithSettings` 校验 endpoint/token → 先 list 复用同名团队 →
  否则服务端创建 → 持久化服务端 id/成员/settings → 设置 currentTeam；失败返回
  stage 与 serverTeamId，UI 不误报成功。
- commit `43a1d54`；5 项 action 测试 + 2 项对话框测试。

### 4. Team Sync 跨版本安全策略
- 根因：历史客户端毫秒游标 + 裸 INSERT；当前服务端返回全量窗口导致 UNIQUE。
- 决策（ADR）：最低支持版本；裸数字 ≥1e12 游标在读取任何数据前返回
  `426 CLIENT_UPGRADE_REQUIRED`。旧客户端不能继续同步（A_TO_B=FAIL），但拒绝
  不交付/不写库/不改本地数据。
- commit `bbf8067`；新增 ADR、协议/服务/真实 HTTP 测试，跨版本 harness 记录
  `LEGACY_CLIENT_SAFE_REJECTION=PASS`。
- 已知限制：协议 1 无 cursor 且 >200 行的首次同步仍可能只拿到前 200
  （`overnight-review-findings.md` #9）。

### 5. 数据安全修复（代码审查）
- 云同步不再删除 local/其他 endpoint 的共享（`ebf4600` + `5db55fa`）。
- 敏感态冲突返回 `SENSITIVE_STATE_MISMATCH`，不空写/不丢编辑。
- `operation=DELETE` push 明确拒绝。
- 不完整 resync 不再清理本地行。
- 端口转发读写拆分，消除 `-L/-D` 全双工死锁（`ccd57ae`，duplex 回归测试）。

### 6. 远端端口转发（-R）接线
- 根因：listener 只写入无人读取的 `FORWARD_REGISTRY`，`ClientHandler.forward_listener`
  从未赋值；`server_channel_open_forwarded_tcpip` 永远丢弃连接；stop 不取消远端绑定。
- 修复：slot 改为共享 `Arc<RwLock<..>>`，建连时存入 `SshSessionState`；setup 写入，
  stop/shutdown 清空并 `cancel_tcpip_forward`。
- commit `47e4464`；slot 共享回归测试通过；真实 SSH 端到端仍 NOT_RUN（本机无 sshd）。

### 7. 路由预加载
- 用户首次进入仍看到 Loading：懒加载在点击时才拉取 chunk。
- 修复：router 创建后立即并行 import 全部路由视图，首次导航命中模块缓存；
  Suspense fallback 改静默骨架屏（aria-busy），不再显示文字。
- commit `08ccda7`；前端 164 文件/1436 项与 bundle budget 通过。

### 8. Settings / Hosts / UI
- Settings：loading/ready/error、失败重试、未保存标记、离开回滚预览、保存中禁用。
- Hosts：加载失败显示错误与重试，AbortSignal 防过期，loadGroups 不再 unhandled。
- Host Dialog：shadcn Dialog（焦点/Esc/aria），未保存关闭需确认；表单逻辑拆 hook。
- 侧栏：Arrow/Shift+Arrow/Home/End 键盘调整 + pointer 拖拽 + aria 值。
- 全量中文化：设置、主机、端口转发、钥匙串、SFTP、片段、团队、已知主机、
  命令面板、日志、串口；bundle 预算 577→588 KB（逐次注明新增来源）。
- commit `cd39c61` 及之前的 i18n 提交。

## B. 未完成任务

见 `docs/phase9-7/overnight-review-findings.md`：
-R 远端转发未接线；SSH writer 超时竞态；协议 1 首同步截断；teamApi 单例跨
endpoint；上传失败截断远端文件；SFTP 列表 mtime；Windows NSIS/AppImage stock；
正式签名/公证/身份迁移；UI 截图（本机无辅助功能/录屏权限，NOT_RUN）。

## C. CI 与 E2E

- 六份证据：官方矩阵 [`42399093877`](https://github.com/baicie/terminal/actions/runs/42399093877)（`e9858c9`）**3/3 success**，指纹 **`7f426434…`**（debug `893c6c6f…`、release `5c4f92b4…`），`check-verification-evidence` **0 problem**；raw log 在 `docs/verification/raw/42399093877/`。未手工修改 manifest。
- Upgrade E2E：`42399231199`（`e9858c9`，含 updater runtime job）**6/6 success**。
- 最终 CI：证据提交后的 HEAD 上运行，URL 见 PR 检查。
- 本地门禁：Rust 341 项 + clippy all-features + fmt；前端 164 文件/1436 项；Team Server 124 单测 + 97 真实 PG；source-size 584 文件；bundle budget 通过。

## D. UI 效果

- 真实 Tauri：`/Applications/Termius.app` 安装 `0.0.1-dev.10-local`（本机验证）。
- 截图：NOT_RUN（无屏幕录制/辅助功能权限；仓库未安装 Playwright）。
- 浏览器 mock 截图未生成，不以 mock 冒充真实桌面。

## E. Git 与 PR

- 分支：`feat/phase9-7-product-acceptance`
- PR #9：Open，非 Draft；未合并、未打 Tag、未发布 Release。
- 工作区：待证据提交后确认 clean。

## F. 质量评价

- 核心正确性：SFTP 串线、云团队幽灵创建、本地共享误删、敏感态覆盖均修复并有回归测试。
- 数据安全：跨版本采用 fail-closed 最低版本策略；本地/服务端数据在拒绝路径保持不变。
- 异步生命周期：SFTP 在途会话、卸载、过期响应已覆盖；SSH writer 竞态仍开放。
- Team Sync：受支持客户端行为不变；旧客户端安全拒绝；首同步截断为已知限制。
- UI/UX：失败态、可访问性、键盘调整与中文化明显改善；截图证据缺失。
- 测试可靠性：修复了依赖 `Date.now` 同毫秒的 flake；前端 1436 项稳定通过。
- 发布准备度：仍不可发布（签名/公证、Windows/AppImage、-R 等）。

## G. 下一轮建议

1. 修复 -R 远端转发接线与 `cancel_tcpip_forward`，加真实 russh 双向测试。
2. 协议 1 首同步整窗/拒绝 + 当前客户端显式初始游标，消除 >200 行静默截断。
3. SSH writer 超时语义与 health 判定，补容量 1 队列回归。
4. 上传临时文件 + rename，避免失败截断远端原文件。
5. Windows 一次性 VM 的 NSIS A→B 与 AppImage stock 启动；UI 截图在具备 GUI 权限的 runner 上执行。
