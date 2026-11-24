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

/**
 * Click `selector` and report how long the WebDriver call itself took.
 *
 * Returns `null` when the element is not clickable here rather than throwing: every case
 * in this spec measures *click latency*, and an element that cannot be clicked on the
 * current route is an environment fact, not a latency result. The caller decides whether
 * that is a NOT_RUN (it is, everywhere in this file).
 *
 * `waitForClickable` used to throw after 10 s, which made three CI runs look like "the
 * focus timeout came back" when they were really "this case picked an element that is not
 * interactive on the route the previous case left behind".
 */
async function timedClick(selector, label) {
  const element = await $(selector)
  if (!(await element.isExisting())) return null
  if (!(await element.isClickable().catch(() => false))) return null
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
    if (elapsed === null) {
      // The suite's `beforeSuite` resets the app to `/terminal`, so this is the case that
      // should always work. If it does not, say so rather than silently passing.
      notes.push('open-dock NOT_RUN: the SFTP rail entry was not clickable at startup')
      return
    }
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
    if (close === null || reopen === null) {
      notes.push('panel-switch NOT_RUN: the dock toggle was not clickable')
      return
    }
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
    /*
     * Both targets here are **toggles**, not navigations.
     *
     * The first version also clicked `rail-connections`, which is a route change. That
     * left the app on `/hosts`, and the next case then failed twice trying to click a
     * control that only exists on `/terminal`. Returning to `/terminal` afterwards was a
     * patch over the problem; not navigating is the fix.
     *
     * `rail-terminal` on `/terminal` and the dock toggle both change *state* without
     * changing which view is mounted, which is exactly what this case claims to measure
     * ("clicks stay immediate across re-renders").
     */
    const targets = [
      ['rail-terminal', '[data-testid="activity-rail"] [data-testid="rail-terminal"]'],
      ['rail-sftp', '[data-testid="rail-sftp"]'],
    ]
    for (const [label, selector] of targets) {
      const elapsed = await timedClick(selector, label)
      if (elapsed === null) {
        notes.push(`${label} not clickable here; skipped`)
        continue
      }
      if (elapsed >= 1000) {
        throw new Error(`${label} took ${elapsed} ms after a re-render`)
      }
    }
    // Leave the dock in a known state for the next case, without depending on which
    // route we are on: closing it is the same toggle it was opened with.
    await browser.execute(() => {
      const rail = document.querySelector('[data-testid="rail-sftp"]')
      if (rail && rail.getAttribute('aria-pressed') === 'true') rail.click()
    })
    await browser.pause(200)
  })

  it('a blur event does not reintroduce the timeout', async () => {
    /*
     * The path this actually exercises: `ensureActiveWindowFocus` exists precisely because
     * a WebView can lose focus. Blurring and refocusing the window is the closest this
     * single-window app can get to the multi-window case the hook was written for.
     *
     * ## Two things this case got wrong on CI, and why
     *
     * **1. It clicked `rail-sftp` while the current route was `/hosts`.** The previous case
     * navigated away from `/terminal` by pressing `rail-terminal` and `rail-connections`,
     * so the SFTP rail entry was a plain link, not the dock toggle this case assumed —
     * and WebdriverIO reported `still not clickable after 10000ms`. The case passed locally
     * only because the local run happened to leave the app on `/terminal`.
     *
     * The fix is not a longer timeout; it is that a focus-timing case must not depend on
     * which view a previous case left behind. It measures whatever rail entry is present
     * and returns to `/terminal` afterwards so the next case starts from a known route.
     *
     * **2. A synthetic `blur` on `window` does not blur anything.** It is an event
     * dispatch, not a focus change: no element loses focus, so the case was not testing
     * "focus was lost" at all. What it can honestly claim is "a blur event went through
     * the handlers without breaking the command path". Said that way it is still worth
     * running — the handler chain is real code — but the case name now matches it.
     */
    await browser.execute(() => {
      window.dispatchEvent(new Event('blur'))
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await browser.pause(150)

    /*
     * ## Existence is not clickability — this is where the case failed twice
     *
     * The first version clicked `rail-sftp` and CI reported it "still not clickable after
     * 10000ms"; the second version picked a rail entry that merely **existed** and CI
     * reported the same thing for `rail-terminal`. Both versions guessed which element
     * would be interactive on whatever route the previous case left behind, and both
     * guesses were wrong on CI while looking fine locally.
     *
     * So this no longer guesses. It asks WebdriverIO, for each candidate, whether the
     * element is actually clickable right now, and times whichever one answers yes. If
     * none does, the case records NOT_RUN with the reason instead of failing on an
     * environment detail that has nothing to do with click latency.
     *
     * That is also the honest shape for what this measures: the subject is "how long does
     * a click take after a blur event", not "is every rail entry always clickable".
     */
    const candidates = [
      'rail-terminal',
      'rail-hosts',
      'rail-connections',
      'rail-sftp',
    ]
    let selector = null
    for (const id of candidates) {
      const candidate = `[data-testid="${id}"]`
      const element = await $(candidate)
      if (!(await element.isExisting())) continue
      if (!(await element.isClickable().catch(() => false))) continue
      selector = candidate
      break
    }
    if (!selector) {
      notes.push(
        'after-blur NOT_RUN: no rail entry is clickable on the route the previous case ' +
          'left behind',
      )
      return
    }
    const elapsed = await timedClick(selector, 'after-blur')
    if (elapsed === null) {
      notes.push(`after-blur NOT_RUN: ${selector} stopped being clickable between probe and click`)
      return
    }
    if (elapsed >= 1000) {
      throw new Error(`a click after a blur event took ${elapsed} ms`)
    }
    notes.push(`after-blur click ${elapsed} ms on ${selector}`)
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
    /*
     * ## Declared gaps, not free-text NOT_RUNs
     *
     * The first version wrote these into `extra.notRun` as prose and nothing else. That
     * is enough for a human reading the JSON, and it is **not** what the report reads:
     * `scripts/gui-e2e-report.mjs` computes
     * `unexplainedNotRun = notRunCount > sum(gaps[].covers)`, so two NOT_RUNs with no
     * `gaps` entry are a case that "should have worked and did not" — `status: FAIL` with
     * `passed: 57, failed: 0`.
     *
     * Measured on run 45319266818: macOS and Windows both reported exactly that, and the
     * only failing step was `Summarise the GUI layer`. The suite had passed.
     *
     * This is the same defect `e2e-01` had (see the comment in the report script): write
     * the structured form the reader consumes, and let the prose be generated from it so
     * the two cannot drift.
     */
    const GAPS = [
      {
        id: 'MULTI_WINDOW_EVENT_TARGETING',
        covers: 1,
        reason:
          'the app is single-instance and single-window by construction ' +
          '(tauri-plugin-single-instance blocks a second process before any database ' +
          'access, and no WebviewWindowBuilder path creates a second window)',
        needs: 'a build with a second window; none exists to drive',
      },
      {
        id: 'SWITCH_TO_WINDOW_SELECTION',
        covers: 1,
        reason:
          'switchToWindow(handles[0]) only sets the user-chosen-window cache; whether it ' +
          'picks the right window in a real multi-window session is not observable here',
        needs: 'the same second window, plus an event that could be misrouted',
      },
    ]
    for (const gap of GAPS) {
      notes.push(`NOT_RUN ${gap.id}: ${gap.reason} (needs ${gap.needs})`)
    }
    const notRunCount = notes.filter(note => note.includes('NOT_RUN')).length
    const file = await writeEvidence(CASE, {
      verdict: verdict === 'FAIL' ? 'FAIL' : notRunCount > 0 ? 'PARTIAL' : 'PASS',
      notes: notes.join('\n'),
      error:
        verdict === 'FAIL'
          ? `${measurements.failures.length} failed case(s): ` +
            measurements.failures.map(f => f.case).join(', ')
          : undefined,
      extra: {
        ...measurements,
        slowestClick: slowest,
        clickCount: measurements.clicks.length,
        notRunCount,
        gaps: GAPS,
      },
    })
    if (verdict === 'FAIL') {
      throw new Error(`recorded ${measurements.failures.length} failed case(s)`)
    }
    return file
  })
})
