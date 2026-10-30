# 代码质量审查报告（2026-10-31）

> **审查方式**：6 个只读子代理并行分模块审查 + 主代理逐条抽样复核，**0 行源码改动**。
> **功能基线**：审查期间 pnpm 各质量门禁全绿（详见第 2 节）。
> **与前序的关系**：docs/code-review.md（2026-03-25，覆盖 src/ 与 eslint 配置）是本报告的前序；本报告为其增量与延续，不复述旧结论。

---

## 0. 摘要

工程质量高于同类仓库平均水位：类型纪律近乎干净（终端核心 104 个生产文件 0 个 any、0 个非空断言、0 个 @ts-ignore），xterm 主链路销毁闭环，团队服务端鉴权三重校验，Rust 生产区无 panic!。

一个系统性主题贯穿全部六个模块：**失败被伪装成成功**。端口转发绑定失败返回 Ok、SFTP 权限错误报「会话不存在」、读库失败返回空数组、部分失败的脚本记成 success、证据门禁可被旁路。这比「有 bug」更危险——它让下游排查与门禁同时失去意义。

| 级别 | 条数 | 说明 |
| --- | --- | --- |
| P0 | 3 | 功能性缺陷 / 静默数据覆盖 / 数据半写入 |
| P1 | 38 | 资源泄漏、竞态、错误被吞、契约未实现 |
| P2 | 48 | 可维护性、性能、索引与分页缺失 |
| P3 | 54 | 规范漂移、i18n、死代码 |

去重后合计约 143 条：team-server 20、scripts 门禁链 17、Rust 21、前端状态/服务层 36、前端 UI 31、前端终端核心 21、主代理独立发现 1（部分与 scripts 条重合）。

---

## 1. 方法与证据等级

- **并行分工**：前端终端核心、前端状态/服务层、前端 UI 与规范、Rust 后端、team-server、门禁脚本，六个只读任务。
- **复核纪律**：主代理对 **33 条**关键断言逐条比对源码原文，另自查 **4 条**跨模块事实；不采信子代理自述。
- **复核结果**：30 条成立，**2 条被修正**（见第 7 节），1 处跨报告矛盾被裁定。
- **未做的验证**：无运行时验证（不连真实 SSH / 硬件 / 数据库，不做 EXPLAIN，本机未跑 cargo clippy——但 CI 已强制 clippy）。

### 证据环境限定

package.json:engines 要求 node 24.16.x，.node-version 为 24.16.0，**本机实际 v22.12.0**（pnpm 只 WARN 不拦）。因此第 2 节的绿基线**不是在声明环境中取得的**，复查时需在 Node 24.16.0 下重跑。

---

## 2. 功能基线（审查期间实测，全部 exit 0）

| 命令 | 结果 |
| --- | --- |
| pnpm --filter=@terminal/frontend typecheck | exit 0 |
| pnpm --filter=@terminal/frontend lint | exit 0 |
| pnpm --filter=@terminal/frontend test | 129 文件 / **1164 测试** 全通过 |
| pnpm --filter=team-server typecheck | exit 0 |
| pnpm --filter=team-server test | 25 文件 / **103 测试** 全通过 |
| node scripts/check-source-size.mjs | 553 个生产文件通过 |

这组数字是「不影响功能」的对比基准。任何后续修复都应在此之前后各跑一次。

---

## 3. P0（3 条）

### P0-1 端口转发绑定失败对调用方完全不可见

- **位置**：src-tauri/src/port_forward.rs:98-138
- **机制**：tokio::spawn 内才执行 start_local_forward（其 156 行的 std::net::TcpListener::bind 失败即返回 Err）；118-126 行立即写入 status:"active" 并 return Ok(())；全仓仅 port_forward.rs:716-730 与 shutdown.rs:19 触碰该 task，且只 abort / 记日志，从不读取 Result。
- **后果**：端口被占用时界面显示「已启动」，实际无人监听。已核实前端无二次连通性探测（view/port-forward/index.tsx:122 → service/ssh.ts:156 → port-forward.ts:16 直接 invoke），故对用户 100% 可见。
- **建议**：用 oneshot/mpsc 把首次 bind 结果回传，bind 成功后再返回 Ok；或先同步 bind 再移交任务。

### P0-2 离线队列的 CREATE 重放静默覆盖较新数据

