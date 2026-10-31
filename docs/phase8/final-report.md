# Phase 8 · Final Report

## 1. Git 状态

| 项 | 值 |
| --- | --- |
| 分支 | feat/phase8-rc-hardening |
| 基线 | main 301cf04e7ef8b0ed6bf70e623384ce1fbf8c8e6c |
| 最终 HEAD | b8d85f7227b6d4472a840884cdeb5c52e32854e1 |
| 工作树 | 干净（仅会话既存的未跟踪 .workbuddy/） |
| Draft PR | https://github.com/baicie/terminal/pull/5 |
| 合并 / tag / Release | **全部未做** |

## 2. 阶段完成度

| 阶段 | 状态 | 说明 |
| --- | --- | --- |
| P8.0 基线与证据治理 | **COMPLETE** | 基线报告；门禁二进制绑定收紧到固定路径 + 8 条篡改测试；修正 5 处反向失真文档 |
| P8.1 Vault 安全与迁移 | **COMPLETE** | verifier 拒绝错误密码；create 独占创建无 TOCTOU；13 新测试 |
| P8.2 SQLite 事务正确性 | **COMPLETE** | 审计确证不成立；改用 Rust 单连接单事务；12 条真实临时 SQLite 故障注入测试 |
| P8.3 Linux SSH/PTY 收口 | **PARTIAL** | A: stale-output 已在真实 runner 验证通过。B: zsh 三条 BLOCKED_EXTERNAL（需 Linux 环境二分） |
| P8.4 生命周期与背压 | **PARTIAL** | 输出静默丢弃已修 + 不变量 accepted=parsed+dropped；8–32MiB 压力用例未补 |
| P8.5 Team Sync 故障恢复 | **COMPLETE** | 13 例真实 PostgreSQL 并发测试；Phase 7 修复全部 VERIFIED_EXISTING；发现并标记 A4 缺口 |
| P8.6 UI/UX 打磨 | **PARTIAL** | 10 项定点修复（状态造假、危险操作、a11y、i18n、reduced-motion）；未修清单已列，无截图验收 |
| P8.7 RC 工程 | **PARTIAL** | LICENSE 补齐 5 处；10 处文档失真全部修正；三平台安装/升级 NOT_RUN |

## 3. 修复清单（按影响排序）

### P0 · 数据与安全

| 问题 | 修复 | 文件 |
| --- | --- | --- |
| 导入事务不成立：真实最坏是**半导入落盘且不报错**，以及他人写入被并入导入事务后**静默回滚**（原文档「最坏为可见失败」的论断已作废） | 新增 Tauri command，复用插件同一 pool，pool.acquire() 取单连接 → BEGIN IMMEDIATE → 9 表 → COMMIT，出错与超时都在同一条连接 ROLLBACK | src-tauri/src/db_import/{mod,payload,writer,tests}.rs；service/sync-import.ts、sync-import-support.ts |
| vault_unlock 不校验密码，空 Vault 任意密码可解锁 | 域分离 HMAC-SHA256 verifier + 常量时间比较，错误密码在 unlock 阶段拒绝 | src-tauri/src/vault.rs、vault_tests.rs、errors.rs |
| vault_create 原子覆盖已存在文件 | OpenOptions::create_new 独占创建（无 TOCTOU），失败不留残骸 | 同上 |
| 证据门禁的二进制绑定不成立：删掉 binary 整块只留 note.sha256=正确值即可整份通过 | 锚定固定路径，每份证据逐条断言 5 件事 | scripts/check-verification-evidence.mjs + test |

### P1 · 可靠性

| 问题 | 修复 | 文件 |
| --- | --- | --- |
| Linux stale-output：判据用整行精确相等，而 barrier 无前导换行被粘在 prompt 后 | Rust 侧 marker 加前导 CRLF；前端新增包含语义判定；canary 改为「任意行包含即失败」（更严） | terminal_smoke.rs、terminal-smoke-buffer.ts、run-terminal-smoke.ts |
| 输出静默丢弃：takeHead 在 receipt 失效时整块 shift，acceptedBytes 不减、不报错、不 ack | 新增 TerminalOutputDropLedger 计数 + warn，snapshot 暴露 droppedBytes/droppedChunks | terminal-output-queue.ts（新）、terminal-output-scheduler.ts |
| 诊断 tail 取最后 32 条的后 8 条，短输出时必然全空，导致误判「终端为空」 | 改为「最近非空行 ×8」并补 bufferLength/cursorY/viewportY/baseY | terminal-smoke-diagnostics.ts |
| 端口转发三处状态造假：不调后端就置 active、停止失败仍报成功、无会话仍写 enabled:1 | 全部以真实后端结果为准 | view/port-forward/index.tsx |
| 删除主机零确认，且把「删除」按钮文案当成功提示、失败也报成功 | 新增确认框说明后果，仅成功后提示 | view/hosts/host-card.tsx、hosts-card-actions.tsx（新） |

