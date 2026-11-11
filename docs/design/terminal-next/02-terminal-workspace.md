# 02 — Terminal-first Workspace：布局与组件规格

- 状态：**提案（Draft）**
- 门禁：`00-adr-architecture.md` §4 的 16 条不变量
- 审查证据：`layout/`、`router/`、`store/`、`components/` 逐文件核实

---

## 1. 现状与目标

### 1.1 现状

| 事实 | 位置 |
| --- | --- |
| 11 条路由全是整页模块 | `router/nav-config.tsx:45-104` |
| 终端层只是其中一条，靠 `invisible` 叠放 | `main-layout-content.tsx:109-122` |
| 管理页都有 `ViewHeader title+description` | `view/hosts/index.tsx:171-173` 等 |
| 顶栏承担 6 类功能 | `top-toolbar/index.tsx:138-222` |
| SFTP 是独立页，按「当前活跃 tab 的 hostId」绑定 | `sftp-container.tsx:26-32` |

### 1.2 目标

**Terminal Canvas 是主体**，其余按需出现。默认只显示图标轨 + 标签栏 + 终端。

---

## 2. 布局规格

### 2.1 结构（沿用设计包 §3.1）

```text
┌──────────────────────────────────────────────────────────────────┐
│ traffic lights │ Local │ prod-01 ● │ + │ ⌘K │ ─ □ ⋯ │  40px      │
├────┬───────────────┬──────────────────────────────┬──────────────┤
│    │ Connections   │ deploy@prod-01        ⤢ 📁  │ SFTP         │
│ 46 │ Search...     ├──────────────────────────────┤ /home/deploy │
│ px │ ★ Favorites   │ $ git status                 │ files…       │
│    │   prod-01     │ On branch main               │              │
│    │ Recent        │ $ █                          │              │
│    │ Groups        │                              │              │
├────┴───────────────┴──────────────────────────────┴──────────────┤
│ SSH connected • UTF-8 / zsh                    transfer 0    ⚙    │ 24px
└──────────────────────────────────────────────────────────────────┘
        220px（可选）              主画布              300px（可选）
```

### 2.2 五态规格

#### 默认态

| 区域 | 状态 |
| --- | --- |
| Activity Rail | 显示，46px |
| Connection Explorer | **折叠** |
| Terminal Canvas | 占满剩余宽度，**列数 ≥ 80** |
| Context Dock | 关闭 |
| Status Bar | 显示 |

**验收**：1440×900 窗口下终端列数 ≥ 120；1024×768 下 ≥ 80。

#### 展开态

Explorer 展开 220px，Dock 展开 300px。画布仍有最小宽度保护：**当画布会被挤到 < 60 列时，禁止同时展开两者**，或自动折叠 Explorer。

这条是从 INV-12 推导的：`layout/index.tsx:88` 与 `use-sidebar-resize.ts:42-47` 已有一套折叠逻辑，新布局必须复用而不是另起一套。

#### 窄窗口态

| 宽度 | 行为 |
| --- | --- |
| < 900px | Explorer 默认折叠（设计包 §3.4） |
| < 720px | Dock 改为覆盖抽屉，不挤压画布 |
| < 640px | 沿用现有 `useIsMobile()`（`use-breakpoint.ts:16-24`），底部导航 |

**关键约束**：断点必须来自 `useIsMobile()`，不能新建第二套。INV-12 明确要求「窄窗口与侧栏由 store + 单一断点驱动」。

#### 连接异常态

**这是本次 UX 重构最容易做坏的一处。**

现有实现（`terminal-error-overlay.tsx`，刚在 `227d3ea` 加入）：错误覆盖在终端区域内，无计时器，给出下一步操作。

新布局必须保持：**错误贴近对应的 pane，不覆盖整个窗口**（设计包 §3.2 第 4 条）。

| 现状 | 新布局 |
| --- | --- |
| Overlay 在 `relative flex-1 min-h-0` 容器内 | 保持在同一容器内 |
| 显示 `user@host:port` | 保持 |
| 按 `credentialKind` 给动作 | 保持，并新增 provider 维度（见 01 号文档 §3） |

**不能**把错误提到 Status Bar 或全局 toast —— 那正是 10.5 修掉的问题。

#### AI 面板态（UX-4 才启用）

Context Dock 的第三个 occupant。默认关闭；开启时必须在 UI 上明确「将要发送的内容」预览。

**约束**：AI 面板不得持有 PTY lifecycle（设计包 §3.2 第 5 条）。关闭 Dock 不中止传输、不关会话。

---

## 3. 组件契约

### 3.1 新增组件

| 组件 | 职责 | 不得做的事 |
| --- | --- | --- |
| `ActivityRail` | 46px 工具切换 | 不做路由导航（它是工具，不是页面） |
| `ConnectionExplorer` | 搜索、收藏、最近、分组树 | 不拥有 tab 生命周期 |
| `ContextDock` | 承载 SFTP / Snippets / AI | 不拥有 PTY；关闭不终止传输 |
| `StatusBar` | 连接状态、编码、传输计数 | 不输出主机秘密、原始命令、模型 key |

### 3.2 改造现有组件

