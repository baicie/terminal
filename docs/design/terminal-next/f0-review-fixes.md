# F0 复审报告 — PR #44 独立 Staff Engineer 复审与缺口修复

- 复审基线：`db2a4d5`（PR #44 原 head）
- 修复后 head：见文末「最终 SHA」
- 角色：独立 Staff Engineer，不采信「CI 11/11 PASS 即运行时布局通过」
- 状态：**Draft**，未合并、未打 Tag、未发布

---

## 0. 结论速览

| 判定项 | 结果 |
| --- | --- |
| `LAYOUT_DECISION_WIRED` | **PASS** |
| `LEFT_DRAWER_REACHABLE` | **PASS** |
| `NAVIGATION_WIDTH_SAFE` | **PASS** |
| `HYSTERESIS_VERIFIED` | **PASS** |
| `REAL_XTERM_COLS_VERIFIED` | **PARTIAL** |
| `SFTP_EXPLICIT_CLOSE_SAFE` | **PASS** |
| `SFTP_NATURAL_DISCONNECT_SAFE` | **PASS** |
| `SFTP_ACTIVE_TRANSFER_SAFE` | **PARTIAL** |
| `EVIDENCE_INTEGRITY` | **PASS**（重采后） |
| `GUI_E2E` | **NOT_RUN** |

---

## 1. 三处 P1 缺口：全部属实

任务书指出的三点，逐条核实后**全部成立**，且比描述的更严重。

### 1.1 Drawer 只有决策、没有渲染

**指控成立。** `main-layout-content.tsx` 只读 `allowLeft`：

```tsx
mode={panelMode === 'explorer' && !panelLayout.allowLeft ? 'none' : panelMode}
```

`allowLeft = leftPresentation === 'column'`。所以：

- `drawer` 决策 → `allowLeft=false` → 面板被设成 **`none`**，什么都不渲染；
- `navigation` 模式**完全绕过**决策，无论宽度如何都渲染。

后果：窗口窄到不足以放出一列时，左侧面板**彻底不可达**——恰是最需要它的场景。

**修复**（`left-panel.tsx` 重写）：

| 呈现 | 行为 |
| --- | --- |
| `none` | 不渲染 |
| `column` | 占列宽，带 resize separator |
| `drawer` | `role="dialog"` + `aria-modal` 浮层，**不占列宽**，无可拖拽 separator |

- 关闭方式：scrim 点击、关闭按钮、**Escape**
- 打开时焦点移入 drawer（键盘用户不会被困在后面的终端里）
- `explorer` 与 `navigation` 走同一个 `leftPresentationFor()` 映射，不再有绕过
- **变异验证**：把 `drawer` 改回 `false` → **5 项测试失败**

### 1.2 Hysteresis 实际不起作用

**指控成立。** 原实现：

```ts
const wasComfortable = previous.predictedCols >= floor   // 旧呈现，旧宽度
const isComfortable  = next.predictedCols >= floor       // 新呈现，新宽度
```

降级后 `next.predictedCols` 几乎总是重新高于底线（面板让位正是为了回到 60+），
所以 `!isComfortable` 几乎永假，滞回带**从不触发**。

**修复**（新增 `layout-hysteresis.ts`）：

- 新增 `evaluatePresentation(left, right, input)`：用**当前宽度**重新评估旧呈现的容量。
  这是原实现缺失的那一块——没有它就无法问「我们现在展示的布局在这里还合适吗」。
- `withHysteresis` 改为**按轴**判断（`leftWentDown` / `rightWentDown`）。
  原来的 `isColumnish()` 检查「任一 presentation 是 column」，而右栏始终是 column，
  所以降级被误判成「非降级」，两个分支都不进，直接落到 `return next`。
  **这个 bug 是逐像素扫描测试才暴露的**，单点断言永远抓不到。

**第二个 bug，测试驱动发现**：修复按轴判断后，`explorer-session-safety` 测试变红。
根因是滞回把**用户主动打开面板**也当成宽度抖动来阻尼——打开 explorer 会增加一列、
减少终端列数，被读作「降级」而拒绝恢复。修复：`LayoutDecision` 携带
`leftMode`/`rightMode`，模式变化时滞回直接放行。**滞回治的是宽度振荡，不是用户的点击。**

**验证**（17 项）：

- 逐像素扫描 1500→900（601 次迭代），每个呈现只出现一次，无抖动
- 往返扫描（下 → 上）
- 滞回带内保持、带外立即降级
- 用旧呈现的旧列数**不**被信任（显式断言）
- 字体从 14px → 20px 走同一路径
- 420px Explorer + 300px Dock 交叉矩阵

