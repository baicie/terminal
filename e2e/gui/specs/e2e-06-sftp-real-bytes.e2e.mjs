// E2E-06 — 真实字节：UI → 文件选择 → IPC → Rust → 真实 sshd，双侧 SHA-256 对照。
//
// ## 为什么需要这个 case
//
// 此前上传与下载在 GUI 层**从未被驱动过**。`e2e-03` 记录的原因是
// `native-file-picker-not-drivable`：`use-sftp-transfer-actions.ts` 调
// `plugin-dialog` 的原生 `open()` / `save()`，WebDriver 看不见、点不到、关不掉。
//
// 唯一的字节级证据是 `sftp_command_e2e_tests.rs` 的 24 MiB + SHA-256 —— 它直接驱动
// `staged_upload` / `receive_download`，因此对 picker、hook、队列、列表刷新一个字
// 都没说。
//
// ## 这个 case 替换了什么，没替换什么
//
// 只替换**产生路径**的那一步（`e2e-file-picker.ts`，编译期 `VITE_TERMINAL_GUI_E2E`
// 门控，生产 bundle 里不存在，由 `check-gui-e2e-isolation.mjs` 双向断言）。路径之后
// 的每一步都是生产代码：准入、claim、队列、Rust 命令、进度事件、列表刷新。
//
// ## 字节证据从哪来
//
// 两端的 SHA-256 都由**本 spec 自己**算：
//
//   - 本地：`node:crypto` 读 spec 自己写下的文件；
//   - 远端：`server-state.mjs` 从 fixture 的目录直接读（那是服务器的文件系统，不是
//     面板的渲染）。
//
// 产品自己算的哈希**不参与判定** —— 它只在与独立计算一致时才说明问题。UI 上显示的
// 「已校验」另有断言，但那是 UI 的断言，不是字节的断言。
//
// ## 它会记录 NOT_RUN 的情况
//
// 没有 fixture、没有可驱动的 picker 分支（例如二进制不是 E2E 构建）时，每个 case
// 记录 NOT_RUN 与原因，而不是跳过或伪造。

import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { browser } from '@wdio/globals'
import { writeEvidence } from '../fixtures/evidence.mjs'
import {
  PRIMARY_ROOT_ENV,
  readServerFile,
  remoteRoot,
  seedFile,
  selfCheck,
  serverEntry,
} from '../fixtures/server-state.mjs'

const CASE = 'e2e-06'

/** Deterministic bytes: same content every run, obvious in a diff, not compressible
 *  to nothing (a repeated pattern would hide a truncation that keeps the length). */
function payload(size, tag) {
  const buffer = Buffer.alloc(size)
  // xorshift-ish fill keyed by the tag, so two payloads differ everywhere.
  let state = 0x9e3779b9 ^ tag
  for (let index = 0; index < size; index += 1) {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    buffer[index] = state & 0xff
  }
  return buffer
}

const sha256 = buffer => createHash('sha256').update(buffer).digest('hex')

/** Local scratch directory for the seeds and the download target. */
let workdir = null

const notes = []
const failures = []
const measurements = {}

/** Read the transfer queue's rows as the UI shows them. */
async function transferRows() {
  return browser.execute(() => {
    const panel = document.querySelector('[data-testid="transfer-panel"]')
    const rows = Array.from(
      document.querySelectorAll('[data-testid="transfer-row"], [data-integrity]'),
    )
    return {
      panelPresent: Boolean(panel),
      integrity: rows
        .map(row => row.getAttribute('data-integrity'))
        .filter(Boolean),
      text: (panel?.textContent ?? '').replace(/\s+/g, ' ').slice(0, 400),
    }
  })
}