| 组件 | 改动 | 风险 |
| --- | --- | --- |
| `top-toolbar` | 拆成 `TitleBar` + `StatusBar` | 顶栏有 8 处跳转 `/terminal?tab=`，拆时要保持 |
| `app-sidebar` | 降级为 `ConnectionExplorer` | 侧栏宽度持久化 key `terminal.sidebar.width` 必须保留 |
| `bottom-nav` | 保留（移动端），但 Vaults 入口不能丢 | 窄窗口下是**唯一解锁 Vault 的入口**（`bottom-nav/index.tsx:76-83` 注释） |

### 3.3 路由处理

**不删除任何路由**，只改导航呈现。

| 路由 | 新位置 |
| --- | --- |
| `/terminal` | 主画布（保持 `element: null`） |
| `/hosts` | Explorer 内联，路由保留为深链 |
| `/sftp` | Dock，路由保留为深链 |
| `/vaults`、`/teams`、`/logs`、`/known-hosts` | Settings 下的高级入口 |
| `/keychain`、`/snippets`、`/port-forward` | Activity Rail |

**绝对不可改**：`router/nav-config.tsx:142-143` 的 index 路由 `element: null`，以及 `router/index.tsx:11-23` 的 `TerminalRoute` 返回 null。这两处是 INV-1 的实现。

---

## 4. 快捷键

### 4.1 现有三层保护（INV-10）

| 层 | 位置 | 保护什么 |
| --- | --- | --- |
| 窗口 bubble | `use-global-shortcuts.ts:20-37` | 只放行 5 个 `EDITABLE_SAFE_ACTIONS` |
| xterm | `use-terminal-shortcut-events.ts:14-38` | 6 个 `DEFAULT_SHELL_CTRL_BINDINGS` 放行给 shell |
| 路由守卫 | `use-layout-shortcut-events.ts:52` | 布局类只在 `/terminal` 生效 |

### 4.2 新增快捷键的规则

**任何 `Ctrl+<字母>` 新绑定都会从 readline 抢键。** 必须逐条确认：

| 设计包提议 | 是否冲突 | 结论 |
| --- | --- | --- |
| ⌘K 命令面板 | 否（⌘ 系列） | **可用** |
| ⌘P Quick Connect | 否 | **可用**，但注意 `Ctrl+P` 是 readline 上一条，不可占用 |
| ⌘T 新本地终端 | 否 | 已存在 |
| ⌘B 折叠 Explorer | 否 | 已存在 |
| ⌘\ 分屏 | 否 | **可用** |
| ⌘N / ⌘O / ⌘R / ⌘[ / ⌘] | **需逐一确认** | Tauri/WebView 默认行为可能冲突 |

**`Ctrl+F` 现在就被应用吃掉**（不在放行名单），这是既有取舍，会造成 readline 前进失效。UX-1 不应扩大这类取舍。

### 4.3 缺失的测试保护

`Ctrl+P` / `Ctrl+N` / `Ctrl+R` **目前没有任何测试**。UX-1 应在动快捷键前先给这三个键补保护测试，否则重构中很容易静默破坏 shell 行编辑。

---

## 5. 验收门禁

### 5.1 必须全部通过

```
TERM_LAYER_SINGLE_MOUNT      = 全局 [data-terminal-workbench] 恰好 1 个
NO_EXTRA_PTY_ON_NAV          = 路由切换不新增/不重建会话
TERMINAL_ALWAYS_MOUNTED      = tabs 清空后终端层仍在（ACK 不断）
PANE_NOT_UNMOUNTED_ON_TAB    = 切 tab 后 xterm 不 dispose
SHORTCUT_3_LAYERS            = 三层保护同时存在
NARROW_LAYOUT_REACHABLE      = 320/480/639/640/900/1280 六档终端列数 > 0
ERROR_STAYS_IN_PANE          = 错误覆盖在 pane 内（10.5 行为）
SFTP_HOST_EXPLICIT           = Dock 的 host 不随 activeTabId 变
WORKSPACE_RESTORE            = 4 个持久化字段全恢复
```

### 5.2 真机要求

- **改前/改后相同窗口尺寸截图**（1440×900、1024×768、390×844）
- 3–5 个关键交互录屏：切 tab、分屏拖拽、Explorer 展开/折叠、Dock 开关、错误恢复
- 中文输入法、Vim、tmux 逐项人工确认

**没有截图的项一律 NOT_RUN。** 本项目历史上多次出现「单元测试全绿但真机不可用」，这正是原因。

---

## 6. 与设计包的差异

| 设计包 | 本文档 | 原因 |
| --- | --- | --- |
| 直接新建 Explorer/Dock | 先补 `Ctrl+P/N/R` 保护测试 | 现有无测试，重构会静默破坏 |
| 「关 Dock 不关后台任务」 | 明确列为**行为变更**，需要上提连接生命周期到服务层 | 当前 `use-sftp-remote.ts:171-183` 是卸载即关 |
| 未提 `data-terminal-workbench` | 列为 CSS 契约 | 移动端底部安全区依赖它 |
| 未提 ACK | 列为 INV-4 物理前提 | 卸载终端层会让后台命令跑死 |
