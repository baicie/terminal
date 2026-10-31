# Phase 8 · P8.3 可靠性调查

## A. Linux SSH reconnect stale-output —— 根因已确诊

**来源**：run 41112206442，Linux job 124256995007，日志行 4926-4927。

### 结论：测试观察判据缺陷（类别 b），不是环境问题，也不是输出丢失

决定性证据（三段代码 + 一行真实日志）：

1. 判定用**整行精确相等**：`hasExactLogicalLine(term, expected)` = `readLogicalTail(term).some(line => line === expected)`（`terminal-smoke-buffer.ts:41-46`）。
2. barrier 发射时**没有前导换行**：`data: format!("{ACTIVE_OUTPUT_BARRIER}\r\n")`（`terminal_smoke.rs:1196`）。
3. 真实日志里 prompt 与 marker **在同一行**：
   `rawOutputTail: "\u001b]133;A\u0007$ TERMINAL_SMOKE_ACTIVE_OUTPUT_BARRIER\r\n"`

于是逻辑行是 `$ TERMINAL_SMOKE_ACTIVE_OUTPUT_BARRIER`，永远不等于 `TERMINAL_SMOKE_ACTIVE_OUTPUT_BARRIER`。
`waitForExactLogicalLine` 只能等到 frontendTimeout 中止，`stage` 停在 `stale-output`。

这也解释了 Linux 特异性：Linux 冒烟 shell 会打印 prompt，marker 被粘在其行尾；非交互场景不打 prompt 时判定才会通过。

### 本文件此前的两处错误结论（已作废，保留以免重复）

| 错误结论 | 为何错 |
| --- | --- |
| 「tail 全空 ⇒ 观察者看到空终端」 | `readLogicalTail(term, 32).slice(-8)` 取「最后 32 条的后 8 条」，而 xterm 清屏后缓冲区恒为 rows=24 条空行；内容在上部时后 8 条**必然全空**。这是诊断字段造成的假象，不证明终端为空。 |
| 「marker 已到达 Rust 侧原始输出」 | `rawOutputTail` 是**前端**字符串 ref，在 `onOutput` 里、`enqueue()` **之前**累加（`use-terminal.ts:117-131`）。它只能证明事件到达前端，与 Rust 无关。 |
| 「代际/实例错配」 | 结构上不可达：整轮只有 1 个 xterm 与 1 个 scheduler（`use-terminal-smoke-round.ts:52-60`），reconnect 不重建（effect 依赖全稳定）。 |

### 18 字节缺口：另一条独立的真实缺陷

`acceptedBytes 303 - parsedBytes 285 = 18` 与失败无因果，但**它本身是一个必须修的缺陷**：

`takeHead()`（`terminal-output-scheduler.ts:251-256`）在 receipt 失效时整块丢弃已入队数据：

```ts
while (output?.receipt && !output.receipt.isActive()) {
  this.queue.shift()
  this.queuedBytes -= output.bytes   // acceptedBytes 不减、无错误、无日志、不 ack
  output = this.queue[0]
}
```

reconnect 起手会 `audience.retireAll()`（`terminal-session-manager-reconnect.ts:241`），使当时仍在队列里的会话数据 receipt 全部失效，
于是下一次 `flushFrame` 把它们静默删除。被丢的**完全可能是当时处于 active 的会话数据**。

第二处：`clearPending()`（:279-287）在 reset/dispose/fail 时清空队列，且**不清 `inFlightBytes/writeInFlight`**。

两者共同违背 P8.4 的「丢弃输出必须触发明确错误，不能静默当作已展示」。

## B. Linux zsh 三条 shell probe 用例（Issue #156）

已确认：稳定失败集合为 readline-history / readline-tab / pty-resize，恰好触到 30 秒 per-case deadline；相隔 30 分钟两次 run 完全一致；同一 runner 在 2026-10-17 上这三条是绿的（246/410/1341 ms）。故排除预算不足与环境抖动。

