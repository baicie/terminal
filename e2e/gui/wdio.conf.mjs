/**
 * Native GUI E2E — WebdriverIO configuration.
 *
 * This drives the **real Tauri WebView** (WKWebView on macOS, WebKitGTK on
 * Linux, WebView2 on Windows) through the in-process WebDriver HTTP server that
 * the `gui-e2e` Cargo feature compiles in. It is not Playwright, not a Chrome
 * page against a dev server, and not an accessibility-screenshot loop.
 *
 * ## Why `@wdio/tauri-service` and not a hand-rolled launcher
 *
 * The first PoC spawned the app itself and called `webdriverio.remote()`
 * directly. That worked (a session against `browserName: 'tauri'` came up and
 * `142×39` was read from the real DOM), but WebdriverIO's *runner* refuses to
 * start a worker whose capability names an unknown browser, so the spec could
 * never run under `wdio run`. The service owns exactly that integration and is
 * the supported path; the PoC is preserved in
 * `docs/testing/native-gui-e2e.md §PoC`.
 *
 * ## Isolation
 *
 * `wdio:tauriServiceOptions.env` is how the app gets a throwaway HOME. Without
 * it the app would open the developer's real database, vault and SSH keys.
 * `scripts/run-gui-e2e.mjs` creates the directory and exports the paths.
 *
 * ## Security posture
 *
 * Deliberately **not** installed: `tauri-plugin-wdio`. It requires
 * `withGlobalTauri` plus `wdio:allow-execute`, both of which the task forbids in
 * a product build. The embedded `tauri-plugin-wdio-webdriver` grants no IPC
 * permission; its ACL set is empty.
 */
import path from 'node:path'
import process from 'node:process'
import { appBinaryPath, isolatedProfileEnv } from '../../scripts/gui-e2e-platform.mjs'

const ROOT = path.resolve(import.meta.dirname, '../..')
const BINARY = process.env.GUI_E2E_BINARY ?? appBinaryPath(ROOT)
const HOME = process.env.GUI_E2E_HOME

if (!HOME) {
  throw new Error(
    'GUI_E2E_HOME is not set. Run through `node scripts/run-gui-e2e.mjs` so the app ' +
      'gets a throwaway profile instead of your real one.',
  )
}

// Windows keeps user state in USERPROFILE/APPDATA/LOCALAPPDATA, not only HOME.
// Passing the full set is what stops the app reading a developer's real Vault.
const profileEnv = isolatedProfileEnv(HOME)