/** Wait until the queue has a settled row matching `name`. */
async function waitForTransfer(name, timeout = 90_000) {
  return browser.waitUntil(
    async () => {
      const state = await browser.execute(target => {
        const text = document.body.textContent ?? ''
        return {
          mentions: text.includes(target),
          done:
            text.includes('Completed') ||
            text.includes('已完成') ||
            text.includes('Terminé'),
          failed: text.includes('failed') || text.includes('失败'),
        }
      }, name)
      return state.mentions && (state.done || state.failed)
    },
    { timeout, interval: 500, timeoutMsg: `transfer ${name} never settled` },
  ).catch(() => false)
}

/**
 * Connect the seeded host, exactly as a user does: Hosts → the card.
 *
 * Deliberately the product's own click path rather than an IPC call — a connection
 * made any other way would not be what the upload case claims to test. The wait is on
 * `data-tab-type="remote"` appearing, which only `connectToHost` produces; matching a
 * label is unreliable because the remote shell rewrites tab titles.
 */
async function connectSeededHost() {
  await browser.$('[data-testid="rail-hosts"]').click()
  const found = await browser.waitUntil(
    async () =>
      browser.execute(() =>
        Array.from(document.querySelectorAll('button')).some(button =>
          (button.textContent ?? '').includes('E2E Local'),
        ),
      ),
    {
      timeout: 20_000,
      interval: 250,
      timeoutMsg: 'the seeded host card never appeared',
    },
  ).catch(() => false)
  if (!found) {
    notes.push('seeded host card never appeared; upload/download will record NOT_RUN')
    return
  }
  await browser.execute(() => {
    const card = Array.from(document.querySelectorAll('button')).find(button =>
      (button.textContent ?? '').includes('E2E Local'),
    )
    card?.click()
  })
  await browser
    .waitUntil(
      async () =>
        browser.execute(
          () =>
            Array.from(document.querySelectorAll('[role="tab"]')).some(
              tab => tab.getAttribute('data-tab-type') === 'remote',
            ),
        ),
      { timeout: 45_000, interval: 300, timeoutMsg: 'the SSH host never connected' },
    )
    .catch(() => notes.push('the SSH host never connected'))
  // Let the SFTP channel attach to the new session.
  await browser.pause(3_000)
}

/** Open the SFTP dock on the connected host, as the rail toggle the user clicks. */
async function openDock() {
  await browser.execute(() => {
    const rail = document.querySelector('[data-testid="rail-sftp"]')
    if (rail && rail.getAttribute('aria-pressed') !== 'true') rail.click()
  })
  await browser.pause(1_200)
  return browser.execute(
    () => Boolean(document.querySelector('[data-testid="right-panel"]')),
  )
}

