# Phase 10 — 现状审计（Daily Driver）

- 基线：`main = 18d6ed0ef38f330088c70b795ca62109c5c60e62`（与任务给定一致）
- 分支：`feat/phase10-daily-driver`
- main CI：`42493878082` 11/11 success（2026-11-08）
- 公开 Release 仍是 `v0.0.1-dev.2`（2026-10-30），**不能代表当前 main 的产品体验**
- 审计方式：源码检索 + 既有测试 + 本地真机运行；本文只记录能被源码或测试证实的事实

## A. 凭据与本地数据完整性

### A1. Host 保存路径写入明文密码/私钥/证书【P0 安全】

- 位置：`packages/frontend/src/service/database/hosts.ts:27`（INSERT）、`:62`（UPDATE）
- 现状：`INSERT INTO hosts (…, password, private_key, certificate, …)` 直接写入明文列；
  同文件 `:36`/`:38`/`:69`/`:71` 绑定 `host.password ?? null` 等原始值。
- 影响场景：任何用户用密码或私钥连接并保存主机后，明文即落在
  `<app data>/terminal.db`；任何能读该文件的人（备份、同步盘、取证、其他本机进程）
  都能直接取得凭据。
- 严重程度：**P0（安全）**
- 复现：`POST` 一台带 `password: 'x'` 的主机 → `sqlite3 terminal.db "select password from hosts"` 返回明文。
- 修复策略：引入凭据边界（`CredentialRef` + `SecretProvider` + 按需解析），Host 行只留
  `credential_ref`；秘密存 Vault 或系统安全存储。
- 验证：负向测试断言 `hosts.password` 恒为 NULL；真实连接在无明文的库上仍成功。

### A2. `storeHostCredential` 存在但主机保存路径从不调用【P0 安全，A1 的直接成因】

- 位置：`packages/frontend/src/service/vault.ts:180`（`storeHostCredential`）
- 现状：能力已实现，但 `hosts.ts` 的增删改路径没有任何调用点（`grep storeHostCredential`
  只命中定义处）。
- 影响场景：用户以为"Vault 已接入"，实际保存走的是明文列。
- 严重程度：**P0**
- 修复策略：在 Host 保存管线接入 `SecretProvider`，与 A1 同一改动完成；不得要求用户
  创建 Vault 才能用 SSH Agent（Agent 无需任何秘密存储）。
- 验证：见 A1。

### A3. SSH Key 表存 `private_key` / `passphrase` 明文列

- 位置：`packages/frontend/src/service/database/`（keys 相关表）
- 现状：需在本阶段确认列语义与写入路径；与 A1 同类风险。
- 严重程度：**P0（待确认范围）**
- 修复策略：与 A1 同一 `SecretProvider` 迁移；加密私钥的 passphrase 按需询问。
- 验证：迁移后列内容不可直接解出秘密；真实密钥认证回归通过。

### A4. 历史明文残留（WAL / 备份 / 导出）

- 现状：SQLite 默认 WAL 模式下，`UPDATE hosts SET password = NULL` **不会**清除
  `-wal` 与旧页中的历史字节；`pre-migration-<epoch>.db` 备份同样保留明文。
- 严重程度：**P0（需明确声明）**
- 修复策略：迁移后执行 `VACUUM`（重建数据库文件）+ `wal_checkpoint(TRUNCATE)`；
  对备份文件不静默删除，改为在 ADR 中声明其保留明文并给出用户可执行步骤；
  所有破坏性清理可审查、可回滚。
- 验证：迁移后对 db/wal 做字符串扫描，断言不含测试密码；备份策略有明确文档。

### A5. 明文导出不存在（当前）

- 现状：源码中没有任何 host → JSON 导出实现（无 `Blob(` 用于主机、无 `exportHosts`）。
- 影响：`PLAIN_EXPORT_SECRET_EXCLUDED` 目前**无既有实现可回归**，必须在新建的
  导入/导出向导里从设计上排除秘密，并用测试锁定。

## B. 日常终端交互

### B1. 命令面板主机搜索被截断到 20 台【P1 可用性】

- 位置：`packages/frontend/src/components/command-palette/use-palette-searchers.tsx:15`、`:55`
- 现状：`const targets = hosts.slice(0, 20)` **先截断再搜索**；`:55` 的 SFTP 动作同样。
  因此第 21 台及之后的主机**永远搜不到**，即使名字完全匹配。
- 影响场景：有 100+ 台主机时，命令面板只能连到随便排在前 20 的机器。
- 严重程度：**P1**
- 复现：造 100 台主机，搜索第 100 台的精确名字 → 无结果。
- 修复策略：完整集合 → 过滤 → 相关性评分（精确名 > 前缀 > 模糊、收藏加权、最近连接加权）
  → 排序 → 截断展示数。
- 验证：1/20/21/100/1000 台矩阵；名称/IP/用户名/标签查询；收藏与最近优先；Unicode 与大小写。

### B2. Quick Connect 语法覆盖

- 位置：`packages/frontend/src/view/hosts/quick-connect-parser.ts`
- 现状：已支持 `host`、`user@host`、`host:port`、IPv6 方括号、`ssh` 前缀与 `-p`；
  有 `SHELL_CONTROL_CHARACTERS` 拒绝 shell 元字符。
