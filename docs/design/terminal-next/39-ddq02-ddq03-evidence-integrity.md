# DDQ02 / DDQ03 — 两个"绿了但没测到"的形态

本文件记录本轮在 GUI 验收链上定位并修复的两个缺陷。两者都不是产品行为错误，
而是**证据链在自己骗自己**，所以修复也都在验收层。

---

## DDQ02 — macOS e2e-08 的 `NOT_RUN` 是一次 600 ms 的竞态

### 事实

Run `45937332982`，同一份源码、三个平台：

| 平台 | e2e-08 | 启动时 `pathname` |
| --- | --- | --- |
| Windows | `PASS`（40 → 10040 行） | 12 个 spec **全部** `/terminal` |
| Linux | `PASS`（43 → 10043 行） | `/terminal` |
| macOS | **`NOT_RUN`** | 第 1–2 个 spec `/terminal`，**第 3 个起全部 `/`** |

证据文件：

```json
{ "verdict": "NOT_RUN", "notes": "no local terminal tab in this run (tabs: 0)" }
```

截图（`e2e-08-1795752430570.png`）显示顶栏只有 `+` 按钮、**没有 tab 栏**，主区空白。

### 排除的假设

任务书列的六条我逐条查了，结论如下：

| 假设 | 判定 | 依据 |
| --- | --- | --- |
| 应用没启动完 | **部分成立** | 应用起来了（截图有顶栏），但终端层没挂载 |
| Local Tab 真的不存在 | 成立，但**有原因** | 见下 |
| 路由/初始状态没等对 | **根因** | `beforeSuite` 用 600 ms 固定等待 |
| 构建缺 `VITE_TERMINAL_GUI_E2E=1` | **排除** | 同一 job 的 e2e-09 读到 `lines: 35`，探针存在 |
| 探针要等页面初始化后才可用 | 排除 | e2e-09 在 e2e-08 之后跑，探针全程可用 |
| 启动时序导致立刻判 NOT_RUN | **根因** | `activeLocalTab()` 只读一次 DOM |

### 机制

三处证据拼起来是一条完整的因果链：

1. **`shouldMountTerminal` 要求有 tab**
   （`packages/frontend/src/layout/main-layout-content.tsx:50`）：
   ```ts
   const shouldMountTerminal = hasTerminalTabs || terminalLayerMountedRef.current
   ```
   没有 tab → 不挂载 `TerminalByUrl` → 没有终端层。鸡生蛋。

2. **第一个 tab 来自产品的 startup fallback，延迟 2 秒**
   （`packages/frontend/src/app-startup-recovery.ts:16`）：
   ```ts
   export const STARTUP_TERMINAL_FALLBACK_MS = 2_000
   ```
   `openFallback()` 在 deadline 之后才 `addTab({ label: 'Local', type: 'local' })`。

3. **harness 和 spec 都比这个 2 秒短**
   - `e2e/gui/wdio.conf.mjs` 的 `beforeSuite`：`pushState('/terminal')` 后 **`pause(600)`**；
   - `e2e/gui/specs/e2e-08` 的 `activeLocalTab()`：**读一次** `[role="tab"]`，空就 NOT_RUN。

   600 ms + 一次读取 < 2 000 ms，于是 macOS 上稳定地读到 0 个 tab。

**为什么 macOS 上的 `pathname` 是 `/`**：`pushState` 之后，应用自己的 bootstrap
（`hydrateFromDatabase` 等一串 await）会把路由落到 `/`（Hosts）。Windows/Linux 上
同样的代码竞态窗口内 bootstrap 已经收敛，所以观察到的是 `/terminal`。这是**同一份
代码在两个平台上胜负不同**，不是平台分支。

### 修复：两层，都是"有界等待"，不是加超时

**第一层（真正的缺陷）**——`e2e-08` 自己必须等：

```js
await browser.waitUntil(
  async () => (await browser.$$('[role="tab"]')).length > 0,
  { timeout: 20_000, interval: 250, timeoutMsg: 'no tab ever appeared in the tab strip' },
)
```

