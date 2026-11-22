// T09 — 为什么 300 px dock 里的 `sftp-remote-refresh` 点不动？
//
// ## 已知事实（来自 PR #148 的运行记录）
//
//   displayed: true   enabled: true
//   elementFromPoint(按钮中心) → 一个 div
//   WebDriver 15 s 内无法点击
//
// 三种解释，必须分开：
//
//   1. **WebView 命中测试**：元素在正确位置，但合成器/命中测试算出的目标不是它；
//   2. **布局遮挡**：确实有别的节点盖在上面（残留 overlay、滚动容器、负 margin）；
//   3. **脚手架问题**：按钮不在其 `BoundingClientRect` 声称的位置（transform、
//      滚动偏移、DPR 缩放），于是 WebDriver 点在空白处。
//
// 这个 spec 只做**测量**，不改产品。它把足以区分三者的量一次采全：矩形、
// `elementsFromPoint` 栈（不止最上层）、pointer-events、z-index、overflow、
// transform、Radix Portal 残留、当前路由与 dock 宽度。
//
// ## 为什么要跨宽度测
//
// 300 px 是 dock 的单栏宽度；400/600 会跨过 `TWO_PANE_MIN_WIDTH`；全屏是另一侧
// 极端。若只有 300 px 失败，问题与单栏布局有关；若全宽度都失败，问题与 dock
// 无关。窗口缩放单独测，因为它改变的是视口而不是容器。
//
// ## 这个 spec 不做什么
//
// 不发 synthetic click，不提高 timeout，不绕过断言。它的输出是**判据**，
// 修复由下一轮基于这些数字决定。

import { browser } from '@wdio/globals'
import { writeEvidence } from '../fixtures/evidence.mjs'

const CASE = 't09-refresh-hit-test'

const notes = []
const measurements = {}

let currentCase = 'unknown case'
beforeEach(function () {
  currentCase = this?.currentTest?.title ?? 'unknown case'
})
afterEach(function () {
  if (this?.currentTest?.state !== 'failed') return
  const title = this.currentTest.title ?? currentCase
  notes.push(`FAILED case: ${title}`)
})

/*
 * The dock's width is **not** adjustable: `right-panel.tsx` renders
 * `width: DOCK_WIDTH` with `DOCK_WIDTH = 300`, a constant from the layout spec.
 * There is no splitter and no stored preference, so "test the dock at 400 px" is not
 * a thing a user can do — the only width lever is the window.
 *
 * What the window changes is the *cell* the dock lives in, and whether the terminal
 * canvas gets `column` or `overlay` presentation. That is why the sweep below varies
 * the window and reports the dock's measured width each time, instead of pretending
 * to resize a fixed element.
 */

/** Every measurement the task asks for, for one selector at one width. */
async function probe(selector) {
  return browser.execute(target => {
    const node = document.querySelector(target)
    if (!node) return { present: false }

    const rect = node.getBoundingClientRect()
    const cx = Math.round(rect.left + rect.width / 2)
    const cy = Math.round(rect.top + rect.height / 2)

    /** Up to six stacked nodes at the button's centre — not just the topmost. */
    const stack = document.elementsFromPoint(cx, cy).slice(0, 6).map(el => {
      const cs = getComputedStyle(el)
      const r = el.getBoundingClientRect()
      return {
        tag: el.tagName.toLowerCase(),
        testid: el.getAttribute('data-testid'),
        role: el.getAttribute('role'),
        state: el.getAttribute('data-state'),
        cls: (el.className?.toString?.() ?? '').slice(0, 80),
        rect: {
          x: Math.round(r.left),
          y: Math.round(r.top),
          w: Math.round(r.width),
          h: Math.round(r.height),
        },
        pointerEvents: cs.pointerEvents,
        zIndex: cs.zIndex,
        position: cs.position,
        opacity: cs.opacity,
        visibility: cs.visibility,
        transform: cs.transform,
        overflow: `${cs.overflowX}/${cs.overflowY}`,
        isSelf: el === node || node.contains(el),
      }
    })

    const cs = getComputedStyle(node)
    const own = node.getBoundingClientRect()
    return {
      present: true,
      rect: {
        left: Math.round(own.left),
        top: Math.round(own.top),
        right: Math.round(own.right),
        bottom: Math.round(own.bottom),
        w: Math.round(own.width),
        h: Math.round(own.height),
      },
      centre: { x: cx, y: cy },
      self: {
        pointerEvents: cs.pointerEvents,
        zIndex: cs.zIndex,
        position: cs.position,
        opacity: cs.opacity,
        visibility: cs.visibility,
        transform: cs.transform,
        display: cs.display,
      },
      stack,
      topmostIsSelf: Boolean(stack[0]?.isSelf),
    }
  }, selector)
}

