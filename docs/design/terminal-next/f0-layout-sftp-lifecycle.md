# F0 交付：Runtime Layout 与 SFTP 资源生命周期

- 基线：`main = 1a24eed`
- 分支：`feat/terminal-next-f0-layout-sftp-lifecycle`
- 设计输入：`Terminal-Next-v2` 设计包（2026-11-13），PR backlog `TN-01` / `TN-02`
- 状态：**Draft**，未合并、未打 Tag、未发布

---

## 0. 为什么先做这两项

设计包 `data/roadmap.csv` 把 F0 定为「Security & Lifecycle」，理由是它是其余
所有阶段的**前置**：布局决策错了，后续每个页面的宽度验收都不可信；SFTP 注册表
不释放，后续每条传输路径都在泄漏之上叠加。

这两项同时也在独立集成验收（`integrated-acceptance-report.md`）里被列为 P1，
两边独立得出同一结论。

---

## 1. TN-01：布局决策使用真实宽度

### 1.1 缺陷

`packages/frontend/src/layout/use-panel-layout.ts` 调用 `panelBudget()` 时只传
`RAIL_WIDTH + SEPARATOR_WIDTH`（52px），从不接收左栏宽度；而 `LeftPanel` 按用户
保存的 `sidebarWidth` 渲染（默认 176，范围 64–420）。

**后果**：预算相信左栏是 52px，实际是 176–420px。每个决策都对着 124–368px
不存在的终端宽度计算。

### 1.2 先红证据

`layout-decision-regression.test.ts` 把旧实现原样复制为 `oldDecision()`，并断言
新决策与它**不一致**：

```
at 1240 with a 420px explorer:
  旧: allowLeft=true, dockMode=column     ← 认为放得下
  实际: 1240-46-420-300-14 = 460px → 54 cols（下限 60）
  新: 拒绝双栏
```

5 项测试，其中 4 项直接对比新旧结果。若有人重新引入 52px 假设，这些断言翻转。

### 1.3 实现

新增 `layout-decision.ts`（从 `terminal-width-budget.ts` 拆出，后者只保留算术）：

| 概念 | 变化 |
| --- | --- |
| `chooseLayout(input)` | 输入 `shellWidth` / `leftWidth` / `leftMode` / `rightMode` / `cellWidth` |
| `LeftPresentation` | `none` \| `column` \| **`drawer`**（新增：宽度不足时折叠而不是挤压） |
| `RightPresentation` | `none` \| `column` \| `overlay` |
| `LimitingReason` | `width` \| `font-size` \| `mobile` |
| `withHysteresis` | 24px 滞回带，按 cellWidth 折算成列数 |

**优先级顺序**（设计包 §06）：终端 ≥60 cols → Dock（可转 overlay）→ Explorer（可转 drawer）。
面板绝不占用终端无法让出的宽度，而是改变呈现方式；**用户的保存宽度从不被改写**。

**测量源**：`useShellWidth()` 用 `ResizeObserver` 观察 shell 容器，而不是
`window.innerWidth`。这一点是设计包特别强调的——把已经被挤压的终端元素宽度
送回去会造成反馈振荡。

**接线**：`main-layout-content.tsx` 现在传 `{ explorerWidth: sidebarWidth }`。
入参是**必填对象**，不知道宽度的调用方会编译失败而不是悄悄传常量。

### 1.4 滞回不是锁

`withHysteresis` 只在**上一个决策是宽裕的**时候才保持。一个已经在饿着终端的布局
必须立即降级——滞回是阻尼器，不是锁。这条有专门测试
（`does not hold a previous decision that was already starving`）。

---

## 2. TN-02：SFTP 注册表随会话释放

### 2.1 缺陷

`sftp_connect` 把 channel 插入 `state.sftp_sessions`，key 是它借用 handle 的那个
SSH session id。**没有任何代码移除这个条目**：

- `session_close` 只清 `SessionManager`（`sessions` / `channel_manager` / `session_meta`）；
- `sftp_sessions` 全仓只有三处访问：`get`、`insert`、**进程退出时的整体 `clear()`**。

而 `SshConnectionPool::release` 已经把底层 handle 移除并 disconnect ——
所以留下的是**悬挂引用**，不只是没释放的内存。

### 2.2 实现

```rust
// sftp.rs — 注册表规则独立于具体值类型
pub(crate) fn remove_session_entry<V>(map: &mut HashMap<String, V>, id: &str) -> bool

// commands.rs — 关闭终端即释放它上面的 SFTP channel
crate::sftp::forget_session(&state, &session_id).await;
```

**为什么把规则抽成泛型**：`SftpSession` 需要活的 SSH channel 才能构造，测试里无法
伪造。若直接把 `HashMap<String, Arc<SftpSession>>` 写死，测试就只能断言「调用了
remove」——那是复述标准库而不是验证行为。泛型化之后，测试用的是**生产代码调用的
同一个函数**，断言的是键语义（按 id 移除、不整体清空、幂等）。

### 2.3 测试

3 项，全部在真实 `HashMap` 与真实 `SharedState` 上：

