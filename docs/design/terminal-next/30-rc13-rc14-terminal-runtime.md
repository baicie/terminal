# RC13 / RC14 — 终端运行时的宽度与 Resize

## RC13 — 1440px 的 +224 已经消失

R08（`29-r08-768px-terminal-refit.md` §五）记录了一个未解释的异常：1440px 档
`.xterm-screen` 比 canvas **大** 224px，方向与其它档相反。当时的判据写得很明确：

> 下一次 CI 若 1440 的差值回到 −16 左右，即为此修复生效的旁证；若仍是 +224，那是
> 另一个独立问题。

**结果：消失了。**

`e2e/gui/artifacts/e2e-02/e2e-02.json`（#149 最终 head `a004483` 上 GUI 全绿那次
的产物）记录：

```
cssWidth: 1440   left: column 182   right: column 300
terminalWidth: 896   cols: 112
```

`1440 − 46(rail) − 182(左栏) − 300(dock) − 16(padding/border) = 896`，精确自洽。
R08 那次读到的是 `1136`。

交叉验证：1024 档推算 `1024 − 46 − 182 − 300 − 16 = 480`，与 R08 记录的 `480`
**完全一致** —— 所以 1024 一直是正常的，只有 1440 与 768 受 `requestFit` 丢弃影响，
而那个修复同时治好了两档。

`TERMINAL_REFIT_AT_1440 = VERIFIED`（未改代码）。

### 未覆盖

本轮**没有**在本地启动 GUI 重采六个宽度（用户要求不再弹窗）。上面的数字来自仓库中
已入库的 evidence，其 `recordedAt` 对应 #149 的全绿运行。三平台一致性仍以 CI 为准。

## RC14 — Resize 压力

新增 3 条用例（`terminal-viewport-controller.test.ts`，10/10 通过）：

| 用例 | 断言 |
| --- | --- |
| 100 次连续 resize | fit 次数 < 100（有界）、突发结束后无残留计时器、控制器仍可用 |
| 双 Pane 同时 resize | 两侧都完成 fit |
| 一侧 dispose 后 | 被 dispose 的一侧不再 fit，另一侧继续工作 |

### 一条变异活了下来，而它是**行为等价**的

我想用「把 `lastFitAt` 改成模块级共享」来模拟双 Pane 互相干扰。**四次尝试都没能让
它变红**，原因逐步查明：

1. 两侧在同一帧请求 → 共享状态无差别；
2. `vi.runAllTimers()` 会推进被伪造的墙钟，32ms 窗口自然过期；
3. 冻结 `Date.now()` 后仍不红 —— 因为 `requestFit` 在 `wait > 0` 时走
   `setTimeout`，**节流只延迟，不丢弃**。共享时钟让第二侧最多晚 32ms，仍然会 fit。

所以这不是一个可捕捉的缺陷，而是**延迟差异**。要「抓住」它只能断言精确的 fit 次数，
那是在断言调度器而不是产品。最终用例保留为「两个 Pane 都能 fit」的冒烟测试，
并把这条限制写进注释 —— 一条抓不住缺陷的测试，说清楚它抓什么，比假装它抓到了要好。

## 判定

```
TERMINAL_REFIT_AT_1440        = VERIFIED   （+224 消失，未改代码）
REFIT_BOUNDED_UNDER_BURST     = PASS       （100 次 resize 有界、无残留）
TWO_PANES_EACH_FIT            = PASS       （但见上：不区分共享节流）
DISPOSE_ISOLATION             = PASS
REAL_GUI_SIX_WIDTH_RECAPTURE  = NOT_RUN    （本轮不启动 GUI）
```
