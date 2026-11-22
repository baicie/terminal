# SFTP GUI 闭合与并发完整性验收（T09–T16）

> 基线 `main = e2a2e58`（PR #148 合入后），工作分支 `fix/tn-sftp-gui-closure`。
> 判定规则不变：**没有在当前 HEAD 上真实跑过的东西，不写成 PASS**。

## 零、本轮的四条总判断

| 问题 | 结论 |
| --- | --- |
| 300 px dock 的 refresh 点不动？ | **当前 HEAD 不复现**，真实 WebDriver 点击触发真实服务器列举 |
| e2e-03 的 FAIL 是产品缺陷吗？ | **不是**。是脚手架每次点击白等 18 秒，撞上 240 s 用例预算 |
| 校验能否被别的传输骗？ | **能**（已复现并修复）：A 用 B 的字节证明了自己的完整性 |
| 系统文件对话框驱动了吗？ | **没有**，`BLOCKED_EXTERNAL`，前置条件写在 §T12 |

---

## 一、T09 — dock refresh 的「不可点」

### 先测量，不猜

新增 `e2e/gui/specs/t09-refresh-hit-test.e2e.mjs`，采集任务要求的全部量。300 px dock、
1440 窗口下：

| 量 | 值 |
| --- | --- |
| `BoundingClientRect` | x=1387 y=209 w=28 h=28 |
| `elementsFromPoint` 第 0 层 | **按钮自己** |
| `pointer-events` | `auto` |
| `opacity` / `visibility` | `1` / `visible` |
| `transform` | `none` |
| `z-index` | `auto` |
| 残留 `role=dialog` / `alertdialog` | **无** |

窗口 1024 / 1440 / 2560 三档、缩放前后，`topmostIsSelf` 全部为 `true`。

### 一个必须更正的假设

