# DDQ07 — Linux 资源曲线的正式归档

**判定：ARCHIVED（既有正式 100 轮，不重跑）。**
**但归档的证据答不了 DDQ07 六问里的第 6 问** —— 见下，这是一个真实的缺口，已修但需下次 CI 才能出现在证据里。

---

## 为什么归档而不是重跑

DDQ07 的条件写得很清楚：

> 如果已经是完整正式采样，则归档现有证据，不重复跑。

Linux 的证据满足这个条件：

| 项 | 值 |
| --- | --- |
| runId | `46124241301` |
| jobId | `140921589341`（Linux GUI E2E） |
| source sha | `24f4b3e626337f9289ec66057f4ab6513d438c12` |
| binary sha256 | `33a11023c04137ac0db8b71133647f99aaf221c424d95b21f997c4f33f5fe4a0` |
| binary bytes | 49,650,968 |
| recordedAt | 2026-11-28T08:43:26.862Z |
| OS | Ubuntu（`7.0.0-1020-azure`），x64 |
| verdict | **PASS** |

---

## 六问逐条核对

### 1. 实际 rounds

```
rounds(asked): 100 | expected: 100 | observed: 100 | completed: 100
```

### 2. 采样数量

```
sampleCount: 101        ← 1 个轮前基线 + 100 个轮后采样
rssSeries: 100 | fdSeries: 100 | roundLines: 100
```

`sampleCount` 是 101 而序列是 100，因为基线是 `round: -1`，`buildSeries` 把它放进
`series.baseline` 而不是轮次列。这是 PR #173 修正的——第一版把基线算成第 0 轮，
导致每条产物都读作 `16 of 15 rounds sampled`。

### 3. RSS / FD / Threads

| 指标 | 起点 → 终点 | 判定 |
| --- | --- | --- |
| RSS（基线 → 末轮） | 216,633,344 → 217,067,520 B（206.58 → 207.00 MiB，**+0.25 MiB**） | `NO_LEAK_DETECTED` |
| openFds | 68 → 69（末值**低于**首个轮次读数，−5） | `NO_LEAK_DETECTED` |
| threads | 42–46 | 记录（描述性） |

### 4. 是否 100 轮

是。`expected == observed == completed == 100`，`completenessProblems: []`，
每个指标 100 个有效样本、最长连续缺失 **0**。

### 5. 是否同一进程

> **更新（PR #179 之后）**：CI run `46138104551` 的 macOS 100 轮证据已经带上了
> 这个字段——`sameProcess: true`、`pidChanges: []`、`pidLookupFailures: 0`。
> 下面记录的是归档时那份证据的状态，作为缺口曾经存在的凭证保留。

**归档的证据答不了这一问。**

`extra` 里没有 `sameProcess` / `pidChanges` 字段。原因是真实的：spec 在测试体里
**算了** `pidChanges`，但只在"确实发生了变化"时赋值，然后从未把它们复制进 `extra`。
一份干净的运行因此不带任何字段——读者无法区分「没变化」与「没检查」。

**已修（本次改动）**：

```js
const pidChanges = []
let pidLost = 0
// …每轮 findAppPid：
if (current === null) pidLost += 1
else if (current !== pid) pidChanges.push({ round, from: pid, to: current })
// …循环之后，无条件写：
measured.pidChanges = pidChanges
measured.pidLookupFailures = pidLost
measured.sameProcess = pidChanges.length === 0 && pidLost === 0
```

并且 `sameProcess === false` 现在会让判定变成 `INSUFFICIENT_DATA` 而不是 PASS ——
从两个进程拼出来的序列描述的不是任何一个：第二个进程的基线不是第一个的，
跨越接缝的上升是重启的产物，不是趋势。

本地 15 轮验证：`sameProcess: true`、`pidChanges: []`、`pidLookupFailures: 0`。
**归档的那份 100 轮没有这个字段**，因为它在改动之前跑的；下一次 CI 会有。

