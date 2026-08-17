# 功能视图说明

> 各主内容区视图的功能与 UI 描述，按侧栏导航分类。实现或还原 UI 时可直接对照本节。

---

## 1. Hosts（主机）

### 功能概述

- 管理远程服务器连接配置（SSH/SFTP/Serial）。
- 支持保存主机、分组、标签、收藏。
- 支持搜索与快速连接（在顶栏输入 `ssh user@hostname` 或搜索主机名后 CONNECT）。

### UI 组成

- **工具栏**：
  - 搜索/连接输入框：「Find a host or ssh user@hostname...」+ 右侧「CONNECT」。
  - 「NEW HOST」主按钮（带下拉，可选类型）。
  - 「TERMINAL」「SERIAL」按钮。
  - 右侧：视图切换（网格/列表）、标签/组织、日历、用户/协作图标。
- **内容区**：
  - 标题：「Hosts」。
  - **主机卡片**（网格或列表）：
    - 图标：如 Ubuntu Logo（橙底）。
    - 主标题：显示名称（如「腾讯云4h4g1y」）。
    - 副标题：协议与用户，如「ssh, ubuntu」。
  - 卡片圆角、略亮于背景，悬停可有反馈。

### 数据与交互

- 卡片点击：打开该主机的终端或 SFTP（或进入详情）。
- 新建主机：弹窗或侧栏表单（主机名、地址、用户、认证方式等）。
- 搜索：实时过滤主机列表。

---

## 2. Terminal（终端）

### 功能概述

- 提供 SSH、本地 PTY 与串口交互式终端；每个标签对应一个独立会话实例。
- 无标签启动时不加载终端入口；首个标签出现后，xterm 实例按稳定 `tab.id` 常驻，路由或标签切换只改变可见性，不决定会话生命周期。
- 支持多标签及最多双 pane 的水平/垂直分屏；同一分组不会创建第三个不可见会话，串口标签禁止分屏。
- `activeTabId` 是活动 pane、键盘焦点、标签选中态、URL 和命令投递目标的单一来源。
- 右侧可打开工具侧栏，展示 Snippets、命令历史等辅助工具。

### UI 组成

- **会话标签栏**：
  - 显示全部会话标签、活动态、连接状态和新建标签入口；窄屏允许横向滚动并自动保持活动标签可见。
  - 移动端终端路由在页面顶栏下方保留 44px 会话栏，同样支持切换、关闭和新建，不把会话管理隐藏到导航菜单。
  - 标签使用 shadcn `ContextMenu`，提供关闭、向左/右移动、水平/垂直分屏和退出分屏；菜单项支持键盘导航。
  - 分屏操作达到两个 pane 上限或标签类型为串口时显示禁用状态，不创建额外会话。
- **终端工作台**：
  - 单 pane 时只展示活动标签；双 pane 时同时展示同一分组内的两个标签。
  - 每个 pane 包含紧凑 pane header 与常驻 xterm surface，活动 pane 使用语义化选中/焦点状态，不通过改变边框尺寸引发布局跳动。
  - xterm 使用等宽字体和终端主题色，内容区占满 pane 的剩余空间。
- **紧凑 pane header**：
  - 左侧显示连接目标、会话类型和连接状态；错误或断连状态就地提供恢复动作。
  - 高频操作包含搜索、重连/断开、清屏、工具侧栏和全屏；缩放、复制 SSH 等低频操作进入更多菜单。
- **分隔条（sash）**：
  - 视觉宽度 4px，透明交互命中区 20px；横向/纵向布局使用对应的 resize 光标。
  - 支持鼠标、触控 Pointer、方向键、Home/End 和双击复位；比例限制为 20/80，默认及双击复位为 50/50。
- **右侧工具侧栏**（可选）：
  - 标签：火箭（快捷操作）、花括号（Snippets）、时钟（命令历史）。
  - 搜索框：过滤 Snippets 或历史。
  - **Snippet 配置区**：
    - 说明：「Save your top-3 commands as snippets to reuse them in one click.」
    - 三个输入框（如 pm2 相关命令）。
    - 「Close」「Save」按钮。
  - **命令历史列表**：可点击项，将命令送入终端或执行（如 `pm2 delete 2`、`pnpm dev` 等）。
- **移动端控制**：
  - pane header 仅保留活动会话、连接状态和菜单入口，完整操作放入 shadcn `Sheet`。
  - 移动端仍支持最多双 pane；会话栏和 pane 均保持 44px 以上触控目标，分屏操作从标签菜单进入。
  - 长按终端打开移动端菜单；终端键盘栏提供 Esc、Tab、方向键、修饰键和常用控制码，按钮保持稳定触控尺寸。
  - 工作台底边必须停在固定底部导航及系统安全区上方；底栏入口等分适配窄屏，活动态由当前路由派生。
  - 全屏终端挂到 `document.body` 的 portal，并覆盖底部导航，不受工作台父级堆叠上下文限制。

