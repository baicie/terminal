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
}
