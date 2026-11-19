# TN 审计残余假绿收口（2026-11-19）

> 本文只记录**已经跑过**的东西。下面每条结论都带提交、命令或日志位置；
> 没有证据的推测不会写成结论，被推翻的结论保留原文并附上推翻依据。

---

## 1. GUI E2E 的三层假绿

本轮把"spec 写出 NOT_RUN → wdio `failed: 0` → 汇总器 PASS → workflow `return 0`"
这条链逐层断开：

| 层 | 修复 | 位置 |
| --- | --- | --- |
| case 层 | REQUIRED 面板打不开时 **抛出**，不再记 `notes.push(NOT_RUN)` | `e2e/gui/specs/e2e-04-dock-occupants.e2e.mjs` |
| 断言层 | 删掉零断言用例（6→5）；`runPaletteAction` 改 10s 条件轮询，不再 `sleep(400)` | 同上 |
| 汇总层 | case 级 FAIL 或超出声明缺口的 NOT_RUN → FAIL；不可读证据与 ENOENT 区分 | `scripts/gui-e2e-report.mjs` |

**先红后绿**：变异（把 `check()` 改回记 note）分别让 3 条、2 条、1 条变红，
恢复后全绿。

同时修正了 `e2e-01` 的一处**字段类型不匹配**（当作数字读的字段实际是数组），
这种错会让"已声明"的缺口永远对不上。

---

## 2. Linux Snippet Dock 的真实根因

不是"扩展没注册"，不是"选择器不对"，是**固定等待短于首个打开耗时**：

| 测量 | 值 |
| --- | --- |
| 首次打开耗时 | 482 ms / 539 ms |
| 原 `sleep` | 400 ms |

`sleep(400)` 在 macOS 上够用、在 Linux runner 上不够。改成 10s deadline 轮询后，
Linux 上 dock 正常打开，`notRunCount` 与另外两个平台一致。

按要求**没有**调大超时来掩盖：改的是等待方式（条件轮询），不是阈值。

---

## 3. Vitest 稳定性

先做了复现矩阵（全量 / layout 子集 / 单文件 / 1 worker / 当前 worker 数 /
不同文件顺序 / 重复跑）。结论：

- **跨文件污染假设被自己的实验推翻**：5 次运行 pass-fail-pass-pass-pass，
  失败与文件顺序无关；
- 真实原因是 **CPU 压力下未被 mock 的 `React.lazy` 边界**。
  空闲时 12/12 通过，8 路并发负载下 6/6 失败；
- 修复是对该边界补 mock 并写明测量条件，**没有**调 `testTimeout`，
  **没有**减少断言，**没有**加自动重试。

---

## 4. Inspector 真实取消

关闭面板原先只停止"相信结果"，exec 通道仍在服务器上开着直到自身超时。

实现 `ExecCancellation`（每次 exec 一个一次性 `Notify` + `AtomicBool`），
`tokio::select!` 竞争取消与 deadline，`exec_local` 用 `kill_on_drop`。

**证据是子进程真的被杀**：取消后断言子进程 PID 不再存在，而不是"函数返回了错误"。

`MUST NOT 关闭整个 SSH 会话`这一条按设计保持：取消作用于单次 exec，
不触碰会话。

1 秒刷新只更新 UI 陈旧态，卸载后 `vi.getTimerCount()` 无残留。

---

## 5. Snippet 工作流（Task E）——这一轮的真实产品缺陷

在真实 WebView 里跑通"打开 dock → 启用扩展 → 选中文本 → 捕获草稿 → 命名 →
保存进 SQLite → 关闭重开 → 找到它 → 停用再启用"的过程中，发现**三处产品缺陷**：

### 5.1 `terminal.context` 菜单从未被渲染

`context.menus.register({ location: 'terminal.context', … })` 把贡献存起来了，
**没有任何东西渲染它**。dock 开着、文本选中，用户没有可点的入口。

