# UX-1a 复审修复 — 交付记录

- 分支：`feat/terminal-next-ux1a-workspace-shell`
- PR：#36（Draft）
- 修复 HEAD：`021ad81`
- 上一次审查 HEAD：`8ceee84`

本文件记录 UX-1a 最后一轮针对性修复：状态栏实时尺寸、旧布局升级的双轨回归、
第三处重复导航入口。**不是 UX-1b 的起点**，Context Dock 与 SFTP 生命周期调整
属于独立的 UX-1c。

---

## 1. 状态栏尺寸同步

### 1.1 缺陷

`use-publish-terminal-size.ts` 只在 `window.resize` 时上报尺寸。

`window.resize` 只覆盖终端改变尺寸的一种方式。以下三条路径都调用
`fitAddon.fit()`，而窗口尺寸**不变**：

| 路径 | 触发点 |
| --- | --- |
| 分屏拖拽 | `terminal-workbench.tsx` 改 CSS grid → `ResizeObserver` |
| Explorer / 侧栏展开折叠 | `main-layout-content.tsx` 宽度变化 → `ResizeObserver` |
| 字体缩放 | `use-terminal-instance.ts:267,276` 直调 `fitNow()` |

于是状态栏继续显示 PTY 已经不再拥有的列数。

### 1.2 修复

订阅 xterm 自己的 `onResize`。它由 `Terminal.resize()` 触发 —— 也就是
`fitAddon.fit()` 最终调用的那个，与 PTY resize 路径
（`terminal-input-registration.ts:79`）**是同一个事件源**。

新增的是第二个独立订阅者，不改会话层任何行为：

- 未改 PTY Session
- 未改 ACK
- 未改 FitAddon 的调用时机

### 1.3 三条旧实现没有的语义

| 语义 | 为什么必须有 |
| --- | --- |
| 后台 pane 不写当前槽位 | 分屏两半都会 resize，隐藏那一半的数字会出现在状态栏 |
| 卸载时清空槽位 | 关闭的标签会把自己的尺寸永久留在状态栏 |
| 切标签释放旧监听器 | 晚到的 fit 会污染新标签的槽位 |

另外 `clear(tabId)` 只在槽位仍属于调用者时清除，晚到的卸载不会擦掉新
pane 的值。

### 1.4 先红后绿

把实现回滚到 `window.resize` 版本，同一份测试 **5/10 红**：

```
× updates when xterm resizes without a window resize
× keeps following resize after several fits
× releases the subscription when the terminal is disposed
× releases the subscription when a new terminal replaces the old one
× clears the slot when the pane unmounts while active
```

新实现 **10/10 绿**。测试驱动 `onResize`、`dispose`、卸载与换实例，
不是断言 `StatusBar` 收到的 props。

---

## 2. 旧布局升级的双轨回归

### 2.1 缺陷

`WorkspaceLayout` 没有版本字段，而 `sidebarVisible` 的旧默认值 `true`
硬编码在**三处**：

- `store/app.ts:144`
- `service/workspace-recovery-layout.ts:51`
- `service/workspace-switch.ts:14`

老用户升级后，旧布局如实恢复 `true` → 46px Rail 旁边再展开 220px 侧栏，
两者列同一批目的地，**终端比升级前还窄 220px**。这正是 UX-1a 要消除的
退化，被「忠实恢复」重新引入。

### 2.2 修复：显式版本化迁移

`service/workspace-layout-version.ts`，`LAYOUT_SCHEMA_VERSION = 2`。

| 存储版本 | 含义 | 结果 |
| --- | --- | --- |
| 缺失 / `1` | 早于 activity rail，该字段不是偏好 | 折叠 |
| `2` | 本构建的用户决定的 | 如实恢复 |
| 非整数 / 非数字 | 手工编辑或截断写入的损坏 | 按旧版折叠 |
| `> 2` | 未来版本 | 如实恢复（不丢弃真实选择） |

**只影响 `sidebarVisible`。** `tabId`、`splitGroups`、`activeTabId` 逐字段
透传，有测试逐条断言 —— 迁移一旦重塑恢复数据，升级会丢掉用户的终端，
比多一个侧栏严重得多。

### 2.3 迁移放在三个读写边界，不是一处

只修一处正是这类回归存活的方式。

| 边界 | 文件 | 覆盖的来源 |
| --- | --- | --- |
| 数据库行 | `service/database/workspaces.ts` `getWorkspaceLayout` | SQLite `workspace_layouts` |
| recovery journal | `service/workspace-recovery-journal.ts` `readRecoveryJournal` | localStorage，**升级后首次启动的主要来源** |
| 内存 | `store/app.ts` `restoreLayout`、`workspace-recovery-layout.ts` `sanitizeWorkspaceRecoveryLayout` | workspace 切换、写盘前的净化 |

