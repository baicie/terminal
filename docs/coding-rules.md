# 编码规则（Terminal 项目）

> **来源**：本规则由 2026-10 代码质量审查（`docs/code-quality-review-2026-10.md`）的 143 条发现**反向提炼**。
> 每条规则都对应一个真实的失败机制与一个真实的反面实例，不是风格偏好。
> **判据**：一条规则值得存在，当且仅当能回答——它阻止哪类故障？违反后多久会被发现？能否变成门禁？

---

## 0. 使用方法

- 写新代码时：先看第 1、2 节（失败可见性、数据一致性），这两节的违规代价最高。
- 改老代码时：看第 5、6 节（渲染契约、契约完整性），这些是最容易顺手破坏的。
- 加门禁时：看第 7、8 节。
- 每条规则标注了三档 enforcement：**[门禁]** 可自动化、**[检查]** 可脚本化但需判读、**[评审]** 只能靠代码审查。

---

## 1. 失败必须可观测

### R1.1 不得让失败伪装成成功 **[门禁]**

返回 `null` / 空数组 / 空列表之前，必须能区分「本来就没有」与「读取失败」两种情形。二者合并返回是本次审查最严重的一类缺陷。

- 反面：`packages/frontend/src/service/storage.ts:73-79` —— `catch { return null }`，上层据此报「服务器上没有备份」，引导用户上传并覆盖真实存在的远端备份
- 反面：`packages/frontend/src/service/database/connection.ts:65-76` —— `select()` 把任何异常变成 `[]`，读失败时 UI 显示空主机列表
- 反面：`src-tauri/src/session/sftp.rs:87-99` —— 权限被拒 / 子系统不可用 / 握手失败三类全映射成 `SessionNotFound`
- 正面：同文件 `connection.ts:84-107` 的 `selectStrict` —— 保留原始错误与 `cause`，让调用方自行决定

**门禁建议**：ESLint 禁止空 catch 与「catch 内仅 return 空值」的形态。

### R1.2 catch 必须绑定异常对象 **[门禁]**

`catch {` 与 `catch (e) { /* 不看 e */ }` 等价于主动销毁排障线索。

- 反面：`packages/team-server/src/sync/sync.service.ts:148` —— `} catch {`，非法枚举、外键冲突、超时在运维侧全部只剩一个固定码 `SYNC_OPERATION_FAILED`

### R1.3 异步早退路径必须显式处置回执与句柄 **[评审]**

在队列 / 调度器 / 回执模型里，「不处理」不等于「已处理」。

- 反面：`features/terminal/services/terminal-output-scheduler.ts:71` —— `if (!data || this.state !== 'active') return false` 直接返回，不确认也不作废回执，条目永久悬挂，切面板时旧输出二次打印

### R1.4 部分成功必须有一种独立状态 **[评审]**

「成功 / 失败」二元表达不了「4 台里挂了 3 台」。

- 反面：`packages/frontend/src/service/script-executor.ts:135-141` —— 三元两个分支都返回 `'success'`，而同一函数 147 行的返回值却是 `false`，记录与结果自相矛盾

---

## 2. 数据一致性

### R2.1 多步写入必须包事务 **[门禁]**

- 反面：`packages/frontend/src/service/sync-import.ts:7-12, 34-53` —— 导入全程顺序 `await` 无 `BEGIN/COMMIT`，且每条语句都重新 `load()` 一个数据库连接，绕过单例与连接级 PRAGMA。失败即产生半写入（hosts 进、groups 没进 → 分组树悬空）
  **规则细化**：数据库连接只能从单例取；事务边界必须包住整个业务操作。

### R2.2 「先查后写」必须用条件更新或事务 **[评审]**

- 反面：`packages/team-server/src/shares/shares.service.ts:76-101` 等 4 处 —— JS 里比较版本再 `update({where:{id}})`，两个并发请求都能通过比较，后者覆盖前者且双方都收到成功
- 正确形态：`updateMany({ where: { id, updatedAt: expected }, data })` 后检查 `count === 1`，或把读+判+写放进同一事务

### R2.3 增量游标必须在读取数据之前取 **[评审]**

- 反面：`packages/team-server/src/sync/sync.service.ts:33-46` —— 两次查询之后才 `Date.now()`，期间落库的行被永久排除在同步集之外，无自愈路径
- 正确形态：查询下界与返回给客户端的游标必须是同一个值