export const config = {
  runner: 'local',
  maxInstances: 1,
  specs: ['./specs/**/*.e2e.mjs'],
  logLevel: process.env.GUI_E2E_LOG_LEVEL ?? 'warn',
  bail: 0,
  waitforTimeout: 20_000,
  connectionRetryTimeout: 180_000,
  connectionRetryCount: 2,
  framework: 'mocha',
  reporters: [
    'spec',
    [
      'json',
      {
        outputDir: path.join(import.meta.dirname, 'artifacts/json'),
        outputFileFormat: options => `wdio-${options.cid}-${Date.now()}.json`,
      },
    ],
  ],
  mochaOpts: {
    ui: 'bdd',
    timeout: 240_000,
  },
  services: [
    [
      '@wdio/tauri-service',
      {
        // Embedded = the in-process W3C server from `tauri-plugin-wdio-webdriver`.
        // The only provider that works on macOS without a CrabNebula subscription.
        driverProvider: 'embedded',
        appBinaryPath: BINARY,
        // The app must never see the developer's real profile.
        env: {
          ...profileEnv,
          RUST_LOG: process.env.RUST_LOG ?? 'info',
        },
        startTimeout: 120_000,
      },
    ],
  ],
  capabilities: [
    {
      browserName: 'tauri',
      'tauri:options': {
        application: BINARY,
      },
      // Window geometry the layout specs care about. The task's matrix starts at
      // 1440 CSS px; the app's own config default is 1200×800, so the specs set
      // the size explicitly through WebDriver rather than relying on it.
      'tauri:windowOptions': {
        width: 1440,
        height: 900,
      },
    },
  ],

  /**
   * Put the UI into the baseline every spec is written against.
   *
   * ## The defect this fixes
   *
   * `maxInstances: 1` means one app process serves every spec in the run, so each
   * spec inherited whatever the previous one left behind. Measured: running
   * `e2e-03 → e2e-01 → e2e-02` failed 5 cases, because `e2e-03` ends with the dock
   * open on a connected SSH host and `e2e-01`'s "exactly one terminal workbench"
   * then sees two tabs and a dock. The suite passed only in the one order it was
   * written in.
   *
   * The contract belongs here rather than in each spec because it is a property of
   * the *runner* (one process, many specs), not of a spec's subject. It is
   * enforced by acting on the DOM, which is the only surface every spec agrees on:
   *
   *   * the right dock is closed (the `rail-sftp` toggle reports `aria-pressed`);
   *   * the app is on `/terminal`, the route that owns the canvas.
   *
   * ## What it deliberately does not touch
   *
   * Connection tabs. Closing one does not dispose its PTY, so a spec that counts
   * `[data-terminal-workbench]` nodes would still see two — measured: a baseline
   * that closed the extra tab left `e2e-01` failing `mounts exactly one terminal
   * workbench`. Tidying the tab list is therefore not a reset; it is a change of
   * state that some specs observe on purpose.
   *
   * `e2e-01` is the one spec that measures the launch state, so it is declared to
   * require a fresh profile and the runner gives it one: `scripts/run-gui-e2e.mjs`
   * starts a new app process and a new throwaway HOME per run, and `e2e-01` is the
   * first spec in the default order. Running it after another spec that opened
   * connections is out of contract, and the evidence records what it saw rather
   * than pretending the state was clean.
   */
  /**
   * Hand every spec the *authoritative* error for a failed test.
   *
   * ## Why a runner hook instead of `this.currentTest.err`
   *
   * Measured on run 44694682531: the spec's own `afterEach` recorded
   * `(no error text for "creates, renames and deletes…")` in the evidence file, while
   * the same run's console log carried the exact cause —
   * `element ("[data-testid="file-row-rename"]") still not existing after 5000ms`.
   *
   * The text existed; `this.currentTest.err` was empty when `afterEach` ran. A record
   * that says only "no error text" cost a round trip through the artifact to learn a
   * one-line fact.
   *
   * wdio passes the same error to `afterTest` in its third argument, where the reporter
   * reads it. That is the source to record.
   *
   * ## Why `process`, not `globalThis`
   *
   * The hook runs in wdio's worker process; the spec runs in the same one, but neither
   * shares scope with the other. `process` is the object both already hold — and it is
   * per-worker, so two specs cannot read each other's error. `globalThis` would work
   * inside one process too, but `process.env`-style sharing makes the intent obvious
   * and survives a future move to a different hook scope.
   */
  afterTest: async function (test, _context, result) {
    const error = result?.error
    if (!error) {
      delete process.__guiE2ELastError
      return
    }
    const text =
      (typeof error === 'string' ? error : undefined) ??
      error?.message ??
      (error?.stack ? String(error.stack).split('\n')[0] : undefined) ??
      (() => {
        try {
          return JSON.stringify(error)
        } catch {
          return `<unserialisable ${typeof error}>`
        }
      })()
    process.__guiE2ELastError = { title: test?.title ?? null, text: text || '(empty)' }
  },

  /*
   * ## Why every case spent 18 s inside `element.click()`
   *
   * Measured on e2e-03: `waitForClickable` resolved in 11–13 ms and the click that
   * followed took **18 010 ms**, four times in one case. The run logged **69** lines
   * of `Tauri core.invoke not available after 5s timeout` — 5 s each, in front of
   * `$`, `$$`, `findElement` and `elementClick`.
   *
   * The cause is `@wdio/tauri-service`'s `beforeCommand`: for those commands it calls
   * `ensureActiveWindowFocus`, which asks the app for its window states over
   * `core.invoke`. This build deliberately does **not** install `tauri-plugin-wdio`
   * (it would need `withGlobalTauri` and `wdio:allow-execute`, both forbidden in a
   * product build — see docs/testing/native-gui-e2e.md), so that invoke is answered by
   * nothing and every check waits out its 5 s timeout.
   *
   * The service already has an escape hatch: `ensureActiveWindowFocus` returns
   * immediately once the session is marked as a user-chosen window
   * (`userSwitchedWindowCache`). `switchToWindow` sets it. One call here costs a
   * single timeout and removes one per command for the rest of the session.
   *
   * What this does not change: no `waitUntil` timeout, no assertion, no click target.
   * The budget a case spends on the *product* is unchanged; only the budget it was
   * wasting on a call this build cannot answer goes away.
   */
  before: async function () {
    try {
      const handles = await browser.getWindowHandles()
      if (handles.length > 0) await browser.switchToWindow(handles[0])
    } catch (error) {
      // Not fatal: the cost is the 5 s timeout per command returning, which makes the
      // suite slow rather than wrong.
      console.warn('[gui-e2e] could not pre-set the active window:', String(error).slice(0, 200))
    }
  },

  beforeSuite: async function () {
    const reset = await browser.execute(() => {
      const report = { closedDock: false, pathname: window.location.pathname }
      const rail = document.querySelector('[data-testid="rail-sftp"]')
      if (rail && rail.getAttribute('aria-pressed') === 'true') {
        rail.click()
        report.closedDock = true
      }
      return report
    })
    await browser.execute(() => {
      if (window.location.pathname !== '/terminal') {
        window.history.pushState({}, '', '/terminal')
        window.dispatchEvent(new PopStateEvent('popstate'))
      }
    })
    console.log('[gui-e2e] baseline reset ' + JSON.stringify(reset))
    /*
     * ## Poll for the route to *hold*, instead of sleeping 600 ms
     *
     * Measured on run 45937332982: the `pushState` above lands, and then the app's own
     * bootstrap settles on `/` on macOS — every spec from the third onward logged
     * `baseline reset {"pathname":"/"}` and ran against the Hosts route. Linux and Windows
     * on the same commit stayed on `/terminal` for all twelve specs.
     *
     * A fixed 600 ms sleep cannot distinguish "the app has finished deciding" from "the
     * app has not decided yet". Nor can a single poll: the interesting failure is the
     * route being correct now and wrong 300 ms later, so the condition is **the same
     * correct answer on several consecutive polls**. The push is re-applied on every poll
     * so a late `navigate('/')` is corrected rather than merely observed.
     *
     * Bounded, and it does not hide a defect: a route that never holds is logged, and each
     * spec's own readiness wait is still what decides its verdict.
     */
    let consecutive = 0
    try {
      await browser.waitUntil(
        async () => {
          const path = await browser.execute(() => {
            if (window.location.pathname !== '/terminal') {
              window.history.pushState({}, '', '/terminal')
              window.dispatchEvent(new PopStateEvent('popstate'))
            }
            return window.location.pathname
          })
          consecutive = path === '/terminal' ? consecutive + 1 : 0
          return consecutive >= 6
        },
        { timeout: 15_000, interval: 250 },
      )
    } catch {
      console.warn(
        '[gui-e2e] the app did not stay on /terminal; the previous 600 ms settle is what ' +
          'each spec now gets, and its own readiness wait decides the verdict',
      )
    }
    // A short settle after the route holds, so the next spec's first read sees the DOM
    // that route renders rather than the one it replaced.
    await browser.pause(600)
  },
}
