---
status: canonical-draft
updated: 2026-11-16
fact_baseline: "main@5f248631e6fff10e824de34cd73b2291fc8ab416"
scope: "Information architecture, visual language, responsive behavior, input and reference-image constraints"
---

# 03 · UI/UX Blueprint

## 1. 信息架构

```text
Application Gate
└─ App Shell
   ├─ Title Bar
   │  ├─ Workspace picker / breadcrumb
   │  ├─ Command Palette (⌘K / Ctrl+K)
   │  ├─ Split / window actions
   │  └─ Native window controls
   ├─ Activity Rail
   │  ├─ Terminal
   │  ├─ Connections / Explorer
   │  ├─ Files / SFTP Dock
   │  ├─ Snippets
   │  ├─ Port Forward / advanced
   │  ├─ Assistant (future, only when runtime exists)
   │  └─ Settings
   ├─ Left Panel: none | explorer | navigation
   │  ├─ Search
   │  ├─ Recent / Favorites / Groups / All
   │  └─ Host actions
   ├─ Center: always-mounted Terminal Plane
   │  ├─ Tab Bar
   │  ├─ Split Tree / Pane headers
   │  └─ xterm Canvas / pane error
   ├─ Right Context Dock: none | sftp | snippets | inspector | ai
   └─ Status Bar
      ├─ current Session/Host state
      ├─ active cols×rows
      ├─ live transfer count
      └─ (encoding: 设计目标，当前无数据源，不渲染)
```

管理页 `/hosts`、`/sftp`、`/vaults`、`/teams`、`/logs`、`/settings`、`/keychain`、`/known-hosts`、`/port-forward`、`/snippets` 保留深链。管理页可以是完整工作表，但不能通过路由删除常驻 Terminal Plane。

## 2. 视觉层级与 Token

### 设计语言

Graphite × Violet：深色石墨背景、层级化表面、紫色只表示选择和主要动作。绿色、黄色、红色和蓝色分别表示连接成功、等待/谨慎、失败和进行中。终端画布保持平整，管理页使用表格和 Inspector，不用大面积发光或虚构 KPI。

### 建议语义 Token

| Token | 暗色起点 | 用法 |
| --- | --- | --- |
| `background` | `#101116` | App Shell 背景 |
| `surface-1` | `#161820` | 面板/导航 |
| `surface-2` | `#1C1E28` | 输入/hover |
| `surface-3` | `#262736` | 菜单/选中层 |
| `border` | `#303240` | 分隔线 |
| `text-primary` | `#E9EAF0` | 正文 |
| `text-muted` | `#9B9EAD` | 辅助信息 |
| `accent` | `#9B6AED` | 选中/主操作 |
| `success` | `#53CC91` | 已连接/成功 |
| `warning` | `#F0B75B` | 警告/等待 |
| `danger` | `#E87680` | 失败/删除 |
| `info` | `#6FAEF4` | 进行中/提示 |

这些是设计起点，不允许直接全局覆盖当前主题。落地 PR 要对现有 CSS 变量、深浅主题、CJK/法文长度、WCAG 对比度和截图逐项审查。

### 尺寸和密度

| 元素 | 目标 | 约束 |
| --- | --- | --- |
| Title Bar | macOS 44–48px；Windows 44px | 系统控件独立热区 |
| Activity Rail | 当前 46px，目标 48px | icon-only 必须 tooltip/aria-label |
| Tab Bar | 38–40px | 最小 100、常规 160、最大 240px；溢出菜单 |
| Explorer | 当前保存值兼容；目标 240px，可调 176–360px | 不覆盖旧 `terminal.sidebar.width` |
| Compact Dock | 300–360px，目标 320px | 小窗改 overlay，不渲染双列 |
| Assistant Dock | 360–460px | 不能挤到终端不可用 |
| Status Bar | 26px | 没有真实来源的字段不显示 |
| Row | compact 28–32px；comfortable 36–40px | 触摸/键盘路径保持可达 |
| Control | compact 30px；default 36px | 手机触摸目标至少 44px |
| Spacing | 4/8/12/16/24/32px | 统一使用 `gap-*` 和语义 Token |

## 3. 布局算法

布局以实际 App Shell 宽度和 xterm cellWidth 决策，不从图片尺寸或 `window.innerWidth - 常数` 推导。

```ts
interface LayoutInput {
  shellWidth: number
  railWidth: number
  leftMode: 'none' | 'explorer' | 'navigation'
  leftWidth: number
  rightMode: 'none' | 'sftp' | 'snippets' | 'inspector' | 'ai'
  preferredRightWidth: number
  cellWidth: number
  paddingAndBorders: number
  minCols: number // 60
  isMobile: boolean
}
```

裁决顺序：

1. Terminal Canvas 优先，先计算真实可用 cols。
2. 如果当前 Dock 作为 column 会让 cols < 60，则 Dock 转 overlay。
3. 如果 Explorer + Dock 同时展开仍小于 60，先让位 Dock，再折叠 Explorer；不改用户的 width preference。
4. 小于 640px 或 `isMobile` 时使用 BottomNav/Drawer，不把桌面 Dock 挤进手机。
5. 在边界使用 24px hysteresis，避免 ResizeObserver 和字体变化导致 presentation thrash。
6. 最终通过 xterm `proposeDimensions` 和真实 `onResize` 复核，不只断言预测值。

