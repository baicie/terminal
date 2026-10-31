# Phase 9.0 基线（P9.0-0）

> 生成时间：本轮审查开始时。基线 HEAD `b0a8b57`。
> 任务书给出的审查基线是 `60d2841`；实际 HEAD 已前进 3 个提交（见 §1），按「以新 HEAD 为唯一工作基线」处理，未覆盖任何提交。

## 1. 仓库状态

| 项 | 值 |
| --- | --- |
| 本地 HEAD | `b0a8b57` |
| origin/feat/phase8-rc-hardening | `b0a8b57`（与本地一致，0/0） |
| origin/main | `301cf04`（**未前进**，无后续提交需要避让） |
| PR #5 | OPEN / **draft** / 65 commits |
| 工作树 | 干净（仅 `?? .workbuddy/`，历史遗留，未提交） |

相对审查基线 `60d2841` 新增的 3 个提交：

| commit | 内容 |
| --- | --- |
| `254e7a5` | ci(windows)：用 PowerShell 解析器校验脚本后再跑真实验证 |
| `60d2841` | diag(db)：schema 初始化失败时写入 console（否则该错误无处可见） |
| `b0a8b57` | fix(windows)：单引号字符串里的撇号终止了字符串（4 个解析错误的根因） |

## 2. CI 与实机矩阵现状

| 运行 | SHA | 结论 |
| --- | --- | --- |
| CI `41219324647` | `b0a8b57` | 本轮开始时仍在执行 |
| CI `41217825046` | `60d2841` | **failure** |
| matrix `41211466016` | `9a1d7ed` | **failure**（macOS 远程冷启动、Linux zsh） |
| matrix `41210924239` | `9a1d7ed` | **failure**（同上） |
| matrix `41194616398` | `aaa8efe` | **failure**（Linux zsh） |

**结论：最近一次 CI 与最近一次实机矩阵都是红的。** 不存在「CI 表面绿灯」可依赖。

## 3. 五类证据（本文件的分类约定）

后续所有结论必须标注属于哪一类。混用是上一阶段反复出错的根源。

### 3.1 代码证明（Code）

通过阅读代码与静态结构得出的结论。**可被运行时证据推翻**，不能单独作为正确性依据。

本轮已确认的代码事实：

- `getDb()` 懒加载：`loadDb()`（创建 `terminal.db`）→ `initSchema`（`initializeCoreSchema` + `initializeTeamSchema`）→ `configureSqlite`
- `initializeCoreSchema` 顺序为：`pendingColumnMigrations` →（非空则）`ensurePreMigrationSnapshot` → 首批 `CREATE TABLE` → ALTER 迁移 → 其余语句
- `DB_KEY = "sqlite:terminal.db"` 与前端 `Database.load('sqlite:terminal.db')` **一致**（已排除「键不匹配」假设）
- `backup_database_before_migration` 已在 `src-tauri/src/lib.rs:243` 注册；Tauri v2 自定义命令不需要 capabilities 条目
- 本构建**没有** `tauri-plugin-log`，也**没有**前端到 Rust 的错误上报通道

### 3.2 真库证明（PG）

在真实 PostgreSQL 上执行并通过的断言。

| 套件 | 结果 |
| --- | --- |
| `pnpm --filter team-server test:pg` | **5 文件 / 46 用例通过**（P9.0-1/-3 后由 37 增至 46） |

### 3.3 runner 证明（Runner）

在 GitHub 托管 runner 上真实执行得到的结论。**这是唯一能证明跨平台行为的证据。**

| 平台 | 结论 | 依据 |
| --- | --- | --- |
| Windows | 安装验证脚本**曾因 PowerShell 语法错误无法解析** | 解析器实测 4 个错误，根因是 `app's` 撇号 |
| macOS | 应用**创建了 `terminal.db` 但未完成 schema** | `[FAIL] the app created table "hosts" ...` |
| Linux | **同上**，问题不是 macOS 特有 | `[FAIL] deb: the app never finished creating its schema` |
| Linux zsh | app 环境 4/4 通过，plain 环境 3/4 超时 | 诊断矩阵实测 |
| macOS 远程冷启动 | 连续两次 10 秒内不就绪 | `terminal readiness did not complete within 10000 ms` |

### 3.4 推断（Inference）

**尚未被证据证实的假设。必须显式标注，不得当作结论。**

本轮需要验证的推断：

| # | 推断 | 状态 |
| --- | --- | --- |
| I1 | `ensurePreMigrationSnapshot` 失败导致 `initializeCoreSchema` 抛出，进而 schema 未完成 | **未验证**，但跨平台一致，且时间点吻合 Task 3 新增三列迁移 |
| I2 | #65 远程冷启动失败与 I1 同源 | **未验证**；#65 的 DB 是全列库，理论上不触发快照 |
| I3 | 前端 DB 初始化依赖窗口可见/水合 | **已自我推翻**（第 12 轮提出，第 13 轮 Linux 同样失败后不再成立） |

### 3.5 NOT_RUN

| 项 | 原因 |
| --- | --- |
| Gatekeeper / SmartScreen / Authenticode / 公证 | 需人工 GUI 决策 + CI 无签名身份 |
| 真实 UI 读回（打开列表看到记录） | runner 无 GUI 自动化栈 |
| Vault 加密往返 | 需交互式主密码；加密正确性由 rust `vault_tests` 覆盖 |
| Linux 桌面会话菜单集成 | runner 无桌面会话 |
| Windows 跨版本升级 vN→vN+1 | CI 只构建一个版本 |
| 物理键盘 / IME | 需人工键入 |

## 4. 未闭合问题清单（来自 `docs/issue.md`）

| # | 问题 | 类别 | 阻塞何状态 |
| --- | --- | --- | --- |
| #59 | macOS/Linux 安装验收中应用未完成 schema 初始化 | runner 证明 | MERGE / RC |
| #60 | Linux plain 环境 zsh 三条用例超时 | runner 证明 | RC（诊断项） |
| #61 | 前端 3 条用例满载下超时 | runner 证明 | 门禁可信度 |
| #62 | 迁移前快照无保留策略 | 代码证明 | 低 |
| #63 | 未声明 operation 的旧写入仍可覆盖串行较新数据 | 代码证明 | RC |
| #64 | 客户端 E2E 规格 1 行 `@ts-nocheck` | 代码证明 | 低 |
| #65 | macOS 远程冷启动 10 秒内不就绪 | runner 证明 | RC / 证据 |
| — | Windows 验证脚本语法错误 | **已修复**（`b0a8b57`），待 CI 确认 | — |

## 5. 本轮新增 P0（动态发现，附理由）

任务书 P9.0-1 指出 `P7` 测试的 210 → 200 + 0 现象。本轮把它升级为 P0，理由：
**「旧客户端拿到 200/210 却收到完成信号」是静默数据丢失**，与 P9.0-3 的静默覆盖同类，
都属于「为兼容而牺牲正确性」。它比 #59 更危险，因为 #59 至少会失败得可见。

## 6. 测试基数（本轮开工时）

| 层级 | 数量 |
| --- | --- |
| 前端 | 149 文件 / **1333** |
| Rust | **294** + 3 集成 |
| team-server 单测 | **116** |
| 真实 PostgreSQL | **37** |
| 门禁脚本 | 254 |
| 生产文件（行数门禁） | 554 |

任何修复都不得使这些数字下降。