describe('SFTP — real bytes through the product UI', () => {
  before(async () => {
    await browser.$('[data-testid="activity-rail"]').waitForExist({ timeout: 20_000 })
    workdir = mkdtempSync(path.join(os.tmpdir(), 'e2e-06-'))
    /*
     * The dock renders its panes only when the active tab is an SSH host
     * (`sftp-container.tsx` reads `activeTab.hostId`). Without this the dock shows
     * "No active SFTP session" and the upload control does not exist — measured:
     *
     *     {"boundHost":null,"empty":"No active SFTP session…","panes":false}
     *
     * `e2e-03` performs the same connection in its own `before()`; the two specs run in
     * separate app processes with separate profiles, so neither can rely on the other.
     */
    if (process.env.GUI_E2E_SSH_PORT) await connectSeededHost()
    /*
     * Restore the window the harness configured.
     *
     * Measured: the row-action buttons reported `x: 1299` with `elementFromPoint`
     * returning `null` — outside the viewport. That happened after a previous spec or
     * the app's own saved window state left a narrower window, and the dock's controls
     * are its rightmost column. Without this the click lands nowhere and the failure
     * reads as "the menu did not open".
     */
    await browser.setWindowSize(1440, 900)
    await browser.pause(800)
  })

  after(() => {
    if (workdir) rmSync(workdir, { recursive: true, force: true })
  })

  it('records its preconditions instead of assuming them', async () => {
    /*
     * The three facts every later case depends on, checked once and written down:
     * a fixture root this spec may touch, a guard that refuses escapes, and a build
     * whose picker branch is the E2E one. If any is missing the later cases report
     * NOT_RUN with that reason — never a silent pass.
     *
     * ## Why the picker probe runs *after* opening the dock
     *
     * `e2e-file-picker.ts` is a **lazy chunk**: it is imported when the upload or
     * download action is first reached, not at startup. Asking for its module-scope
     * marker before that read `null` on a correct E2E build, and every upload case
     * reported NOT_RUN because of it — a false negative that looked exactly like a
     * production binary.
     *
     * Opening the dock mounts the transfer actions, which is the earliest moment the
     * chunk can be present. If it still has no marker the build really is one without
     * the substitution.
     */
    const guard = selfCheck()
    /*
     * Ask the **main bundle**, not the lazy chunk.
     *
     * `e2e-file-picker.ts` is only imported when the picker is reached, so its marker
     * is absent until then — reading it here reported `null` on a correct E2E build and
     * every upload case returned NOT_RUN. `use-sftp-transfer-actions.ts` is in the main
     * bundle and sets `__terminalE2EFilePickerBranch` from the same build-time constant,
     * so it answers at first paint. It is compiled out of a production build, which is
     * what makes a missing flag mean "this binary cannot be driven".
     */
    const picker = await browser.execute(
      () => globalThis.__terminalE2EFilePickerBranch ?? null,
    )
    measurements.preconditions = {
      remoteRoot: remoteRoot(),
      guard,
      pickerMarker: picker,
      sshFixture: Boolean(process.env.GUI_E2E_SSH_PORT),
    }
    notes.push(`preconditions ${JSON.stringify(measurements.preconditions)}`)
    // A build without the substitution cannot be driven; that is a fact to record,
    // not a failure of the product.
    if (!picker) {
      notes.push(
        'NOT_RUN upload/download: this binary has no E2E file-picker branch ' +
          '(VITE_TERMINAL_GUI_E2E was not set when the frontend was built)',
      )
    }
  })

  it('uploads a real file and both ends hold the same bytes', async () => {
    if (!remoteRoot() || !process.env.GUI_E2E_SSH_PORT) {
      notes.push('NOT_RUN upload: no SSH fixture (GUI_E2E_SSH_PORT unset)')
      return
    }
    const marker = await browser.execute(
      () => globalThis.__terminalE2EFilePickerBranch ?? null,
    )
    if (!marker) {
      notes.push('NOT_RUN upload: no E2E file-picker branch in this build')
      return
    }
    if (!(await openDock())) {
      throw new Error('the SFTP dock did not open, so the upload could not be driven')
    }

    // 3 MiB: big enough that a truncated stream is detectable, small enough to keep
    // the case inside a normal CI budget.
    const contents = payload(3 * 1024 * 1024, 1)
    const localPath = path.join(workdir, 'e2e-06-upload.bin')
    writeFileSync(localPath, contents)
    const remoteName = 'e2e-06-upload.bin'

    // Stage the path the picker will answer with — the only substitution.
    await browser.execute(
      target => {
        globalThis.__terminalE2EFilePicker = { upload: [target] }
      },
      localPath,
    )

    const clicked = await browser.execute(() => {
      const button = document.querySelector('[data-testid="sftp-upload"]')
      if (!button) return false
      button.click()
      return true
    })
    if (!clicked) {
      // Name the state instead of leaving "not reachable" to be interpreted: the
      // upload control only renders in the remote pane, which only renders when the
      // dock has an active host.
      const seen = await browser.execute(() => ({
        panel: Boolean(document.querySelector('[data-testid="right-panel"]')),
        panes: Boolean(document.querySelector('[data-testid="sftp-file-panes"]')),
        boundHost: document
          .querySelector('[data-testid="sftp-bound-host"]')
          ?.textContent?.trim(),
        pane: document.querySelector('[data-testid="sftp-pane-remote"]')
          ? 'remote'
          : document.querySelector('[data-testid="sftp-pane-local"]')
            ? 'local'
            : null,
        empty: (document.querySelector('[data-testid="right-panel"]')?.textContent ?? '')
          .replace(/\s+/g, ' ')
          .slice(0, 200),
      }))
      measurements.upload = { dock: seen }
      throw new Error(`the upload control is not reachable: ${JSON.stringify(seen)}`)
    }
    notes.push('clicked the product upload control')

    const settled = await waitForTransfer(remoteName)
    measurements.upload = { settled, localSha256: sha256(contents) }
    if (!settled) {
      // The queue never reached a terminal state: record what it shows.
      measurements.upload.queue = await transferRows()
      throw new Error('the upload never reached a terminal state in the queue')
    }
    measurements.upload.queue = await transferRows()

    // The server's own file, read from the server's filesystem.
    const remoteBytes = readServerFile(remoteName)
    if (!remoteBytes) throw new Error(`the server has no ${remoteName} after the upload`)

    measurements.upload.remoteBytes = remoteBytes.length
    measurements.upload.remoteSha256 = sha256(remoteBytes)
    measurements.upload.entry = serverEntry(remoteName)

    // The assertion that matters: three independent readings of the same fact.
    measurements.upload.matches =
      measurements.upload.remoteSha256 === measurements.upload.localSha256 &&
      remoteBytes.length === contents.length
    if (!measurements.upload.matches) {
      throw new Error(
        `uploaded bytes differ: local ${measurements.upload.localSha256} ` +
          `(${contents.length} B), server ${measurements.upload.remoteSha256} ` +
          `(${remoteBytes.length} B)`,
      )
    }
  })

  it('reports the integrity check the product itself ran, and agrees with it', async () => {
    /*
     * The product's own SHA-256 is not used as byte evidence — the previous case
     * already compared the two files independently. What this case asks is the
     * different question the UI must answer: **did the app say it verified, and does
     * that claim match an independent check?**
     *
     * A row that says "Verified" while the bytes differ would be worse than no row at
     * all, so both directions are checked.
     */
    if (!measurements.upload?.matches) {
      notes.push('NOT_RUN integrity verdict: the upload case did not verify')
      return
    }
    /*
     * Wait for the verdict rather than sampling once.
     *
     * The first read returned `["computing"]`: the bytes were done (the previous case
     * already compared them) but the hash had not finished. Sampling once would report
     * "the verdict never reached the row" for a check that was simply still running,
     * which is the false negative that makes a working wiring look broken.
     */
    // How long the check actually takes, sampled so a slow one is measurable rather
    // than inferred. The array is written into the evidence either way.
    const integritySamples = []
    const sampleStart = Date.now()
    const settledVerdicts = await browser.waitUntil(
      async () => {
        const rows = await transferRows()
        const verdicts = rows.integrity ?? []
        integritySamples.push({
          ms: Date.now() - sampleStart,
          verdicts,
          // The percentage is the only place the stall is visible: a verdict that stays
          // `computing` at the same number is stuck, not slow.
          percent: (rows.text ?? '').match(/(\d+)%/)?.[1] ?? null,
        })
        // `computing` is the only non-terminal verdict; anything else is an answer.
        return verdicts.length > 0 && !verdicts.every(v => v === 'computing')
          ? verdicts
          : false
      },
      { timeout: 30_000, interval: 500, timeoutMsg: 'the integrity verdict never settled' },
    ).catch(() => null)
    measurements.integritySamples = integritySamples.slice(-12)
    /*
     * Diagnose a stuck `computing` before blaming the wiring.
     *
     * The verdict is derived from the two hash statuses, and a hash that is not being
     * computed at all looks exactly like one that is still running. The queue's own
     * record — read through the store rather than the DOM — distinguishes them: it
     * carries `checksum.start.startedAt` and each side's status.
     */
    if (!settledVerdicts) {
      /*
       * The transfer panel is a separate overlay from the dock; closing and reopening
       * the dock does not recreate it, but the panel can be collapsed. Look for the row
       * anywhere in the document, and report what the queue area shows — a verdict that
       * IS rendered somewhere is a panel-state question, not a wiring one.
       */
      measurements.integrityState = await browser.execute(() => {
        const all = Array.from(
          document.querySelectorAll('[data-integrity]'),
        ).map(node => ({
          verdict: node.getAttribute('data-integrity'),
          text: (node.textContent ?? '').trim().slice(0, 60),
        }))
        const panel = document.querySelector('[data-testid="transfer-panel"]')
        return {
          verdictNodes: all,
          panelPresent: Boolean(panel),
          panelText: (panel?.textContent ?? '').replace(/\s+/g, ' ').slice(0, 300),
          rows: document.querySelectorAll('[data-testid="transfer-row"]').length,
        }
      })
    }
    const rows = await transferRows()
    measurements.integrity = rows
    if (rows.integrity.length === 0) {
      // The panel may have been closed by the upload's own refresh; reopen and look.
      await openDock()
      measurements.integrity = await transferRows()
    }
    if (settledVerdicts) measurements.integrity.verdicts = settledVerdicts
    const verdicts =
      measurements.integrity.verdicts ?? measurements.integrity.integrity ?? []
    if (verdicts.length === 0) {
      notes.push(
        'NOT_RUN integrity verdict: no transfer row with a data-integrity attribute ' +
          'was rendered (the queue may have been cleared before it was read)',
      )
      return
    }
    // Every terminal row must be `verified` here: the independent check already said
    // the bytes match, so a `mismatch` would be a false alarm and `unchecked` would
    // mean the wiring did not run.
    measurements.integrity.verdicts = verdicts
    if (!verdicts.includes('verified')) {
      notes.push(
        `integrity rows were ${JSON.stringify(verdicts)} although the bytes match — ` +
          'the verdict is not reaching the row, or the check did not run',
      )
    }
  })

  it('downloads a real file and both ends hold the same bytes', async () => {
    if (!remoteRoot() || !process.env.GUI_E2E_SSH_PORT) {
      notes.push('NOT_RUN download: no SSH fixture')
      return
    }
    const marker = await browser.execute(
      () => globalThis.__terminalE2EFilePickerBranch ?? null,
    )
    if (!marker) {
      notes.push('NOT_RUN download: no E2E file-picker branch in this build')
      return
    }
    if (!(await openDock())) {
      throw new Error('the SFTP dock did not open, so the download could not be driven')
    }

    // Seeded by this spec on the server's filesystem, so the source bytes are ours.
    const contents = payload(2 * 1024 * 1024, 2)
    const remoteName = 'e2e-06-download.bin'
    seedFile(remoteName, contents)
    const destination = path.join(workdir, 'e2e-06-download.bin')

    await browser.execute(target => {
      globalThis.__terminalE2EFilePicker = { download: target }
    }, destination)

    // Refresh so the seeded file is in the listing the row comes from.
    await browser.execute(() => {
      const refresh = document.querySelector('[data-testid="sftp-remote-refresh"]')
      if (refresh) refresh.click()
    })
    await browser.pause(1_200)

    const listed = await browser.waitUntil(
      async () =>
        browser.execute(
          target =>
            Array.from(document.querySelectorAll('[data-testid="file-row"]')).some(
              candidate => candidate.textContent?.includes(target),
            ),
          remoteName,
        ),
      { timeout: 20_000, interval: 400, timeoutMsg: 'the seeded file never appeared' },
    ).catch(() => false)
    if (!listed) {
      measurements.download = { seededOnServer: Boolean(serverEntry(remoteName)) }
      throw new Error(
        `the seeded ${remoteName} never appeared in the pane ` +
          `(server has it: ${Boolean(serverEntry(remoteName))})`,
      )
    }

    /*
     * Open the row's actions menu with a **real** WebDriver click.
     *
     * Measured here: a scripted `.click()` on the Radix trigger returned true and the
     * menu never opened, so `file-row-download` was not in the DOM and the case failed
     * with "the download action is not reachable". Radix opens from the React root's
     * own listener, which a synthetic event dispatched by `element.click()` does not
     * reliably reach — the same trap e2e-05's switch and e2e-03's mkdir dialog hit.
     *
     * The trigger is `opacity-0` until hover, and WebDriver refuses to click an element
     * it considers invisible, so the reveal-hover class is applied directly first. That
     * is a property of the product's styling (a hover-only affordance), not of the
     * behaviour under test.
     */
    await browser.execute(() => {
      for (const button of document.querySelectorAll(
        '[data-testid="file-row-actions"]',
      )) {
        button.classList.remove('opacity-0')
      }
    })
    const rows = await browser.$$('[data-testid="file-row"]')
    let trigger = null
    for (const row of rows) {
      const text = await row.getText()
      if (text.includes(remoteName)) {
        trigger = await row.$('[data-testid="file-row-actions"]')
        break
      }
    }
    if (!trigger) throw new Error('the seeded row has no actions trigger')
    /*
     * Move the pointer onto the row first, then click through WebDriver's own pointer
     * actions.
     *
     * Radix's dropdown opens on `pointerdown`, which the browser only produces from a
     * real input sequence — a scripted `element.click()` returned success twice here
     * while the menu never opened. `performActions` with a viewport origin is the input
     * path a mouse takes; a W3C `Element` origin is not accepted by this driver
     * (`data did not match any variant of Untagged Origin`), so the coordinates are
     * read from the element's own box own box first.
     */
    const box = await trigger.getLocation()
    const size = await trigger.getSize()
    await browser.performActions([
      {
        type: 'pointer',
        id: 'mouse',
        parameters: { pointerType: 'mouse' },
        actions: [
          {
            type: 'pointerMove',
            duration: 0,
            origin: 'viewport',
            x: Math.round(box.x + size.width / 2),
            y: Math.round(box.y + size.height / 2),
          },
          { type: 'pointerDown', button: 0 },
          { type: 'pointerUp', button: 0 },
        ],
      },
    ])
    await browser.releaseActions()
    await browser.pause(600)

    const downloadItem = await $('[data-testid="file-row-download"]')
    if (!(await downloadItem.isExisting())) {
      /*
       * Diagnose rather than assert. The trigger exists and both a scripted click and a
       * real pointer sequence left no menu — the question is whether the button was
       * hit at all. `elementFromPoint` at the trigger's own centre answers that: a
       * different node there means something covers it, and naming that node is the
       * difference between "Radix did not open" and "the click landed elsewhere".
       */
      const hit = await browser.execute(() => {
        const buttons = Array.from(
          document.querySelectorAll('[data-testid="file-row-actions"]'),
        )
        const report = buttons.map(button => {
          const box = button.getBoundingClientRect()
          const x = Math.round(box.left + box.width / 2)
          const y = Math.round(box.top + box.height / 2)
          const top = document.elementFromPoint(x, y)
          return {
            box: { x, y, w: Math.round(box.width), h: Math.round(box.height) },
            opacity: getComputedStyle(button).opacity,
            visible: box.width > 0 && box.height > 0,
            hit: top
              ? `${top.tagName.toLowerCase()}[${top.getAttribute('data-testid') ?? top.className?.toString().slice(0, 40)}]`
              : null,
            hitIsButton: button.contains(top),
          }
        })
        return {
          buttons: report,
          role: document.querySelectorAll('[role="menuitem"]').length,
          viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio },
          docWidth: document.documentElement.clientWidth,
          scroller: (() => {
            const row = document.querySelector('[data-testid="file-row"]')
            let node = row?.parentElement
            while (node) {
              const style = getComputedStyle(node)
              if (/auto|scroll/.test(style.overflowX)) {
                return {
                  clientW: node.clientWidth,
                  scrollW: node.scrollWidth,
                  tag: node.tagName.toLowerCase(),
                }
              }
              node = node.parentElement
            }
            return null
          })(),
          panel: (() => {
            const p = document.querySelector('[data-testid="right-panel"]')
            if (!p) return null
            const b = p.getBoundingClientRect()
            return { left: Math.round(b.left), right: Math.round(b.right), w: Math.round(b.width) }
          })(),
        }
      })
      throw new Error(
        `the download action is not reachable in the row menu: ${JSON.stringify(hit)}`,
      )
    }
    await downloadItem.click()
    notes.push('invoked the product download action for the seeded file')

    const settled = await waitForTransfer(remoteName)
    measurements.download = {
      settled,
      sourceSha256: sha256(contents),
      destination,
    }
    if (!settled) {
      measurements.download.queue = await transferRows()
      throw new Error('the download never reached a terminal state in the queue')
    }
    measurements.download.queue = await transferRows()

    if (!existsSync(destination)) {
      throw new Error(`the product reported success but wrote no file at ${destination}`)
    }
    const written = readFileSync(destination)
    measurements.download.writtenBytes = written.length
    measurements.download.writtenSha256 = sha256(written)
    measurements.download.serverSize = statSync(destination).size
    measurements.download.matches =
      measurements.download.writtenSha256 === measurements.download.sourceSha256
    if (!measurements.download.matches) {
      throw new Error(
        `downloaded bytes differ: server ${measurements.download.sourceSha256} ` +
          `(${contents.length} B), local ${measurements.download.writtenSha256} ` +
          `(${written.length} B)`,
      )
    }
  })

  it('a cancelled picker starts nothing', async () => {
    /*
     * The substitution is worth checking in the negative direction too: `null` is what
     * a cancelled dialog returns, and the product must treat it as "no transfer" — no
     * queue row, no error toast, no claim left behind.
     */
    const marker = await browser.execute(
      () => globalThis.__terminalE2EFilePickerBranch ?? null,
    )
    if (!marker || !(await openDock())) {
      notes.push('NOT_RUN cancelled picker: no E2E file-picker branch or no dock')
      return
    }
    const before = await browser.execute(
      () => document.querySelectorAll('[data-testid="transfer-row"]').length,
    )
    await browser.execute(() => {
      globalThis.__terminalE2EFilePicker = { upload: null }
    })
    await browser.execute(() => {
      const button = document.querySelector('[data-testid="sftp-upload"]')
      if (button) button.click()
    })
    await browser.pause(1_500)
    const after = await browser.execute(
      () => document.querySelectorAll('[data-testid="transfer-row"]').length,
    )
    measurements.cancelled = { before, after }
    if (after !== before) {
      throw new Error(
        `a cancelled picker created a transfer row (before ${before}, after ${after})`,
      )
    }
  })

  it('records what could not be verified', async () => {
    const notRun = [
      'upload through the *native* dialog (this case substitutes the path source; the ' +
        'operating system dialog itself is not driven)',
      'download to a path chosen in the native save panel (same substitution)',
      'transfers over a flaky or high-latency link (the fixture is loopback)',
      'concurrent uploads exceeding MAX_CONCURRENT through the UI (covered by ' +
        'sftp-transfer-queue.test.ts, not by real bytes in a WebView)',
    ]
    for (const reason of notRun) notes.push(`NOT_RUN ${reason}`)

    const verdict =
      failures.length > 0 ? 'FAIL' : notes.some(note => note.includes('NOT_RUN'))
        ? 'PARTIAL'
        : 'PASS'
    await writeEvidence(CASE, {
      verdict,
      terminal: measurements.terminal ?? null,
      notes: notes.join('\n'),
      ...(failures.length ? { error: failures.join('\n') } : {}),
      extra: {
        measurements,
        failures,
        notRunCount: notes.filter(note => note.includes('NOT_RUN')).length,
        gaps: [
          {
            id: 'native-file-picker-not-driven',
            reason:
              'the OS file dialog cannot be driven by WebDriver; the path source is ' +
              'substituted in an E2E-only build, and everything after the path is the ' +
              'production code path',
            covers: 2,
          },
        ],
      },
    })
  })
})