### R2.4 版本号必须是会变的值 **[门禁]**

- 反面：`packages/frontend/src/store/team-actions-sync.ts:96-103, 121` —— `baseVersion` 取 `item.createdAt`（创建后永不变化），冲突检测恒判「无冲突」，远端改动被静默覆盖

### R2.5 连接与客户端只在初始化成功后对外可见 **[评审]**

- 反面：`packages/frontend/src/service/database/connection.ts:19-25` —— `db` 在 `await initSchema()` 之前赋值，建表失败后第 16 行直接返回未建表的连接，schema 初始化永不重试

### R2.6 外部 HTTP 客户端必须设超时 **[门禁]**

- 反面：`src-tauri/src/storage.rs:104, 431, 659` —— 三处 `reqwest::Client::new()` 无 request / connect timeout，对端半开连接会让 Tauri 命令永久挂起

---

## 3. 资源生命周期

### R3.1 任何无上限的集合都必须有上限或背压 **[评审]**

- 反面：`features/terminal/services/terminal-session-output-buffer.ts:155` —— `delivered` 回执表无上限，而 `MAX_BUFFERED_CHUNKS` / `MAX_BUFFERED_BYTES`（9-10 行）只作用于 `buffered`；有 owner 时 `buffered` 恒空，两个上限永不上场
- 反面：`packages/frontend/src/service/notifications.ts:126-133` —— 通知数组无淘汰

### R3.2 异步加载的模块必须能感知「已卸载」 **[评审]**

- 反面：`features/terminal/components/terminal-container/use-terminal-instance.ts:101` —— 动态 `import` 的 clipboard addon 在 `term.dispose()` 之后仍会 `loadAddon`，错误被自身 `.catch` 降级成 `console.warn`

### R3.3 监听器、定时器、rAF 必须成对 **[门禁]**

本次审查确认 15 处计时器全部成对、7 个文件监听器计数相等，这是做得好的地方。个别缺口：

- 反面：`features/terminal/services/terminal-session-reconnect-policy.ts:4` —— `sleep` 的 abort 监听器正常路径不移除，随重连累积
- 反面：`components/terminal-container/terminal-body.tsx:67` 等 6 处 —— `requestAnimationFrame` 未取消

### R3.4 阻塞调用不得落在 async fn 的运行时线程上 **[检查]**

- 反面：`src-tauri/src/session/local.rs:728-729` —— `drop(startup)` 触发同步递归删目录；同文件 314 行的 setup 路径已正确放进 `spawn_blocking`
- 反面：`src-tauri/src/port_forward.rs:156, 363` —— `std::net::TcpListener::bind` 直接在 async fn 内调用
- 正面范本：`connection.ts` 之外的 `serial.rs:263` 读写全走 `spawn_blocking`

---

## 4. 并发与重入

### R4.1 定时触发的后台动作必须有重入守卫 **[门禁]**

- 反面：`packages/frontend/src/store/team-actions-sync.ts:25-45` —— `sync()` 不检查 `isSyncing`，30 秒定时器无条件调用，配合无超时 `fetch`，慢请求超过 30 秒即并发叠跑同一批数据

### R4.2 重试必须退避 + 抖动，并发必须有上限 **[检查]**

- 反面：`packages/frontend/src/service/script-executor.ts:12-29` —— 零退避零抖动，最多 11 次全速重连；66 行 `Promise.all` 对全部目标主机同时发起，无并发上限

### R4.3 全局锁不得跨 `.await` 持有 **[评审]**

- 反面：`src-tauri/src/port_forward.rs:61, 68` —— 取锁后到函数结束未释放，`setup_remote_forward(...).await`（走网络的 SSH global request）在锁内执行，阻塞 list / stop / shutdown
- 正面范本：`sftp.rs:63-71` 明确 clone 出 `Arc` 后立即释放全局锁

---

## 5. 渲染契约（React）

### R5.1 渲染路径禁止裸 `JSON.parse` **[门禁]**

外部数据（数据库文本列、同步导入、手改库）在进入渲染之前必须经过带保护、返回安全默认值的解析函数。

- 反面：`view/snippets/script-list.tsx:51`、`view/snippets/index.tsx:148`、`view/snippets/use-script-form.ts:102` —— 裸 `JSON.parse(script.host_ids || '[]')`
- 正面范本：`components/snippet-manager/snippet-list.tsx:47-56` 已用 `try/catch` 包裹同一字段，证明团队知道该值可能坏

