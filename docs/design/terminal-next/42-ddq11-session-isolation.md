# DDQ11 — 真实 GUI 断线恢复与会话隔离

**判定：NOT_IMPLEMENTED（未交付用例）。**

本文件记录它**没有**完成、已确认的三层阻塞、以及过程中发现并修复的一个真实产品侧缺陷。
不写成 PASS 的原因很简单：没有任何一次运行产出过隔离或恢复的证据。

---

## 目标（未达成）

日用中最重要的一条：

> 我连着，网络断了，我继续用，网回来了——**我的会话还是我的吗？**

三个可独立失败的部分：隔离（A 断，B 照常）、恢复（路径回来后 A 可用）、
身份（A 的迟到数据不写进 B）。

---

## 已交付的部分（可复用，与本 case 无耦合）

| 交付物 | 状态 |
| --- | --- |
| `sftp-shaping-proxy.mjs` 的 `pause()` / `resume()` | ✅ 7/7 测试，含变异验证 |
| `run-gui-e2e.mjs` 的可暂停代理 + 回环控制通道 | ✅ 起来过，实测端口与计数 |
| `e2e/gui/fixtures` 的第三行 "E2E Gated" | ✅ 种进每个 spec 的 profile |
| 探针多终端缺陷修复 | ✅ 见下，e2e-01 回归 6/6 |

`pause()` 的语义是**连接保持、字节停止**——不是 `close()`（那模拟服务器消失）。
它记录 `pausedConnections` 与 `droppedWhilePaused`，让"暂停时有东西可断"成为断言而非假设。
变异验证：把 `pause()` 改成空操作，测试变红。

---

## 三层阻塞，逐条实测

### ① 探针在多终端下读错终端（**已修复**）

`installGuiE2EProbe` 每个终端装一次，直接赋值 `window.__terminalGuiE2E`，
于是**最后挂载的**终端赢。开两个远端 tab 时，每一次 `readActiveTerminalTail`、
`snapshot`、`typeIntoActiveTerminal` 描述的都是它。

`e2e-01`..`e2e-08` 全在单终端上跑，所以从未暴露。

修复：探针注册表 + 按 `.xterm` 节点顺序与 `.invisible` 祖先判定可见终端；
析构只移除自己，最后一个移除时才删全局。

**4 项新测试**（`gui-e2e-probe-multi-terminal.test.ts`）在修复前全部变红
（实测 `expected 'beta-line' to be 'alpha-line'`）。
**回归验证**：`e2e-01` 恢复 6/6 通过。

### ② 通过探针向远端终端输入，内容不达会话（**未解决**）

实测序列，每一步都在证据里：

| 尝试 | 结果 |
| --- | --- |
| `helper.addValue()` 切 tab 后 | `element did not become interactable`（helper 是 8×16 px、`z-index: -5`） |
| 点 `[data-terminal-canvas]` + `browser.keys` | 无报错，但终端尾部停在裸提示符 |
| `helper.click()` + `browser.keys` | 同上，静默丢失 |
| `typeIntoActiveTerminal`（`terminal.paste()`） | 返回 `true`，但 `aTail: ""` |
| 加 `focusActiveTerminal()`（xterm 的 `focus()`）后 | 仍 `aTail: ""` |

`e2e-01`/`e2e-08` 能用 `addValue` 是因为它们在**套件刚激活的那个 tab** 上跑，
helper 仍持有焦点；本 case 需要在两个远端 tab 间切换。

**未定位到的部分**：`aTail: ""` 意味着选中的终端缓冲区完全为空（连 banner 都没有），
这更像是 `activeTerminal()` 在多 pane 场景下仍选错，而不是输入路径的问题。
`.xterm` 节点数可能与 registry 数不等（远端 pane 结构不同），此时退回"最新"。

### ③ 修复 ① 的过程中引入并修复的回归（**已修复，记录在案**）

给 `installGuiE2EProbeIfBuilt` 加第三个 `element` 参数、调用方传 `term.element` 后，
**探针完全停止安装**：`e2e-01` 从 6 passing 变成 "the probe is absent"。

二分定位（这是本轮唯一一次用实验而非推理解决的）：

| 保留 | 结果 |
| --- | --- |
| 探针文件改动 + 调用方传 `term.element` | ✗ 探针不装 |
| 只改探针文件，调用方原样 | ✓ 6 passing |
| 调用方传 `containerRef.current` | ✗ 探针不装 |

结论：**问题在调用方传参这一侧**，`term.element`/`containerRef.current` 都会破坏安装
（原因未查明）。最终方案是探针自己从 DOM 读，调用方一行不改。

这个教训值得记下：我在这一层改了三次才想到做二分，而二分一次就定位了。

---

## 为什么停在这里

任务书规定「外部条件阻塞时记录真实原因，继续其它独立任务，不反复询问是否继续」。
本 case 迭代 12 轮仍未产出证据，而剩余问题（②）需要先弄清多 pane 下的 DOM 结构，
不是加一个超时能解决的。

**继续磨下去的风险**：为了让 fail 变绿而放宽断言（例如"尾部有内容就算过"），
那正是本任务书反复警告的形态。所以停止，如实记为未交付。

---

## 剩余限制 / 下一步

- 需要先回答：多 pane 时 `.xterm` 节点有几个、它们与 tab 的对应关系如何。
  这可以用一次 `browser.execute` 打印 DOM 结构得到，不需要跑完整 case。
- 解决后才能验证隔离与恢复；`pause()`/控制通道/第三行主机都已就绪。
- 断线时长、SFTP 通道、旧进程存活断言等都尚未涉及。

---

## 代码位置

| 关注点 | 位置 |
| --- | --- |
| 代理 pause/resume | `scripts/sftp-shaping-proxy.mjs` |
| GUI fixture 的可暂停代理与控制通道 | `scripts/run-gui-e2e.mjs` |
| 探针的多终端规则 | `packages/frontend/src/features/terminal/gui-e2e-probe.ts` |
| 该规则的独立测试 | `packages/frontend/src/features/terminal/gui-e2e-probe-multi-terminal.test.ts` |

曾经把选择规则抽成 `gui-e2e-active-terminal.ts` 以便单独测试，但探针最终内联了它
（跨模块静态 import 与"动态 import 才能被 tree-shake"的约定冲突），那个模块没有
消费者，已删除——不留只有类型、没有生产消费者的机制。