判定层缺陷已修（f74a33e）：原本 contract mismatch 是唯一失败出口。

**未解决**：这三条为何从未完成。本轮仍未取得拆分后的新日志——修复提交之后的 Linux run 在更早的 A 问题处失败，未走到 shell 矩阵。A 修复后应能拿到新日志。

## C. 修复完成情况（提交 3e40823）

| # | 修复 | 位置 | 状态 |
| --- | --- | --- | --- |
| 1 | barrier 与 canary 增加前导 \r\n，各自独占一行 | terminal_smoke.rs | ✅ |
| 2 | 新增 hasLogicalLineContaining / waitForLogicalLineContaining；barrier 改包含语义；canary 由「整行相等即失败」改为「任意行包含即失败」（更严） | terminal-smoke-buffer.ts / run-terminal-smoke.ts | ✅ |
| 3 | 诊断 tail 改「最近非空行 ×8」并补 bufferLength/cursorY/viewportY/baseY | terminal-smoke-diagnostics.ts | ✅ |
| 4 | 新增 TerminalOutputDropLedger，丢弃计数 + 一次 warn；snapshot 暴露 droppedBytes/droppedChunks | terminal-output-queue.ts（新） | ✅ |
| 5 | reset() 的 in-flight 选择「明确记因」而非归零 | terminal-output-scheduler.ts | ✅ |

**测试**：新增 8 条（失效 receipt 丢弃被计数 / reset 清队列记账 / accepted=parsed+dropped /
reset 后陈旧在途写仍被记账 / barrier 与 prompt 同行时通过 / canary 嵌行中仍失败 /
tail 报最近非空行 / tail 为空时仍带 bufferLength=24）。既有 1293 用例未减少。

**未做（各需再动 1 个文件）**：Rust 侧缺「marker 必须带前导 CRLF」的发射端回归断言；
warn 未含 sessionId（scheduler 层无会话身份）。

**仍然待验证**：本次修复只证明判据正确，**没有在真实 Linux runner 上重跑过**。
需要下一次 matrix 的 Linux job 来确认 stale-output 阶段通过、且 shell 矩阵能真正执行。

## D. 真实 runner 复验结果（run 41176128211，Linux job 124463955121）

**这是 P8.3-A 的最终验证。**

    修复前：terminal smoke finalized ok=false stage=stale-output（超时）
    修复后：terminal smoke finalized ok=true  stage=complete      （日志第 8559 行）
            terminal smoke finalized ok=true  stage=complete      （日志第 10428 行）

stale-output 阶段通过，Linux job 已经走到之前被跳过的 shell 矩阵 —— 判据缺陷的修复在真实 Linux runner 上生效。

同时 f74a33e 的可诊断性修复也生效了，第一次能看到实际键入的字节：

    FAILED: Shell probe case failed: readline-history after 30037 ms
    expected: ok=true, error=null, trace ready>step>pass
    actual:   ok=false, error="terminal shell probe timed out"
    timing:   30037 ms is at or past the app's 30000 ms per-case deadline
    typed:    1 event(s): "printf '\r\n%s%s\r\n' '__TERMINAL_SHELL_PROBE_shell_48' '434b..._READY__'\r"
    verdict:  the protocol was honoured; this is a case failure, not a contract mismatch

### 从新诊断得到的新事实

- 失败的三条恰好都是依赖 zsh 行编辑语义的：readline-history / readline-tab / pty-resize；
  zsh 其余四条（cat-eof / vim-edit / nano-edit / ctrl-c-interrupt）与 bash 全部七条均通过。
- readline-history 与 pty-resize 各只键入了 **1 个事件**，且是带 \r 结尾的 READY 命令；
  30 秒内连 READY marker 都没回显 → 该命令从未被执行。
- readline-tab 键入了 5 个事件，说明它执行到更后面才卡住。
- 命令文本本身正确。

### 当前假设（**未验证**，需要 Linux 环境）

