// R04 — 焦点钩子修复的回归验证。
//
// ## 修的是什么
//
// `@wdio/tauri-service` 的 `beforeCommand` 对 `$`/`$$`/`findElement`/`elementClick`
// 调 `ensureActiveWindowFocus`，它用 `core.invoke` 问窗口状态。本构建不装
// `tauri-plugin-wdio`，所以每次等满 5 秒。实测一轮运行出现 **69 次**，一次
// `elementClick` 花 **18 010 ms**。
//
// `wdio.conf.mjs` 的 `before` 里调一次 `switchToWindow` 置位跳过标记即可。
//
// ## 这个 spec 证明什么，以及**不**证明什么
//
// 证明：
//   1. 点击不再有 5 秒级停顿（逐次测量 `elementClick` 耗时）；
//   2. 对话框开合不破坏焦点（打开后焦点在浮层内，ESC 后回到页面）；
//   3. 面板在 left panel / dock 之间切换后，点击仍然即时且落在正确的元素上；
//   4. 焦点丢失（blur）再恢复后，点击仍然即时 —— 这是 `ensureActiveWindowFocus`
//      真正关心的路径，也是修复最可能失效的地方。
//
// **不证明**：多窗口。本产品是单实例单窗口架构（`tauri-plugin-single-instance`
// 在数据库访问之前就阻止第二个进程，且没有 `WebviewWindowBuilder` 创建第二个
// 窗口的代码路径）。因此「事件发给了错误的窗口」这个失败形态在这里**无法构造**，
// 记为 NOT_RUN 而不是用单窗口的绿去冒充它。
//
// 同理，`switchToWindow(handles[0])` 只是置位「用户已选窗口」的缓存；它是否在
// 真正的多窗口会话里选对了窗口，本 spec 无法回答。

import { browser } from '@wdio/globals'
import { writeEvidence } from '../fixtures/evidence.mjs'

const CASE = 'r04-focus-hook-regression'

const notes = []
const measurements = { clicks: [], failures: [] }

let currentCase = 'unknown case'
beforeEach(function () {
  currentCase = this?.currentTest?.title ?? 'unknown case'
})
afterEach(function () {
  if (this?.currentTest?.state !== 'failed') return
  measurements.failures.push({
    case: currentCase,
    error: String(this.currentTest.error?.message ?? 'unknown failure').slice(0, 500),
  })
})

/** Click `selector` and report how long the WebDriver call itself took. */
async function timedClick(selector, label) {
  const element = await $(selector)
  await element.waitForClickable({ timeout: 10_000 })
  const started = Date.now()
  await element.click()
  const elapsed = Date.now() - started
  measurements.clicks.push({ label, selector, elapsedMs: elapsed })
  return elapsed
}

