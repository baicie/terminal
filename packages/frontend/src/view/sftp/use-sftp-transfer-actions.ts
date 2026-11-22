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
 * Pick local files to upload: the real dialog, or — in a GUI E2E build only — the
 * path a spec staged. The literal comparison is what lets the bundler drop the
 * import; see `e2e-file-picker.ts`.
 */
async function pickUploadPaths(): Promise<string[] | null> {
  if (import.meta.env.VITE_TERMINAL_GUI_E2E === '1') {
    const { e2eOpenFiles } = await import('./hooks/e2e-file-picker')
    return e2eOpenFiles()
  }
  const { open } = await import('@tauri-apps/plugin-dialog')
  const selected = await open({ multiple: true })
  if (!selected) return null
  return Array.isArray(selected) ? selected : [selected]
}

/** Pick the destination for a download. Same split as `pickUploadPaths`. */
async function pickDownloadTarget(defaultPath: string): Promise<string | null> {
  if (import.meta.env.VITE_TERMINAL_GUI_E2E === '1') {
    const { e2eSaveFile } = await import('./hooks/e2e-file-picker')
    return e2eSaveFile(defaultPath)
  }
  const { save } = await import('@tauri-apps/plugin-dialog')
  return save({ defaultPath })
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
