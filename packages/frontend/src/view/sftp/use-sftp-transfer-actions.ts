/**
 * The upload and download actions, including the file pickers.
 *
 * Extracted from `sftp-container.tsx` because that file is at its 200-line limit and
 * because the picker is where the session-lifetime question actually starts: the
 * native dialog can stay open indefinitely, and everything that protects the
 * connection afterwards (`uploadFile`'s claim) only begins once it answers.
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
    const { open } = await import('@tauri-apps/plugin-dialog')
    const selected = await open({ multiple: true })
    // Cancelled: nothing to do, and nothing to clean up.
    if (!selected) return
    const paths = Array.isArray(selected) ? selected : [selected]
    // No refresh here. `uploadPaths` resolves when the files are *scheduled*, not
    // when they have landed — the listing is refreshed by
    // `useUploadCompletionRefresh` on each transfer's terminal event.
    await uploadPaths({ sessionId, remoteDir: remotePath, localPaths: paths })
  }, [sessionId, remotePath])

  const onDownload = useCallback(
    async (file: FileItem) => {
      if (!sessionId || file.is_directory) return
      const { save } = await import('@tauri-apps/plugin-dialog')
      const fileName = file.name.split('/').pop() || file.name
      const target = await save({ defaultPath: fileName })
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
