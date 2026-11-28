// E2E-08 — 真实 WebView 里的大输出与背压。
//
// ## 这个 case 补的是哪一格
//
// `terminal_output_tests.rs` 已经证明 Rust 侧的背压泵能处理 10 MiB 并保持顺序，但那
// 证明的是**泵**。RC17 要的是「真实 Tauri WebView + xterm，把大输出喂进去，同时
// 界面仍在消费」。两者之间隔着 IPC、`onOutput` 回调、ACK 回传，以及 xterm 自己的
// 渲染——任何一处堵住，泵的单测都看不见。
//
// ## 判据为什么不是「跑完没崩」
//
// 「进程还活着」几乎总是真的，而它对背压只字未提。这个 case 断言的是三件**只有
// 消费真的在推进**才会同时成立的事：
//
//   1. 缓冲区尾部在前进——`lines` 在两个采样点之间增长，说明数据被 xterm 吃掉了，
//      而不是堵在某个队列里；
//   2. 缓冲区**有界**——`lines` 不超过 scrollback 上限加上命令行本身，说明产品在
//      按自己的淘汰策略工作，而不是无界堆积；
//   3. 停止输出后能回到提示符——说明输入方向没有被输出拖死，这是背压失效最典型的
//      症状（界面看着在滚，但再也敲不进东西）。
//
// 第 3 条是最容易被省略、也最能区分「看起来在跑」和「真的没堵住」的一条。
//
// ## 它记录 NOT_RUN 的情况
//
// 没有本地终端、探针不可用、或平台没有可用的输出命令时，记录原因而不是伪造结果。

import { browser, expect } from '@wdio/globals'
import { writeEvidence } from '../fixtures/evidence.mjs'

const CASE = 'e2e-08'

/** How much the buffer must grow before the run is considered to have produced output. */
const MIN_BUFFER_GROWTH_LINES = 200

/** The default scrollback the product ships; the buffer must not exceed it meaningfully. */
const SCROLLBACK = 10_000

/**
 * Emit a large stream, bounded in **both** directions.
 *
 * ## Why it is throttled
 *
 * Measured: `seq 1 400000` piped through `awk` produces ~15.5 MB in 0.33 s on this host.
 * Unthrottled, whether the case passes would depend on how fast the *runner's* pipe and
 * scheduler happen to be — a slow runner would look like a backpressure failure and a fast
 * one would finish before the first sample. Neither is a statement about the product.
 *
 * Chunks sleep between writes instead, so the stream is large enough to cross the 1 MiB
 * pause watermark while lasting long enough to observe. The size it settles on is stated
 * in bytes below, not in lines.
 *
 * ## Why there are two commands
 *
 * Measured on the Windows GUI E2E job: `seq` and `awk` do not exist in PowerShell, so the
 * POSIX command printed an error and the case failed on "the buffer never grew" — a
 * platform gap reported as a product result. Each platform gets an idiom that actually
 * runs. A third platform would need a third branch rather than a silent fallback to a
 * command that cannot work.
 *
 * This is separate from *how the command is typed*. The second Windows run got past the
 * command and still failed, with `linesAfter: 1475` out of 300k and `inputAfterFlood:
 * false` — the delivery path, not the command, was the problem, and the fix for that is
 * below: WebDriver's own key sequence instead of `terminal.paste()`.
 *
 * ## Why the payload is counted in bytes, not lines
 *
 * The first version emitted 300k short lines (~32 B each). Measured on two Windows runs
 * of this same spec: the fast one finished the flood inside 64 s of total spec time, the
 * slow one was still at line 215522 of 300000 after 120 s — the screenshot at the timeout
 * shows the output advancing normally, so the product was consuming it and the runner was
 * simply slower. PowerShell's per-iteration cost (a script-block call plus formatting) is
 * what sets the ceiling, and it is charged **per line**, so a payload sized in lines makes
 * the case's runtime track the runner rather than the product.
 *
 * What this case actually needs is stated in bytes and in rows, and neither needs 300k
 * lines: cross the 1 MiB pause watermark (so backpressure engages at all) and exceed the
 * 10 000-row scrollback (so eviction is observable). A 103-character pad plus the counter
 * gives ~110-character lines: 100k of them is 10.99 MB — measured with `wc -c` on the
 * POSIX command's output, the same byte volume the Rust test drives and ten times the
 * scrollback — for a third of the iterations. A runner three times slower than the slow
 * one measured still finishes inside the waits below.
 *
 * The line width is kept under the terminal's 120 columns on purpose: a wrapped line
 * costs several rows and would make the row arithmetic here depend on the window size.
 */
const PAD = 'padding '.repeat(13).trim() // 103 characters, same on both platforms

const FLOOD_LINES = 100_000

