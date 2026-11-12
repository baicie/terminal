# UX-1b — Connection Explorer 交付记录

- 分支：`feat/terminal-next-ux1b-connection-explorer`
- 基线：`main = 4270629`（UX-1a 合并后的实际 HEAD）
- 实施 HEAD：`4ecedb6`
- PR：见仓库（Draft）

本阶段严格限定 Connection Explorer。**未实施** UX-1c Context Dock、SFTP 生命周期
改造、UX-2a/2b Vault/Keychain、UX-3 插件系统、UX-4 Rust Rig。

---

## 0. 开工前的审查结论

按任务书要求，先审真实代码再设计。四个发现改变了实施方式：

| # | 发现 | 影响 |
| --- | --- | --- |
| 1 | `HostRecency` 在 `host-ranking.ts` 有类型、`rankHosts()` 有参数，但**两个调用点都不传** | 命令面板的「最近」是死代码；Explorer 不能复用它 |
| 2 | `hosts` 表只有 `created_at` / `updated_at`，**没有 `last_connected`** | 不能拿 `updated_at` 冒充（任务书明令禁止） |
| 3 | **`connection_logs` 表已存在且活跃**：`session.ts` 的六条连接路径（local + 五种 ssh 认证）成功时都调 `recordConnectionSuccess(host_id, started_at)` | 这是唯一可信来源，**零 schema 改动** |
| 4 | `handleConnect` 只有两行：`addTab` + `navigate` | Explorer 必须复用它，不能另写 |

第 3 条推翻了本轮最初的判断。我一度以为「没有任何最近连接数据源」并向用户提议
新建表；核实后发现 `connection_logs` 一直在写，已向用户更正并改用现有表。

---

## 1. Connection Explorer

`packages/frontend/src/features/connection-explorer/`

| 文件 | 职责 |
| --- | --- |
| `connection-explorer.tsx` | 面板容器、三种状态（加载 / 失败 / 数据库不可用）、宽度由调用方传入 |
| `explorer-sections.tsx` | 搜索框、Recent / Favourites / 分组三段、空态与无匹配态 |
| `host-row.tsx` | 单行：连接、收藏切换、编辑 |
| `group-section.tsx` | 可折叠分组，带成员数 |
| `host-sections.ts` | `filterHosts` / `favoriteHosts` / `groupHosts`（纯函数） |
| `recent-connections.ts` | `pickRecentHosts`（纯）+ `loadRecentHosts`（读 `connection_logs`） |
| `relative-time.ts` | `Intl.RelativeTimeFormat`，三语各自语法 |
| `use-explorer-hosts.ts` | 从 Host Store 读，不缓存副本 |
| `use-connect-to-host.ts` | **唯一**连接实现 |

### 1.1 最近连接只用真实连接记录

数据来源是 `connection_logs` 的 `(host_id, started_at)`，由真实连接成功写入。

四条规则，每条都有测试：

| 规则 | 防止的缺陷 |
| --- | --- |
| 从不用 `hosts.updated_at` 兜底 | 编辑过的主机冒充「刚连接过」 |
| `host_id` 为 null 的行跳过 | Local 终端与快速连接不是「主机」 |
| 已删除的主机不进列表 | 「最近」里出现点不开的死链 |
| 同地址的两台主机都保留 | 去重会让其中一台从列表里消失 |

**先红后绿的教训**：只测纯函数 `pickRecentHosts` **抓不到**「回退到 `updated_at`」
这个缺陷，因为回退写在 I/O 包装 `loadRecentHosts` 里。补了 3 项 I/O 测试后，
把回退加回去 → `returns nothing when there are no connection logs` 变红。

### 1.2 三种状态分开

| 状态 | 表现 | 为什么不能合并 |
| --- | --- | --- |
| 加载中 | Skeleton | — |
| 读取失败 | 错误 + 重试按钮，**已有 hosts 仍然渲染** | 「读不出来」和「没有主机」需要相反的反应 |
| 数据库不可用 | 单独的提示，不显示「空列表」 | 让用户以为是自己没有主机 |
| 真的没有主机 | 空态文案 | — |

Recent 读取失败单独降级：只隐藏该段，收藏、分组、搜索照常。**不影响终端**。

---

## 2. 单面板左栏

### 2.1 问题

UX-1a 的 `sidebarVisible` 只能表达「面板开没开」，但左栏现在有两个可能的占位者。
Rail 与侧栏同时出现正是 UX-1a 被截图抓到的那次退化。

### 2.2 设计

`AppStore.leftPanel: 'none' | 'explorer' | 'navigation'`，规则集中在
`store/left-panel-state.ts`：