写侧统一打版本号（`saveWorkspaceLayout` 与 `store/workspace.ts` `saveLayout`），
让「无版本」只能意味着「更早的构建写的」。

`readRecoveryLayout` 从内存读时**主动打当前版本** —— 否则用户刚展开的侧栏
会在每次 journal 写入时被折叠。

### 2.4 先红后绿

| 回滚的改动 | 结果 |
| --- | --- |
| `restoreLayout` 回旧实现 | 1/16 红（`folds the sidebar for a pre-upgrade layout`） |
| `sanitize` + journal 回旧实现 | 5/11 红 |

### 2.5 四类场景覆盖

| 场景 | 测试 |
| --- | --- |
| 旧数据升级 | `workspace-layout-version.test.ts`（8 项迁移规则 + 4 项数据库读）+ `workspace-layout-migration-boundaries.test.ts`（journal 6 项） |
| 新数据重启 | 版本 2 且 `sidebarVisible: true` → 保持展开（两个文件各一组） |
| 缺失字段 | `sidebarVisible` 缺失 → 折叠，而不是猜「展开」 |
| 损坏布局 | 非 JSON 仍抛错（不降级成「没有布局」）；未知 journal 版本仍丢弃；非数字版本按旧版处理 |

### 2.6 不存在默认 Rail + 旧 Sidebar 双轨的证明

`layout/navigation-dedup.test.tsx` 5 项，**数目的地有几扇门**，而不是问某扇门
能不能用：

- 默认布局：Rail 在，侧栏的 resize separator 不在（`role="separator"` 是可空断言，
  不是被 `if` 静默跳过的分支）
- 侧栏打开后，侧栏仍能到达 Rail 到不了的 `/settings` —— 证明它没被替换成 Rail 的副本
- 每个日用目的地在 Rail 里恰好 1 个链接
- Rail 第一项是 `/terminal`，且无重复 href
- 高级目的地（`/vaults`、`/teams`、`/logs`、`/known-hosts`）不占 Rail 槽位

---

## 3. 导航去重复核

### 3.1 发现的第三处重复

SFTP 已在 Activity Rail 上常驻，顶栏那个 SFTP 按钮是**同一个房间的第三扇门**。

上一轮我在提交信息里写「同一错误犯了两次」，紧接着犯了第三次，而且没有
检查顶部 SFTP 与 Rail 的 `/sftp` 是不是同一个目的地。

### 3.2 最小修改

顶栏 SFTP 按钮**唯一独有的是传输徽章**，所以改成仅在确实有传输时渲染：

- 空闲时消失 —— 不再与 Rail 重复
- 传输中仍给出唯一的「正在运行」指示 —— **传输状态仍然可见**

没有删除 /sftp 路由，没有改 Rail 的集合，没有进入 UX-1b / UX-1c。

### 3.3 各处入口的最终归属

| 功能 | 常驻入口 | 备选入口 |
| --- | --- | --- |
| 终端 | Activity Rail 第 1 项 | 标签栏 |
| Hosts / SFTP / Keychain / Snippets / Port Forward | Activity Rail | 侧栏（展开时）、命令面板 |
| Vaults | 顶栏 `WorkspaceSwitcher variant="vaults"` | 侧栏 advanced、底部导航（窄屏） |
| 传输状态 | **仅传输中**显示顶栏徽章 | 状态栏计数、SFTP 传输面板 |
| Teams / Logs / Known Hosts | 侧栏 advanced | 命令面板 |

### 3.4 先红后绿

| 测试 | 旧实现 |
| --- | --- |
| `does not add a second SFTP door while nothing is transferring` | 红 |
| `surfaces the transfer count while something is moving` | 红 |
| `drops the badge again once the transfer finishes` | 绿（新旧都通过，锁住不回归） |

---

## 4. 门禁

| 项 | 结果 |
| --- | --- |
| 前端测试 | **226 文件 / 2027 项**（基线 222 / 1981，+4 文件 +46 项） |
| Rust | **391 passed**，0 failed，4 ignored |
| `cargo fmt --check` | 通过 |
| typecheck | 通过 |
| ESLint | 通过 |
| source-size | **648** 个生产文件 |
| bundle budget | **618.16 / 624 KB**（initial 130.70 / 240） |
| 证据指纹 | 源码改动 → `bfe5221a…` → `f9859207…`，**按官方流程重采** |

### 4.1 测试基数变化