const FLOOD_COMMAND_POSIX = `seq 1 ${FLOOD_LINES} | awk '{ printf "%s ${PAD}\\n", $1; if (NR % 20000 == 0) system("sleep 0.25") }'`

const FLOOD_COMMAND_POWERSHELL = `$pad = '${PAD}'; 1..${FLOOD_LINES} | ForEach-Object { "$_ $pad"; if ($_ % 20000 -eq 0) { Start-Sleep -Milliseconds 250 } }`

const FLOOD_COMMAND =
  process.platform === 'win32' ? FLOOD_COMMAND_POWERSHELL : FLOOD_COMMAND_POSIX

async function probeSnapshot() {
  return browser.execute(() => globalThis.__terminalGuiE2E?.snapshot?.() ?? null)
}

async function activeLocalTab() {
  return browser.execute(() => {
    const tabs = Array.from(document.querySelectorAll('[role="tab"]'))
    const local = tabs.find(tab => tab.getAttribute('data-tab-type') === 'local')
    if (!local) return { ok: false, tabs: tabs.length }
    local.setAttribute('data-e2e-activate', 'local')
    return { ok: true, wasActive: local.getAttribute('aria-selected') === 'true' }
  })
}

describe('E2E-08 large output through a real WebView', () => {
  /*
   * ## Why the verdict is computed in `after`, not written inside the case
   *
   * `scripts/gui-evidence-integrity.test.mjs` requires every spec that writes evidence to
   * read `currentTest.state`, and the reason is the false-PASS shape measured on `e2e-02`:
   * a case that throws after its own `writeEvidence(..., 'PASS')` leaves an evidence file
   * claiming success next to a failing job. Writing PASS at the end of the happy path only
   * moves the problem — an assertion that fires before that line still leaves the previous
   * run's file on disk.
   *
   * So this spec collects measurements and lets the state decide. `skipped` (no local tab,
   * no probe) stays NOT_RUN: the harness could not drive the product, which is not a
   * product result either way.
   */
  const measured = {}
  const caseFailures = []

  afterEach(function () {
    if (this.currentTest?.state === 'failed') {
      /*
       * ## `currentTest.err` is undefined under this runner
       *
       * Measured, not assumed: a diagnostic dump of `Object.keys(this.currentTest)` on a
       * deliberately failing case lists `state`, `title`, `duration`, `timedOut` — and no
       * `err` at all. Reading `err?.message` therefore produced
       * `(no error text for "…")` in the evidence, which is a FAIL with no reason in it.
       *
       * The recorded fields are the ones that exist. The measurement block below carries
       * `linesAfter` and `bound`, so an assertion that fired on the bound is still legible
       * from the file even without the thrown message — the numbers are the reason. Nothing
       * is invented to fill the gap.
       */
      const test = this.currentTest
      const facts = [
        test.timedOut === true ? 'timed out' : null,
        typeof test.duration === 'number' ? `${test.duration} ms` : null,
      ].filter(Boolean)
      caseFailures.push({
        title: test.title ?? '<unknown case>',
        error:
          facts.length > 0
            ? `failed (${facts.join(', ')}); the runner exposes no error object, see the measurements`
            : 'failed; the runner exposes no error object, see the measurements',
      })
    }
  })

  after(async () => {
    const verdict = caseFailures.length > 0 ? 'FAIL' : measured.notRun ?? 'PASS'
    await writeEvidence(CASE, {
      verdict,
      command: FLOOD_COMMAND,
      ...(caseFailures.length > 0
        ? {
            error: caseFailures
              .map(failure => `${failure.title}: ${failure.error}`)
              .join('; '),
          }
        : {}),
      ...(measured.note === undefined ? {} : { notes: measured.note }),
      extra: {
        linesBefore: measured.linesBefore ?? null,
        linesAfter: measured.linesAfter ?? null,
        bound: measured.bound ?? null,
        scrollback: SCROLLBACK,
        inputAfterFlood: measured.inputAfterFlood ?? false,
        platform: process.platform,
      },
    })
  })

  it('streams a large output while the terminal keeps consuming it', async function () {
    /*
     * The outer budget has to exceed the sum of the inner waits (60 s prompt + 120 s growth
     * + 120 s flood-completion + 30 s echo), or Mocha kills the case first and the failure
     * names no step. Measured: the previous 180 s was below two of those waits combined, so
     * a slow runner produced "timed out" for a reason the evidence could not attribute.
     * The inner timeouts are the ones that carry the diagnostic messages; this only has to
     * stay out of their way.
     */
    this.timeout(360_000)

    /*
     * ## Wait for the terminal layer to exist before concluding it does not
     *
     * Measured on run 45937332982 (macOS): this spec recorded
     * `NOT_RUN  no local terminal tab in this run (tabs: 0)` while the **same runner, same
     * build** ran e2e-09 for 100 rounds afterwards and read `lines: 35` from the terminal
     * the whole time. The screenshot at the moment of the NOT_RUN shows a top bar with only
     * a `+` button and no tab strip at all.
     *
     * The mechanism is a startup race, not a platform difference. The harness's
     * `beforeSuite` pushes `/terminal` once and waits 600 ms; on macOS the app's own
     * bootstrap then settles on `/` (the Hosts route), so every spec from the third onward
     * logged `baseline reset {"pathname":"/"}`. The terminal tab strip is only rendered
     * when the app has at least one tab, and the first tab on a fresh profile comes from
     * the product's own startup fallback — `app-startup-recovery.ts` opens a local tab
     * after `STARTUP_TERMINAL_FALLBACK_MS` (2 s). This case read the tab strip **once**,
     * before that timer had fired, and reported the absence as a product result.
     *
     * `e2e-01` had already solved exactly this: it polls for `[role="tab"]` to appear
     * (20 s) — run 44268976548 recorded the same `tabs: 0` shape on Linux and the poll is
     * what makes the difference. This case skipped that step because on Linux and Windows
     * the harness's navigation happened to land first.
     *
     * So: poll, do not sleep longer, and keep the timeout bounded. A run where no tab ever
     * appears still ends in NOT_RUN — with a reason that says the wait expired rather than
     * implying the product has no terminal.
     */
    let tabsAppeared = true
    try {
      await browser.waitUntil(
        async () => (await browser.$$('[role="tab"]')).length > 0,
        {
          timeout: 20_000,
          interval: 250,
          timeoutMsg: 'no tab ever appeared in the tab strip',
        },
      )
    } catch {
      tabsAppeared = false
    }

    const activated = await activeLocalTab()
    if (!activated.ok) {
      /*
       * No local tab means there is nothing to flood. Say so; do not invent a pass.
       *
       * The two reasons are kept apart because they call for different work: no tab strip
       * at all after a 20 s wait is a startup-fallback problem, while a strip with tabs but
       * none of type `local` is a state problem (the profile restored only remote
       * sessions). Folding them into one sentence is how the 45937332982 NOT_RUN read as a
       * product fault when it was a 600 ms race.
       */
      measured.notRun = 'NOT_RUN'
      measured.note = tabsAppeared
        ? `the tab strip has ${activated.tabs} tab(s) but none of type "local"`
        : 'no tab appeared within 20 s of the suite starting; the startup fallback that ' +
          'opens the first local tab did not fire'
      return
    }
    if (!activated.wasActive) {
      await browser.$('[data-e2e-activate="local"]').click()
      await browser.pause(500)
    }

    const ready = await probeSnapshot()
    if (!ready) {
      /*
       * The probe is compiled in only for E2E builds. Its absence is a harness problem,
       * not a product result — the same distinction `e2e-01` draws.
       */
      measured.notRun = 'NOT_RUN'
      measured.note =
        'read-only GUI E2E probe is absent; the frontend was built without VITE_TERMINAL_GUI_E2E=1'
      return
    }

    /*
     * Wait for a prompt before typing, the way `e2e-01` does.
     *
     * Measured on the first run of this spec: it typed into a terminal whose shell had not
     * finished starting. The buffer held 43 lines (scrollback from the restored session),
     * the command went nowhere, and the case failed on "the buffer never grew" — an
     * assertion about the product, fired by a missing precondition. The prompt is the only
     * signal that the shell is listening.
     */
    await browser.waitUntil(
      async () => {
        const tail = await browser.execute(
          () => globalThis.__terminalGuiE2E?.readActiveTerminalTail?.() ?? '',
        )
        return typeof tail === 'string' && /[$#%>]\s*$/.test(tail)
      },
      {
        timeout: 60_000,
        interval: 500,
        timeoutMsg: 'the local shell never showed a prompt, so it cannot be given a command',
      },
    )

    // Sampled after the prompt: the baseline must be the buffer the flood actually starts
    // from, not one taken before the shell had finished drawing its banner.
    const beforeLines = (await probeSnapshot())?.lines ?? ready.lines
    measured.linesBefore = beforeLines
    /*
     * ## Typed through the real key path, not `terminal.paste()`
     *
     * Two measured failures led here:
     *
     * 1. `paste()` inserts characters rather than interpreting them, so the command sat on
     *    the line with its `\r` rendered as text and the shell never ran it.
     * 2. On Windows the paste route produced `linesAfter: 1475` out of 300k — the flood
     *    stopped early and input was dead afterwards (`inputAfterFlood: false`), while
     *    `e2e-01` on the *same* runner drove the same terminal fine.
     *
     * `e2e-01` uses WebDriver's *Element Send Keys* against `.xterm-helper-textarea`, which
     * is the browser's own key sequence rather than a DOM call. That is the path a user's
     * keystrokes take, and the one that works on every platform this suite runs on.
     */
    const helper = await browser.$('.xterm-helper-textarea')
    await helper.addValue(FLOOD_COMMAND)
    await browser.keys('Enter')

    // Poll for growth rather than sleeping a fixed time: a fixed sleep measures the
    // runner's speed, and a fast machine would finish the flood before the first sample.
    await browser.waitUntil(
      async () => {
        const current = await probeSnapshot()
        if (!current) return false
        measured.linesAfter = current.lines
        return current.lines >= beforeLines + MIN_BUFFER_GROWTH_LINES
      },
      { timeout: 120_000, interval: 500, timeoutMsg: 'the terminal buffer never grew' },
    )
    measured.peakLines = measured.linesAfter

    /*
     * ## Wait for the flood to *finish*, not just to start
     *
     * Measured on the Windows runner: `linesAfter: 617` — well past the growth threshold,
     * so the case moved on to the echo while the shell was still producing output. The
     * echo then sat behind the whole flood and the 30 s wait expired with
     * `inputAfterFlood: false`. The verdict blamed the product for being unable to accept
     * input, when the input was simply queued behind the work this case had just asked for.
     *
     * The prompt is the shell saying it is done. Waiting for it is what makes the next
     * step a question about input rather than a race against the flood.
     *
     * Bounded by the flood's own duration (~5 s of sleeps plus the runner's throughput);
     * a shell that never returns to a prompt is a real failure and this timeout says so.
     *
     * ## Why the poll also samples the buffer length
     *
     * Measured on the Windows run that failed here: the evidence recorded
     * `linesAfter: 674` while the screenshot taken at the same moment showed the terminal
     * printing line 215522. `linesAfter` was only ever written by the *first* wait, which
     * stops polling the moment the growth threshold is met — so the number in the file was
     * a stale early sample, and the failure read as "the buffer barely moved" when the
     * buffer had in fact grown to the scrollback limit. The artifact under-reported itself,
     * which is the one thing evidence must never do. Sampling here keeps
     * `linesAfter` truthful on the timeout path as well as the success path.
     */
    await browser.waitUntil(
      async () => {
        const tail = await browser.execute(
          () => globalThis.__terminalGuiE2E?.readActiveTerminalTail?.() ?? '',
        )
        const current = await probeSnapshot()
        if (current) measured.linesAfter = current.lines
        return typeof tail === 'string' && /[$#%>]\s*$/.test(tail)
      },
      {
        timeout: 120_000,
        interval: 500,
        timeoutMsg:
          'the shell never returned to a prompt after the flood, so the terminal may be stuck',
      },
    )
    measured.linesAfter = (await probeSnapshot())?.lines ?? measured.linesAfter

    /*
     * Bounded: scrollback is the product's own retention limit. A buffer far past it means
     * output is accumulating rather than being consumed under a policy — the shape a
     * missing backpressure takes. Recorded as a measurement and asserted, so a failure
     * here names the number instead of only the expectation.
     */
    const BOUND_SLACK = 2_000
    measured.bound = SCROLLBACK + BOUND_SLACK
    expect(measured.linesAfter).toBeLessThanOrEqual(measured.bound)

    /*
     * The direction that matters most: after the flood, input must still work. A terminal
     * whose output path blocked the renderer scrolls happily and never accepts a keystroke
     * again — the failure this case exists to catch, and the one a "process is alive"
     * assertion cannot see.
     */
    const token = `guie2e08${Date.now()}`
    /*
     * The same real key path as the flood, and a POSIX `echo` on every platform.
     *
     * `e2e-01` sends `echo <token>` on Windows too — the runner's shell there is not
     * required to be PowerShell for this to be the right command, because the earlier run
     * proved that exact form works on the Windows runner. Using `Write-Output` here would
     * test a different shell than the one the flood just ran in.
     */
    const echoCommand = `echo ${token}`
    const echoHelper = await browser.$('.xterm-helper-textarea')
    await echoHelper.addValue(echoCommand)
    await browser.keys('Enter')
    await browser.waitUntil(
      async () => {
        const tail = await browser.execute(
          () => globalThis.__terminalGuiE2E?.readActiveTerminalTail?.() ?? '',
        )
        return typeof tail === 'string' && tail.includes(token)
      },
      {
        timeout: 30_000,
        interval: 500,
        timeoutMsg: 'the shell never answered after the flood; input is blocked',
      },
    )
    measured.inputAfterFlood = true
    measured.note = `buffer ${beforeLines} → ${measured.linesAfter} lines, then a command round-tripped`
  })
})