这正是 `e2e-01` 早就用过的机制（它自己的注释记着 run `44268976548` 上同样的
`tabs: 0`）。`e2e-08` 漏了这一步，因为在 Linux/Windows 上 harness 的导航恰好抢在前面。

**第二层（纵深防御）**——`beforeSuite` 从"等 600 ms"改为"等路由**连续 6 次**
读数为 `/terminal`"，超时 15 s，失败时告警并继续：

```js
await browser.waitUntil(async () => {
  const path = await browser.execute(() => { /* re-apply pushState; return pathname */ })
  consecutive = path === '/terminal' ? consecutive + 1 : 0
  return consecutive >= 6
}, { timeout: 15_000, interval: 250 })
```

单次轮询不够——真正要抓的失败形态是"这一刻对、300 ms 后又被改回去"。连续读数才能
区分"应用已经决定完"和"应用还没决定"。

### NOT_RUN 现在会说明是哪一种

```
the tab strip has N tab(s) but none of type "local"     ← 状态问题
no tab appeared within 20 s …; the startup fallback …    ← 启动问题
```

把两种原因合成一句话，正是这次 `NOT_RUN` 被读成产品故障的原因。

### 没有做的事

- **没有**把 `NOT_RUN` 改成 `PASS`。前置条件仍不满足时它仍然是 `NOT_RUN`。
- **没有**提高任何既有 `waitUntil` 的超时。
- **没有**为了让它过而缩短洪泛负载。

---

## DDQ03 — 资源曲线的守卫被调用方绕开了

### 事实

`resource-curve.mjs` 有一条测试叫 **"refuses a series with a hole in it"**：

```js
const withHole = [...plateau()]
withHole[10] = null
assert.equal(summariseSeries(withHole, LIMITS).verdict, 'INSUFFICIENT_DATA')
```

规则是对的。但 `e2e-09` 在调用它之前做了这件事：

```js
const rss = samples.map(sample => sample.rssBytes).filter(v => v !== null)
const rssCurve = summariseSeries(rss, LIMITS)
```

`filter` 把每一个洞都摘掉了，规则**永远看不到洞**。

### 为什么这比"阈值太松"更糟

两个后果，都是我在本轮实测到的形状：

1. **12 个有效样本冒充 100 轮曲线。** `minimumSamples` 是 12。100 轮里 RSS 只读到
   12 次，filter 之后正好 12 个元素 —— 一个几乎没测到的 run 被判定成曲线。
2. **时间索引被销毁。** 第 3 轮没读到、第 4 轮读到，filter 之后第 4 轮的值变成数组的
   第 3 项。证据里的 `rssSeries[40]` 不再是第 40 轮。任何基于它的 x 轴结论都是错的。

第 2 条尤其危险：`summariseSeries` 的 `floorsClimb` 会拿"第 40 项"和"第 50 项"比
floor，而这两项可能相隔 8 轮或 80 轮。**曲线规则本身无从察觉。**

### 修复：完整性先判，序列带轮次

新增 `e2e/gui/fixtures/resource-series.mjs`：

```js
buildSeries(samples, metrics, { expectedSamples })   → ResourceSeries
completenessProblems(series, { minCoverage, maxConsecutiveMissing, minRounds })
```

`ResourceSeries` 携带 DDQ03 要求的全部字段：

| 字段 | 作用 |
| --- | --- |
| `expectedSamples` / `observedSamples` / `completedRounds` | 区分"60 of 100"与"60 of 60" |
| `rounds` | 每一项属于哪一轮 |
| `values[metric]` | **与轮次对齐**，洞保留为 `null` |
| `perMetricValidSamples` | 每个指标的有效样本数 |
| `missingRounds[metric]` | 缺了哪几轮 |
| `maximumConsecutiveMissing` | 最长连续缺口 |
| `unavailableReasons[metric]` | 为什么缺（`unavailable` 字段的下游） |
| `scope.metrics` | `REQUIRED` / `OPTIONAL` |
| `baseline` | 轮次前的那次读数（`round: -1`） |