| 文件 | 项数 |
| --- | --- |
| `use-publish-terminal-size.test.tsx`（新） | 10 |
| `workspace-layout-version.test.ts`（新） | 16 |
| `workspace-layout-migration-boundaries.test.ts`（新） | 11 |
| `navigation-dedup.test.tsx`（新） | 5 |
| `top-toolbar/index.test.tsx`（追加） | +3 |
| `app-terminal-layout-normalize.test.ts`（改+增） | 净 +1 |
| `workspace-recovery.test.ts`（fixture 打版本号） | 25 不变 |

### 4.2 两处旧测试期望被改动，理由如下

**两者测的正是被改的行为**，不是形状变化后顺手对齐：

| 测试 | 旧期望 | 新期望 | 理由 |
| --- | --- | --- | --- |
| `defaults a missing persisted sidebar value to visible` | `true` | `false` | 缺失字段意味着「没有偏好记录」，terminal-first 默认是折叠。默认展开正是把 220px 侧栏放到 46px Rail 旁边的原因 |
| `clears the previous layout when the selected workspace has no saved layout` | `sidebarVisible=true` | `false` | 无保存布局的 workspace 走 `EMPTY_LAYOUT`，现在是 terminal-first |

`workspace-recovery.test.ts` 的 20 处 fixture 补 `layoutVersion` 是**打了
版本号让它们继续代表「本构建写的布局」**，恢复逻辑测试不应被侧栏策略污染。
没有一处把断言期望改成实际值。

---

## 5. 16 项不变量矩阵

| ID | 不变量 | 本轮状态 | 说明 |
| --- | --- | --- | --- |
| INV-1 | 全局恰好一个 `[data-terminal-workbench]` | **PASS** | 未改挂载点；`navigation-dedup.test.tsx` 断言 Rail 不含该节点 |
| INV-2 | 一个 tabId 最多一个 TerminalContainer | **PASS** | 未改 `TerminalByUrl` 的渲染路径 |
| INV-3 | 已挂载 pane 不因切 tab/路由卸载 | **PASS** | 未改 `terminal-workbench.tsx` 的 `mountedTabIds` |
| INV-4 | 终端层永不卸载，只可隐藏 | **PASS** | 未改 `main-layout-content.tsx` 的 `TerminalByUrl` 位置 |
| INV-5 | 「终端是否可见」只有一个判定源 | **NOT_RUN** | 仍有 11 处 `/terminal` 字面量；按设计留 UX-1b |
| INV-6 | 布局持久化字段集合不可缺项 | **PASS** | 新增 `layoutVersion`，三条写入路径（`saveWorkspaceLayout`、`store/workspace.ts`、`workspace-switch.ts`）全部补齐，无遗漏 |
| INV-7 | 恢复持久化订阅点不可移除 | **PASS** | `createRecoveryPersistence` 未改动 |
| INV-8 | `prune` 只按完整 tab 集合关闭 | **PASS** | 未改 `terminalSessionManager.prune` 调用 |
| INV-9 | tab id 跨恢复稳定 | **PASS** | 迁移只动 `sidebarVisible`；`tabs`/`splitGroups`/`activeTabId` 有逐字段断言 |
| INV-10 | 快捷键三层保护同时存在 | **PASS** | 未改快捷键；`terminal-shortcut-invariants.test.ts` 4 项仍绿 |
| INV-11 | 输入/输出只有一条有序通路 | **PASS** | 新 `onResize` 订阅者只读尺寸，不写 PTY |
| INV-12 | 窄窗口与侧栏由 store + 单一断点驱动 | **PASS** | 侧栏可见性仍只来自 `AppStore.sidebarVisible`；断点仍只用 `useIsMobile()` |
| INV-13 | SFTP 主机绑定必须显式 | **NOT_RUN** | 按设计留 UX-1c |
| INV-14 | SFTP 连接不被切 tab/关面板终止 | **NOT_RUN** | 按设计留 UX-1c |
| INV-15 | 启动门禁与恢复编排保持为布局祖先 | **PASS** | 未改 `StartupGate`；`workspace-recovery.ts` 只改 sanitize |
| INV-16 | 前端源码改动会让证据失效 | **PASS（已重采）** | 指纹 `bfe5221a…` → 新指纹，按官方流程重采，未手改旧 manifest |

**13 PASS / 3 NOT_RUN。**

---

## 6. 截图：本轮未能补拍

### 6.1 应用确实启动并建出了正确的窗口

release 二进制（`src-tauri/target/release/terminal`，33992192 字节）以隔离
`HOME` 启动，进程存活，日志记录 `tauri app starting up` 与
`db recovery state=Healthy reason=the database does not exist yet`。

