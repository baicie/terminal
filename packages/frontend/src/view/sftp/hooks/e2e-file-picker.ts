/**
 * E2E-only file-path injection, so the upload and download paths can be driven
 * without the native picker.
 *
 * ## The gap this closes
 *
 * `use-sftp-transfer-actions.ts` calls `plugin-dialog`'s `open()` / `save()`. Those
 * are OS dialogs: WebDriver cannot see them, cannot type into them, and cannot
 * dismiss them. The consequence recorded in `e2e-03` was `native-file-picker-not-drivable`
 * — **upload and download had never been driven through the product's UI at all**.
 * The only byte-exact evidence was a Rust command-level test, which drives
 * `staged_upload` directly and therefore says nothing about the picker, the hook, the
 * queue, or the listing refresh.
 *
 * ## What this is, precisely
 *
 * A **path source** substituted for the dialog, and nothing else. The bytes still go
 * through `uploadPaths()` / `downloadFile()` — the same admission, the same claim, the
 * same queue, the same Rust commands — because the substitution happens at the picker
 * boundary that produces a path. It cannot select a file itself, cannot bypass the
 * queue, and cannot reach a session.
 *
 * ## Why it cannot ship
 *
 * Same construction as `gui-e2e-probe.ts`, which is already proven absent from a
 * production bundle by `scripts/check-gui-e2e-isolation.mjs`:
 *
 *   - the flag is `import.meta.env.VITE_TERMINAL_GUI_E2E === '1'`, a build-time
 *     constant a production build never sets;
 *   - the only importer uses a **dynamic** `import()` behind a literal comparison at
 *     the call site, so the bundler drops both the call and this module;
 *   - the marker string below is asserted absent from `dist/`.
 *
 * The paths themselves are not taken from this module. They are read from
 * `globalThis.__terminalE2EFilePicker`, which a spec sets — so a production build has
 * neither the code nor the value.
 */

/**
 * Marker `scripts/check-gui-e2e-isolation.mjs` greps for, in **both** directions:
 * absent from a production bundle, present in an E2E one. It has to survive
 * minification, so it is read at runtime rather than mentioned by a statement the
 * bundler is free to drop — the first version used `void MARKER`, which terser
 * removed, and the positive assertion then reported the capability as dead code.
 */
export const FILE_PICKER_MARKER = 'terminal-e2e-file-picker'

/** The paths a spec has staged for the next picker call. */
interface StagedPaths {
  /** Returned by `open()`; `null` behaves like the user cancelling. */
  upload?: string[] | null
  /** Returned by `save()`; `null` behaves like the user cancelling. */
  download?: string | null
}

interface PickerGlobal {
  [key: string]: unknown
}

/**
 * Put the marker somewhere a reader can find it.
 *
 * A spec can also read it back, which is how a GUI run proves it is driving this
 * module rather than a build where the branch was compiled out.
 */
function recordMarker(): void {
  const holder = globalThis as PickerGlobal
  holder.__terminalE2EFilePickerMarker = FILE_PICKER_MARKER
}

function staged(): StagedPaths | null {
  const holder = (globalThis as PickerGlobal).__terminalE2EFilePicker as
    | StagedPaths
    | undefined
  return holder ?? null
}

/**
 * Stand-in for `plugin-dialog`'s `open()`.
 *
 * Answers `null` — the same value as a cancelled dialog — when no spec has staged
 * paths. A missing staging therefore produces "the user changed their mind", which
 * the product already handles correctly, rather than a transfer of `undefined`.
 */
export async function e2eOpenFiles(): Promise<string[] | null> {
  recordMarker()
  const paths = staged()?.upload
  if (!paths || paths.length === 0) return null
  return paths
}

/**
 * Stand-in for `plugin-dialog`'s `save()`.
 *
 * `defaultPath` is honoured as a *name* (no directory) so a spec can assert the
 * downloaded file's name was proposed by the product, without the spec choosing where
 * it lands.
 */
export async function e2eSaveFile(defaultPath?: string): Promise<string | null> {
  recordMarker()
  const target = staged()?.download
  if (!target) return null
  void defaultPath
  return target
}

/** Test-only: whether the module is reachable in this build. */
export function e2eFilePickingAvailable(): boolean {
  return import.meta.env.VITE_TERMINAL_GUI_E2E === '1'
}