### 交互

- 点击、触摸或聚焦任一 pane 会立即更新 `activeTabId` 和 URL `?tab=`；标签选择、前后标签快捷键与浏览器历史变化也反向同步到同一状态。
- 命令面板、Snippet、History 和工具侧栏中的命令严格单播到活动标签，不广播到其他常驻 xterm。
- 切换标签或激活 pane 后统一执行 xterm `fit()` 与 `focus()`；搜索、菜单和工具侧栏关闭后将焦点归还当前 xterm，用户可直接继续输入。
- 非活动会话保持挂载和输出接收，但不成为键盘或命令目标；离开 `/terminal` 路由只隐藏工作台，不关闭会话。
- `/terminal` 的空 Outlet 过渡层必须不可见且不可命中，不能透明覆盖常驻工作台。
- 创建分屏会复制连接配置并建立独立会话；关闭活动 pane 后，剩余 pane 解除分组并成为活动标签。
- 拖动 sash 时按 animation frame 合并尺寸更新，结束时执行最终 fit/resize；最新方向和比例写回工作区布局。
- 加载旧布局时归一化超过两个 pane、越界比例和无效活动标签，避免恢复出不可见会话。
- 工作区切换按事务执行：保存当前布局，预载并校验目标布局，成功后提交活动工作区；失败时保留并恢复原工作区、标签和分屏状态。
- 移动端 Sheet、长按菜单或键盘栏关闭后同样恢复活动 xterm 焦点；标准 Ctrl 组合必须发送对应控制码。

### 验证边界

- 浏览器可验证标签、分屏、焦点、移动端控件、明暗主题和响应式布局，但无法建立真实 Tauri SSH、本地 PTY 或串口 IPC。
- Windows/Linux、OpenSSH Agent、Pageant、Jump Host、本地 PTY 与串口硬件交互按 `docs/issue.md` Issue #39 单独做实机验证，不能用浏览器预览代替。

---

## 3. SFTP（双栏文件管理）

### 功能概述

- 本地与远程主机之间文件浏览与传输。
- 双栏并排：左本地，右远程（或可切换）。
- 支持筛选、操作菜单（上传、下载、删除、重命名、新建文件夹、权限等）。

### UI 组成

- **每栏结构一致**：
  - **标题**：左栏「Local」+ 电脑图标；右栏为连接名（如「腾讯云4h4g1y」）+ 图标。
  - **工具栏**：「Filter」（放大镜）、「Actions」下拉。
  - **面包屑**：后退/前进箭头 + 路径（如 `Users > liuzhiwei` / `home > ubuntu`）。
  - **文件表格**：列——Name（图标+名称，下行小字为权限如 `drwxr-xr-x`）、Date Modified、Size、Kind。
- **视觉**：深色背景，文件夹与强调用亮蓝，表格行有适当间距无竖线。

### 交互

- 面包屑与双击目录进入子目录。
- Filter：当前目录内搜索/过滤。
- Actions：上传、下载、删除、重命名、新建文件夹、权限等。
- 支持拖拽在本地与远程之间传输（需在实现中约定）。

### 组件层级（供实现参考）

- TabBar → SplitView → FilePane(Local) | FilePane(Remote) → BreadcrumbNav + FileTable。

---

## 4. Logs（日志）

### 功能概述

- 查看历史连接与操作记录。
- 支持按时间、用户、主机筛选；可标记「已保存/书签」。

### UI 组成

- **工具栏**：与主内容区通用模式一致，可有搜索、视图切换等。
- **表格**：
  - **列**：Date（带排序/筛选）、User（带筛选）、Host、Saved（书签图标）。
  - **行示例**：
    - Date：如「Mar 16, 2026」+ 时间段「13:00 - 13:37」。
    - User：头像 + 邮箱（如 `zl316546@gmail.com`）+ 本机名（如 `liuzhiweideMacBook-Pro.local`）。
    - Host：主机图标 + 显示名（如「腾讯云4h4g1y」）+ 副标题「ssh, ubuntu」。
    - Saved：书签图标，未保存为浅色。

### 交互

- 列头排序/筛选。
- 行可点击查看详情或标记为 Saved。

---

## 5. Port Forwarding（端口转发）

### 功能概述

- 管理 SSH 隧道：本地、远程或动态端口转发。
- 用于访问远程数据库、Web 服务等，如同本地服务。

### UI 组成