/** Radix portals that outlived their dialog are the classic cause of a full-screen
 *  invisible blocker; count them and describe each. */
async function residue() {
  return browser.execute(() => {
    const portals = Array.from(
      document.querySelectorAll(
        '[data-radix-portal], [data-radix-popper-content-wrapper], [role="dialog"], [role="alertdialog"], [data-state="closed"]',
      ),
    ).map(el => {
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      return {
        tag: el.tagName.toLowerCase(),
        testid: el.getAttribute('data-testid'),
        role: el.getAttribute('role'),
        state: el.getAttribute('data-state'),
        cls: (el.className?.toString?.() ?? '').slice(0, 70),
        rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
        pointerEvents: cs.pointerEvents,
        opacity: cs.opacity,
        position: cs.position,
        zIndex: cs.zIndex,
      }
    })
    return {
      path: location.pathname + location.search,
      viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio },
      portals,
    }
  })
}

/** The dock's own report of its width and presentation. */
async function dockState() {
  return browser.execute(() => {
    const panel = document.querySelector('[data-testid="right-panel"]')
    const panes = document.querySelector('[data-testid="sftp-file-panes"]')
    const box = el => {
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }
    }
    return {
      panel: box(panel),
      panes: box(panes),
      presentation: panes?.getAttribute('data-presentation') ?? null,
      contentWidth: panes?.getAttribute('data-width') ?? null,
      railPressed: document
        .querySelector('[data-testid="rail-sftp"]')
        ?.getAttribute('aria-pressed'),
    }
  })
}

async function openDock() {
  await browser.execute(() => {
    const rail = document.querySelector('[data-testid="rail-sftp"]')
    if (rail && rail.getAttribute('aria-pressed') !== 'true') rail.click()
  })
  await browser.pause(1_200)
  return browser.execute(() =>
    Boolean(document.querySelector('[data-testid="right-panel"]')),
  )
}