## 4. 测试

| 门禁 | 基线 | 现在 |
| --- | --- | --- |
| 前端 | 1283（146 文件） | **1301（148 文件）** |
| Team Server 默认 | 116（25 文件） | **116（25 文件）** |
| Team Server 真库并发 | 无 | **13 例（12 pass + 1 it.fails 已知缺口）**，已接入 CI |
| Rust | 247 + 3 集成 | **272 + 3 集成** |
| 门禁脚本 | 246 | **254** |
| 生产文件行数门禁 | 558 | **560** |

## 5. 真实 CI

| run | 提交 | 结论 |
| --- | --- | --- |
| https://github.com/baicie/terminal/actions/runs/41176110602 | d9e161d | **success，8/8 job** |

八个 job：Frontend quality、Team Server quality（含新接入的真库并发套件）、Team Server container、Rust quality、Production source-size gate、Tauri build ×3（macOS / Ubuntu / Windows）。

| run | 提交 | 结论 |
| --- | --- | --- |
| https://github.com/baicie/terminal/actions/runs/41176128211 | d9e161d | macOS ✅ / Windows ✅ / **Linux ❌**（zsh 三条，见 P8.3-B） |

**CI 全绿不等于实机验收通过。** 见第 6 节。

## 6. 真实设备证据与 NOT_RUN

| 项 | 状态 |
| --- | --- |
| Linux stale-output 修复 | ✅ **VERIFIED on real runner**（ok=true stage=complete 两次） |
| Linux zsh 三条 shell probe | ❌ BLOCKED_EXTERNAL（需 Linux 环境二分：禁用 rc / 最小 rc / bindkey -v） |
| 6 份实机证据 | ✅ **已用当前源码重采**：run 41176128211，manifest 指纹 a6cd9881…，debugSha 41cfa67d…，releaseSha 08ea8801…，7 份原始日志入库 docs/verification/raw/41176128211/ |
| macOS Gatekeeper 下载拦截与拖入 Applications | **NOT_RUN** |
| Windows SmartScreen / MOTW / 安装卸载 | **NOT_RUN** |
| Linux AppImage 沙箱 / dpkg 依赖 / glibc 下限 | **NOT_RUN** |
| 升级与降级后用户数据保留 | **NOT_RUN** |
| updater-signed 真实升级链路 | 已在 v0.0.1-dev.2 跑通打包与签名，**但未在真实设备上执行过升级** |
| 物理键盘 / 中文 IME / Option-dead key | **NOT_RUN**（需人工键入） |
| 串口真实硬件 | **NOT_RUN** |

## 7. 仍然存在的 P0 / P1 / P2

**P0（必须在 RC 前解决）**

1. **三平台安装/升级/数据保留全部未验证**。这是 RC 的硬阻塞项，CI 全绿不能替代。

> 原本列在此的「6 份实机证据需重采」**已闭合**：run 41176128211 产出后经 fetch-verification-evidence 安装，
> check-verification-evidence => passed for 6 current evidence file(s)，且 pnpm verify all exit 0。

**P1**