### R5.2 渲染期不得写 ref 或读可变 ref 当作渲染数据 **[门禁]**

- 反面：`components/terminal-container/container.tsx:99-101` 渲染期写 ref、`use-terminal-instance.ts:236` 渲染期读 ref（首帧必为 `null`，靠下游兜底才不出错）

### R5.3 effect 必须声明依赖数组 **[门禁]**

- 反面：`components/terminal-container/use-remote-prompt-probe.ts:74` —— 无 deps，每次渲染都执行

### R5.4 setter 命名不得遮蔽全局 API **[门禁]**

- 反面：`view/snippets/batch-execute-panel.tsx:30` —— `const [timeout, setTimeout] = useState(60)`，未来任何人在该组件体内写 `setTimeout(fn, 800)` 都会把函数当 state 写入且定时器不触发，编译器不报错

### R5.5 列表 `key` 必须是稳定业务 id **[门禁]**

- 反面：`components/host-list/environment-dialog.tsx:92`、`view/sftp/components/file-pane-navigation.tsx:91`、`view/hosts/host-list-view.tsx:37`

### R5.6 平台判定必须走单一入口 **[门禁]**

- 现状：`navigator.platform` 检测被复制 5 份且匹配集互不一致，而 AGENTS.md 指定的 `hooks/use-platform.ts` **并不存在**
- 规则：只允许一个平台判定入口，且不得使用已废弃的 `navigator.platform`

---

## 6. 契约不得只写不读

### R6.1 枚举与权限字段必须有读取点 **[评审]**

- 反面：`packages/team-server/src/sync/share-write-data.ts:37-39` —— `READONLY / READWRITE` 全仓只在写库处出现，无任何授权读取点，「共享可写」的产品语义在服务端不存在

### R6.2 字段不得成为死字段 **[评审]**

- 反面：`packages/frontend/src/service/notifications.ts:131` —— `persistent` 全仓仅 2 处出现，没有任何读取点

### R6.3 死代码必须删除或标注 **[检查]**

- 反面：`use-terminal-completion.ts` + `use-shell-rc-completion.ts` 共 98 行零引用；`syncOfflineQueue` 无调用点；`audit.create()` 无调用方
- 规则：超过一个迭代周期仍无调用点的导出，删除或加注释写明计划

---

## 7. 门禁与验证

### R7.1 门禁必须覆盖它宣称覆盖的范围 **[门禁]**

- 反面：`scripts/check-source-size.mjs:11-16` 整目录豁免 `experiments/`，6-9 行的扫描根只有两个目录，`scripts/*.mjs` 因扩展名规则完全不受检；而 AGENTS.md 宣称「所有文件均已拆分至限制以内」。实际 `experiments/xterm-test.tsx` 598 行、`experiments/terminal-shell-probe/protocol.ts` 445 行 2-3 倍超限
- 反面的反面：这两个文件还经 `terminal-bootstrap-default-dependencies.ts:2-4` **静态**引入主干、经 `router/nav-config.tsx:124-136` 暴露为可达路由 —— 既躲门禁又进生产包

### R7.2 测试必须自动纳入，不得手写清单 **[门禁]**

- 反面：`scripts/verify.mjs:57-80` 手写 16 项，磁盘实有 18 项，漏掉的恰是证据生成器与前台检测的测试

### R7.3 断言不得用「任一匹配」代替「精确匹配」 **[门禁]**

- 反面：`scripts/check-verification-evidence.mjs:104-112, 434` —— 遍历整棵 JSON 树收集任意 `sha256`，命中一个即通过；加一行 `{"note":{"sha256":"<target>"}}` 即可旁路产物绑定

### R7.4 脚本直跑判定必须 realpath 安全 **[门禁]**

- 反面：`scripts/check-verification-evidence.mjs:604-606`（同型 10 处）—— 路径含符号链接时静默不执行，退出码 0、零输出，上层仍打印「全部通过」

### R7.5 CI 覆盖面必须与文档宣称一致 **[检查]**

- 现状：CI 已强制 frontend（lint/typecheck/test/build:budget）、team-server（prisma validate/typecheck/lint/test/build）、source-size、rust（cargo fmt `--check` / check / **clippy `-D warnings`** / test）、docker、tauri build
- 缺口：`scripts/*.test.mjs`（18 个测试文件、237 项用例）与 `check-verification-evidence.mjs` 在 CI 中**零覆盖**

