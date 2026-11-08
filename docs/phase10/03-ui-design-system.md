# Phase 10 — Terminal-first UI 与设计系统

## 定位

保留现有 shadcn/ui + Tailwind + Lucide 体系，不新建视觉语言、不引入第二套 UI 框架。
本次改动只调整**信息层级**与**启动落点**，不改组件库。

## 导航层级（已实现）

| 层级 | 入口 | 理由 |
| --- | --- | --- |
| 一级（primary） | Hosts、SFTP | 每天都会用；终端本身由常驻层渲染，不是路由 |
| 二级（secondary） | Keychain、Port Forward、Snippets、Settings | 偶尔打开，紧邻一级 |
| 高级（advanced） | Vaults、Known Hosts、Logs、Team | 低频或配置类 |

实现：`router/nav-tier.ts` 定义 `NavTier`，`nav-config.tsx` 为每一项标注，
`app-sidebar/index.tsx` 先渲染 primary，再用 `Separator` 分隔其余项。

**不删除任何路由、不删除任何数据模型**：`router/route-table.tsx` 仍为十个入口
生成路由，测试 `nav-tiers.test.ts` 断言"每个导航项恰好属于一个层级"且"所有路由可达"。

## 启动落点

- 索引路由 `element: null`，由 `layout` 中常驻的 `TerminalByUrl` 渲染终端；
- 不在路由里渲染终端：那会为同一 tabId 挂载第二个 `TerminalContainer`，
  产生两个 PTY 与两个监听器（`router/index.tsx` 的注释已记录该约束）；
- 测试 `nav-tiers.test.ts` 锁定"索引路由是终端层，不是主机管理表"。

## 视觉与可访问性基线（沿用既有）

- 颜色：语义 token（`bg-background`、`text-muted-foreground`、`border-border`）；
- 主题：Dark / Light / System，由 `AppStore.theme` 单一数据源驱动；
- 焦点：`focus-visible:ring` 由 shadcn 组件统一提供；
- 图标：Lucide，尺寸由容器决定；
- 动效：仅侧栏项的 `fade-in`/`slide-in-from-left`（已在 `prefers-reduced-motion` 下由 Tailwind 处理）。

## 未做（明确记录）

- 未新增"右侧按需面板"（SFTP/片段/会话信息）：现有 `/sftp` 路由与分屏已能用，
  在真实使用数据证明需要之前不增加布局复杂度。
- 未重新调色、未改字号/圆角体系：没有证据表明现状影响日常使用。
- 真实截图：本机无 Screen Recording 权限，`GUI_VISUAL_EVIDENCE=NOT_RUN`。