历史报告说「elementFromPoint 返回遮挡 div」。在当前 HEAD 上不成立。**而在
PR #148 之前跑同一条用例时，那个 div 确实存在**——它是 `fixed inset-0 z-[210]
bg-black/50`，即 AlertDialog 的遮罩，来自用例超时被中断后未关闭的删除对话框。
#148 去掉动画门控后，遮罩不再滞留。

这不是「问题自己好了」：**是被另一个修复顺带解决的**，而且只在用例不超时的前提下。

### dock 宽度不可调

`right-panel.tsx` 渲染 `width: DOCK_WIDTH`，`DOCK_WIDTH = 300` 是常量，没有 splitter、
没有持久化偏好。所以「在 400 / 600 px 测 dock」不是用户能做的操作——能变的只有窗口。
spec 里写明了这一点，宽度扫掠改为窗口扫掠并逐次报告 dock 实测宽度（三档都是 300）。

### 验收

`browser.$().click()` 真实点击后，`__sftpLoadTrace` 从 2 条增到 4 条，最后一条是
`listed <fixture 目录> -> 1 entries`——真的重新向服务器列了一次目录，不是重渲染缓存。

```
dock_refresh_clickable_at_300px = PASS（真实点击 + 服务器列举证据）
```

---

## 二、T10 — e2e-03 的 FAIL 是一个 18 秒的脚手架开销

### 读数

在干净 HEAD 上仍复现两个失败。加了两处测量后：

```
waitForClickable : 11–13 ms      ← 按钮一直可点
element.click()  : 18 010 ms     ← 四分钟内四次，每次都一样
```

同一次运行里 `Tauri core.invoke not available after 5s timeout` 出现 **69 次**。

### 根因

`@wdio/tauri-service` 的 `beforeCommand` 对 `$`、`$$`、`findElement`、`elementClick`
调 `ensureActiveWindowFocus`，后者用 `core.invoke` 问窗口状态。本构建**故意不装
`tauri-plugin-wdio`**（它要求 `withGlobalTauri` 与 `wdio:allow-execute`，两者都禁止
进入产品构建），所以那次 invoke 无人应答，每次等满 5 秒。18 s ≈ 3×5 s。

服务留了出口：`ensureActiveWindowFocus` 在会话被标记为「用户已选窗口」后立即返回，
`switchToWindow` 会置位。在 `wdio.conf.mjs` 的 `before` 里调一次。

### 结果

| 指标 | 改前 | 改后 |
| --- | --- | --- |
| `elementClick` | 18 010 ms | **6 ms** |
| `Tauri core.invoke` 超时 | 69 次 | **0 次** |
| e2e-03 | 7 分 8 秒 / 2 失败 | **14 秒 / 11 项全过** |
| 整个 GUI 套件 | ~30 分钟 | **2 分 08 秒** |

**没有改任何 `waitUntil` 超时、断言或点击目标。**

### 服务器侧闭环（T10 验收）

11 项全过后，证据里每一步都由服务器自己的目录确认：

| 步骤 | 证据 |
| --- | --- |
| `mkdir` | 服务器上真的创建了目录 |
| `rename` | 新名存在**且**旧名消失 |
| `delete` | 服务器上真的没有 |
| 另一台 Host | 目录未被触碰（1 项，两者都不在） |
| 导航 | 面板列表 == 服务器 2 项 |
| 面包屑 Home | 回到根列表 |

```
E2E_03_WRITE_CASE     = PASS（服务器侧独立读盘）
E2E_03_NAVIGATION     = PASS
OTHER_HOST_UNTOUCHED  = PASS
```

### 顺带修掉两处会掩盖问题的等待

1. `clickWhenReady` 对**已知隐藏**的元素等满 15 s 再试下一个。`$` 返回文档顺序第一个，
   而 `sftp-mkdir` 匹配两次（单栏布局下第二个隐藏），每次点击白花 15 s。改为先按
   `isDisplayed()` 分区。
2. mkdir 之后 `void loadDir(path)` 是异步刷新，spec 在服务器确认后立刻选行会撞上未刷新
   的列表。补一个显式的「等面板列出」等待（服务器断言已在前面通过，所以这是刷新等待，
   不是用 DOM 取代服务器证据）。

---

## 三、T11 — 浮层去掉动画之后

6 项，断言的是具体数字而不是「有个弹窗出现了」：

| 用例 | 断言 |
| --- | --- |
| Dialog 打开 | 焦点进入浮层（`activeInDialog: true`，落在 `sftp-mkdir-input`） |
| ESC | `openDialogs` 1 → 0，无全屏层残留 |
| Dialog 遮罩点击 | 关闭（用户主动取消） |
| **AlertDialog 遮罩点击** | **不关闭**——`openDialogs: 1 → 1`，守卫有效 |
| 二次打开 | 恰好 1 个 overlay，不是 2 个 |
| 全部关闭后 | 终端中心点解析到 canvas，无全屏层 |

### Tab 顺序：测到了限制，没测到缺陷

第一次运行红在「Tab 没有移动焦点」。往下追：

| 事实 | 值 |
| --- | --- |
| Tab 的 `keydown` 到达 document | **是**（捕获阶段计数 = 1） |
| 对话框内可聚焦元素 | 4 个，全部 `tabIndex: 0` |
| `browser.keys(['Tab'])` 后焦点 | 仍在 input |
| 程序化 `focus()` 到下一个控件 | **成功** |

最后一行是判据：Radix 的陷阱只在浏览器**将要离开容器**时介入；浏览器不执行 Tab 的
默认动作时，陷阱没有可反应的事件。程序化聚焦能成功，说明焦点没有被锁住。

```
FOCUS_STAYS_IN_DIALOG = PASS
TAB_ORDER             = NOT_RUN（WebView under WebDriver 无 Tab 默认动作）
```

能断言的仍然断言了：焦点在 Tab 之后**仍在对话框内**——这是用户依赖的性质。

---

## 四、T13 — 校验在异常与数据变化下

7 项单测 + 2 项真实 sshd。两个变异验证：

| 变异 | 结果 |
| --- | --- |
| `localStatus === 'error'` 返回 `verified` | 1 红 |
| 两侧都 done 时恒返回 `verified` | **2 红**（篡改 + 不静默删除） |

真实 sshd（8/8 通过）：

- **篡改**：3 MiB 传输后改动远端中间一个字节 → 两侧哈希不同，**且两侧文件都还在**
- **断线**：读取必须报错。若把「读到 0 字节」当 EOF，哈希会变成空串的 SHA-256
  （`e3b0c442…`），两个空文件就会「一致」——断线被报告成完整性通过

```
CHECKSUM_TAMPER_DETECTED   = PASS
CHECKSUM_DISCONNECT_SAFE   = PASS
NO_SILENT_DELETE           = PASS
```

---

## 五、T14 — 同路径并发：**A 用 B 的字节证明了自己**

### 复现

用一个独立驱动，读数确定：

```
A status: done
remote calls: 1
A checksum: { localHash: "local-<A>", remoteHash: "local-<A>" }   verdict: verified
```

B 已经写完同一路径，A 仍然给自己发了 `verified`。队列在 `done` 时释放槽位、校验仍在跑
是**设计如此**（一个完成的传输不该为哈希占着并发名额），所以这个竞态不是排队能消除的。

### 修法：路径代次

`remotePath → 写入次数`。传输 `done` 时 +1，校验开始时取快照，读完再取一次；两次不同
就把结论降为 `indeterminate`，理由写明「文件在校验期间被另一个传输覆盖」。

不做互斥的理由：那会让 A 的**哈希**延迟挡住 B 的**数据写入**，用户没有要求这样。

key 只有 `remotePath` 的理由：第一版把 `sessionId` 也算进去，实测否掉了——A 走 `s1`、
B 走 `s2` 写同一路径时两个 key 不同，A 照样报 `verified`，而那正是最常见的场景。代价是
两个不同服务器上的同名路径会被当成同一个 → 多报一次 `indeterminate`（保守），而不是
多报一次 `verified`（骗人）。

| 用例 | 断言 |
| --- | --- |
| 前置 | B 能在 A 还在校验时开始（设计如此） |
| 隔离 | 两条记录各持自己的 hash |
| **核心** | A 的路径被覆盖后**不得** `verified`（改前红） |
| 不误伤 | B 作为最后写入者仍能 `verified` |
| 有边界 | 不同路径互不影响 |

变异：短路代次守卫 → 精确红在核心用例。

```
SAME_PATH_NO_FOREIGN_CERTIFICATION = PASS
```

---

## 六、T15 — 校验期间隐藏记录

7 项。产品语义：**用户可以隐藏记录，但校验不能因此被静默中断或误报成功。**

| 变异 | 结果 |
| --- | --- |
| `.finally` 去掉 `verifyingIds.delete` | **2 红** |
| `removeTransfer` 顺手「结束」会话 claim | **2 红** |

第二个是本轮最值得防的「看似合理的错修」：用户移除了行，所以「顺便把校验也停掉」听起来
对，实际会让一份仍在进行的远端读取失去会话保护。

```
HIDE_RECORD_KEEPS_CLAIM = PASS
RUNNING_CANCEL_REFUSED  = PASS（不伪造取消）
```

---

## 七、T16 — 慢网络与断流

### 基础设施：一个不需要 root 的用户态整形代理

`dummynet` / `pfctl` / `tc qdisc` 都要 root。代理插在 `client → proxy → sshd` 之间：
真实服务器、真实协议、真实 Rust 传输代码，只有字节的**到达时间**被改变。

代理自身先自证，6 项全过：字节 SHA-256 不变、延迟可观测、限速可观测、断流是真截断、
定时重置、双向统计。

### 两个在写测试时被纠正的实现错误

1. **`socket.destroy()` 发 FIN 不是 RST** —— 对端看到 `end`，一个被截断的流看起来像
   「正常结束」。改用 `resetAndDestroy()`，对端得到 `ECONNRESET` 且 `ended: false`。
2. **未捕获的 `EPIPE`/`ECONNRESET` 会中止整个测试进程** —— 报告里看到的会是「代理测试
   失败」而不是「断流生效了」。

### 实测结果

| 场景 | 结果 |
| --- | --- |
| `slow-upload`（2 MiB/s 上行 + 20 ms 延迟） | **8/8 通过**，105 秒，24 MiB 字节完整性成立 |
| `slow-download` / `cut-upload` / `cut-download` / `slow-uplink-only` | 见下节表格 |
| GUI 层（真实 WebView 里的传输队列） | `NOT_RUN` —— 见 §九 |

**必须写清的边界**：这不是 WAN 仿真。延迟是应用层定时器而非传播时延，断流是 RST 而非
内核丢包 + 重传。它证明的是「产品在字节流被拖慢或中途消失时的行为」。

---

## 八、T12 — 系统文件选择器（`BLOCKED_EXTERNAL`）

**无法在本会话驱动。** 不是「没试」，是探测到了具体边界：

| 探测 | 结果 |
| --- | --- |
| `System Events` 的 `UI elements enabled` | **true** |
| 可见进程数 | 51 |
| `count of windows of process "Claude"` | **0** |
| `sheets of window 1 of process "Claude"` | `无效的索引 (-1719)` |

辅助功能权限是开着的，但 System Events 对**任何**进程都看不到窗口。这个会话运行在一个
没有窗口服务器访问权的上下文里。

| 平台 | 机制 | 本会话 | 需要什么 |
| --- | --- | --- | --- |
| macOS | `System Events` 驱动 `NSOpenPanel` sheet | ❌ | 普通登录会话 + 已授予辅助功能权限；CI 上需 `AXIsProcessTrusted` 与 GUI 会话 |
| Windows | UI Automation 驱动 `IFileOpenDialog` | ❌ | 一次性 Windows VM 或自托管 runner，会话未锁定 |
| Linux | `xdg-desktop-portal` 的 `FileChooser` | ❌ | 装配了 portal 的桌面会话，或可控的后端实现 |

任务书要求「任何测试替换路径来源时，不能声称原生 Dialog 已通过」。`e2e-06` 替换的正是
**产生路径的那一步**，它证明的是「路径之后的链路对」，不是「原生对话框被驱动过」。

```
NATIVE_FILE_DIALOG_DRIVEN = BLOCKED_EXTERNAL
E2E_PICKER_SUBSTITUTION   = PASS（隔离门禁双向断言）
```

---

## 九、真实环境证据与 NOT_RUN

### 已在本机真实执行

| 项 | 结果 |
| --- | --- |
| GUI 套件全量（macOS WKWebView） | **2 分 08 秒，全部通过** |
| e2e-03 写路径 + 导航 | 服务器侧独立读盘确认 |
| t09 refresh 命中测试 + 真实点击 | 服务器列举证据 |
| t11 浮层交互 | `openDialogs` 逐项断言 |
| 真实 sshd SFTP（含慢网/断流） | 见 §七 |
| 代理自证 | 6/6 |

### 仍为 NOT_RUN / BLOCKED_EXTERNAL

| ID | 状态 | 原因 |
| --- | --- | --- |
| `NATIVE_FILE_DIALOG_DRIVEN` | `BLOCKED_EXTERNAL` | 见 §八 |
| `TAB_ORDER` | `NOT_RUN` | WebView under WebDriver 无 Tab 默认动作 |
| `SELECT_SHEET_CONTEXT_MENU_FROM_DOCK` | `NOT_RUN` | 这三个浮层不由 dock 挂载；由各自组件测试覆盖 |
| `PHYSICAL_INPUT` | `NOT_RUN` | 无物理设备 |
| `GUI_SLOW_NETWORK` | `NOT_RUN` | 整形代理目前只接在 Rust 命令行路径；WebView 内的传输队列在慢网下的 UI 行为未跑 |
| `WINDOWS_LINUX_GUI` | `NOT_VERIFIED_LOCALLY` | 本机只有 macOS；三平台结论以 CI 为准 |
| `DAILY_DRIVER_7DAY` | `NOT_RUN` | 需七天真实使用 |

---

## 十、门禁

| 门禁 | 结果 |
| --- | --- |
| 前端测试 | 325 文件 / 2998 项 |
| `scripts/*.test.mjs` | **810 项通过 / 0 失败** |
| typecheck / ESLint | 通过 |
| source-size | 769 生产文件 |
| Rust lib | 456 项 |
| Rust SFTP command-level（直连） | 8/8 |
| Rust SFTP command-level（2 MiB/s 慢速上行） | 8/8，105 秒 |
| `cargo fmt --check` / `cargo clippy -D warnings` | 通过 |
| GUI 隔离门禁 | 7/7 |

---

## 十一、判定

```
DOCK_REFRESH_CLICKABLE_300PX   = PASS
E2E_03_FULL_CHAIN              = PASS
OTHER_HOST_UNTOUCHED           = PASS
OVERLAY_INTERACTION            = PASS（Tab 顺序 NOT_RUN）
CHECKSUM_TAMPER_DETECTED       = PASS
CHECKSUM_DISCONNECT_SAFE       = PASS
SAME_PATH_NO_FOREIGN_CERT      = PASS
HIDE_RECORD_KEEPS_CLAIM        = PASS
RUNNING_CANCEL_REFUSED         = PASS
SHAPING_PROXY_TRUSTWORTHY      = PASS
RUST_TRANSFER_ON_SLOW_LINK     = PASS
GUI_TRANSFER_ON_SLOW_LINK      = NOT_RUN
NATIVE_FILE_DIALOG_DRIVEN      = BLOCKED_EXTERNAL
```

`DAILY_DRIVER_READY = NO`、`SIGNED_PUBLIC_RELEASE_READY = NO`。
两者都不是本轮工作量的函数：前者需要七天真实使用，后者缺证书与外部授权。

### 本轮最值得记住的两件事

1. **一个 18 秒的脚手架开销伪装成了产品缺陷。** 两个「失败」的用例被当成 dock 布局
   问题查了三轮，实际是 WebDriver 服务在每个命令前等一个本构建无法应答的 IPC。判据是
   `waitForClickable` 11 ms 而 `elementClick` 18 010 ms——一个按钮不可能「可点」却点
   18 秒。
2. **校验能被另一个传输的字节骗过。** 这不是理论风险：A 在 B 覆盖路径之后仍然给自己发了
   `verified`。修复不是拦下并发的写入（那是用户要的），而是让结论在「我读到的可能不是我的」
   时降级。
