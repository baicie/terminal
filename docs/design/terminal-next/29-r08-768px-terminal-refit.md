# R08 追加 — 768 px 只有 50 列：一次被丢弃的 resize

Linux GUI E2E 长期在 `e2e-02-layout` 的 **768 px** 一档失败。本文记录定位过程与根因。

## 一、先排除的三件事

| 假设 | 结果 |
| --- | --- |
| 布局决策错了 | **排除**。`chooseLayout` 在 768 预测 65 列，左 panel + 右 overlay，自身自洽 |
| hysteresis 锁住了旧决策 | **排除**。实测 `left: column` 正是新决策，不是 900 档的 `drawer` |
| 全局偏移 | **排除**。矩阵里 1280→92、1024→60、640→72 三档预测与实测**精确相等** |

## 二、诊断字段把问题定死

第一版只有 `left/right/terminalWidth/cols` 三个数字，我基于它们猜过两次、错了两次
（先点 `rail-sftp`，再点 `rail-terminal`，CI 两次都报 not clickable）。所以这一轮不再猜，
在 `readPresentations` 里把每个候选宽度持有者都测出来：

```
width   canvas   xtermHost   .xterm-screen   cols    差值
1440      912        911          1136        142    +224
1280      752        751           736         92     −16
1024      496        495           480         60     −16
 900      554        553           536         67     −18
 768      540        539           400         50    −140   ← 异常
 640      594        593           576         72     −18
```

规律非常干净：**除 1440 与 768 外，`.xterm-screen` 比 canvas 小 16–18 px**（padding +
边框）。768 小了 **140 px**。

1440 的 +224 是另一个方向的异常，同源（见 §四）。

## 三、根因：`requestFit()` 丢弃了最后一次请求

`terminal-viewport-controller.ts`：

```ts
requestFit(): void {
  if (this.disposed || this.resizeFrame !== null || this.resizeTimer !== null) {
    return   // ← 请求被丢弃，不是合并
  }
  ...
}
```

当时的设计假设是「已有 fit 排队，再来一次 resize 不必重复」。这个假设只在**后面还有
resize 事件**时成立。一串 resize 的**最后一次**不满足它：那次请求被丢掉，排队的 fit 用的
是这次 resize **之前**的容器尺寸，而之后没有任何东西会再要求 fit。

于是终端停在窗口已经没有的宽度上，直到下一次无关的布局变化。

在矩阵里正是这样：canvas 从 554 → 540 → 594，列数却是 67 → **50** → 72。768 这一档的
容器**比前一档更大**，列数反而掉了 17。

## 四、修法与验证

被丢弃的请求改为记住，当前 fit 完成后补一次：

```ts
if (this.resizeFrame !== null || this.resizeTimer !== null) {
  this.fitRequestedAgain = true
  return
}
...
this.fitNow()
if (this.fitRequestedAgain) {
  this.fitRequestedAgain = false
  this.requestFit()
}
```

节流不变（仍是最多每帧一次 fit），改变的是**最后一次请求不会被扔掉**。

### 先红后绿

`terminal-viewport-controller.test.ts` 新增 2 项：

- `runs a second fit when a resize arrives while one is already scheduled`
- `does not schedule extra passes when nothing arrives during the fit`

**第一版测试是空转的**，值得记下来：它记录每次 fit 看到的容器宽度，断言最后一个是新宽度。
它在**坏代码上也能通过** —— 只有一次 fit 被调度，而那次 fit 执行时容器宽度**已经**改过了
（测试在帧执行前改了宽度）。断言被偶然满足。这正是本仓有名字的那个问题（空转的守护测试）。
改为断言**调用次数**后，变异回归旧实现立刻变红：

```
× runs a second fit when a resize arrives while one is already scheduled
AssertionError: expected 1 to be 2
```

第二项测试守住另一半：没有新请求时不得多跑一次，否则节流失去意义。

## 五、1440 的 +224 尚未解释

`.xterm-screen` 在 1440 比 canvas **大** 224 px。这不影响任何断言（142 列远超 60），但它
与 768 是同一种时序问题的另一面：`.xterm-screen` 反映的是 xterm **上一次** `fit()` 的结果，
而 `canvasWidth` 是当前布局。本次修复让最后一次请求不被丢弃，可能同时改善这一档。

下一次 CI 若 1440 的差值回到 −16 左右，即为此修复生效的旁证；若仍是 +224，那是另一个
独立问题，需要单独看。

## 六、判定

```
LAYOUT_DECISION_AT_768          = CORRECT   （预测 65 列，左 column + 右 overlay）
TERMINAL_REFIT_AFTER_LAST_RESIZE = FIXED    （变异验证红）
DROPPED_RESIZE_REQUEST          = FIXED
NO_EXTRA_FIT_WITHOUT_REQUEST    = PINNED
XTERM_SCREEN_LARGER_THAN_CANVAS = OPEN      （1440 档，+224，未解释）
```

门禁：前端 **327 文件 / 3019 项**、typecheck 通过。