目标窗口只是验收样本，不是硬编码：Focus 1440×900 目标 ≥120 cols，1024×768 目标 ≥80 cols；双侧展开的可用底线是 60 cols；512×370 必须允许关闭面板并保持输入。

## 4. 核心页面规格

### 4.1 Focus Terminal

默认只显示 Rail、Tab Bar、Terminal Canvas 和 StatusBar。无 Tab 时显示本地终端 CTA，不显示黑屏。Connected/Connecting/Disconnected/Failed 都在对应 Tab 和 Pane 内表达。状态栏只显示当前活跃 Session 的真实信息。

### 4.2 Connection Explorer

Explorer 是终端旁的轻量连接面板，包含 Search、Recent、Favorites、Groups。Recent 只能来自 `connection_logs`；没有真实记录就显示空态。点击 Host 行可预览/编辑，明确 Connect 才创建 Tab。错误不影响已有 Host 列表和 Terminal。

### 4.3 Hosts 管理页

三列管理态只在宽窗使用：Rail + Explorer + 主表 + Details Inspector。列表支持批量标签/分组/导出，删除需要确认。Host 详情显示最近成功连接时间、HostKey 状态和 Credential Provider 状态，不展示 Secret。`Last successful` 不得渲染为 `Online`。

### 4.4 New SSH Connection

表单字段按 Password/Private Key/SSH Agent/Certificate 切换，保留未提交输入；右侧 Summary 显示 Host/Port/User/Auth/Provider 状态。`Test Connection` 不自动保存、不修改 Host ID。Vault/Keychain 状态错误在表单上下文中恢复，网络错误走连接错误，不混用重试预算。

### 4.5 Split Workspace

Tab Bar 在 Shell 层，Pane header 显示 Host、Tab 名、状态和操作。当前实现限制每组两个 Pane；未来若做 2×2，必须先扩展 SplitTree、关闭/焦点/恢复和真实输入证据，不能只把 UI 图画成四格。Inactive Pane 保留输出订阅和 ACK，输入只写 active Pane。

### 4.6 SFTP Full/Dock

Full `/sftp` 双栏浏览 Local/Remote；Dock 只渲染一个文件列表，通过 Local/Remote Tab 切换，显示 Pin Host、路径、刷新、进入 Full View。每行带 `hostId/sessionId/remotePath` 语义、状态、字节和 SHA/错误信息。Dock 关闭不关闭正在传输的 Session。

### 4.7 Logs & Output

来源明确区分 App Log、Session Output、Transfer Activity、Connection History。大列表虚拟化，Follow 只在用户位于底部时生效；导出/复制再次脱敏。没有真实来源的时间、Host、Level 以 unknown 显示，不猜测。

### 4.8 Settings

Settings 按 General、Terminal、Appearance、Connections、Shortcuts、Security、Transfers、AI（未来）、About 分组。字体/主题变更实时预览但不重建 Session。保存失败保留输入并显示原因；平台不支持的选项说明原因，不显示假开关。

### 4.9 Command Palette

结果来自统一 Action Registry：`id/titleKey/category/keywords/when/run/needsConfirmation`。搜索域包括 Commands/Hosts/Files/Recent/Snippets/Settings；危险动作需确认。IME composing 时 Enter 只确认候选，不执行动作。`Ctrl+C/D/L/P/N/R/W/U` 等 Shell 控制键不被新功能占用。

### 4.10 AI Dock（UX-4 才启用）

单 Composer、Profile Selector、Context Chips、Context Preview、Cancel/Retry。每次发送前显示 Host/Session/所选字节和脱敏结果；模型未配置、401、429、timeout、cancelled 都有可恢复状态。命令草稿卡显示完整文本和风险，默认只能 Copy/Save Snippet。

## 5. 状态设计

所有页面必须同时定义 Loading、Empty、Error、Success、Permission、Offline、Stale、Long Text 和 Disabled 状态：

- **Loading**：Skeleton 不遮住持续运行的 Terminal；只在该面板内占位。
- **Empty**：说明为什么为空，并给下一步操作，例如 New Local、Add Host、Import OpenSSH。
- **Error**：保留已有数据和用户输入，提供 Retry/Edit/Unlock/Check 等准确动作。
- **Permission**：显示哪个系统资源被拒绝，不改写成网络故障。
- **Offline/Stale**：区分当前未检测、历史成功和当前连接；不渲染绿色假状态。
- **Long Text**：主机名/路径 truncate + tooltip；命令和日志保留可选择原文。
- **Disabled**：显示原因，不能通过键盘绕过 disabled action。

## 6. 键盘、鼠标和 IME

### 快捷键规则