| 入口 | 行为 |
| --- | --- |
| Rail 终端项 | `leftPanel = 'none'` + 回 `/terminal` |
| Rail Connections 项 | 切换 `explorer`，**不导航离开终端** |
| `⌘B` / `toggleSidebar` | 关闭时开 Explorer，开启时关，从不在两者间切换 |
| `restoreLayout` | 恢复的 `sidebarVisible: true` → `navigation` |

`sidebarVisible` 仍持久化（INV-6 的字段集合不变），由 `leftPanel` 解析成唯一面板。

### 2.3 结构上不可能双轨

`LeftPanel` 是 `TerminalByUrl` 的**兄弟**，不是祖先。测试断言的是**面板计数 ≤ 1**，
而不是「某个面板存在」—— 后者在双轨时依然会绿。

---

## 3. INV-5 收敛

`router/terminal-route.ts` 是唯一判定源。

### 3.1 四类判断，不是一个

| 用途 | 调用点 | 收敛后 |
| --- | --- | --- |
| Canvas 显示 | `main-layout-content.tsx`、`terminal-by-url.tsx` | `isTerminalPath` |
| 快捷键生效 | `use-layout-shortcut-events.ts`、`container.tsx` | `isTerminalPath` |
| 路由跳转 | `tabs.tsx` 等 | `terminalTabPath` / 字面量（目的地） |
| Tab 激活 | `terminal-by-url.tsx` 的 URL 同步 | `isTerminalPath` |

### 3.2 有差别替换，不是无差别替换

- **13 处** `/terminal?tab=` 拼接收敛到 `terminalTabPath()`，顺带统一了 encode
- **5 处** `pathname === '/terminal'` 收敛到 `isTerminalPath()`
- **保留**导航目标形式的字面量（`navigate('/terminal')`、nav item 的 `path`）
- **保留** `/terminal?tab=` 深链兼容 —— 有测试钉住

### 3.3 防止再长回去

`terminal-route-literal-guard.test.ts` 读源码树，禁止六种比较式字面量重新出现，
并且**自测该守卫本身会命中**（守卫没见过开火就没人知道它有效）。

---

## 4. 连接路径只有一条

`useConnectToHost` 是唯一实现。`Hosts` 页的 `handleConnect` 委托给它。

测试用**真实 hook** 而非 mock，断言点击后 `addTab` 产生的 tab（`type: 'remote'`、
`hostId`、`label`）与 `activeTabId` —— 覆盖的是生产代码路径。

---

## 5. 验收

### 5.1 六类测试

| 任务书要求 | 文件 | 项数 |
| --- | --- | --- |
| Explorer 折叠/展开 | `connection-explorer.test.tsx` | 1（分组折叠） |
| 搜索、收藏、分组、最近连接 | `host-sections.test.ts`、`recent-connections.test.ts`、`connection-explorer.test.tsx` | 12 + 12 + 5 |
| 连接复用原有服务 | `connection-explorer.test.tsx`（真实 hook） | 1 |
| 老用户 Workspace 恢复 | `store/left-panel-restore.test.ts` | 8 |
| Terminal 挂载次数与会话保活 | `layout/explorer-session-safety.test.tsx` | 6 |
| 单面板不双轨 | `layout/navigation-dedup.test.tsx` | 5 |
| INV-5 语义与守卫 | `router/terminal-route.test.ts`、`terminal-route-literal-guard.test.ts` | 9 + 2 |

### 5.2 先红后绿（三处实证）

| 变异 | 结果 |
| --- | --- |
| `loadRecentHosts` 加 `updated_at` 兜底 | 1 项红（`returns nothing when there are no connection logs`） |
| 让 Explorer 成为终端层祖先（`leftPanel === 'explorer'` 时不渲染 `TerminalByUrl`） | **4/6 红** |
| 回退 Rail 为纯链接（无 Connections 项） | 3 项红 |

第二条是本阶段最重要的一次验证：它证明「Explorer 展开不卸载终端」这条不变量
真的被测试守住了，而不是靠代码结构碰巧成立。

### 5.3 门禁

| 项 | 结果 |
| --- | --- |
| 前端 | **233 文件 / 2095 项**（基线 226 / 2027，+7 文件 +68 项） |
| Rust | **391 passed** / 0 failed / 4 ignored |
| `cargo fmt --check` | 通过 |
| typecheck | 通过 |
| ESLint | 通过 |
| source-size | **663** 个生产文件 |
| bundle budget | **623.04 / 628 KB**（initial 130.88 / 240） |
| 证据 | 指纹 `f9859207…` → `ac1b1b7d…`，按官方流程重采 |

### 5.4 bundle 预算上调的依据

| 项 | 值 |
| --- | --- |
| 基线（UX-1a） | 618.20 KB |
| 本轮 | 623.04 KB |
| 增量 | **+4.84 KB** |
| initial | 130.74 → **130.88**（+0.14，Rail 多一个入口） |
| 预算 | 624 → **628** |