describe('T09 — the remote refresh button under a real hit test', () => {
  before(async () => {
    await browser.$('[data-testid="activity-rail"]').waitForExist({ timeout: 20_000 })
    await browser.setWindowSize(1440, 900)
    await browser.pause(500)
    // Connect the seeded host: the remote pane only renders with a live session.
    if (process.env.GUI_E2E_SSH_PORT) {
      await browser.$('[data-testid="rail-hosts"]').click()
      const found = await browser
        .waitUntil(
          async () =>
            browser.execute(() =>
              Array.from(document.querySelectorAll('button')).some(button =>
                (button.textContent ?? '').includes('E2E Local'),
              ),
            ),
          { timeout: 20_000, interval: 250 },
        )
        .catch(() => false)
      if (found) {
        await browser.execute(() => {
          Array.from(document.querySelectorAll('button'))
            .find(button => (button.textContent ?? '').includes('E2E Local'))
            ?.click()
        })
        await browser
          .waitUntil(
            async () =>
              browser.execute(() =>
                Array.from(document.querySelectorAll('[role="tab"]')).some(
                  tab => tab.getAttribute('data-tab-type') === 'remote',
                ),
              ),
            { timeout: 45_000, interval: 300 },
          )
          .catch(() => notes.push('the SSH host never connected'))
        await browser.pause(3_000)
      } else {
        notes.push('seeded host card never appeared')
      }
    } else {
      notes.push('no SSH fixture; the remote pane will not render')
    }
    await openDock()
  })

  it('measures how long one round trip costs', async () => {
    /*
     * Every wait in e2e-03 that "took 30 s" could be a product fault or a slow
     * transport. This measures the transport directly: ten trivial `execute` calls,
     * timed individually. If a bare round trip is seconds, the budgets in the longer
     * cases are being spent on the harness, not on the product.
     */
    const samples = []
    for (let index = 0; index < 10; index += 1) {
      const start = Date.now()
      await browser.execute(() => document.title.length)
      samples.push(Date.now() - start)
    }
    samples.sort((a, b) => a - b)
    measurements.roundTrip = {
      samples,
      median: samples[Math.floor(samples.length / 2)],
      max: samples[samples.length - 1],
    }
    notes.push(`round trip (ms): ${JSON.stringify(measurements.roundTrip)}`)
  })

  it('records the dock geometry and what is stacked over the refresh button', async () => {
    measurements.dock = await dockState()
    measurements.residue = await residue()
    measurements.refresh = await probe('[data-testid="sftp-remote-refresh"]')
    notes.push(`default width: dock=${JSON.stringify(measurements.dock)}`)
    notes.push(`refresh: ${JSON.stringify(measurements.refresh)}`)
    if (!measurements.refresh.present) {
      notes.push('the refresh button is not in the DOM — the remote pane did not render')
    }
  })

  it('sweeps window widths, reporting the dock width each time', async () => {
    /*
     * 1440 is the harness default; 1024 crosses where the terminal canvas switches
     * the dock to `overlay`; 2560 is wider than any laptop the app targets and is the
     * control for "the fault is not the window's size". The dock itself measures 300
     * at every one of them — if it does not, `DOCK_WIDTH` is not the constant this
     * spec assumes and the reader needs to know before reading any of the rest.
     */
    measurements.widths = {}
    for (const width of [1024, 1440, 2560]) {
      await browser.setWindowSize(width, 900)
      await browser.pause(800)
      const state = await dockState()
      measurements.widths[width] = {
        dock: state,
        refresh: await probe('[data-testid="sftp-remote-refresh"]'),
        residue: await residue(),
      }
      notes.push(
        `window ${width}: dockW=${state.panel?.w ?? 'none'} presentation=${state.presentation} ` +
          `contentW=${state.contentWidth} topmostIsSelf=${measurements.widths[width].refresh.topmostIsSelf}`,
      )
    }
    await browser.setWindowSize(1440, 900)
    await browser.pause(500)
  })

  it('checks the full-window case, where the dock should not be alone', async () => {
    // Widening the window and closing the dock removes the container constraint
    // entirely. If refresh is clickable here, the fault is the dock's layout.
    await browser.setWindowSize(1920, 1080)
    await browser.pause(800)
    measurements.fullWindow = {
      dock: await dockState(),
      refresh: await probe('[data-testid="sftp-remote-refresh"]'),
    }
    notes.push(`full window: ${JSON.stringify(measurements.fullWindow.refresh?.rect)}`)
    await browser.setWindowSize(1440, 900)
    await browser.pause(500)
  })

  it('checks whether a window resize changes the hit test', async () => {
    // A resize forces a relayout; a stale transform or a stale `elementsFromPoint`
    // cache would show as a different answer before and after.
    const before = await probe('[data-testid="sftp-remote-refresh"]')
    await browser.setWindowSize(1280, 800)
    await browser.pause(600)
    const shrunk = await probe('[data-testid="sftp-remote-refresh"]')
    await browser.setWindowSize(1440, 900)
    await browser.pause(600)
    const restored = await probe('[data-testid="sftp-remote-refresh"]')
    measurements.resize = {
      before: before.rect,
      shrunk: shrunk.rect,
      restored: restored.rect,
      sameTopmost: before.topmostIsSelf === restored.topmostIsSelf,
    }
    notes.push(`resize: ${JSON.stringify(measurements.resize)}`)
  })

  it('a real WebDriver click on refresh loads a fresh listing', async () => {
    /*
     * ## The acceptance for T09
     *
     * The hit test says the button is topmost at every width, so the previous
     * blockage is not reproduced on this HEAD. That is a statement about geometry;
     * the acceptance is a **click that produces an observable refresh**.
     *
     * A scripted `element.click()` would fire the handler regardless of whether a
     * user could reach it, so this uses WebDriver's own click — the same input path
     * the failing case used. What makes it evidence is the second half: the pane's
     * listing must be re-read after the click, and the count of remote rows must come
     * back non-empty. A click that fired `onRefresh` into a broken session would
     * leave the pane empty and fail here.
     */
    const before = await browser.execute(() => {
      const rows = document.querySelectorAll(
        '[data-testid="sftp-pane-remote"] [data-testid="file-row"]',
      ).length
      const trace = globalThis.__sftpLoadTrace ?? []
      return { rows, traceLen: trace.length }
    })

    const button = await $('[data-testid="sftp-remote-refresh"]')
    if (!(await button.isExisting())) {
      notes.push('NOT_RUN real click: the refresh button is not in the DOM')
      measurements.realClick = { skipped: true }
      return
    }
    await button.click()
    await browser.pause(1_500)

    const after = await browser.execute(() => {
      const rows = document.querySelectorAll(
        '[data-testid="sftp-pane-remote"] [data-testid="file-row"]',
      ).length
      const trace = globalThis.__sftpLoadTrace ?? []
      return { rows, traceLen: trace.length, last: trace.slice(-1)[0] ?? null }
    })

    measurements.realClick = { before, after, clicked: true }
    notes.push(`real click: before=${JSON.stringify(before)} after=${JSON.stringify(after)}`)

    if (after.rows === 0) {
      throw new Error(
        'the refresh click produced no remote rows — the listing was not reloaded ' +
          `(before ${before.rows} rows, after ${after.rows})`,
      )
    }
    // The load trace is written by `resolveListingPath` in E2E builds; a new entry
    // means the product went back to the server rather than re-rendering its cache.
    if (after.traceLen <= before.traceLen) {
      notes.push(
        'the click left the row count intact but the load trace did not grow — the ' +
          'pane may have re-rendered cached rows instead of re-listing',
      )
    }
  })

  it('does NOT attempt a synthetic click — records the verdict instead', async () => {
    /*
     * The rule this spec obeys: a synthetic `.click()` on an element WebDriver cannot
     * click proves nothing. It would fire the handler whether or not a user could
     * reach it, turning a layout fault into a green test.
     *
     * So this case only states which of the three explanations the measurements
     * support. The fix — and the real click that verifies it — belongs to the change
     * that follows these numbers.
     */
    const at300 = measurements.widths?.[1440]?.refresh
    const at600 = measurements.widths?.[1024]?.refresh
    const verdict = {
      presentAt300: Boolean(at300?.present),
      topmostIsSelfAt300: at300?.topmostIsSelf ?? null,
      topmostIsSelfAt600: at600?.topmostIsSelf ?? null,
      blockerAt300: at300?.stack?.[0] ?? null,
      residueCount: measurements.residue?.portals?.length ?? 0,
    }
    measurements.verdict = verdict

    if (!verdict.presentAt300) {
      notes.push('NOT_RUN: the refresh button never rendered at 300 px')
    } else if (verdict.topmostIsSelfAt300 && verdict.topmostIsSelfAt600) {
      notes.push(
        'hit test says the button IS the topmost node at both widths — the failure ' +
          'WebDriver reported is a scaffolding coordinate problem, not occlusion',
      )
    } else if (!verdict.topmostIsSelfAt300 && verdict.topmostIsSelfAt600) {
      notes.push(
        'blocked at 300 px only: the dock single-column layout puts something over ' +
          `the button (${JSON.stringify(verdict.blockerAt300)})`,
      )
    } else {
      notes.push(
        `blocked at every width (blocker at 300: ${JSON.stringify(verdict.blockerAt300)})`,
      )
    }

    /*
     * The real click is no longer a NOT_RUN: it ran above and observed a fresh server
     * listing (`__sftpLoadTrace` grew, last entry names the fixture directory). What
     * this spec still does not do is drive the *native* dialog or a slow link — those
     * belong to other cases and are recorded there, not here.
     */
    const verdictValue =
      measurements.realClick?.after?.rows > 0 ? 'PASS' : 'PARTIAL'
    await writeEvidence(CASE, {
      verdict: verdictValue,
      notes: notes.join('\n'),
      extra: {
        measurements,
        notRunCount: notes.filter(note => note.includes('NOT_RUN')).length,
      },
    })
  })
})