3. **A4 增量游标缺口**：本轮 SELECT 之后才提交、updatedAt 落在本轮窗口内的写入会被下一轮永久跳过（已用 it.fails 标记）。修复需 DB 侧单调版本列或重叠窗口 + 迁移。
4. **Linux zsh 三条 shell probe**（BLOCKED_EXTERNAL，见上）。
5. **view/vaults/** 整目录是不可达死代码**（无路由、无外部 import，全英文硬编码）。需决策删除或重新接线。
6. **产品身份四种拼写**（Termius / termius / terminal / Terminal），且 Termius 是既存商业产品名。改 identifier 会让老用户数据目录失联，RC 阶段禁改；商标问题需产品决策 + 迁移设计。
7. **连接级 PRAGMA 未统一**：busy_timeout/synchronous/cache_size 只作用于执行 PRAGMA 的那条连接，其余用 sqlx 默认 5s。只影响锁冲突等待时长，不影响正确性。
8. **无升级前 DB 快照、无 schema 版本闸门**；「新库被旧版本打开」从未验证。vault.json 与 DB 不同目录且不随 identifier 走，任何迁移方案都须把它算进去。

**P2**

9. 本机 Node v22.12.0 与仓库声明的 24.16.x 不符（CI 合规）。
10. P8.6 未修的 UI 项：update-check 约 20 条英文硬编码、custom-title-bar 硬编码色与 aria-label、若干 animate-* 缺 motion-safe、语义 token 违规。
11. `#[cfg(not(unix))]` 的 Windows 独占创建分支只编译未实机。

## 8. 安全与数据迁移兼容性结论

**Vault**

- 新格式写入 verifier；旧格式（无 verifier）三条路径都已处理：非空则解密真实条目验证并原子迁移；为空则**明确承认不可验证**并封存；迁移失败不影响旧文件与旧密码。
- **不可消除的限制**：历史格式的空 Vault 没有校验材料，首次解锁会把输入密码封存为主密码。已文档化，不假装能验证。
- 未在日志或错误中泄露密码、派生密钥或明文（错误路径只有枚举值）。
- **任何未来的 Vault 格式变更都必须同时处理 verifier**，否则会让既有用户无法解锁。

**SQLite**

- 导入现为单连接单事务，all-or-nothing；并发读写不产生中间态（测试 f 断言采样只能是 0 或 2000）。
- 导入/导出**文件格式零改动**，任何能通过现有 TS 解析的备份都能被新命令接受（Rust 侧字段全 default）。
- 旧版本备份缺列按默认值导入成功（测试 h）。
- 表结构纯增量（CREATE IF NOT EXISTS + 容错 ALTER），升级可读；**回滚到旧版本只是代码推论，从未验证**。

## 9. 下一版本可执行工作计划

1. **冻结源码后重采 6 份实机证据**（macOS 证据 job + fetch-verification-evidence），让 evidence gate 转绿。
2. **三平台人工验收 Runbook 执行**：macOS 带 quarantine 下载 → 拖入 → 首开拦截形态 → 覆盖安装后 DB 复用；Windows MOTW → SmartScreen → 安装/卸载残留 → 覆盖安装 DB 保留；Linux AppImage 沙箱 → dpkg 依赖 → 21.04/24.04 glibc 下限 → 升降级 DB 可读。
3. **A4 游标缺口**：加 DB 侧单调版本列或重叠窗口 + 迁移 + 并发测试。
4. **Linux zsh 三条**：在 Linux 上用最小 rc 二分定位 ZLE 交互。
5. **决定 view/vaults/ 去留**：删除或重新接线到路由与导航。
6. **产品身份决策**：若必须解决商标问题，需单独设计跨 identifier 迁移（首次启动拷贝旧 app_config_dir + 旧更新通道多留一版 + vault.json 一并迁移）。
7. **schema 版本闸门与升级前快照**（VACUUM INTO），并补「新库被旧版本打开」的验收项。
8. **连接级 PRAGMA 统一**（after_connect），把 busy_timeout 提到全部连接。

## 10. 三个 READY 判定

| 判定 | 结果 | 理由 |
| --- | --- | --- |
| **READY_FOR_REVIEW** | **是** | Draft PR 已创建，CI 8/8 通过，改动均可审查，文档齐备。 |
| **READY_FOR_RC** | **否** | 唯一硬阻塞变为**三平台安装/升级/数据保留全部 NOT_RUN**——RC 需要至少能证明「装得上、升得动、数据不丢」，而 CI 全绿不能替代这一点。证据门禁已转绿，不再是阻塞项。 |
| **READY_FOR_RELEASE** | **否** | 在 RC 基础上还需：真实签名链路（Apple 公证 / Windows Authenticode）从未配置、产品身份商标问题未决策、Linux zsh 三条未闭合、无人工物理键盘/IME 验收。 |

**三者不能互相代替**：PR 可审查只代表代码可读可评，不代表能装能用，更不代表可发布。
---

# Phase 8.8 追加（Sync Correctness & RC Closure）

> 基线 `ffde477`，本节记录 8.8 各任务结果。

## A. Team Sync 协议正确性 — COMPLETE

| 原问题 | 结论 |
| --- | --- |
| 客户端用本地 `Date.now()` 做游标 | 已确认为真；改为服务器发放的游标，原样回传并持久化 |
| `baseVersion: item.createdAt` 与服务端 `updatedAt` 比较 | 已确认为真；旧客户端 epoch-ms 版本一律判 stale 并拒绝 |
| A4 游标缺口 | 已修复；`it.fails` 改为正向 `it()`，且断言更强（新增游标单调） |
| CREATE 无版本条件可覆盖较新数据 | 归因更正：离线队列路径本就安全，真正无版本条件的是**推送路径**；已修 |
| CREATE/UPDATE 语义混淆 | 已区分：CREATE 命中已存在行按内容指纹幂等 ack 或 conflict；UPDATE 必带 baseVersion，命中缺失行 conflict 不复活 |

**游标设计的正确性**：`safe = pg_snapshot_xmin(pg_current_snapshot())`，窗口 `txid ∈ [since, safe)`。
证明只依赖事务身份与 xmin——不依赖 sequence 分配顺序，也不依赖任何时钟。
新增的 `Share.version` 由触发器分配但**只用于批内展示排序，不作为游标**。

**代价已披露**：safe 被最老在途写事务钉住，长事务会阻塞增量拉取（正确性优先）；
截断时游标只推进到已投递的最大 txid，宁可重投绝不跳过。

## B. Vault 创建崩溃恢复与连接归池 — COMPLETE

- 改前 0 字节 `vault.json` 与「损坏 Vault」产生**同一个** `UnlockFailed`，且旧 `exists()` 对占位返回 true、`create` 又 `AlreadyExists` → 崩溃后用户**永久卡死**。现区分 `Uninitialized` / `Corrupt` / 正常三态，**没有任何无条件删除**。
- 改前 `rollback` 失败只 `warn!` 后忽略，连接随之归还池 → **带未关闭事务的连接回到池**。现改为关闭该连接，绝不归还。
- 负向对照证明测试非空转：把修复改回旧行为后测试失败（`left: 11 right: 10`）。

## C. Linux zsh 诊断 — PARTIAL

**已排除的假设**：应用生成的 `.zshrc` 破坏 ZLE。去混杂后 zsh 全部变体正常执行命令，`app-rc` 的 transcript 显示健康的 ZLE（含 DECCKM 切换）。

**已确证的事实**：Debian/Ubuntu 上驱动交互式 zsh 会被两个系统级提示吞掉输入——无启动文件时的 `zsh-newuser-install` 向导，以及系统 `/etc/zsh/zshrc` 里 `compinit` 的 `insecure directories ... [y/n]?`。必须设 `skip_global_compinit=1` 并提供至少一个启动文件。

**未解决的**：应用里恰好三条依赖 ZLE 的用例为何超时。若真是 compinit 阻塞，七条都该挂；只挂三条说明另有原因，候选方向是应用 PTY 环境的 HOME 权限、ZDOTDIR 注入时序与 shell 就绪检测的交互。需要带应用内插桩的下一次 matrix。

**我写坏并删除的两版指标**（拒绝用坏指标冒充结论）：`[[ -o zle ]]`（命令执行期间恒为 OFF）、PTY 内发送 `ESC [ A` 测 history（在能通过的 macOS 上同样报 false）。

## D. Vault UI 清理与身份迁移设计 — COMPLETE

不可达性用**程序化依赖图 BFS** 复核（入口 `main.tsx` + `router/index.tsx`，解析 `@/`、相对路径、
`import`/`export-from`/动态 `import()`/`require()`）：可达 484 个文件，`view/vaults` 下 **0 个**。

- 删除 9 个旧容器文件（闭环互引、全英文硬编码、与现代表零交叉）
- 保留 5 个现代表，这是唯一带 i18n 骨架且 `useVaultsView` 承载真实 create/unlock 语义的实现
- 通过 `router/nav-config.tsx` 接入 `/vaults`（该文件是路由与侧栏的**共用数据源**，`buildRoutes()` 由它自动生成，改一处两边生效）
- 新增 18×3 三语 key；键盘（Tab/Enter/Esc）；错误态**对齐 Task B 新增的两个 Rust 变体**：
  `uninitialized` 提示「上次创建未完成」并允许重新创建；`corrupt` 提示「已原样保留供人工恢复」且 **不提供任何破坏性按钮**

`docs/phase8/identity-migration.md` 180 行（未实施）：旧配置发现、DB 与 Vault 备份/校验/迁移/失败回滚、
重复启动幂等、跨平台安装身份后果。**明确声明本阶段不做商标清查、不得宣称新品牌已完成合规审查。**
关键事实：`vault.json` 在 `dirs::config_dir()/terminal/vault.json`，**不随 identifier 走**，必须单列处理。

## E. RC 自动化验收 — PARTIAL（安装链已真机验证，签名与交互项 NOT_RUN）

### E0. 一个被纠正的前提

三个 Tauri 作业原本最后一步是 `tauri build --no-bundle`，**根本不产出安装包**。
补了打包步骤（`tauri bundle` 复用已编译二进制）后才谈得上安装验证。

### E1. 三平台安装链（真实 runner 结果，`aaa8efe` 的 CI 9/9）

**Windows —— 完整通过**：

    [PASS] NSIS 静默安装
    [PASS] 注册表卸载项找到（HKCU\...\Uninstall\Termius）
    [PASS] 首次启动 5 秒存活
    [PASS] 数据目录被首次启动创建
    [PASS] 覆盖安装保留了安装目录与二进制
    [PASS] 覆盖安装后再启动 5 秒存活
    [PASS] 数据保留：数据目录在覆盖安装后仍在
    [PASS] 静默卸载删除了安装目录
    [NOT_RUN] SmartScreen / MOTW（需人工判断）
    [NOT_RUN] Authenticode 签名（CI 无证书）

**macOS —— 安装与身份通过，数据保留未验证**：

    [PASS] dmg 存在、挂载成功
    [PASS] CFBundleIdentifier = com.baicie.termius（身份未被意外改变）
    [PASS] 二进制启动 5 秒存活、覆盖安装保留 bundle、再启动存活、dmg 卸载
    [SKIPPED] app data dir creation —— 5 秒内未创建数据目录
    [SKIPPED] overwrite-install data retention —— 没有可保留的内容
    [NOT_RUN] Gatekeeper 弹窗（阻塞式 GUI 安全对话框，需人工点击）
    [NOT_RUN] Developer ID 签名与公证（CI 无签名身份）

> **必须区分**：Windows 的数据保留**被真实验证**；macOS 的数据保留**是 SKIPPED，不是 PASS**。

**Linux —— 未取到本轮日志**（该 job 在更早的 zsh 处失败），标记 NOT_RUN。

### E2. 数据库升级兼容（真实 SQLite 文件，零 mock）

4 条：`VACUUM INTO` 快照可重开且行数一致 / 旧库升级保留全部行并回填默认值（迁移连跑两次幂等）/
**旧客户端读新库不报错不写坏** / 迁移中断后原库可读可重跑。

其中「旧客户端读新库」正是 Phase 8 P8.7 审计里标记为「只是代码推论、从未验证」的那一项，现已用真实文件验证。

### E3. 证据日志敏感性审查（21 个文件，.gz 已解压扫描）

无 token / 私钥 / 密码 / 真实用户名 / hostname；IP 全是 `127.0.0.1`；只有 `/Users/runner`（CI 临时账户）
与夹具标记 `/home/REMOTE_COLD_MARKER`。**结论：无需脱敏，不删除任何证据。**

### E4. 本轮 CI 红-绿过程暴露的四个缺陷（全部由真机自动化发现）

| # | 失败 job | 真因 |
| --- | --- | --- |
| 1 | Frontend quality | bundle budget 超限——Vault UI 从死代码变成实际打包 |
| 2 | Tauri build (macos) | 我在 P8.7 加的 `licenseFile` 让 DMG 带 EULA，`hdiutil attach` 非交互必取消 |
| 3 | Rust quality | Task B 的 `num_idle()` 断言与 sqlx 的 `after_release` 时序竞态，本地稳定、CI 偶发 |
| 4 | Tauri build (windows) | 脚本猜 `Termius.exe`，实际二进制是 `terminal.exe`，且错误信息指向了错误的检查对象 |

**没有一个是功能逻辑错误，全部是「本地绿 ≠ CI 绿」的盲区。** 这也是本轮最实在的收获。