- **位置**：packages/team-server/src/sync/offline-sync.service.ts:217-235
- **机制**：if (existing) 走 update 分支，但 CREATE 负载不带 baseVersion，225 行的守卫 shareData.baseVersion !== undefined 被短路，随后全量 update。
- **后果**：客户端提交 CREATE → 服务端已提交但响应丢失 → 客户端重试，第二次不报冲突，用较旧队列快照覆盖 data / encryptedData / permission；客户端收到 updated 而非 conflicts。
- **归因更正**：推送路径 sync.service.ts:143 走的是 prisma.share.create（share-write-data.ts:67 写入 id），撞主键抛 P2002 并被 148 行 catch 捕获成错误 —— 即「失败且不静默」，**不是**静默覆盖。静默覆盖只存在于离线队列路径。
- **建议**：CREATE 分支显式判定「id 已存在即冲突」，或要求 CREATE 也带 baseVersion；用 updateMany({where:{id, updatedAt}}) 做条件更新。

### P0-3 导入既无事务又自建数据库连接

- **位置**：packages/frontend/src/service/sync-import.ts:7-12、34-53
- **机制**：importExecute 每条语句都执行 module.default.load('sqlite:terminal.db')，绕过 service/database/connection.ts:15 的 getDb() 单例与连接级 PRAGMA（busy_timeout）；importResources 全程顺序 await，无 BEGIN/COMMIT。
- **后果**：第 N 条失败时前 N-1 条已落库 —— hosts 写入成功、groups 失败即产生悬空分组树，用户看到 "Import failed" 却被改了一半，重试会二次叠加。
- **建议**：复用 getDb()/executeQuery；整体包 BEGIN IMMEDIATE … COMMIT，catch 内 ROLLBACK。

---

## 4. P1（38 条）按主题分组

### 组 A｜失败伪装成成功

| 位置 | 问题 |
| --- | --- |
| src-tauri/src/sftp.rs:87-99 | 权限被拒 / 子系统不可用 / 协议握手失败三类全映射为 SessionNotFound |
| src-tauri/src/sftp.rs:371-375 | let _ = create_dir_all(...)，真实原因被后续 File::create 报错掩盖 |
| src-tauri/src/session/ssh_writer.rs:153-158, 282-283 | 单次队列超时即 complete_writer(false)，此后整条写通道永久报废、不可恢复 |
| packages/frontend/src/service/storage.ts:73-79 | catch { return null } → sync-server.ts:99 报「服务器上没有备份」，引导用户上传并覆盖真实远端备份 |
| packages/frontend/src/service/script-executor.ts:135-141 | 三元两分支同写 'success'，4 台挂 3 台记成成功，与 147 行返回值自相矛盾 |
| scripts/run-terminal-smoke.mjs:1084-1099 | 退出码非 0 只在读不到 result.json 时检查，崩溃二进制写好 result.json 仍判通过 |

### 组 B｜静默数据覆盖与丢失

| 位置 | 问题 |
| --- | --- |
| team-server/src/sync/sync.service.ts:33-46 | 游标 Date.now() 在两次查询之后取值，期间落库的行永久漏同步，无自愈路径 |
| team-server/src/shares/shares.service.ts:76-101 等 4 处 | 先查后写无事务，baseVersion 乐观锁可被并发绕过 |
| packages/frontend/src/store/team-actions-sync.ts:96-103, 121 | baseVersion 取 item.createdAt（永不变），冲突检测恒判无冲突 |
| packages/frontend/src/features/terminal/services/terminal-output-scheduler.ts:266 | 溢出时 clearPending 一次丢弃最多 16 MiB，无补写通道 |

### 组 C｜事务与重入缺失

| 位置 | 问题 |
| --- | --- |
| packages/frontend/src/service/database/connection.ts:19-25 | db 在 initSchema() 之前赋值，建表失败后第 16 行直接返回裸连接，schema 永不重试 |
| packages/frontend/src/store/team-actions-sync.ts:25-45 | sync() 无 isSyncing 重入守卫 + 30s 定时器 + fetch 无超时 → 并发同步同一批 shares |
| packages/frontend/src/service/script-executor.ts:12-29 | 重试零退避零抖动，最多 11 次全速重连；66 行 Promise.all 无并发上限 |
| packages/frontend/src/service/sync-import.ts:228-246 | knownHosts 在 replace 模式永不更新指纹；238 行用 randomUUID 而非 item.id |