| 用例 | 断言 |
| --- | --- |
| `closing_a_session_forgets_its_sftp_channel` | 移除指定 key；**其他会话存活**（不是 wholesale clear） |
| `forgetting_is_idempotent_and_reports_whether_it_did_anything` | 重复关闭是 no-op，不报错 |
| `the_shared_state_registry_starts_empty_and_stays_keyed` | 走 Tauri 命令收到的那个类型 |

**幂等性是有意的**：`session_close` 不能因为「SFTP 从未用过」或「关两次」就开始失败。

---

## 3. TN-02 附带：drop 监听器（设计包 GAP-DRAG-LISTENER）

设计包基于 `1a24eed` 快照报告 `use-sftp-drop.ts` 的 cleanup 在 Promise `.then` 内部。
**核实结果：main 上已经修好了**（`cancelled` 标志 + `offs` 数组 + `if (cancelled) off()`），
但**零测试**。

这正是本项目反复出现的形态：守卫存在、没人证明它有效。新增 8 项测试，并做**变异验证**：

```
移除 cancelled 保护后 → 2 项失败 + 99 个错误（100 次循环全部泄漏）
恢复后 → 8/8 通过
```

覆盖：4 个监听器安装/卸载、无 session 不安装、drop 只上传一次、空 paths 忽略、
重挂载不残留、**100 次开关**（此前最多测 5 次）、import 未完成就卸载不安装。

---

## 4. 门禁

| 项 | 结果 |
| --- | --- |
| 前端测试 | **243 文件 / 2191 项**（基线 240 / 2160） |
| ESLint | 0 error / 0 warning |
| typecheck | 通过 |
| bundle budget | **625.22 / 628 KB**（initial 130.92 / 240） |
| source-size | **675 文件**通过 |
| `cargo fmt --check` | 通过 |
| `cargo clippy -D warnings` | 通过 |
| `cargo test` | **397 passed**（基线 394，+3 项 SFTP） |

**source-size 触发过两次**，都在本地发现并拆分（不是等 CI）：
`terminal-width-budget.ts` 308 行 → 拆出 `layout-decision.ts`（190 行）；
`main-layout-content.tsx` 205 行 → 压缩注释回 200 行以内。

---

## 5. 真实 GUI 验收：做到什么程度

**做到的**：

- 用 `pnpm tauri build --no-bundle` 构建可运行二进制（这台机器上会失败的是裸
  `cargo build --release`，缺 `custom-protocol`——那是 PR #43 的修复，本分支基于
  main 尚未包含）
- 隔离 `HOME` 启动，确认 `frontend-boot` 与 `fallback-opened` 都出现
- 取窗口 ID 后 `screencapture -l` 按窗口截图：**`142×43`**，Focus 模式，
  与 `chooseLayout` 的 Focus 分支一致
- 状态栏的 `142×43` 就是 xterm `FitAddon` 实测的 cols×rows，不是本项目算法的输出

**没做到的**（如实记录）：

- **合成鼠标点击（`CGEvent`）不生效**于 Tauri webview，`⌘B` 也被终端吞掉
- **辅助功能读不到 webview 内部元素**（`AXUIElementCopyAttributeValue` 返回空），
  这是 Tauri/WebKit 的已知限制，不是本项目的缺陷

因此**「420px 左栏 + Dock 同开时终端 ≥60 cols」这一条没有 GUI 实拍证据**。
它有单元级与接线级证据（`layout-decision.test.ts` 的交叉矩阵、`main-layout-content.test.tsx`
的 shell 元素接线），但**设计包要求的 GUI 最低验收仍是 NOT_RUN**。

要闭合它，需要一个能驱动 webview 的 harness（Playwright/WebDriver，或给应用加
一个 smoke 通道）。那是独立任务，不在本轮范围。

---

## 6. 判定

```
TN-01_LAYOUT_WIRING        = PASS（单元 + 接线），GUI 交叉验收 NOT_RUN
TN-02_SFTP_REGISTRY        = PASS
TN-02_DROP_LISTENER        = PASS（含变异验证）
F0_EXIT_GATE               = PARTIAL
```

F0 的退出条件是设计包写的「0 P0/P1 leak & wrong-host risks」。本轮消除了两条 P1
（GAP-LAYOUT、GAP-SFTP-REGISTRY），但 GAP-SECRETS 与 GAP-FS-SCOPE 仍在，
且 GUI 交叉验收未做——所以是 PARTIAL，不是 PASS。

---

## 7. 下一步（按设计包顺序）

1. **TN-04 IPC 权限审计** —— F0 的另一半，且是 RC 阻断项（详见
   `integrated-acceptance-report.md` 的 P0-1）；
2. **GUI harness** —— 让「真实 cols」可以从外部验证，否则 TN-01 的退出条件永远差一截；
3. TN-05 之后按 roadmop 推进。

---

## 8. 与 PR #43 的关系

设计包提醒「PR #43 覆盖 TN-15 的一部分，不应重复改 `Cargo.toml/custom-protocol`」。
本分支**没有**碰 `Cargo.toml`、`custom-protocol`、`release-*` profile 或证据文件。

一个实际影响：本分支基于 main，所以本地构建可运行二进制必须用
`pnpm tauri build`（它会自动加 `custom-protocol`），裸 `cargo build --release`
仍会产出灰屏二进制。**PR #43 合并后这个差异消失**，本分支无需改动。