---

## 8. 规则与实现现状的偏差（必须先做决策）

以下四条 AGENTS.md 强制项在当前代码里**无法被遵守**，属于规范失效，要么补实现、要么修订文档：

| AGENTS.md 要求 | 现实 |
| --- | --- |
| 平台检测用 `hooks/use-platform.ts` | 该文件不存在，实际 5 份手写实现且匹配集不一致 |
| 输入框按钮组用 `InputGroup` 组件 | `components/ui/` 下无 `input-group.tsx`，实际 7 处 `absolute` 定位按钮 |
| 「所有文件均已拆分至限制以内」 | `experiments/` 下 598 / 445 行文件从未被门禁看见 |
| 移动端至少 44×44 触摸区、长列表降级为卡片 | `view/settings/`（11 文件）、`view/app-logs/`（2 文件）全子树零响应式断点 |

---

## 9. 从规则到门禁的落地清单

| 规则 | 现成手段 | 需新增 |
| --- | --- | --- |
| R1.1 R1.2 禁止空 catch / 吞错返回空值 | ESLint `no-empty` + 自定义 `no-restricted-syntax` | 自定义规则 |
| R1.3 R1.4 早退处置 / 部分成功 | 无 | 只能评审 |
| R2.1 R2.6 事务 / HTTP 超时 | 无 | 自定义 lint（查 `Client::new()`） |
| R2.4 版本号用 createdAt | 无 | 只能评审 |
| R3.1 R3.2 无上限集合 / 卸载保护 | 无 | 只能评审 |
| R3.3 R3.4 监听器成对 / 阻塞调用 | `cargo clippy` 部分覆盖 | 自定义 grep 门禁 |
| R4.1 R4.2 重入 / 退避 | 无 | 只能评审 |
| R5.1 R5.4 R5.5 渲染契约 | ESLint `react-hooks``、`@typescript-eslint` | 补 `react-hooks/exhaustive-deps` 为 error，加自定义 `no-shadow-restricted-names` 风格规则 |
| R5.6 平台判定单一入口 | 无 | 建成 `hooks/use-platform.ts` 后用 `no-restricted-properties` 禁 `navigator.platform` |
| R6.1 R6.2 只写不读字段 | 无 | 只能评审 |
| R7.1~R7.4 门禁自身 | 已可脚本化 | 扩 `check-source-size.mjs` 扫描根、`verify.mjs` 改通配、收紧哈希绑定、realpath 守卫 |
| R7.5 CI 覆盖 | GitHub Actions | 增加 `node --test scripts/*.test.mjs` |

---

## 10. 与既有文档的关系

- 本文件是**规则层**：回答「以后怎么写」。
- `docs/code-quality-review-2026-10.md` 是**发现层**：回答「现在哪里坏了」，含 143 条带 `file:line` 的问题与抽样复核记录。
- `docs/code-review.md`（2026-03-25）是更早的前序审查。
- `AGENTS.md` 是**项目约定层**：本文件第 8 节的偏差表应反馈回 `AGENTS.md` 修订。

---

## 11. 变更记录

### 2026-10-31 · R7.6 新增（来自一次真实的指令错误）

**R7.6 批量机械替换前，必须用项目实际安装的编译器验证目标工具类真实存在。**

- **事故**：批量把 `h-N w-N` 收敛为 `size-N` 时，把 `App.tsx` 根节点的 `h-screen w-screen` 也纳入了替换范围。`size-screen` 在 tailwindcss@4.2.4 中**不生成任何 CSS**——`size-*` 的值集含数字/小数/fraction/`full`/`min`/`max`/`fit`/`auto`/`dvh`，**唯独没有 `screen`**。若照做，根 div 同时丢失 width 与 height，整个应用外壳塌掉。
- **规则**：数字/小数/fraction/`full`/`min`/`max`/`fit`/`auto`/`px`/`dvh` 系可转；**`screen` 一律跳过**。更一般地——任何「看起来等价」的批量替换，都要先用编译器逐候选验证生成 CSS，再落地。
- **判据**：等价替换的证明不是「命名对称」，而是「目标类确实生成了等效 CSS」。
- **反面教材（本次）**：派发方给出的前提「6 处全是等价替换」在 `App.tsx` 上是错的；执行方用编译器验证后拒绝执行并回滚，避免了 P0 级 UI 坍塌。**执行方有权拒绝明显错误的批量替换指令，并附证据。**


