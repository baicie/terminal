# Phase 8 · Final Report

## 1. Git 状态

| 项 | 值 |
| --- | --- |
| 分支 | feat/phase8-rc-hardening |
| 基线 | main 301cf04e7ef8b0ed6bf70e623384ce1fbf8c8e6c |
| 最终 HEAD | 见本节末尾（推送后回填） |
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
| 6 份实机证据 | 见第 6.1 节 |
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
2. **6 份实机证据需用当前源码重采**。源码在 Phase 8 多次变更导致指纹漂移，evidence gate 当前为红。

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
| **READY_FOR_RC** | **否** | 硬阻塞：6 份实机证据未用当前源码重采（evidence gate 红）；三平台安装/升级/数据保留全部 NOT_RUN。RC 需要至少能证明「装得上、升得动、数据不丢」。 |
| **READY_FOR_RELEASE** | **否** | 在 RC 基础上还需：真实签名链路（Apple 公证 / Windows Authenticode）从未配置、产品身份商标问题未决策、Linux zsh 三条未闭合、无人工物理键盘/IME 验收。 |

**三者不能互相代替**：PR 可审查只代表代码可读可评，不代表能装能用，更不代表可发布。