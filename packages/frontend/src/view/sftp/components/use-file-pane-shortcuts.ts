/**
 * The remote pane's keyboard shortcuts.
 *
 * ## Why this is a hook rather than an effect in `FilePane`
 *
 * The two shortcuts carry a lesson each, and the reason for F2's existence is long
 * enough that keeping it inside the component pushed the file over its 200-line limit.
 * Moving it here is the right split anyway: the rules are about keyboard accessibility,
 * not about rendering a table.
 *
 * ## F2, and the gap it closes
 *
 * `Delete` had a shortcut from the start; **rename had none**. Its only entry was the
 * hover-only `file-row-actions` dropdown (`file-pane-row.tsx`), so a keyboard user could
 * not rename a file at all.
 *
 * That gap was found the hard way: a real-GUI acceptance case spent three CI rounds
 * (30 minutes each) trying to open that menu through WebDriver and failing identically
 * on macOS, Linux and Windows. Whether or not a synthetic event can open a Radix trigger
 * is a question about the harness; "the only way to rename is to hover and click" is a
 * question about the product, and the answer was bad.
 *
 * F2 is the convention every file manager uses (Explorer, Finder, Nautilus, Dolphin,
 * Thunar). It does not replace the menu — it gives the same action a standard second
 * route.
 */
import { useEffect } from 'react'
import type { FileItem } from '@/service/ssh'

export interface FilePaneShortcuts {
  /** Only a remote pane with a live SFTP session acts on files. */
  type: 'local' | 'remote'
  sessionId: string | null
  selectedFile: FileItem | null
  onRename: (file: FileItem) => void
  onDelete: (file: FileItem) => void
  /** Cleared after a delete, because the row it named is gone. */
  onAfterDelete?: () => void
}

export function useFilePaneShortcuts({
  type,
  sessionId,
  selectedFile,
  onRename,
  onDelete,
  onAfterDelete,
}: FilePaneShortcuts): void {
  useEffect(() => {
    if (type !== 'remote' || !sessionId) return
    const handler = (event: KeyboardEvent) => {
      /*
       * `!event.defaultPrevented` on both: a dialog that already consumed the key must
       * not also trigger an action underneath it. Measured shape — pressing F2 with the
       * rename dialog open would otherwise open a second one behind it.
       */
      if (event.key === 'Delete' && selectedFile && !event.defaultPrevented) {
        event.preventDefault()
        onDelete(selectedFile)
        onAfterDelete?.()
        return
      }
      if (event.key === 'F2' && selectedFile && !event.defaultPrevented) {
        event.preventDefault()
        onRename(selectedFile)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [type, sessionId, selectedFile, onRename, onDelete, onAfterDelete])
}