`pidLookupFailures` 是本轮新增的第三个字段，理由是它比 pid 变化更危险：
如果查询中途开始失败，循环会继续采一个可能已被回收的号码。那不是重启，
是采样器不再知道自己测的是什么。

### 6. 是否执行了完整操作

**诚实的答案是：执行了，但只覆盖一条 GUI 路径。**

```json
roundLines: 100 项，全部是 43
```

每一轮做的是：打开命令面板 → Escape → 读终端快照。终端缓冲区 100 轮**一行未变**。

这不能读成"终端会话在 100 轮里被反复驱动"。它测的是**命令面板这条路径重复运行时
进程级资源是否稳定**。SFTP、Snippet、Inspector、Terminal Session 的长时运行
不在其中——那是 DDQ08 的范围。

### 7. 曲线判读

报告写 `NO_LEAK_DETECTED`。独立复算（不依赖 spec 自己的判定函数）：

```
rss steady 前半 floor: 216,944,640
rss steady 后半 floor: 217,030,656        ← 在爬，但
涨幅: 86,016 B = 0.04%                     （阈值 20%）
整段增长: 258,048 B = 0.25 MiB             （阈值 8 MiB）
```

`floorRise` 与 `floorsClimb` 两个条件**同时**成立才判 `LEAK_SUSPECTED`。这里
`climbs` 为真但 `rise` 与绝对增长都远低于阈值，所以 `NO_LEAK_DETECTED` 是对的。

值得记下：**floor 确实在缓慢上升**。0.25 MiB / 100 轮的斜率若线性外推到 10 000 轮
是 25 MiB —— 但那是对一条 100 点序列的外推，不是测量。这个数字没有任何证据支持。

---

## 三平台横向对照（DDQ07 要求统一比较的四项）

| 平台 | run | 轮次完整性 | RSS 起 → 止 | 描述符 | 生命周期回收 |
| --- | --- | --- | --- | --- | --- |
| macOS | `46119329682` | 100/100 | 119.3 → 119.6 MB | — | 末值近基线 |
| Linux | `46124241301` | 100/100 | 216.6 → 217.1 MB | 68 → 69 | 末值近基线 |
| Windows | `46124241301` | 100/100 | 46.4 → 45.8 MB（`handleCount` 100 个样本） | — | 末值**低于**起点 |

**绝对 RSS 不比较**（二进制、WebView 栈、分配器都不同）。比较的是：

- 轮次完整性：三个平台都是 `100 of 100`；
- 稳定期增长趋势：三个平台都是 `NO_LEAK_DETECTED`；
- 最终进程状态：三个平台都仍可响应（`alive` 快照非空）。

---

## 本次改了什么

只改测试与证据层，不触碰产品：

| 文件 | 改动 |
| --- | --- |
| `e2e/gui/specs/e2e-09-resource-curve.e2e.mjs` | 无条件记录 `sameProcess`/`pidChanges`/`pidLookupFailures`；写入 `extra`；`sameProcess === false` → `INSUFFICIENT_DATA` |
| `scripts/gui-resource-series-integrity.test.mjs` | 三条守卫：赋值、进证据、进判定 |

变异验证（全部变红）：

| 变异 | 结果 |
| --- | --- |
| 删掉 `measured.sameProcess = …` | 1 红 |
| 删掉 `extra` 里的 `sameProcess` | 1 红 |
| 把 `identityLost` 从判定里去掉 | 1 红 |

---

## 剩余限制

- **归档的 100 轮证据没有 `sameProcess` 字段**（跑在本次改动之前）。PR #179 合并后
  的 CI（run `46138104551`）已经产出带该字段的证据：`sameProcess: true`、
  `pidChanges: []`、`pidLookupFailures: 0`。**归档那份仍然没有**——本文件保留它的
  原状，不回溯改写。
- 曲线只覆盖命令面板路径（第 6 问）。
- 三个平台的曲线都来自**一台** runner 的一次 100 轮，是关于那台 runner 的假设。
- `roundLines` 只记录行数，不记录内容——"终端没变"是从行数恒定推断的，
  不是从缓冲区哈希验证的。
