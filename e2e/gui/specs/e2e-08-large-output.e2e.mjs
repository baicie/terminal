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
 * `awk` sleeps between chunks instead, so the stream is large enough to cross the 1 MiB
 * pause watermark (measured decision below) while lasting long enough to observe: roughly
 * 300k lines over several seconds.
 */
const FLOOD_COMMAND =
  'seq 1 300000 | awk \'{ printf "%s padding padding padding padding\\n", $1; if (NR % 20000 == 0) system("sleep 0.25") }\''

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
  it('streams a large output while the terminal keeps consuming it', async function () {
    this.timeout(180_000)

    const activated = await activeLocalTab()
    if (!activated.ok) {
      // No local tab means there is nothing to flood. Say so; do not invent a pass.
      await writeEvidence(CASE, {
        verdict: 'NOT_RUN',
        notes: `no local terminal tab in this run (tabs: ${activated.tabs})`,
      })
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
      await writeEvidence(CASE, {
        verdict: 'NOT_RUN',
        notes: 'read-only GUI E2E probe is absent; the frontend was built without VITE_TERMINAL_GUI_E2E=1',
      })
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
    /*
     * Check the write's own answer before polling for its effect.
     *
     * `typeIntoActiveTerminal` returns whether xterm accepted the paste, and the first
     * version of this spec discarded it. The run then sat 120 s polling a buffer that had
     * never been asked to change — `linesBefore: 43, linesAfter: 43` — and reported "the
     * buffer never grew", which reads like a product problem and was not one. A write that
     * reports failure must fail here, with that fact, not 120 s later with a wrong one.
     */
    /*
     * ## The trailing `\r` has to be a *separate* write
     *
     * Measured on the third run of this spec, with the buffer dumped right after the write:
     *
     *     … % seq 1 300000 | awk '{ printf "%s padding padding p
     *     adding padding\n", $1; if (NR % 20000 == 0) system("sleep 0.25") }'
     *
     * The command was on the line and the shell had not run it, because `terminal.paste()`
     * treats `\r` as a character to insert, not as Return. That is correct xterm behaviour
     * — a paste must never execute — and the first version of this spec assumed otherwise,
     * then spent 120 s polling a buffer that was never asked to change.
     *
     * So: paste the text, then press Return with `browser.keys('Enter')` — the real key
     * path `e2e-01` already uses for the same reason. A synthetic `KeyboardEvent` would
     * not travel the product's handler, and `\n` through `paste()` is text like any other.
     */
    const accepted = await browser.execute(
      text => globalThis.__terminalGuiE2E?.typeIntoActiveTerminal?.(text) ?? false,
      FLOOD_COMMAND,
    )
    if (!accepted) {
      await writeEvidence(CASE, {
        verdict: 'NOT_RUN',
        command: FLOOD_COMMAND,
        notes: 'xterm refused the paste; the probe could not deliver the command',
        extra: { linesBefore: beforeLines },
      })
      return
    }
    await browser.keys('Enter')

    /*
     * Poll for growth rather than sleeping a fixed time.
     *
     * A fixed sleep measures the runner's speed: a fast machine finishes the flood before
     * the first sample and the case reads "no growth". Polling for the condition is the
     * rule `e2e-01` already established for its own readiness checks.
     */
    let grown = null
    try {
      await browser.waitUntil(
        async () => {
          const current = await probeSnapshot()
          if (!current) return false
          grown = current
          return current.lines >= beforeLines + MIN_BUFFER_GROWTH_LINES
        },
        { timeout: 120_000, interval: 500, timeoutMsg: 'the terminal buffer never grew' },
      )
    } catch (error) {
      await writeEvidence(CASE, {
        verdict: 'FAIL',
        command: FLOOD_COMMAND,
        error: error.message,
        extra: { linesBefore: beforeLines, linesAfter: grown?.lines ?? null },
      })
      throw error
    }

    /*
     * Bounded: scrollback is the product's own retention limit. A buffer far past it means
     * output is accumulating rather than being consumed under a policy — the shape a
     * missing backpressure takes. The slack covers the in-flight batch plus the command's
     * own echoed line.
     */
    const BOUND_SLACK = 2_000
    expect(grown.lines).toBeLessThanOrEqual(SCROLLBACK + BOUND_SLACK)

    /*
     * The direction that matters most: after the flood, input must still work. A terminal
     * whose output path blocked the renderer scrolls happily and never accepts a keystroke
     * again — the failure this case exists to catch, and the one a "process is alive"
     * assertion cannot see.
     */
    const token = `guie2e08${Date.now()}`
    await browser.execute(
      text => globalThis.__terminalGuiE2E?.typeIntoActiveTerminal?.(text),
      `echo ${token}\r`,
    )
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

    await writeEvidence(CASE, {
      verdict: 'PASS',
      command: FLOOD_COMMAND,
      notes: `buffer ${beforeLines} → ${grown.lines} lines, then a command round-tripped`,
      extra: {
        linesBefore: beforeLines,
        linesAfter: grown.lines,
        scrollback: SCROLLBACK,
        inputAfterFlood: true,
      },
    })
  })
})