zsh 由 session/shell_startup.rs 注入自定义 ZDOTDIR + 生成的 .zshrc（local.rs:802），
所以不是 newuser 向导问题。更可能落在生成 rc 与 ZLE 的交互上（键位模式、bindkey、或 rc 提前 return 使 ZLE 未就绪）。

**这一条无法在本地验证** —— 本机是 macOS，需要一台真实 Linux（含完整图形栈）做二分实验
（禁用 rc / 只加最小 rc / 检查 bindkey -v）。不得凭猜测改动 shell_startup.rs，
那可能修好 Linux 却破坏 macOS。

### 状态

- P8.3-A（stale-output）：**VERIFIED on real runner**
- P8.3-B（zsh 三条）：**BLOCKED_EXTERNAL** —— 根因候选已收窄，需要 Linux 环境二分

## E. Task C 诊断结果（Phase 8.8，CI run 41189424959）

### 已确证：两个系统级交互提示会吞掉输入（与 rc 无关）

在 Ubuntu runner 上用真实 PTY 跑五种 rc 变体，第一轮 zsh 全部未执行键入命令，
查 transcript 发现它们卡在两个与 rc 无关的系统级提示上：

- **没有启动文件时**：zsh 进入 `zsh-newuser-install` 向导并一直等待
- **有启动文件时**：Debian/Ubuntu 的系统级 `/etc/zsh/zshrc` 调用 `compinit`，
  在全新 PTY 里停在 `zsh compinit: insecure directories ... continue [y] or abort compinit [n]?`

bash 五个变体全部正常，因为 bash 没有这套机制。

**因此第一轮的「zsh 全 False」是两个系统级阻塞的产物，不能作为关于 rc 的证据。**

### 已确证：排除这两个阻塞后，zsh + 应用生成的 rc 在 Linux 上完全正常

给每个变体写入 `.zshenv` 并设 `skip_global_compinit=1` 后重跑：

    zsh | no-user-rc | True | True
    zsh | minimal-rc | True | True
    zsh | app-rc     | True | True
    bash| (三个)     | True | True
    阻塞提示出现次数：0

`app-rc` 的 transcript 显示一个健康的工作会话：prompt、`\x1b]133;A\x07`（precmd）、
键入的命令、`\x1b]133;B\x07`（preexec）、marker 输出，并且出现 `\x1b[?1h\x1b=` /
`\x1b[?1l\x1b>` 这对 DECCKM 键盘模式切换 —— 正是 ZLE 在工作。

### 由此得出的结论（以及不能得出的结论）

**可以得出的**：应用生成的 `.zshrc` 本身不会破坏 ZLE，也不会阻止命令执行。
「rc 内容导致 zsh 三条超时」这一假设被排除。

**不能得出的**：这还没有解释应用里那三条用例为何失败。若真是 compinit 阻塞，
七条 zsh 用例应当全挂，而实际只挂依赖 ZLE 的三条。所以应用侧的失败另有原因，
候选方向是应用 PTY 环境（HOME 权限、ZDOTDIR 注入时序）与 shell 就绪检测的交互，
需要带应用内插桩的下一次 matrix 才能定论。

### 本阶段产出的两个独立价值

1. 任何在这类 runner 上驱动交互式 zsh 的自动化，都会被 newuser 向导或 compinit 阻塞，
   必须显式设 `skip_global_compinit=1` 并提供至少一个启动文件。
2. 诊断脚本的指标取舍过程本身值得记录：`[[ -o zle ]]`、PTY 内发送 `ESC [ A` 两个指标
   在**能通过的 macOS 上同样报 false**，属于坏指标，已删除而不是发布。

### 状态

- Task C：**PARTIAL** —— 诊断能力已入库并产出真实证据；根因候选收窄但未确认。
- 下一步需要带应用内插桩的 Linux matrix（记录 HOME 权限、ZDOTDIR 注入时序、
  以及 shell 就绪判定与首条命令发送的时间差）。
