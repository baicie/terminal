/**
 * The upload and download actions, including the file pickers.
 *
 * Extracted from `sftp-container.tsx` because that file is at its 200-line limit and
 * because the picker is where the session-lifetime question actually starts: the
 * native dialog can stay open indefinitely, and everything that protects the
 * connection afterwards (`uploadFile`'s claim) only begins once it answers.
 *
 * ## The picker, and the one substitution allowed
 *
 * The dialogs below have one E2E-only alternative, chosen by a **build-time constant**
 * (`VITE_TERMINAL_GUI_E2E`), never by runtime input: `e2eOpenFiles()` /
 * `e2eSaveFile()` return a path a spec staged. Everything after the path — admission,
 * the claim, the queue, the Rust commands, the listing refresh — is the production
 * code below, unchanged. That substitution exists because the native dialog cannot be
 * driven by WebDriver, which is why upload and download had never been exercised
 * through the UI. See `e2e-file-picker.ts` for why it cannot reach a shipped build.
 *
 * What is decided here and nowhere else:
 *
 *   - **While the dialog is open, nothing has claimed the session.** A dock close in
 *     that window genuinely releases the connection, and that is correct: the user
 *     has not committed to a transfer yet. Claiming at the button click would hold a
 *     connection open for a dialog the user might cancel — and it would never be
 *     released on the cancel path unless every exit were wired.
 *   - **A cancelled or failed dialog starts nothing.** No claim, no queue record, no
 *     toast. `open()` answering `null` and `save()` answering `null` are both the
 *     user changing their mind, not an error.
 *   - **A host switch between the dialog opening and answering is caught by the
 *     caller's closure**, not here: `sessionId` is captured at call time, so the
 *     transfer is admitted to the session the panel was showing when the user
 *     clicked. The claim then either succeeds (that connection is still alive) or is
 *     refused (it closed) — both are honest answers, and neither can silently
 *     redirect bytes to the host the user switched *to*.
 */
import { useCallback } from 'react'
import type { FileItem } from '@/service/ssh'
import { downloadFile, uploadPaths } from '@/service/sftp-transfer'

/**
 * Which module answers the picker, chosen at build time.
 *
 * ## Why this is a ternary and not an `if`
 *
 * The first version used `if (import.meta.env.VITE_TERMINAL_GUI_E2E === '1') { await
 * import(…) }`. Measured in a production bundle: **both** branches survived, and the
 * E2E chunk was still fetched at runtime — the branch never fired, so no marker was
 * set and every upload/download GUI case recorded NOT_RUN while the spec printed
 * "6 passing".
 *
 * The difference from the working probe gate is shape, not intent: a ternary that
 * resolves to one module specifier is folded, while a statement *inside* an `async`
 * function gets wrapped in Vite's dynamic-import helper before the condition can be
 * constant-folded. `check-gui-e2e-isolation.mjs` now asserts the marker's presence in
 * an E2E build for exactly this reason — a bundler behaviour that silently keeps dead
 * code is not something a comment can guarantee.
 */
/*
 * A boolean, not a module specifier. `PICKER_MODULE === './hooks/e2e-file-picker'`
 * compiled to a runtime string comparison — Vite folds the env expression into a
 * literal, but minification then compares two literals instead of eliminating the
 * branch, and the E2E chunk stayed in a production bundle.
 *
 * A literal `true`/`false` is what terser can evaluate, and it is the same shape
 * `install-gui-e2e-probe.ts` uses (`!== '1'` → early return).
 */
const USE_E2E_PICKER = import.meta.env.VITE_TERMINAL_GUI_E2E === '1'

/*
 * Announce the capability at the moment the module loads, not when the picker is
 * first reached.
 *
 * The E2E picker itself is a lazy chunk, so a spec that asks "can this build drive
 * the picker?" before clicking upload gets no answer — on a correct build as well as a
 * production one. This module *is* in the main bundle, so a flag here is readable from
 * the first paint, and it is compiled out with the same constant that removes the
 * chunk (asserted in both directions by `check-gui-e2e-isolation.mjs`).
 */
if (USE_E2E_PICKER && typeof globalThis !== 'undefined') {
  ;(globalThis as { __terminalE2EFilePickerBranch?: boolean })
    .__terminalE2EFilePickerBranch = true
}

type UploadPicker = { e2eOpenFiles?: () => Promise<string[] | null>; open?: (options: { multiple: boolean }) => Promise<string | string[] | null> }
type DownloadPicker = { e2eSaveFile?: (name?: string) => Promise<string | null>; save?: (options: { defaultPath: string }) => Promise<string | null> }

async function pickUploadPaths(): Promise<string[] | null> {
  if (USE_E2E_PICKER) {
    const picker = (await import('./hooks/e2e-file-picker')) as UploadPicker
    return picker.e2eOpenFiles!()
  }
  const picker = (await import('@tauri-apps/plugin-dialog')) as UploadPicker
  const selected = await picker.open!({ multiple: true })
  if (!selected) return null
  return Array.isArray(selected) ? selected : [selected]
}

/** Pick the destination for a download. Same split as `pickUploadPaths`. */
async function pickDownloadTarget(defaultPath: string): Promise<string | null> {
  if (USE_E2E_PICKER) {
    const picker = (await import('./hooks/e2e-file-picker')) as DownloadPicker
    return picker.e2eSaveFile!(defaultPath)
  }
  const picker = (await import('@tauri-apps/plugin-dialog')) as DownloadPicker
  return picker.save!({ defaultPath })
}

export interface SftpTransferActions {
  onUpload: () => Promise<void>
  onDownload: (file: FileItem) => Promise<void>
}

export function useSftpTransferActions(args: {
  sessionId: string | null
  remotePath: string
}): SftpTransferActions {
  const { sessionId, remotePath } = args

  const onUpload = useCallback(async () => {
    if (!sessionId) return
    const paths = await pickUploadPaths()
    // Cancelled: nothing to do, and nothing to clean up.
    if (!paths) return
    // No refresh here. `uploadPaths` resolves when the files are *scheduled*, not
    // when they have landed — the listing is refreshed by
    // `useUploadCompletionRefresh` on each transfer's terminal event.
    await uploadPaths({ sessionId, remoteDir: remotePath, localPaths: paths })
  }, [sessionId, remotePath])

  const onDownload = useCallback(
    async (file: FileItem) => {
      if (!sessionId || file.is_directory) return
      const fileName = file.name.split('/').pop() || file.name
      const target = await pickDownloadTarget(fileName)
      if (!target) return
      await downloadFile({
        sessionId,
        remotePath: file.path,
        localPath: target,
        displayName: fileName,
        bytesTotal: file.size,
      })
    },
    [sessionId],
  )

  return { onUpload, onDownload }
}