### 组 D｜无上限与泄漏

| 位置 | 问题 |
| --- | --- |
| features/terminal/services/terminal-session-output-buffer.ts:155 | delivered 回执表无上限；MAX_BUFFERED_*（9-10 行）只作用于 buffered，有 owner 时恒空 |
| features/terminal/services/terminal-output-scheduler.ts:71 | 拒绝入队时不触碰回执 → 悬挂 + 切面板时旧输出二次打印 |
| features/terminal/components/terminal-container/use-terminal-instance.ts:101 | clipboard addon 异步加载无 disposed 保护 |
| features/terminal/services/terminal-session-reconnect-policy.ts:4 | abort 监听器正常路径不移除，随重连累积 |
| service/notifications.ts:126-133 | 通知数组无上限，persistent 全仓无读取点（死字段） |
| service/sftp-transfer.ts:70, 102 | pendingTransfers Map 仅一处 delete，失败/移除记录后不清理 |

### 组 E｜门禁链不自洽

| 位置 | 问题 |
| --- | --- |
| .github/workflows/ci.yml | 覆盖 frontend / team-server / source-size / rust / docker / tauri，但**零覆盖** scripts/*.test.mjs（18 个）与 check-verification-evidence.mjs；无任何工作流调用 pnpm verify |
| scripts/verify.mjs:57-80 | 只列 16 个测试文件，磁盘 18 个；差集恰为 build-verification-evidence.test.mjs、macos-frontmost.test.mjs |
| scripts/check-verification-evidence.mjs:104-112, 434 | 遍历整棵 JSON 树收任意 sha256，命中一个即过 → 加一行 {"note":{"sha256":"<target>"}} 即可旁路产物绑定 |
| scripts/check-verification-evidence.mjs:604-606（同型 10 处） | 软链路径下门禁静默 no-op、退出码 0、零输出，verify.mjs 继续报「全部通过」 |

### 组 F｜契约未实现

| 位置 | 问题 |
| --- | --- |
| team-server/src/sync/share-write-data.ts:37-39 | READWRITE 只在写库处出现，全仓无授权读取点 → 「共享可写」语义在服务端不存在 |
| team-server/src/invites/invites.service.ts:49 | nanoid(24) 首字符可为 -（20k 采样命中 350 次 ≈ 1.75%），而 http-validation.ts:4 要求首字符 \w，invites.controller.ts:64,74 确挂该 Pipe → 该比例邀请链接永久不可用 |
| team-server/src/{shares,members,invites}/**.service.ts | 批量读接口全部无分页上限 |
| src-tauri/src/storage.rs:104, 431, 659 | 三处 reqwest::Client::new() 无任何超时 → 卡死的存储服务让 Tauri 命令永久挂起 |

### 组 G｜前端渲染路径

| 位置 | 问题 |
| --- | --- |
| view/snippets/script-list.tsx:51、view/snippets/index.tsx:148、view/snippets/use-script-form.ts:102 | 渲染/处理器路径裸 JSON.parse（同项目 snippet-list.tsx:47-56 已加 try/catch） |
| view/snippets/batch-execute-panel.tsx:30 | const [timeout, setTimeout] = useState(60) 遮蔽全局定时器 |
| features/terminal/components/terminal-container/use-remote-prompt-probe.ts:74 | 无依赖数组的 effect，每次渲染都执行 |
| hooks/use-window-focus.ts:39-58 | 动态 import 链无 .catch，聚焦检测静默失效 |
| service/workspace-recovery.ts:256 | 整店订阅 + 每帧 JSON.stringify 全布局 + localStorage.setItem（拖分屏逐帧触发） |

---

## 5. P2 / P3 主题统计

| 主题 | 代表 | 量级 |
| --- | --- | --- |
| 规范漂移 | space-y/x-* **199 处**、w-N h-N **123 处**、硬编码十六进制色 **28 处**、border-t 当分割线 12 处、key={index} 3 处 | 高 |
| i18n 缺口（键不缺，用法缺） | en/cn/fr 各 850 键完全齐平，但 components/settings-dialog/index.tsx 283 行**零 t()**；45 个 .tsx 硬编码英文；share-host-dialog.tsx:175 明文共享警告只有中文 | 中 |
| 响应式缺位 | view/settings/（11 文件）、view/app-logs/（2 文件）全子树 0 断点；ViewToolbar 无 flex-wrap | 中 |
| 重复实现 | Tauri 探测 5 份、平台检测 5 份（AGENTS.md 指定的 hooks/use-platform.ts **不存在**）、checkMembership 6 份、上传/下载两份逐行复制 | 中 |
| 死代码 | use-terminal-completion + use-shell-rc-completion 共 98 行零引用、syncOfflineQueue 无调用点、会话输出管线无消费者、audit.create() 无调用方、experiments/ 下 598/445 行文件 | 中 |
| 大文件 | ssh.rs 3442 行、local.rs 1518 行、port_forward.rs 763 行（三类转发 + SOCKS5 同文件） | 中 |
| 索引与分页 | Share 表无任何 @@index；SyncQueue/Team.ownerId/Share.sharedBy 无外键；sync.dto.ts:175 since 上界放行 MAX_SAFE_INTEGER | 中 |
| 类型设置 | team-server tsconfig.json:20-23 关闭 strictNullChecks / noImplicitAny | 中 |

### 主代理独立发现（门禁盲区）

scripts/check-source-size.mjs:11-16 把整个 experiments/ 目录列入 excludedDirectories，且 6-9 行的 sourceRoots 只有两个目录；scripts/*.mjs（41 个）因 isProductionSource（21 行）只接受 .ts/.tsx 而完全不受检。后果是 experiments/xterm-test.tsx（598 行）与 experiments/terminal-shell-probe/protocol.ts（445 行）2-3 倍超限却从未被门禁看见，而 AGENTS.md 宣称「所有文件均已拆分至限制以内」。这两个文件还经 terminal-bootstrap-default-dependencies.ts:2-4 **静态**引入主干、并经 router/nav-config.tsx:124-136 暴露为应用内可达路由 —— 既躲过门禁又进生产包。

---

## 6. 已确认良好（避免只报坏消息）

- **类型纪律**：features/terminal 104 个生产文件 0 个 any / 0 个非空断言 / 0 个 @ts-ignore（主代理 grep 复算 = 0）；UI 三目录 0 个 as any / 0 个 dangerouslySetInnerHTML / 0 个 hr。
- **资源释放**：4 个 Drop guard；SshSession::close 有 2 秒读任务超时 + abort + 连接池释放；writer 用 watch::send_replace 不丢状态；port_forwards 之外的全局锁无跨 await；15 处计时器全部成对；7 个文件监听器 add/remove 计数相等；ResizeObserver 与 xterm dispose 闭环。
- **安全面**：ApiKeyGuard 全覆盖；28 处 :param 全过 IdentifierPipe；分享读写三重校验无越权；令牌存 sha256 摘要且显式拒绝用摘要当 bearer；注册门禁 timingSafeEqual + 生产默认 closed；CORS fail-closed；1mb 体限；错误响应不吐堆栈；日志无令牌。
- **状态一致性**：service/store 全部不可变更新，无一例原地 push/splice；107 个模块导入图 DFS 仅 1 条类型层环，store↔service 无运行时环。
- **CI 门禁**：frontend（lint/typecheck/test/build:budget）、team-server（prisma validate/typecheck/lint/test/build）、source-size、rust（cargo fmt --check / check / **clippy -D warnings** / test）、docker、tauri build 均在 CI 强制执行。Rust 报告自述「未跑 clippy」的缺口由 CI 覆盖。
- **失败即拒绝**：证据生成器 fail-closed 不落盘；verify.mjs 退出码正确传播（未知组 exit 2，失败立即终止）；行数门禁用真实行数而非 length>0。

---

## 7. 复核记录（33 条抽样 + 2 处修正）

**成立（30 条）**：team-server 7 条（含 delivered 无关项）、scripts 5 条、Rust 6 条（含按 #[cfg(test)] 切分的 panic 独立复算）、前端状态层 6 条、前端 UI 5 条、前端终端核心 4 条。

**修正 1 —— team-server P0 归因收窄**：原报称 sync.service.ts:122-133 也做无守卫覆盖；复核发现该处走 prisma.share.create，撞主键抛 P2002 被 catch → 「失败且不静默」。静默覆盖仅在 offline-sync.service.ts:217-235。

**修正 2 —— Rust panic 计数**：原报摘要写「4 处」，按 #[cfg(test)] 切分实算为 **7 处**（local.rs 3 + storage.rs 3 + lib.rs:274），原报漏计 local.rs:261/265/380。实质结论（生产区无 panic!）仍成立。

**跨报告矛盾裁定**：状态层报告要求优化 use-shell-rc-completion.ts:16 的订阅，终端核心报告判定该文件零引用为死代码；grep 证实引用数为 0，采信后者。

**主代理表述更正**：审查过程中曾表述「CI 从不跑 pnpm verify」，易被读成「CI 无质量门禁」。精确表述见第 4 节组 E 与第 6 节。

---

## 8. 待确认清单（附确认方式）

| # | 问题 | 确认方式 | 影响 |
| --- | --- | --- | --- |
| 1 | scripts 表是否存在非法 host_ids 行 | SELECT id FROM scripts WHERE host_ids IS NOT NULL AND json_valid(host_ids)=0; | 0 行 → 组 G 降 P2；>0 行 → 升 P0 |
| 2 | tauri-plugin-sql 重复 load 是否复用连接池 | 两次 load 后各查 PRAGMA busy_timeout | 决定 P0-3 的 PRAGMA 代价 |
| 3 | team-server /sync/conflicts/check 是否真用 baseVersion | grep 该实现 | 决定组 B 之一是否真会覆盖 |
| 4 | 离线队列是否由后端其它入口驱动 | grep processOfflineQueue 调用方 | 决定死代码判定 |
| 5 | Rust 是否为 local-data / serial-data 填 bytes | 读 emit 处 payload | 决定回执无上限的触发面 |
| 6 | since=9007199254740991 的真实状态码 | curl 该参数看 400 还是 500 | 已验证 new Date(MAX_SAFE_INTEGER) 为 Invalid Date、toISOString 抛 RangeError；待验 HTTP 层 |
| 7 | 亮色主题下标题栏观感 | pnpm tauri dev 切 light 截图 | 验证 28 处硬编码色 |
| 8 | Node 版本错配的实际影响 | 在 24.16.0 下重跑第 2 节基线 | 已验证错配存在（本机 22.12.0） |
| 9 | 软链路径下门禁静默 no-op | ln -s <repo> /tmp/l && cd /tmp/l && node scripts/check-verification-evidence.mjs; echo $? | 验证组 E 第 4 条 |
| 10 | Windows 平台判定分叉 | Windows 实机看快捷键面板 | 验证 5 份平台检测 |

---

## 9. 建议修复顺序

1. **先修门禁**（组 E + 第 5 节盲区）：门禁不自洽时，后续任何修复都没有可信的回归证据。最小动作是给 CI 加 node --test scripts/*.test.mjs 与 node scripts/check-verification-evidence.mjs，并把 verify.mjs 的测试清单改成通配。
2. **再修数据正确性**（3 个 P0 + 组 B + 组 C 前两条）：逐条配回归测试，起点是 P0-3 的导入事务与 P0-2 的离线队列守卫。
3. **然后修失败可见性**（组 A）：机械但面广，改完用第 1 步建立的门禁做前后对比。
4. **最后清资源上限与规范**（组 D / G + P2/P3）：可分批、可延后。

---

## 10. 覆盖边界

六个模块合计约 60% 生产文件被逐行阅读，其余靠全量 grep 取证。

- **未覆盖的前端文件**：service/ssh.ts(261)、vault.ts(140)、shortcuts.ts 系列(381)、updates.ts(79)、serial.ts(119)、scripts.ts(189)、shell-rc.ts 主体(195)、store/team-actions-data.ts(264)、hooks/use-command-completion*(482)、use-breakpoint.ts、use-swipe-back.ts，以及全部 *.test.*（约 8k 行）未逐行阅读。
- **未覆盖的 Rust 区段**：ssh.rs:1554-1850（create 主流程）、1989-2160（authenticate 家族）、storage.rs 大部、commands.rs 仅 470-532、errors.rs 仅 1-96 与兜底分支。
- **未覆盖的 team-server**：8 个 *.module.ts（DI 装配未核）、prisma/seed.ts、dist/ 与 src 的一致性。
- **未做的运行时验证**：未连真实 SSH / 硬件 / PostgreSQL，未做 EXPLAIN，未跑 prisma validate，本机未跑 cargo clippy。

---

## 11. 声明

本报告完成于审查阶段，当时**未修改任何源码、未执行任何 --fix / format / install / git 写操作**。第 2 节基线是「不影响功能」的对比基准。审查之后的第 1 层修复见第 12 节。

---

## 12. 第 1 层修复记录

> 依据「在不影响功能的前提下」这条约束，只执行可被工具证明行为不变的修复。判据：改动前后同一输入必须产生同一可观测输出；硬验收是「1164 项测试数不变 + typecheck/lint 全绿 + 行数门禁 553 不变」。

### 12.1 已修复（6 处改动 / 5 个文件）

| # | 位置 | 改动 | 零行为风险的依据 |
| --- | --- | --- | --- |
| 1 | packages/frontend/src/store/workspace.ts | deleteWorkspace 的三元死分支降为直接取值 | 函数开头已有 throw 守卫排除 activeWorkspaceId === id，三元第一支永不可达 |
| 2 | packages/frontend/src/store/workspace.ts | loadLayout 去掉不可达的 try/catch，保留 as 断言 | try 体只有类型断言（编译期擦除），catch 不可能命中 |
| 3 | packages/frontend/src/view/snippets/batch-execute-panel.tsx | timeout / setTimeout → timeoutSeconds / setTimeoutSeconds（4 处） | 纯重命名；已确认该文件内无全局定时器调用 |
| 4 | scripts/verify.mjs | scripts 组由手写 16 项改为 readdir 通配收集 | 之前漏掉的 build-verification-evidence.test.mjs 与 macos-frontmost.test.mjs 已实测 12/12 通过；未知组 exit 2、任一组失败即终止的语义未变 |
| 5 | .github/workflows/ci.yml | source-size job 增加 node --test scripts/*.test.mjs | 只增加步骤、不删既有步骤；该步实测 237 项全过 |
| 6 | scripts/check-verification-evidence.mjs | 直跑守卫改为两侧 realpath 比较 | 非软链场景前后等价（两侧 realpath 后仍相等）；软链场景由「静默 exit 0 零输出」变为正常执行 |

### 12.2 验收（改动后实测）

| 项 | 结果 | 与第 2 节基线对照 |
| --- | --- | --- |
| pnpm --filter=@terminal/frontend typecheck | exit 0 | 一致 |
| pnpm --filter=@terminal/frontend lint | exit 0 | 一致 |
| pnpm --filter=@terminal/frontend test | 129 文件 / 1164 项通过 | **数字完全一致** |
| node --test scripts/*.test.mjs | 237 项通过 | 由「CI 与 verify 都不跑」变为「两处都跑」 |
| node scripts/check-source-size.mjs | 553 个生产文件通过 | 一致 |

### 12.3 唯一的已知副作用：证据门禁转红

- **现象**：node scripts/check-verification-evidence.mjs 由 exit 0（在 HEAD 快照 worktree 上实测）变为 exit 1（5 条失配），源码指纹 99b0879d… → dedbcd0c…。
- **机制**：FINGERPRINT_PATHS（脚本第 255-294 行）包含整个 packages/frontend/src 与 check-verification-evidence.mjs 自身，因此**任何源码修复都会让实机证据失配**。这是该机制的既定行为，不是本次改动引入的缺陷。
- **影响面**：verify.mjs 的 source 组因此为红，即完整 pnpm verify 会红；CI 未接入该门禁，故 CI 不受影响。
- **正确修法**（需在 CI 上执行，本次未做）：在本次提交上 dispatch .github/workflows/real-machine-matrix.yml，重新产出 6 份实机证据并刷新 docs/verification/evidence-manifest.json。**不得手工改 manifest 伪造绑定**，那会让证据失去意义。
- **若希望立即恢复全绿**：git checkout -- packages/frontend/src scripts/check-verification-evidence.mjs（这三处都在指纹内）；scripts/verify.mjs 与 ci.yml 不在指纹清单，回退后仍可保留。

### 12.4 评估后决定不修（1 项）

use-terminal-completion.ts（72 行）+ use-shell-rc-completion.ts（26 行）确认零源码引用，但 docs/plans/terminal-reliability-rebuild.md:80 把前者列为**进行中重构计划的 P0 缺陷「当前证据」**。删除会让该计划文档指向不存在的文件并丢失缺陷现场，故保留。若该 P0 已确认关闭，删除这两个文件是零风险清理。

### 12.5 未做的（需要行为变更，超出本次边界）

3 个 P0 与 38 条 P1 全部未动。它们必然改变失败上报、冲突返回或事务边界，需要独立回归测试与实机验证，属第 2 / 第 3 层范围。