`e2e-09` 的判定从三段变成四段：

```
caseFailures.length > 0        → FAIL
measured.notRun === 'NOT_RUN'  → NOT_RUN
completeness.length > 0        → INSUFFICIENT_DATA      ← 新增
否则                            → PASS
```

**关键：`INSUFFICIENT_DATA` 不是 FAIL。** 它表示"这一轮回答不了这个问题"，
与"产品有问题"是两回事。所以它不写 `error` 字段，而是把 completeness problems
写进 `notes`。

### 反例（变异验证）

`scripts/gui-resource-series-integrity.test.mjs` 是源码级守卫，防止 filter 重新回来。
三处变异全部变红：

| 变异 | 结果 |
| --- | --- |
| `buildSeries` 的 metric 列表去掉 `threads`（spec 仍读 `series.values.threads`） | 红：`the spec reads series.values.threads but only asked buildSeries for [rssBytes, openFds]` |
| 把 `samples.push({ round: -1, … })` 删掉 | 红：`…never pushes a { round: -1 } sample into samples` |
| 在 spec 里把 `series.values.rssBytes` 改回 `.filter(v => v !== null)` | 红：`e2e-09 must not filter nulls out of a metric series` |

### 本地实测（15 轮快速检查，不覆盖 100 轮正式归档）

```
verdict            INSUFFICIENT_DATA
notes              15 of 15 rounds sampled; run: this run asked for 15 rounds; the formal curve needs 100
expected/observed  15 / 15
perMetricValid     { rssBytes: 15, openFds: 15, threads: 15 }
maxConsecutive     0 / 0 / 0
rssBaseline        33,292,288 → rssLast 28,770,304
fdsBaseline        90 → fdLast 88
```

**短跑不再冒充曲线**，而且它给出的原因可以被操作（跑满 100 轮）。

### 本轮自己引入又修掉的三个缺陷

这三个都是本地端到端跑出来的，不是想出来的：

1. **`series.values.threads` 未定义** → `after()` 抛
   `series.values.threads is not iterable`，Mocha 报 "1 passing / 1 failing"，
   **连证据文件都没写出来**。原因是 `buildSeries` 只被要求了 `['rssBytes','openFds']`。
   修复 + 守卫：`every metric the spec reads is one it asked buildSeries for`。
2. **`16 of 15 rounds sampled`** → 基线被当成第 0 轮。修复：基线是 `round: -1`，
   在 `buildSeries` 里单独放进 `baseline`，不进轮次列。
3. **`rssBaseline: null`** → 基线只赋给了 `measured.baseline`，从未 push 进 `samples`，
   所以 `series.baseline` 永远是 null。这个字段看起来像"采样器读不到基线"，
   实际是"读到了然后丢了"。修复 + 守卫（守卫本身第一版也是空转的，
   因为它被 `measured.baseline = { round: -1 }` 那一行满足了）。

### 没有做的事

- **没有**放宽 `minimumSamples`、`growthFraction`、`growthFloor`。
- **没有**用 15 轮的结果覆盖归档的 100 轮证据。
- **没有**把 `LEAK_SUSPECTED` 改成抛错（它仍然是记录）。

---

## 两个形态的共同点

| | DDQ02 | DDQ03 |
| --- | --- | --- |
| 表面 | 工作流 success，case `NOT_RUN` | 工作流 success，case `PASS` |
| 实质 | 前置条件没等到就被判为不存在 | 守卫被调用方绕开，从未执行 |
| 判据失效点 | `activeLocalTab()` 读一次 DOM | `filter` 在规则之前 |
| 修复位置 | spec 的就绪等待 + harness 的收敛等待 | 新增 series 层 + 源码守卫 |
| 变异能否复现 | 是（600 ms < 2 s fallback） | 是（三处变异全红） |

两者都属于同一族问题：**测试通过不代表测到了东西**。
前一轮的 `e2e-08` 是"第五种形态：从未执行"，这一轮是它的两个变体。
