# 终端工作台重构方案

## 1. 目标

参考本地 `../nyala-studio`（SideX / VS Code Workbench 分支）的终端交互模型，重构当前 Terminal 项目的终端前端体验。复用其成熟的“会话实例、会话组、活动面板、分屏布局、焦点与尺寸同步”逻辑，不复制其 Workbench 框架和视觉代码。

本轮成功标准：

- 打开终端后可立即输入；切换标签或点击分屏后，活动终端获得焦点并成为命令投递目标。
- 标签、分屏和活动面板具有一致状态；不会创建 UI 无法展示的第三个分屏实例。
- 桌面端常用动作在会话栏内直接可达，次要动作进入 shadcn/ui 菜单；移动端保持触控友好。
- 分隔条支持鼠标、触控和键盘调整，尺寸写回工作区状态，并触发 xterm 自适应。
- 非活动终端实例保持挂载和会话存活，路由切换不关闭会话。
- UI 使用项目已有 shadcn/ui、Lucide 和语义色 token，支持明暗主题，不引入新依赖。

## 2. 已确认的现状与参考逻辑

### 当前项目问题

1. `TerminalWorkbench` 只渲染分组前两个标签，但 `splitTab()` 可继续向组内追加实例，产生不可见会话。
2. 分屏内点击终端不会同步 `activeTabId`；Snippet、History 和快捷键可能仍投递到旧面板。
3. xterm 仅在首次创建后调用 `focus()`；标签切换、分屏切换和搜索关闭后的焦点恢复不统一。
4. 顶部全局标签、会话状态条和终端工具栏三层并存，重复显示会话信息并压缩终端高度。
5. 标签右键菜单为手写 fixed DOM，缺少完整键盘语义；分屏状态使用 emoji 表达。
6. 分隔条仅支持鼠标拖动，尺寸只保存在组件局部状态，工作区保存后不能恢复最新比例。
7. 终端组件订阅整个 `tabs` / `hosts` 数组，高频状态变化会让所有常驻终端参与无关渲染。

### 从 Nyala Studio 采用的逻辑

- **实例与视图分离**：终端实例长期存在，视图显隐不决定会话生命周期。
- **组是布局边界**：标签选择的是活动实例；分组决定同时可见的实例集合。
- **活动面板显式化**：焦点、命令目标和选中态使用同一个 active instance 来源。
- **分隔条是一等控件**：支持约束尺寸、键盘操作、双击复位和布局后的终端 resize。
- **动作分层**：高频操作直接显示，低频操作进入上下文菜单；状态与错误靠近所属会话。
- **大缓冲区 resize 降噪**：尺寸变化按 animation frame 合并，避免拖动时重复 reflow。

### 明确不采用

- 不迁移 Nyala 的 VS Code service/contribution/context-key 基础设施。
- 不迁移侧边竖向 Terminal Tabs、编辑器区域或命令注册系统。
- 不改造 Rust 会话命令、SSH/SFTP 协议、数据库结构或主题系统。
- 不在本轮实现任意数量或嵌套分屏；当前产品边界为最多两个面板。

## 3. 技术栈与目录

- React 19 + TypeScript + Vite
- Zustand：`packages/frontend/src/store/app.ts`
- xterm.js：`packages/frontend/src/features/terminal/`
- shadcn/ui + Tailwind：`packages/frontend/src/components/ui/`
- 布局入口：`packages/frontend/src/layout/`
- 国际化：`packages/frontend/src/locales/{cn,en,fr}/app.ts`

## 4. 目标交互模型

```text
TopToolbar
└── Session tabs (组/实例导航 + 新建)
    └── TerminalWorkbench
        ├── Pane A [active]
        │   ├── compact session header (目标、状态、主要动作)
        │   └── persistent xterm instance
        ├── accessible sash
        └── Pane B
            ├── compact session header
            └── persistent xterm instance
```

状态约束：

- `activeTabId` 同时代表键盘焦点目标、命令投递目标和选中样式。
- 单面板时仅当前标签可见；双面板时同一 `SplitGroup.tabs` 的两个标签可见。
- 点击、触摸或聚焦任一面板，立即将其设为 active。
- 分屏新建复制连接配置并建立独立会话，与 Nyala / VS Code 的 split terminal 行为一致。
- 双面板组再次执行 split 为无操作并给出禁用状态，不创建幽灵标签。
- 关闭活动分屏后，剩余面板解除分组并成为 active。

## 5. 实施任务

### Phase A：状态模型与回归测试

- 为 `AppState` 增加显式的 `activateTab` / `resizeSplit` / `moveTab`（最终命名以现有风格为准）。
- 收紧 `splitTab` 为双面板上限，并修复关闭分屏后的活动标签选择。
- 用 store 单元测试覆盖：双分屏上限、活动面板、关闭/移出分组、尺寸限制、标签重排。

验收：`pnpm --filter=@terminal/frontend test -- src/store/app.test.ts` 通过。