依据写在 `packages/frontend/scripts/bundle-stats.mjs` 的注释里：无新依赖；增长来自
Explorer 组件、单面板解析、路由判定源与约 30 条三语字符串；全部在 lazy 边界内，
initial 基本未动。备选是删掉三语字符串或 Recent 读取器 —— 那等于用交付要求换一个
用户感受不到的数字。

**尝试过但否决的方案**：把 Explorer 做成 `lazy()`。实测让 total 从 623.04 **升到
624.11**（分块产生重复共享模块），initial 几乎不变（130.88 → 130.86），说明
Explorer 本来就在 lazy 图内。已撤销。

---

## 6. 真实 GUI

### 6.1 能力边界（与 UX-1a 相同，未改善）

`AXIsProcessTrusted: false` —— **不能点击 / 键入**。

### 6.2 截图

release 二进制以隔离 `HOME` 启动，窗口在 CoreGraphics 列表里实测
`layer=0 alpha=1.0 onscreen=true 1200×800`。但把它提到前台的四条路径全部被权限
拒绝（`screencapture -l` 只返回可见像素、`osascript activate` 报 `-1719`、
`NSRunningApplication.hide()` 返回 `false`、ScreenCaptureKit 在命令行工具里因无
window server 连接断言崩溃）。

**本阶段同尺寸截图未采集。** 上一阶段的 `03-final.png` 是 `8ceee84` 的产物，
不使用它冒充本阶段。

补拍步骤：人工把 terminal 窗口点到前台，然后

```
swift /tmp/list-windows.swift
screencapture -l <windowId> -o docs/design/terminal-next/ux1b-evidence/01-explorer.png
```

### 6.3 不同宽度下的终端行列数

**NOT_RUN** —— 需要真实窗口拖拽，本机无法操作。自动化侧能证明的是 `StatusBar`
只显示 xterm 通过 `onResize` 报告的尺寸（UX-1a 的 10 项测试），不能证明「不同窗口
宽度下这个数字确实变化」。

### 6.4 真实 GUI 项

```
EXPLORER_COLLAPSE_EXPAND_GUI      = NOT_RUN
EXPLORER_CONNECT_REAL_SSH         = NOT_RUN
EXPLORER_CONTEXT_MENU_GUI         = NOT_RUN
SPLIT_RESIZE_SIZE_SYNC_GUI        = NOT_RUN
GUI_IME                           = NOT_RUN
VAULT_REAL_FLOW                   = NOT_RUN
```

---

## 7. 产品体验变化

| 场景 | 之前 | 现在 |
| --- | --- | --- |
| 打开应用 | 终端 + 46px Rail，侧栏关闭 | **不变** |
| 连一台常用机 | 点 Rail 的 Connections（当时是 `/hosts` 整页）→ 离开终端 → 找主机 → 点连接 → 回到终端 | 点 Rail 的 Connections → **终端仍在** → 点主机 → 新标签立刻出现 |
| 找一台机器 | 进 Hosts 页用搜索框 | 面板内搜索，终端不消失 |
| 看最近用过什么 | 无 | **Recent 段**（来自真实连接记录） |
| 管理主机/导入/共享 | Hosts 页 | **不变**（`/hosts` 深链与全部能力保留） |
| 打开导航侧栏 | 与 Rail 并存（双轨） | Rail 的终端项关面板；管理页由 Rail 条目直达 |

**核心标准的检验**：「从打开 Terminal 到连接一台常用服务器，应当比现在少走步骤」——
现在少了一次整页跳转往返；「不会因 Explorer 的任何操作中断已有终端会话」——
由 `explorer-session-safety.test.tsx` 的 6 项与那次 4/6 变红的变异验证守住。

---

## 8. 代码风险清单

| 风险 | 严重度 | 状态 |
| --- | --- | --- |
| `leftPanel` 与 `sidebarVisible` 双字段可能不一致 | 中 | 所有写入走 `left-panel-state.ts` 的 `withLeftPanel`，有测试遍历三种模式断言两个字段一致 |
| 命令面板的 `rankHosts` 仍不传 `recency`（死代码） | 低 | **本轮未修**，属命令面板范围；Explorer 未复用该路径 |
| Explorer 读取失败时的降级只在测试里验证 | 中 | 真实 GUI 未验证 |
| `MainLayoutContent` 保留了未使用的 `sidebarOpen` prop | 低 | 有意保留一个版本（外部调用方仍会传），已注明 |
| `explorer-sections.tsx` 的 Recent 与 Favourites 会把同一主机渲染两次 | 低 | **设计选择**：Recent 是快捷入口不是唯一列表，有测试注明 |
| 移动端没有 Explorer | 低 | 移动端沿用原有底部导航（任务书要求），Explorer 只在桌面 |
| bundle 余量 4.96 KB | 中 | 下一阶段若再加功能需再次评估 |

