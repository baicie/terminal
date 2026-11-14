import type { FileItem } from '@/service/ssh'
import { Download, Edit3, MoreHorizontal, Trash2 } from 'lucide-react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { format } from '@/lib/date-utils'
import { cn } from '@/lib/utils'
import {
  formatFileSize,
  getFileIcon,
  getFileKindKey,
} from './file-pane-file-info'

export interface FilePaneRowProps {
  file: FileItem
  type: 'local' | 'remote'
  sessionId: string | null
  selected: boolean
  focused: boolean
  onSelect: (file: FileItem) => void
  onFocus: (file: FileItem) => void
  onDoubleClick: (file: FileItem) => void
  onDownload?: (file: FileItem) => void
  onRename: (file: FileItem) => void
  onDelete: (file: FileItem) => void
}

/**
 * One row of the file table.
 *
 * Its own file because the table was at its 200-line limit and because the name cell
 * carries the two decisions that make a narrow pane usable:
 *
 * - **Truncate to the container, not to a constant.** The old cell had
 *   `max-w-[120px] sm:max-w-none`, which truncated names at 120px in the 300px dock —
 *   where there was room for more — and then stopped truncating at the `sm`
 *   breakpoint, which the dock never leaves. `min-w-0 flex-1` plus a plain
 *   `truncate` lets the cell decide.
 * - **`title` carries the whole name.** A truncated `report-2026-11-final.pdf` and
 *   `report-2026-11-final.psd` look identical; without the tooltip the user cannot
 *   tell which they are about to delete. The row is already focusable, so the name is
 *   reachable by keyboard and the title shows on hover.
 */
export function FilePaneRow({
  file,
  type,
  sessionId,
  selected,
  focused,
  onSelect,
  onFocus,
  onDoubleClick,
  onDownload,
  onRename,
  onDelete,
}: FilePaneRowProps) {
  const { t } = useTranslation()

  /**
   * The keyboard gets the same two gestures the mouse has.
   *
   * The row carried `tabIndex={0}` without an `onKeyDown`, so Tab reached it and
   * then nothing worked: a keyboard user could move the highlight through a file
   * list but could not select a file or open a directory.
   *
   *   - **Space** selects, like a click.
   *   - **Enter** opens, like a double click (which for this table means navigate
   *     into a directory; the pane decides, the row only reports).
   *
   * Everything else is left alone on purpose. Arrows, Home/End and Tab belong to
   * the table and to focus order; a modified Enter (Cmd/Ctrl) is a shortcut
   * elsewhere; and a key press that originated inside the action menu must not
   * bubble into "open the file and close the menu at once".
   */
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTableRowElement>) => {
      if (event.target !== event.currentTarget) return
      if (event.metaKey || event.ctrlKey || event.altKey) return

      if (event.key === ' ') {
        // Space scrolls the pane by default; the row wants it.
        event.preventDefault()
        onSelect(file)
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        onDoubleClick(file)
      }
    },
    [file, onDoubleClick, onSelect],
  )

  return (
    <tr
      className={cn(
        'group cursor-pointer hover:bg-accent/50 transition-colors',
        (selected || focused) && 'bg-primary/10',
      )}
      onClick={() => onSelect(file)}
      onDoubleClick={() => onDoubleClick(file)}
      onKeyDown={onKeyDown}
      tabIndex={0}
      onFocus={() => onFocus(file)}
      // `aria-selected` is what tells a screen reader which row the table considers
      // current. Without it the visual highlight is the only signal, and it is
      // invisible to assistive tech.
      aria-selected={selected}
      data-testid="file-row"
    >
      <td className="px-2 sm:px-3 py-1.5">
        <div className="flex items-center gap-1.5 sm:gap-2">
          {getFileIcon(file)}
          <div className="min-w-0 flex-1">
            <div className="truncate" title={file.name}>
              {file.name}
            </div>
            {file.permissions && (
              <div className="text-[9px] sm:text-[10px] text-muted-foreground/70 font-mono truncate hidden sm:block">
                {file.permissions}
              </div>
            )}
          </div>
        </div>
      </td>
      <td className="px-2 sm:px-3 py-1.5 text-muted-foreground text-[10px] sm:text-xs">
        {file.is_directory ? '-' : formatFileSize(file.size)}
      </td>
      <td className="px-2 sm:px-3 py-1.5 text-muted-foreground text-[10px] sm:text-xs hidden sm:table-cell">
        {file.modified_time === null
          ? '—'
          : format(file.modified_time, 'MMM dd, HH:mm')}
      </td>
      <td className="px-2 sm:px-3 py-1.5 text-muted-foreground text-[10px] sm:text-xs hidden sm:table-cell">
        {t(getFileKindKey(file))}
      </td>
      <td className="px-3 py-1.5">
        {type === 'remote' && sessionId && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-6 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                aria-label={t('sftp.fileActions')}
              >
                <MoreHorizontal className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onDownload?.(file)}>
                <Download className="size-3.5 mr-2" /> {t('sftp.download')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onRename(file)}>
                <Edit3 className="size-3.5 mr-2" /> {t('sftp.rename')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive"
                onClick={() => onDelete(file)}
              >
                <Trash2 className="size-3.5 mr-2" /> {t('common.delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </td>
    </tr>
  )
}