### 5.2 设置开关只在保存时生效

`applyExtensionSettings` 只在 `handleSave` 里调用。用户拨了开关切到终端，
什么都没发生，也没有任何提示说要先点保存。

### 5.3 `enabledExtensions` 启动时从未被读取

存进了 `app_settings`，重启后没人读。开关显示 "on"，扩展是关的。

### 5.4 开关只激活、不落库（本轮最后一条）

`applyEnabledExtensions(value)` 只激活，**从不写库**。于是：

```
开关点击 → 激活成功 → app_settings 仍是旧列表
         → 任何一次"按存储列表重新应用"（设置页保存 / App 启动）
         → registry 被拉回旧值，开关仍显示 "on"
```

**这条最初被我判断错了。** 第一版结论是"菜单读到陈旧值"，理由是 CI 日志里
`runtime` 快照显示扩展已激活而菜单里没有。推翻它的证据有三条：

1. Radix 每次打开都重新挂载 `ContextMenuContent`，读的是当次渲染；
2. 构建产物里 registry 是单一模块作用域单例（`dist/js/terminal-session-ids.*.js`
   只有一处 `menusFor`），不存在两份实例；
3. 生产代码里只有两条 deactivate 路径，其中 `useExtensionRuntime().disable()`
   **没有调用方**。

因此只可能是"按列表应用"把它关掉了，而列表之所以是旧的，是因为开关没写库。

修复：`persistAndApplyExtensionToggle` 先写库再应用；`applyEnabledExtensions`
接受带序号的列表，晚到的旧快照被拒绝；激活通知挂在 registry 构造时的
`onChanged` 上（而不是 hook 的 `enable`，因为设置开关根本不走它）。

### 5.5 E2E 覆盖

`e2e-05-snippet-workflow.e2e.mjs` 现有 6 个用例，包含本轮新增的
"关闭再启用"用例，断言：

| 断言 | 为什么必须这样断 |
| --- | --- |
| 开关 `data-state` 为 `checked` | 用户看到的状态 |
| registry `active` 含 `snippet-dock` | 开关与运行时是否一致 |
| registry `menus` 含 `snippet-dock.capture-selection` | 贡献是否还在 |
| **`app_settings.enabledExtensions` 含它** | 只读 registry 看不出"只应用不落库" |
| 关闭 dock 后同一 PTY 仍能执行命令 | 不是 `xterm` DOM 存在性 |
| SQLite 里按名字查到行 | 不是 React state |

---

## 6. 真实 SSH 密码认证（Task F）

**这条在开工时就已经实现了**，我一开始写了 200 行重复实现，发现后删除。

既有实现 `scripts/terminal-smoke-password-sshd.mjs` 有两套后端：
Linux Docker 容器内的 Debian OpenSSH，以及 macOS 上的临时账户
（`sysadminctl`）。19 项测试。

矩阵 run `44347976945` 的真实结果：

```
✅ password:           first connection 971 ms, 8774 ms, 10 sessions
✅ password-reconnect: first connection 951 ms, 8126 ms, 11 sessions
```

满足"绝不修改开发者真实账户密码"：容器是隔离的，macOS 后端建的是临时账户。

---

## 7. 仍然 NOT_RUN

| 项 | 原因 |
| --- | --- |
| Windows 升级 E2E / NSIS A→B | 需要一次性 profile 或 VM |
| AppImage stock 启动 | headless 下 bundled WebKit EGL 失败 |
| Vault app-level、Team Sync 跨版本客户端 | 需要真实多版本环境 |
| updater 运行时（Windows/Linux） | 只有 macOS arm64 有证据 |
| 物理键盘 / IME / DPI | 需要真实输入设备 |
| 真实 GUI 的 Jump Host / SFTP 全链路 | 本机无辅助功能权限 |

这些都保持 `NOT_RUN` / `BLOCKED_EXTERNAL`，**没有**折算成 PASS。
