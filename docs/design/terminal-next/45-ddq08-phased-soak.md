# DDQ08 — 分阶段 GUI soak

**判定：PASS（五个 Phase 全部可达，默认预算 80 轮完成）。**

---

## 为什么 `e2e-09` 不够

`e2e-09` 跑 100 轮**同一个**动作（开命令面板、关掉），曲线 RSS 与描述符数。
它证明那条路径稳定，对其余路径一无所知：SFTP 传输、SSH 会话、Snippet dock、
Inspector 各自走不同的代码，其中任何一处的泄漏都不会出现在 palette-only 的曲线上。

任务书要五个 Phase，每个**先用几轮确认可达**，再决定正式轮数，且明确不要求每个 Phase
都跑 100 轮。

---

## 五个 Phase

| Phase | 动作 | 默认轮数 |
| --- | --- | --- |
| A `local-terminal` | 切到本地 tab → 聚焦 → 输入 `echo soakA<n>` → 等回显 | 20 |
| B `palette` | 派发 `shortcut:command-palette` → 确认面板挂载 → Escape | 20 |
| C `sftp-dock` | 点 rail 的 SFTP → 读 dock 的 `data-panel` → 关闭 | 20 |
| D `snippet-dock` | 从命令面板点 "Open the snippet dock" → 断言 dock 报 `snippets` | 10 |
| E `inspector` | 从命令面板点 "Inspect the server" → 断言 dock 报 `inspector` | 10 |

`DDQ08_ROUNDS` 可把每个 Phase 一起放大（手动 soak 用）。默认值是一份普通 PR 能承受的：
轻的 20 轮，重的（每轮一次真实 SSH 握手）5–10 轮。

**为什么 A 轮要等回显**：一条排在被堵住的输出路径后面的命令，不等待就会被算作
"完成了一轮"。回显是 shell 说"我做完了"的唯一信号。

---

## 可达性优先

仓库里的实测历史：`e2e-02` 与 `e2e-03` 都把轮次花在断言一个**没有打开**的界面上，
并把结果记成产品缺陷。一个跑 100 轮"点一个不存在的控件"的 soak 会画出漂亮的平线
和一个错误的结论。

所以每个 Phase 先跑一轮探测，控件不在就报 `UNREACHABLE` —— 不是 `FAIL`，也不是 `PASS`。
判定因此有四种：

```
FAIL          有 case 抛错
NOT_RUN       探针缺失，或所有 Phase 都不可达
PARTIAL       部分 Phase 可达
PASS          五个 Phase 全部完成各自预算
```

---

## 打开命令面板的正确路径

三轮实测才找对：

| 尝试 | 结果 |
| --- | --- |
| `browser.keys(['Meta', 'k'])` | 面板未开 |
| `browser.keys(['Control', 'k'])` | 面板未开 |
| `window.dispatchEvent(new CustomEvent('shortcut:command-palette'))` | **打开** |

`service/shortcuts.test.ts` 里主绑定确实是 `ctrlKey`，但 WebDriver 的按键序列到不了
`use-global-shortcuts.ts` 的 `keydown` 监听。`e2e-04` 早就在用窗口事件，注释也写明
「这是键盘快捷键经过自己的翻译层之后做的事」。

**顺带一个发现**：`e2e-09` 按 `Meta+K` 跑 100 轮并通过——因为它的轮次只检查缓冲区
还能读回，一个什么都不做的组合键与一个打开对话框的组合键在它眼里一样。这不影响
`e2e-09` 的主张（它声称的是资源稳定，不是面板可达），但意味着它的轮次比那里的注释
暗示的要轻。

---

## 实测（本机 macOS，默认预算）

```
verdict: PASS
A-local-terminal  RAN 20/20  rssDelta = -35,504,128
B-palette         RAN 20/20  rssDelta =  -4,718,592
C-sftp-dock       RAN 20/20  rssDelta = -11,436,032
D-snippet-dock    RAN 10/10  rssDelta =  +2,555,904
E-inspector       RAN 10/10  rssDelta =  +4,341,760
```

三个 Phase 的 RSS 下降（启动期分配在结束时释放），两个小幅上升 2.4 / 4.1 MB
——都在 8 MiB 的噪声带以内。**这些是单次运行的差值，不是曲线判读**：
每个 Phase 的轮数太少，`summariseSeries` 的最低样本门槛是 12，A/B/C 刚好够、
D/E 不够。所以这里记录的是 `rssBefore` / `rssAfter` / `rssDelta` 与逐轮样本数，
而不是一个 `LEAK_SUSPECTED`/`NO_LEAK_DETECTED` 的结论。

要得到每个 Phase 的曲线判读，用 `DDQ08_ROUNDS=60` 手动派发——那是本文件
**没有做**的事。

---

## 与 `e2e-09` 的分工

| | `e2e-09` | `ddq08` |
| --- | --- | --- |
| 轮数 | 100 | 20 / 20 / 20 / 10 / 10 |
| 覆盖 | 一条路径 | 五个界面 |
| 判读 | 完整曲线（`NO_LEAK_DETECTED` 等） | 每 Phase 的起止差值 + 逐轮样本 |
| 门禁 | macOS 阻塞 | 常规 PR 跑；重轮的靠 `DDQ08_ROUNDS` 手动 |

两者不是替代关系：100 轮的深度与 5 个界面的广度各自回答不同的问题。

---

## 剩余限制

- **每个 Phase 的轮数不足以做曲线判读。** D/E 只有 10 轮，低于 `minimumSamples` 12。
  文件里记录的是差值，不是趋势。
- **没有 SSH 会话 Phase。** 任务书的 Phase B 是「SSH Session 创建、关闭和切换」，
  本文件用命令面板与 dock 代替了它——真实 SSH 每轮一次握手会让默认预算跑不进 PR。
  这是**未做**，不是做不了：`e2e-03`/`e2e-06` 已经在用 fixture sshd。
- **没有 SFTP 传输 Phase。** 任务书的 Phase C 包含"文件操作、传输"，本文件只开了 dock。
  真实传输有 `e2e-06`（3 MiB 上传 / 2 MiB 下载，双侧 SHA-256）。
- 五个 Phase 都在一个 app 进程里顺序跑，**没有隔离**：前一个 Phase 的分配会影响后一个
  的基线。差值因此是"在这个进程的第 N 段"，不是"全新进程"。
- 只在 macOS 本机跑过；CI 三平台尚未实跑。