- macOS 使用 ⌘，Windows/Linux 默认 Ctrl；系统关闭/窗口快捷键保留给平台。
- 新绑定必须先检查 xterm 放行表、编辑控件和路由作用域。
- 快捷键的显示和实际 handler 必须来自同一 registry；禁止仅修改 Settings 展示。
- `Ctrl+P/N/R` 保留 readline 语义；命令面板默认使用 ⌘K/Ctrl+K；用户可配置但冲突必须显式拒绝。
- **`Ctrl+F` 也保留给 shell**（readline `forward-char`）。它此前被绑成「终端内搜索」并被
  应用吃掉 —— 一条注释记录了这个取舍，理由是「收回属于搜索的产品决策」。T05 做了那个
  决策：搜索在右键菜单与命令面板各有入口，而 `C-f` 是 shell 用户不假思索会按的键。
  完整放行表见 `use-terminal-shortcut-events.ts` 的 `DEFAULT_SHELL_CTRL_BINDINGS`。
- Command Palette、Dialog、AI Composer 和 xterm 各自有焦点 owner；焦点不清楚时不得提交动作。

### IME

`compositionstart → compositionupdate → compositionend` 期间，Palette/AI/表单不能把 Enter/Escape 当成终端动作。中文、日文、韩文分别验证 xterm、Host 表单和 AI Composer；未确认的组合文本不能发送 SSH。粘贴保护沿用现有 PastePolicy，不隐式回车。

### 鼠标/触摸

分屏 sash 视觉 4–6px，命中区至少 20px；右键操作必须有可见菜单或 Palette 路径；手机使用 Sheet/BottomNav，触摸目标至少 44×44px。Dock 的开关、Pin、Follow 不得改变后台 Session owner。

## 7. 平台适配

### macOS

- 交通灯保留系统安全区，TitleBar 可拖动区域与按钮点击热区分开。
- ⌘ 快捷键、系统菜单、Keychain 和 Retina glyph 以真机为准。
- Mission Control、窗口失焦/恢复后 Terminal 仍保活并能重新聚焦。

### Windows

- Minimize/Maximize/Close、双击标题栏和 Alt+F4 保留系统习惯。
- `Segoe UI Variable` 优先，Terminal 使用用户配置等宽字体；125%/150% DPI 测量用 CSS px + 实际 cols。
- Windows 本地路径与远端 POSIX 路径不混用；OpenSSH Agent/Pageant 失败显示具体 provider。

### Linux/移动端

- Linux 窗口装饰、文件对话框和桌面主题需要真实运行验证；编译成功不等于桌面通过。
- Mobile 沿用 `useIsMobile()` 和 BottomNav；不在 390px 宽窗口强塞桌面 Explorer/Dock。

## 8. 参考图映射

| 图 | 真实页面/规格 | 可复用 | 必须纠正 |
| --- | --- | --- | --- |
| 01 Focused Terminal | Focus Terminal | Rail、Tab、状态栏、终端主画布 | 图片里的命令输出、时间和连接状态都是示例 |
| 02 Connections | Hosts 管理页 + Explorer | Recent/Favorites/Groups、Details Inspector | 不假设所有 Host Online；Recent 必须来自 `connection_logs` |
| 03 SSH/Vault | New SSH Connection + Credential 详情 | 表单/summary/安全检查层级 | 未验证 Keychain 不能标为有效，图片里的秘密不能复用 |
| 04 Split | Split Workspace | Pane 边界、Tab 和 Split 工具 | 不能以图证明 2×2、ACK 或 Session 独立 |
| 05 SFTP | Full `/sftp` + Compact Dock | 文件表、Transfer Center | Dock 只做单列，不能把图片双栏缩到 300px |
| 06 Logs | Logs & Output | 时间/Level/Host 层级 | 不添加没有采集源的历史日志 |
| 07 Operations | Server Inspector | 卡片层级、时间戳 | 不做假 CPU 曲线、常驻健康率或告警 |
| 08 AI | AI Dock | Context Review、审批卡、Composer | 当前无生产 AI Runtime，不把示例回答当实现 |
| 09 Settings | Settings | 分类、主题预览、快捷键 | 未实现 Provider 不显示可用开关 |
| 10 Palette | Command Palette | 搜索、分类、kbd hint | 不把示例文件索引或主机在线状态写进产品 |

当前执行环境未找到 v2.0 声称的四张 Windows 图，因此 Windows 视觉验收只能以本规格的真实平台矩阵和未来收到的图为准，不能复制不存在的参考资产。

## 9. 视觉验收

每个 UI PR 至少提供同一固定尺寸的改前/改后截图或明确 `NOT_RUN`：

- macOS：1440×900、1024×768、512×370；100%/125%/150% 字体/缩放。
- Windows：1440×900、1280×800、900×700；100%/125%/150% DPI。
- 关键态：Focus、Explorer、Dock、两者让位、Split、Host Form、Settings、Palette、Error、Loading、Empty。
- 对比度、focus ring、标题栏控件、CJK/法文长标签、窗口最小尺寸、键盘和 IME 分开验收。
- 参考图只检查信息层级、密度和视觉语言；真实数据、状态和功能必须来自 fixture/应用运行时。
