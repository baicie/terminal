# DDQ12 — 大输出期间的真实交互

**判定：PASS（macOS 本机，真实 WebView）。**

---

## 与 `e2e-08` 的区别

`e2e-08` 灌入大输出，然后**等 shell 回到提示符**再输入。它回答的是「洪泛**之后**
终端还能不能用」。

日用要问的是另一句：**输出还在到达时**，我能不能切 pane、在另一个 pane 干活、
切回来、打断它、继续用？

两者不是同一个主张。一个能正确排水但握着锁的产品，或一个每收一块就重绘整个
scrollback 的产品，会通过第一个而败在第二个。

---

## 本 case 做的事

```
启动洪泛（不等它结束）
→ 等「输出仍在到达」：缓冲区在涨 且 末尾不是提示符
→ 派发 shortcut:split-vertical（产品自己的快捷键事件）
→ 断言真的分了：tab 1→2、.xterm 1→2
→ 在新 pane 里 echo 一个 nonce，等回显
→ Ctrl+C
→ 等缓冲区停止增长
→ 再 echo 一个 nonce，等回显
```

每一条断言都有它挡的失败形态：

| 断言 | 挡的是 |
| --- | --- |
| `outputStillArriving` | 洪泛已经跑完才做交互——那就退化成了 e2e-08 |
| `split.happened` | 快捷键什么都没做，却被当成双 pane 记录 |
| `settled.quiet` | 界面在滚但再也停不下来（Ctrl+C 没被接受） |
| `echoedAfterInterrupt` | 输出停了但会话不可用 |

---

## 两处实测推翻了我的初版

### ① 「分割发生了」的观查点选错了

第一版数 `[data-terminal-workbench]`，它在分割前后**都是 1**——因为分割渲染在它
**内部**（`terminal-workbench.tsx:88-107`，一个 grid，子节点是分割后的 tab）。
那次运行 `split: {workbenches: 1, canvases: 1}` 却仍然 PASS，因为我没有断言它。

正确的信号是 **tab 数**（`splitTab()` 返回新 id）与 **`.xterm` 实例数**：

```json
{"tabs":2,"terminals":2,"tabsBeforeSplit":1,"happened":true}
```

### ② 洪泛早就跑完了

第一版 `linesWhileProducing: 10043`——缓冲区已经顶到 scrollback 上限，
后面所有「输出期间」的交互**全部发生在输出结束之后**。case 通过了，
而它一次都没有在输出期间做过任何事。

修法：等待的条件从「缓冲区涨了」改成「缓冲区在涨**且末尾不是提示符**」。
提示符是 shell 说「我说完了」的信号，它的缺失才是「还在说」的证据。

---

## 实测（macOS 本机）

```
verdict: PASS
outputStillArriving: true
split: {tabs: 2, terminals: 2, tabsBeforeSplit: 1, happened: true, elapsedMs: 1589}
echoedDuringOutput: true
afterInterrupt: {quiet: true, lines: 20, elapsedMs: 2852}
echoedAfterInterrupt: true
```

`linesWhileProducing: 10043` = 43 基线 + scrollback 10000，缓冲区在洪泛期间
**有界**——这与 `e2e-08` 测到的同一个数，说明淘汰策略在交互期间仍在工作。

---

## 关于背压，本 case **不**声称什么

任务书明确要求：「不要仅凭输出超过 1 MiB 就断言一定触发了背压」。

越过 1 MiB 的暂停水位是**必要不充分**条件——泵可能比生产者填得更快，
水位从未维持。本 case 记录的是请求的字节数与缓冲区有界，**不是**「背压已激活」。

要证明背压真的激活，需要客户端侧的 ACK 计数或 paused 状态证据。
`session/terminal_output.rs` 有这套会计，但它没有暴露到 GUI 探针，
本 case 因此不引用它。

---

## 剩余限制

- **场景 B（输出期间改窗口尺寸与 split 比例）未做。** 任务书要求它，本 case 只做了
  场景 A（切 pane / 输入 / 中断）。
- 只在 macOS 本机跑过；CI 三平台未实跑。Windows 的洪泛命令是 PowerShell 版本，
  但 DDQ12 本身没在 Windows 上跑过。
- `payload` 是 103 字符 × 100k 行（约 11 MB），走的是本地 PTY。SSH 会话上的大输出
  由 `e2e-08` 的兄弟用例与 Rust 侧 `terminal_output_tests.rs` 覆盖，不是本 case。
- **不断言背压激活**（见上）。
- 打断后 `lines: 20` —— 缓冲区从 10043 掉到 20，说明 scrollback 在 Ctrl+C 之后
  被重置。这个行为没有被单独断言，只是记录；它是产品行为，不是本 case 的判据。