窗口在 CoreGraphics 窗口列表里的实测值：

```
num=14144 layer=0 alpha=1.0 onscreen=true bounds={X:360, Y:85, W:1200, H:800}
```

`layer=0`（普通窗口层）、`alpha=1.0`、`onscreen=true`、**1200×800 与基线截图同尺寸**。

### 6.2 但截不到内容

窗口被 Chrome 遮挡，而把应用提到前台的四条路径全部被权限挡住：

| 尝试 | 结果 |
| --- | --- |
| `screencapture -l 14144` | 全灰图 —— 截图 API 只返回窗口的可见像素 |
| `osascript ... activate` | `-1719`，辅助功能未授权 |
| `NSRunningApplication.hide()`（移开 Chrome） | 返回 `false`，同样需要权限 |
| ScreenCaptureKit `SCScreenshotManager` | 命令行工具无 window server 连接，`CGS_REQUIRE_INIT` 断言崩溃 |

`AXIsProcessTrusted: false` 意味着**能读取窗口几何，不能改变窗口层级**。

### 6.3 这对证据意味着什么

`docs/design/terminal-next/ux1a-evidence/03-final.png` 是 `8ceee84` 拍摄的，
**不是 `021ad81`**。

本轮三处改动里，只有「顶栏 SFTP 按钮从常驻变为仅在传输时出现」在视觉上可见，
其余两处（订阅 `onResize`、布局版本化迁移）是数据通路与持久化逻辑。而截图是
在无传输的空闲状态下拍的 —— 两者视觉上应当完全一致。

但「应当一致」不是证据。**旧截图不被冒充为本轮产物。**

### 6.4 补拍所需

把 terminal 窗口切到前台（人工点击一次即可），执行：

```
swift /tmp/list-windows.swift   # 取新的 windowId
screencapture -l <windowId> -o docs/design/terminal-next/ux1a-evidence/04-review-fixes.png
```

---

## 7. 验收边界

### 6.1 静态与自动化（PASS）

```
STATUS_BAR_FOLLOWS_XTERM_RESIZE   = PASS（10 项，旧实现 5 项红）
BACKGROUND_PANE_NO_OVERWRITE      = PASS
TAB_SWITCH_NO_STALE_SIZE          = PASS
LAYOUT_VERSION_MIGRATION          = PASS（27 项，旧实现 6 项红）
LEGACY_SIDEBAR_FOLDED_ONCE        = PASS
NEW_SIDEBAR_PREFERENCE_PERSISTS   = PASS
NO_RAIL_SIDEBAR_DUPLICATION       = PASS
SFTP_SINGLE_PERMANENT_ENTRY       = PASS
TRANSFER_STATE_STILL_VISIBLE      = PASS
```

### 6.2 真实 GUI（NOT_RUN）

本机 `AXIsProcessTrusted: false` —— **能截图，不能点击 / 键入**。

```
REAL_GUI_SPLIT_DRAG_SIZE_SYNC     = NOT_RUN
REAL_GUI_SIDEBAR_TOGGLE_SIZE_SYNC = NOT_RUN
REAL_GUI_FONT_ZOOM_SIZE_SYNC      = NOT_RUN
REAL_GUI_UPGRADE_FROM_OLD_LAYOUT  = NOT_RUN
GUI_IME                           = NOT_RUN
SSH_REAL_CONNECTION               = NOT_RUN
VAULT_REAL_FLOW                   = NOT_RUN
```

状态栏跟随 resize 一事，自动化测试驱动的是真实的 `onResize` 契约；
**「拖动分屏时眼睛看到的数字确实在变」需要人工确认**。

旧布局升级一事，自动化覆盖了四个读写边界与四类数据形态；
**「从真正装有旧版本的机器上升级」需要人工确认**。

---

## 8. 合并建议

**READY**（受以下条件约束）

| 条件 | 状态 |
| --- | --- |
| 三项复审修复完成 | ✅ |
| 每项先红后绿 | ✅ |
| 前端全量 | ✅ 226 / 2027 |
| Rust | ✅ 391 |
| 全部门禁 | ✅ typecheck / ESLint / source-size / bundle / cargo fmt |
| 证据重采至匹配指纹 | 见 §4 |
| CI 11/11 | 见 PR |
| 真实 GUI 项 | **NOT_RUN，不影响 READY** —— 它们本就不是本环境的可验证项 |

**不合并、不打 Tag、不发布** —— 按任务书要求，等待明确授权。

下一阶段严格限定为 UX-1b（Connection Explorer）。Context Dock 与 SFTP
生命周期调整放到独立 UX-1c。