### Phase B：会话标签栏

- 用 shadcn `ContextMenu` / `DropdownMenu` 替换手写右键浮层。
- 使用 Lucide 图标与文本/状态点替换 emoji 分屏标记。
- 支持键盘可达的切换、关闭、向左/右移动、水平/垂直分屏、退出分屏。
- 在窄屏使用横向滚动并保证活动标签可见；移动端按钮维持至少 44px 触控区域。

验收：组件测试覆盖菜单动作与活动标签语义；无原生表单控件或自绘弹层。

### Phase C：工作台与活动面板

- 为每个 pane 增加明确的 active/visible 状态与点击/焦点激活回调。
- 非活动 xterm 保持挂载但不可交互；活动 pane 使用语义 focus ring，不改变布局尺寸。
- 分隔条支持 Pointer Events、方向键、Home/End、双击 50/50，并把尺寸同步到 store。
- resize 通过 `requestAnimationFrame` 合并；拖动结束后执行最终 fit/resize。

验收：鼠标、触控和键盘均可调整；20/80 边界生效；保存的比例可恢复。

### Phase D：终端面板头与焦点恢复

- 合并 `SessionStatusBar` 与 `TerminalToolbar` 为紧凑的 pane header，去掉重复标题层。
- 保留目标、连接状态、搜索、重连/断开、清屏、工具侧栏、全屏；缩放与复制 SSH 放入更多菜单。
- `TerminalContainer` 仅订阅自己的 tab/host；收到 active 后统一 `fit()` + `focus()`。
- 搜索、菜单、工具侧栏关闭后把焦点归还当前 xterm。

验收：标签切换和分屏点击后可直接输入；连接错误有就地恢复动作；单屏可用高度增加。

### Phase E：移动端与验证

- 移动端顶部显示活动会话和连接状态，常用操作进入现有 Sheet；保留长按菜单和键盘栏。
- 运行测试、lint、typecheck、build、源码行数门禁。
- 启动 Vite，通过浏览器在桌面与手机尺寸检查布局、主题、焦点和控制台。
- 更新 `docs/project.md`、`docs/issue.md`、`docs/todo.md` 与 `docs/ui/02-views.md`。

## 6. 测试策略

- **单元测试**：Zustand 会话/分屏状态转换、尺寸归一化和标签重排。
- **组件测试**：标签选择/关闭/菜单动作、分隔条键盘行为、活动 pane ARIA 状态。
- **集成检查**：常驻 `TerminalByUrl` 在非终端路由不可交互，回到终端路由会恢复 active xterm。
- **浏览器检查**：1440x900、1024x768、390x844；浅色/深色；控制台无新增错误。
- **Tauri 边界**：浏览器无法建立真实本地/SSH/串口 IPC，真实连接仍以既有 Rust 自动测试和实机矩阵为准。

## 7. 命令

```bash
pnpm --filter=@terminal/frontend test
pnpm --filter=@terminal/frontend lint
pnpm --filter=@terminal/frontend typecheck
pnpm --filter=@terminal/frontend build
pnpm check:source-size
pnpm dev
```

## 8. 代码规范与边界

### 始终执行

- 使用 `@/` 路径别名、Zustand selector、shadcn/ui 和语义色 token。
- Icon Button 提供 `aria-label` / tooltip，Lucide 图标在 Button 内使用 `data-icon`。
- 使用 `gap-*`、`size-*`、`cn()`；组件/普通 TSX 文件分别不超过项目行数门禁。
- 保持 macOS、Windows、Linux 快捷键差异和 WebKit 输入补偿不回退。

### 本轮不做

- 不新增 npm/crate 依赖，不改数据库 schema，不改 Tauri capability/CI。
- 不移除已有搜索、补全、历史、Snippet、右键菜单、移动键盘能力。
- 不实现 shell integration、命令装饰、任意嵌套分屏或终端拖出新窗口。

## 9. 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| 常驻 xterm 在重排/显隐时错误重建 | 保持稳定 `tab.id` key；只更新显隐与 active props |
| 拖动分隔条造成 xterm 大量 reflow | Pointer Move 仅合并到 animation frame；结束时最终 fit |
| 分屏活动状态与 URL 不一致 | 所有 pane 激活统一更新 store 和 `?tab=` |
| 移动端控件过密 | 只显示状态和菜单入口，完整动作放入 Sheet |
| 修改状态模型破坏工作区恢复 | 保持 `Tab` / `SplitGroup` JSON 兼容，只新增可选字段或 action |

## 10. 完成定义

- 上述 Phase A-E 全部完成并有自动化或可复现验证记录。
- 新增/修改文件满足行数限制，文档与代码状态一致。
- 终端核心路径在桌面和移动尺寸下无重叠、无不可见活动会话、无焦点丢失。
- 不把浏览器模拟结果表述为真实 SSH/PTY/串口实机通过。