### 1.3 SFTP 释放路径不完整

**指控成立。** `forget_session` 只在 `session_close` 命令里调用。任务书列的 9 条路径中，
**8 条会留下悬挂的 `Arc<SftpSession>`**。

**修复**：

- `SessionManager` 新增 `removed_listeners`，在两条移除路径上通知：
  - `remove_session`（显式关闭、认证失败、连接失败、completion cleanup 都走这里）
  - `close_registered_sessions`（`close_all` / `shutdown`）
- `sftp.rs` 的 `register_registry_lifecycle` 订阅它，用 `Weak<SharedState>`
  保证 shutdown 期间是 no-op（此时 `close_shared_resources` 已整体清空）

**本轮最严重的自身缺陷**：第一版用 `tokio::spawn` 注册监听器，而 `lib.rs` 的 setup
在 **Tokio runtime 之外**执行 —— 应用**启动即 panic**：

```
thread 'main' panicked at src/sftp.rs:120:
there is no reactor running, must be called from the context of a Tokio 1.x runtime
```

**`cargo test` 与 CI 都不会执行 `lib.rs` 的 setup 路径**，所以 401 项 Rust 测试全绿时
应用根本起不来。只有真实启动才暴露。修复：改用 `std::sync::Mutex` + 同步
`on_session_removed`，并在监听器内部用 `Handle::try_current()` 防 shutdown 竞态。

> 这条必须单独记：**单元测试全绿 ≠ 应用能启动。** 本轮差点带着一个「打开即崩」的
> 版本交付。

---

## 2. 类型契约修正

`explorerWidth` 由**可选**改为**必填**，删除静默 fallback。

理由：没有任何合法的生产调用方不知道这个值——shell 拥有 `sidebarWidth`，传给布局的
就是它渲染用的同一个数。可选参数会让「忘记传」编译通过并悄悄用默认值，
这正是原缺陷（52px 常量）的同类，只是更安静。

---

## 3. 实际 DOM 测量（任务书 §3 末段）

新增 `useMeasuredChrome`：从 `getComputedStyle` 读 shell 容器的 `padding` 与
`border` 宽度，不再把 separator 与边框当 0。用 ResizeObserver 跟随主题/密度变化。

**未覆盖**：separator 本身的 6px 由 `LeftPanel` 渲染在列内，已经计入
`leftWidth` 侧；drawer 模式下不存在 separator，因此不计。这条在测试里通过
`data-presentation` 断言两种模式的 DOM 差异。

---

## 4. SFTP 生命周期：覆盖矩阵

| 路径 | 覆盖方式 | 状态 |
| --- | --- | --- |
| SSH 显式关闭 | `session_close` → `forget_session` + 监听 | **PASS** |
| 远端自然断开 | `remove_session` → `notify_removed` | **PASS** |
| SSH 认证失败 / 连接失败 | 同上（会话未注册成功即失败） | **PASS** |
| SessionManager completion cleanup | 同上 | **PASS** |
| SessionManager shutdown | `close_registered_sessions` → 逐 id 通知 | **PASS** |
| SFTP 建立中会话关闭 | `forget_session` 幂等，先释放再移除会话 | **PASS** |
| 正在传输时 Dock 关闭 | 前端 `releaseOrDefer`（PR #44 原实现，8 项测试） | **PASS** |
| 最后传输结束后释放 | 同上，watcher 轮询到不忙才关 | **PASS** |
| 相同 Session ID 重复请求 | 幂等测试（关两次是 no-op） | **PASS** |

**测试局限（如实记录）**：`SftpSession` 需要活的 SSH channel 才能构造，
所以注册表测试断言的是**键语义**（按 id 移除、不整体清空、幂等），不是真实的
Rust Session 生命周期。`every_removal_path_notifies_listeners` 用的是真实的
`SessionManager` 与 `fake_local_session`，覆盖了「通知确实被触发」这一环。

**`SFTP_ACTIVE_TRANSFER_SAFE = PARTIAL` 的理由**：传输中的释放靠前端
`releaseOrDefer`，有 8 项测试；但「真实 SSH 上传输中途关 Dock、字节仍在流」
需要打包应用，本轮未做。

---

## 5. GUI 验收：逐项评估后为 NOT_RUN

任务书要求先评估可用方案，不得为测试在生产暴露危险命令。