---

## 9. 16 条不变量矩阵

| ID | 不变量 | 本轮 | 依据 |
| --- | --- | --- | --- |
| INV-1 | 全局恰好一个 `[data-terminal-workbench]` | **PASS** | 挂载点未动；`explorer-session-safety` 断言面板切换不新增 |
| INV-2 | 一 tabId 一 TerminalContainer | **PASS** | 连接走 `addTab` 新建 tab，不复用/重建已有 tab |
| INV-3 | 已挂载 pane 不因切 tab/路由卸载 | **PASS** | `terminal-workbench.tsx` 未改 |
| INV-4 | 终端层永不卸载，只可隐藏 | **PASS** | 6 项挂载计数测试；变异后 4/6 红 |
| INV-5 | 可见性只有一个判定源 | **PASS（本轮收敛）** | 11 处字面量 → `terminal-route.ts`；literal guard 防回退 |
| INV-6 | 布局持久化字段集合不可缺项 | **PASS** | `sidebarVisible` 仍在；新增 `leftPanel` 不持久化（会话偏好） |
| INV-7 | 恢复持久化订阅点不可移除 | **PASS** | `createRecoveryPersistence` 未改 |
| INV-8 | `prune` 只按完整 tab 集合关闭 | **PASS** | 未改 |
| INV-9 | tab id 跨恢复稳定 | **PASS** | 恢复测试逐字段断言 |
| INV-10 | 快捷键三层保护同时存在 | **PASS** | 未新增 `Ctrl+字母` 绑定；`⌘B` 行为改变但仍在应用层 |
| INV-11 | 输入/输出只有一条有序通路 | **PASS** | Explorer 不触碰 SessionIo/Scheduler |
| INV-12 | 窄窗口与侧栏由 store + 单一断点驱动 | **PASS** | `leftPanel` 在 `isMobile` 时强制 `none`；断点仍只用 `useIsMobile()` |
| INV-13 | SFTP 主机绑定必须显式 | **NOT_RUN** | 按任务书留 UX-1c |
| INV-14 | SFTP 连接不被切 tab/关面板终止 | **NOT_RUN** | 按任务书留 UX-1c |
| INV-15 | 启动门禁与恢复编排保持为布局祖先 | **PASS** | `StartupGate` 未动 |
| INV-16 | 前端源码改动会让证据失效 | **PASS（已重采）** | 指纹 `ac1b1b7d…`，官方流程 |

**14 PASS / 2 NOT_RUN。** INV-5 从 UX-1a 的 NOT_RUN 转为 PASS。

---

## 10. 合并建议

**READY**（受两项约束）

| 条件 | 状态 |
| --- | --- |
| 六类验收测试 | ✅ |
| 先红后绿 | ✅ 三处变异均有记录 |
| 前端 / Rust / 全部门禁 | ✅ |
| 证据重采至匹配指纹 | ✅ |
| CI 11/11 | 见 PR |
| **同尺寸 GUI 截图** | ❌ 权限，需要人工点击一次 |
| **不同宽度下的终端行列数** | ❌ NOT_RUN |

两项都不是代码问题，是本机权限边界。**不使用旧截图或单元测试冒充。**

未合并、未打 Tag、未发布。

---

## 11. UX-1c 实施建议

任务书把 Context Dock 与 SFTP 生命周期放到独立阶段。基于本轮的代码状态：

### 11.1 必须解决的前置

1. **SFTP 的主机绑定**（INV-13）：现在是「跟随 `activeTabId` 的 hostId」
   （`sftp-container.tsx:26-32`）。Dock 一旦常驻，这个隐式绑定会让目录树在切 tab
   时串台。需要显式 `dockHostId` 并写测试钉住。
2. **SFTP 会话生命周期**（INV-14）：目前「卸载即关」。Dock 折叠不能等同于卸载，
   否则上传到一半会失败。

### 11.2 建议的边界

- 复用本轮的 `LeftPanel` 模式：**右栏**同样只允许一个占位者（SFTP / Snippets / AI），
  用 `rightPanel` 状态解析，不要再用布尔量
- 复用 `terminal-route.ts` 的收敛方式：先找出散落的 `'/sftp'` 判断再统一
- 传输状态已有三个可见点（状态栏计数、SFTP 传输面板、传输中顶栏徽章），Dock 改造
  不得减少其中任何一个

### 11.3 不建议在本阶段做的事

- 不要把 Explorer 与 Dock 合并成一个「侧栏」—— 那正是本轮消除的双轨
- 不要在 Dock 里持有 PTY 生命周期（设计包 §3.2 第 5 条）