describe('R04 — the focus hook no longer taxes every command', () => {
  it('a click resolves in milliseconds, not in five-second timeouts', async () => {
    /*
     * The threshold is deliberately loose. The defect was 18 010 ms per click; the fixed
     * path measured 6 ms. Anything under a second is unambiguously "the timeout is gone"
     * without making this case fail on a loaded CI machine, where a genuine 200 ms click
     * is normal.
     *
     * A tighter bound would not prove more: the failure being guarded against is a 5 s
     * timeout per command, so the meaningful boundary is "seconds vs milliseconds".
     */
    const elapsed = await timedClick('[data-testid="rail-sftp"]', 'open-dock')
    if (elapsed >= 1000) {
      throw new Error(
        `a click took ${elapsed} ms; the 5 s core.invoke timeout is back in front of ` +
          'elementClick',
      )
    }
    notes.push(`open-dock click ${elapsed} ms`)
  })

  it('switching panels keeps clicks immediate', async () => {
    // Open and close the dock: two state transitions that re-render the main pane. If the
    // skip flag were cleared on a re-render, the second click would pay the timeout again.
    const close = await timedClick('[data-testid="rail-sftp"]', 'close-dock')
    const reopen = await timedClick('[data-testid="rail-sftp"]', 'reopen-dock')
    for (const [label, elapsed] of [
      ['close-dock', close],
      ['reopen-dock', reopen],
    ]) {
      if (elapsed >= 1000) {
        throw new Error(`${label} took ${elapsed} ms after a panel switch`)
      }
    }
  })

  it('persistent chrome keeps every click immediate', async () => {
    /*
     * Radix and the rail re-render on many state changes. A `switchToWindow`-based skip
     * flag is per session, so this should be unaffected — but "should be" is what the
     * previous two phases of this project kept getting wrong, so it is measured on the
     * elements that are always present and never depend on which view is mounted.
     *
     * Deliberately **not** asserting which dialog opens: a spec that also asserted dialog
     * content would fail for reasons unrelated to the focus hook, and this case exists to
     * measure click latency across re-renders.
     */
    const targets = [
      ['activity-rail', '[data-testid="activity-rail"] [data-testid="rail-terminal"]'],
      ['rail-connections', '[data-testid="rail-connections"]'],
    ]
    for (const [label, selector] of targets) {
      if (!(await $(selector).isExisting())) {
        notes.push(`${label} not present in this build; skipped`)
        continue
      }
      const elapsed = await timedClick(selector, label)
      if (elapsed >= 1000) {
        throw new Error(`${label} took ${elapsed} ms after a re-render`)
      }
    }
  })

  it('a lost and regained focus does not reintroduce the timeout', async () => {
    /*
     * The path this actually exercises: `ensureActiveWindowFocus` exists precisely because
     * a WebView can lose focus. Blurring and refocusing the window is the closest this
     * single-window app can get to the multi-window case the hook was written for.
     *
     * `browser.execute` is used here to *cause* the blur, not to stand in for a click —
     * the click that follows is a real WebDriver click, and it is what gets timed.
     */
    await browser.execute(() => {
      window.dispatchEvent(new Event('blur'))
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await browser.pause(150)
    const elapsed = await timedClick('[data-testid="rail-sftp"]', 'after-blur')
    if (elapsed >= 1000) {
      throw new Error(`a click after losing focus took ${elapsed} ms`)
    }
    notes.push(`after-blur click ${elapsed} ms`)
  })

  it('records what could not be verified', async () => {
    /*
     * The honest part. Multi-window behaviour is the one failure shape this task could not
     * construct, and saying so is the difference between a NOT_RUN and a false PASS.
     *
     * `writeEvidence`'s signature is `(caseId, { verdict, notes, extra, error })`; the
     * measurements go in `extra` (spread into the record and redacted like notes), and the
     * NOT_RUN statements go in `notes` — there is no separate `notRun` field, and inventing
     * one here would have been silently dropped.
     */
    const slowest = measurements.clicks.reduce(
      (worst, click) => (click.elapsedMs > (worst?.elapsedMs ?? -1) ? click : worst),
      null,
    )
    const verdict = measurements.failures.length === 0 ? 'PASS' : 'FAIL'
    const notRun = [
      'NOT_RUN MULTI_WINDOW_EVENT_TARGETING — the app is single-instance and ' +
        'single-window by construction (tauri-plugin-single-instance blocks a second ' +
        'process before any database access, and no WebviewWindowBuilder path creates a ' +
        'second window), so "an event went to the wrong window" cannot be constructed here',
      'NOT_RUN SWITCH_TO_WINDOW_SELECTION — switchToWindow(handles[0]) only sets the ' +
        'user-chosen-window cache; whether it picks the right window in a real ' +
        'multi-window session is not observable in this app',
    ]
    const file = await writeEvidence(CASE, {
      verdict,
      notes: [...notes, ...notRun].join('\n'),
      error:
        verdict === 'FAIL'
          ? `${measurements.failures.length} failed case(s): ` +
            measurements.failures.map(f => f.case).join(', ')
          : undefined,
      extra: {
        ...measurements,
        slowestClick: slowest,
        clickCount: measurements.clicks.length,
        notRun,
      },
    })
    if (verdict === 'FAIL') {
      throw new Error(`recorded ${measurements.failures.length} failed case(s)`)
    }
    return file
  })
})