- **工具栏**：
  - 「NEW FORWARDING」主按钮（带右箭头与下拉，区分转发类型）。
  - 右侧：搜索、布局切换、详情面板开关。
- **空状态**（无规则时）：
  - 居中大图标：箭头指向盒子/容器。
  - 标题：「Set up port forwarding」。
  - 说明：「Save port forwarding to access databases, web apps, and other services.」

### 有数据时

- 列表或卡片展示每条转发规则（本地端口、远程主机、远程端口等），可编辑/删除。

---

## 6. Known Hosts（已知主机）

### 功能概述

- 管理 SSH 已知主机指纹（对应 `~/.ssh/known_hosts`）。
- 支持从文件导入、列表展示、删除。

### UI 组成

- **工具栏**：「IMPORT」按钮（带上传图标）。
- **标题**：「Known Hosts」。
- **列表**：每项为卡片样式。
  - 图标：蓝色圆底 + 白色指纹。
  - 标签：IP 或主机名（如 `82.156.109.240`）。
  - 圆角、略亮于背景。

### 交互

- IMPORT：从文件（如系统 known_hosts）批量导入。
- 点击项可查看指纹详情或删除。

---

## 7. Keychain（密钥与凭证）

### 功能概述

- 集中管理 SSH 密钥、证书、密码等。
- 支持多种类型：Key、Certificate、Touch ID、FIDO2 等。
- 密钥可与主机关联，连接时自动选用。

### UI 组成

- **中央列表区**：
  - **筛选标签**：KEY（带下拉）、CERTIFICATE、TOUCH ID、FIDO2。
  - 标题：「Keys」（当前在 Keys 下）。
  - 列表项：卡片，选中时绿色边框；图标+标签（如「Add a label...」）+ 副标题「Type: unknown」。
- **右侧面板（New Key / 编辑）**：
  - 标题：「New Key」；上下文下拉「Personal vault」；更多「...」、收起箭头。
  - **表单**：
    - Label：单行输入。
    - Private key \*：多行必填。
    - Public key：多行。
    - Certificate：多行。
  - **导入区**：
    - 虚线框拖放：「Drag and drop a private key file to import」。
    - 主按钮：「Import from key file」（绿色）。

### 交互

- 列表选一项则在右侧显示详情/编辑；新建则显示「New Key」表单。
- 支持粘贴密钥文本或从文件导入。

---

## 8. Snippets（代码片段）

### 功能概述

- 保存并复用常用命令/脚本。
- 可关联「目标主机」，一键在多台机器上执行。
- 可选：用自然语言描述 + AI 生成脚本。

### UI 组成

- **中央列表区**：
  - 工具栏：「NEW SNIPPET」（蓝色+下拉）、「SHELL HISTORY」；右侧搜索、视图、更多。
  - 标题：「Snippets」。
  - 列表/卡片：空时占位卡片（绿框）+ 花括号图标 +「Set a Label or Script...」。
- **右侧面板（New Snippet）**：
  - 标题：「New Snippet」；上下文「Personal vault」；更多、展开图标。
  - **AI 提示卡片**（可关闭）：
    - 标题：「Termius can write the code for you!」
    - 说明：在「Action description」中写描述，点 AI 图标生成脚本。
    - 按钮：「Ok, got it」。
  - **表单**：
    - Action description：单行，占位「Example: check network load」，右侧 AI 图标。
    - Add a Package：依赖输入。
    - Script \*：多行必填。
  - **执行目标**：
    - 说明：「Automate work with snippets. Add target hosts and automatically run the snippet on them in one click!」
    - 列表项占位：「IP or Hostname」「SSH」等。
  - 底部：「Run」按钮（无目标或未填脚本时可禁用）。

### 交互

- 保存 Snippet 后可在一侧列表点击运行或编辑。
- 选择目标主机后「Run」在所选主机上执行脚本。

---

## 视图与路由/组件对照建议

| 视图            | 路由示例               | 前端组件/视图         |
| --------------- | ---------------------- | --------------------- |
| Hosts           | `/hosts` 或 `/`        | home-view / host-list |
| Terminal        | `/terminal?tab=:tabId` | TerminalByUrl / TerminalWorkbench |
| SFTP            | `/sftp/:sessionId`     | sftp-container        |
| Logs            | `/logs`                | 待实现                |
| Port Forwarding | `/port-forwarding`     | port-forward          |
| Known Hosts     | `/known-hosts`         | 待实现                |
| Keychain        | `/keychain`            | 待实现                |
| Snippets        | `/snippets`            | snippet-manager       |

以上描述可直接用于需求澄清、UI 还原与实现对照；与 `docs/project.md`、`docs/design.md` 结合可保持文档与代码一致。