- 严重程度：**P2（基本可用，需补矩阵）**
- 需补：`ssh user@host -p 2222`（选项在末尾）等组合的系统性测试，以及不支持参数时的
  明确帮助文案（不得猜测执行）。
- 验证：在既有 parser 测试上补矩阵，断言 `unsupported-arguments` 时不产生连接。

### B3. 快捷键完全不持久化【P1 可用性】

- 位置：`packages/frontend/src/service/shortcuts.ts:12-60`
- 现状：`ShortcutsService` 的 `shortcuts` 是进程内数组，**没有任何 localStorage/数据库读写**；
  `grep localStorage|persist|load` 在该文件零命中。重启即丢失用户改键。
- 额外问题：`addShortcut` 遇冲突只 `console.warn`，仍然加入 → 静默重复绑定。
- 严重程度：**P1**
- 修复策略：接入既有用户配置持久化层；启动加载、更新后立即刷新 UI、冲突显式拒绝、
  支持恢复默认、导入导出包含快捷键。
- 验证：重启后保持；冲突时拒绝写入并有可见提示。

### B4. 粘贴无安全检查【P1 安全/可用性】

- 位置：`terminal-context-menu.tsx:73-78`、`terminal-mobile-menu.tsx:71-76`
- 现状：读剪贴板后直接 `term.paste(text)`，无多行/控制字符/体积预览确认。
- 影响场景：粘贴含换行的多行文本时，最后一行会被 shell 立即执行；粘贴 `rm` 类文本无提示。
- 严重程度：**P1**
- 修复策略：统一 `PasteService`/`PastePolicy`——单行直接粘贴；多行/含控制字符/超限时
  预览与确认；不改写文本、不隐式加回车、不重复注入。
- 验证：右键与 Cmd/Ctrl+V 两路；bracketed paste；Vim/less；粘贴后焦点回到终端。

## C. UI 与启动

### C1. 侧栏一级入口过多，非 Terminal-first【P1 产品】

- 位置：`packages/frontend/src/router/nav-config.tsx:41-92`
- 现状：一级导航 10 项（hosts、teams、keychain、vaults、port-forward、snippets、
  known-hosts、logs、sftp、settings）平铺；`/` 索引路由指向 **hosts** 而非终端。
- 影响场景：打开应用先看到主机管理表，而不是可以立刻打字的终端；团队/Vault 等
  高级功能与日常入口同级。
- 严重程度：**P1**
- 修复策略：一级只留 Terminal / Hosts / SFTP；其余降为二级或按需面板。**不删路由**。
- 验证：启动落在终端；所有原路由仍可达。

### C2. 启动索引路由是 Hosts

- 位置：`nav-config.tsx` `buildRoutes()`：`{ index: true, element: lazyRoute(() => import('@/view/hosts')) }`
- 影响：与 C1 同一用户可见问题（打开即管理页而非终端）。
- 修复策略：索引路由改为终端；`/hosts` 保留。

### C3. 路由预加载与首个终端的资源竞争

- 位置：`packages/frontend/src/router/lazy-route.tsx:31`（路由表构建即 `getComponent()`）
- 现状：启动时一次性启动**所有**页面 chunk 的加载；首个本地终端与此并发竞争带宽/解析。
- 严重程度：**P2（需实测）**
- 处理：本阶段先用 `Daily Driver Scorecard` 测量 `首个本地 Shell 可输入时间`，
  有明确收益才改；无收益则保留，不做无谓的动态加载重构。

## D. 已有但需真实复证的链路

| 能力 | 代码存在 | 真实复证状态 |
| --- | --- | --- |
| 本地 PTY / 终端 | 是（`session/local.rs`） | 本阶段需实测 zsh/bash |
| SSH 密码/密钥/Agent/证书 | 是 | 既有实机矩阵 PASS（Phase 9.x），Phase 10 需回归 |
| Jump Host | 是 | 既有矩阵 PASS |
| SFTP 上传（暂存保护） | 是（9.8-A） | 真实 sshd 脚本 PASS |
| `-R` 远端转发 | 是（9.8-C2） | 真实 sshd PASS |
| Vault 服务级 | 是 | 服务级 PASS；**UI 级 NOT_RUN** |
| 工作区恢复 / db_recovery | 是 | E2E PASS |
| Team Sync | 是 | 跨版本策略 PASS（旧客户端 426） |

## E. 对单人使用无必要（保留但不占主工作区）

- Team / Cloud Sync：单人不使用时应完全不出现于默认路径（当前侧栏一级）。
- Logs / Known Hosts / Vaults 管理：低频，降为二级。
- Experiments：仅 DEV/冒烟构建显示，保持不变。

## F. 审计结论（进入开发）

优先级顺序：

1. **A1/A2/A3/A4 凭据边界与迁移**（P0，数据安全）
2. **B3 快捷键持久化、B4 安全粘贴、B1 搜索完整性**（P1，日常可感知）
3. **C1/C2 Terminal-first 布局与启动**（P1，产品定位）
4. **D 真实复证 + Scorecard 测量**（验收依据）
5. M3 扩展：OpenSSH/Tabby 导入（P1 迁移价值）

不在本阶段做：SessionManager 重写、插件体系、云协作、为新而新的重构。