| 方案 | 评估结果 |
| --- | --- |
| macOS WebDriver (`safaridriver`) | 存在，但只驱动 Safari，**不驱动 WKWebView 里的 Tauri 应用** |
| `tauri-driver` | **未安装**（`which tauri-driver` 为空） |
| Playwright | **未安装**；且它驱动浏览器，需要应用暴露调试端口 |
| 仅测试构建的 smoke IPC | 项目已有 `VITE_TERMINAL_SMOKE_BUILD` 先例，但它**替换整个应用根**，
不是给真实布局加探针；改造量超出本轮范围 |

**实测尝试（全部失败，记录以免重复踩坑）**：

- 合成鼠标事件（`CGEvent` 左键按下/拖动/抬起）：窗口尺寸**不变**，事件不驱动 Tauri 窗口
- `AXUIElementSetAttributeValue` 改窗口尺寸：返回 `-25205`（`kAXErrorAPIDisabled`），
  尽管 `AXIsProcessTrusted: true` —— WKWebView 未向 AX 暴露该进程的窗口
- `osascript` + `System Events`：`不能获得 window 1 of process "terminal"`
- `⌘B`：被终端吞掉，不触发 `toggle-sidebar`

**做到的部分**：

- 真实二进制启动（`pnpm tauri build --no-bundle`），确认**无 panic**
- `frontend-boot` 与 `fallback-opened` 均出现
- 按窗口 ID 截图：**`142×39`**，Focus 模式

**`REAL_XTERM_COLS_VERIFIED = PARTIAL` 的理由**：`142×39` 确实是 xterm `FitAddon`
实测值（不是本模块算法的输出），证明了 Focus 状态下的真实列数。但任务书要求的
「420px Explorer + Dock 下读取真实 cols」**没有做到**。

**`GUI_E2E = NOT_RUN`**：不做任何「纯函数测试替代 GUI」的宣称。

---

## 6. 与 PR #43 的整合风险：实测，不靠推断

任务书警告「不得以源码零重叠为由认为两套证据合并后继续有效」。**核实结果：警告正确。**

实际建了一个合并 worktree 并计算指纹：

| 树 | 源码指纹 |
| --- | --- |
| #43（`85a5b04`） | `b94a26ee…` |
| #44（`bea9bf7`） | `dc249ed7…` |
| **两分支合并后** | **`9552b3e0…`** |

三方**互不相同**。而且合并时 `docs/verification/` 下的证据文件**直接冲突**：

```
CONFLICT (content): Merge conflict in docs/verification/evidence-manifest.json
CONFLICT (content): Merge conflict in docs/verification/2026-10-11-macos-ssh-matrix-current.json
```

**源码零冲突，证据全冲突。** 这印证了推荐流程：

```
#43 合并 → 更新 #44 的 base → 在最终联合树上重采一次证据
```

**本任务未执行该合并**（任务书明确不得自行合并）。

---

## 7. 门禁与证据

| 项 | 结果 |
| --- | --- |
| 前端测试 | **244 文件 / 2202 项**（复审前 243/2191） |
| Rust 测试 | **401 passed**（复审前 397） |
| ESLint / typecheck | 0 error / 0 warning |
| source-size | **676 文件** |
| bundle budget | 625.91 / 628 KB |
| `cargo fmt --check` / `clippy -D warnings` | 通过 |

`source-size` 触发一次（`layout-decision.ts` 314 行），拆出 `layout-hysteresis.ts`。

**证据**：本轮改了 `src-tauri/src/*.rs` 与 `packages/frontend/src/layout/*`，
两者都在 `FINGERPRINT_PATHS` 内，按官方流程重采（见 §8）。

---

## 8. 最终 SHA 与证据

- 修复提交：`98e8de2`（源码冻结点）
- 安全台账：`5b18169`（三条 QUIC advisory，不在指纹路径内）
- 证据重采：run `43479528469`（commit `98e8de2`，指纹 `49547275…`）
- **最终 head：`9e4fe8e`**，CI **11/11 pass**，PR 保持 **Draft**

`98e8de2` 与 `9e4fe8e` 的源码指纹实测相同（`49547275…`）——后者只增加
`docs/verification/` 下的证据文件，不在 `FINGERPRINT_PATHS` 内。

---

## 9. 未做与不该做

**未做**（明确记录，不是遗漏）：

- GUI 双面板交互验收（见 §5，工具链不可用）
- 在最终联合树上重采证据（依赖 #43 先合并，本任务不得自行合并）
- 真实 SSH 上传中途关 Dock 的字节级验证（需打包应用 + 真机 sshd）

**没做但不该做**：

- 生产构建暴露调试命令换 GUI 测试通过
- 用纯函数测试替代 GUI 验收
- 改旧 manifest 或把 `Cargo.toml`/`src` 移出指纹路径换取 CI 变绿
