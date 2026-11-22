import type { FileItem } from '@/service/ssh'
import { Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { FilePaneRow } from './file-pane-row'

export type FilePaneSortBy = 'name' | 'size' | 'modified'

interface FilePaneTableProps {
  files: FileItem[]
  loading: boolean
  filter: string
  type: 'local' | 'remote'
  sessionId: string | null
  sortBy: FilePaneSortBy
  sortDir: 'asc' | 'desc'
  selectedFile: FileItem | null
  focusedFile: FileItem | null
  onSort: (column: FilePaneSortBy) => void
  onSelect: (file: FileItem) => void
  onFocus: (file: FileItem) => void
  onDoubleClick: (file: FileItem) => void
  onDownload?: (file: FileItem) => void
  onRename: (file: FileItem) => void
  onDelete: (file: FileItem) => void
}

export function FilePaneTable({
  files,
  loading,
  filter,
  type,
  sessionId,
  sortBy,
  sortDir,
  selectedFile,
  focusedFile,
  onSort,
  onSelect,
  onFocus,
  onDoubleClick,
  onDownload,
  onRename,
  onDelete,
}: FilePaneTableProps) {
  const { t } = useTranslation()
  if (loading) {
    return (
      <div className="flex-1 overflow-auto">
        <div className="flex items-center justify-center h-full">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    )
  }

  if (files.length === 0) {
    return (
      <div className="flex-1 overflow-auto">
        <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
          {filter ? t('sftp.noMatchingFiles') : t('sftp.emptyDirectory')}
        </div>
      </div>
    )
  }

  return (
    /*
     * `@container/pane`: the columns are chosen by **this box's** width, not the
     * viewport's.
     *
     * The `sm:` breakpoints below were written for a full-width file view, but this
     * table also renders inside the 300 px context dock. There the viewport is 1440 px
     * (so `sm:` is active) while the table has 273 px, and the five columns totalled
     * 409 px: measured `clientW: 273, scrollW: 409`, with the row-actions button at
     * `x: 1539` — past the right edge of a 1440 px window. A user cannot reach
     * Download, Rename or Delete at all without discovering a horizontal scrollbar that
     * sits under a sticky header.
     *
     * A container query fixes the actual question ("how much room do I have?") rather
     * than the proxy one ("how wide is the monitor?").
     */
    <div className="@container/pane flex-1 overflow-auto">
      <table className="w-full text-xs sm:text-sm">
        <thead className="sticky top-0 bg-muted/80">
          <tr className="text-left text-[10px] sm:text-xs text-muted-foreground">
            <th
              className="px-2 sm:px-3 py-1.5 font-medium cursor-pointer hover:text-foreground select-none"
              onClick={() => onSort('name')}
            >
              {t('sftp.tableName')}{' '}
              {sortBy === 'name' && (sortDir === 'asc' ? '↑' : '↓')}
            </th>
            <th
              className="hidden @md/pane:table-cell px-2 sm:px-3 py-1.5 font-medium cursor-pointer hover:text-foreground select-none w-16 sm:w-24"
              onClick={() => onSort('size')}
            >
              {t('sftp.tableSize')}{' '}
              {sortBy === 'size' && (sortDir === 'asc' ? '↑' : '↓')}
            </th>
            <th
              className="hidden @lg/pane:table-cell px-2 sm:px-3 py-1.5 font-medium cursor-pointer hover:text-foreground select-none w-20 sm:w-28"
              onClick={() => onSort('modified')}
            >
              {t('sftp.tableModified')}{' '}
              {sortBy === 'modified' && (sortDir === 'asc' ? '↑' : '↓')}
            </th>
            <th className="hidden @lg/pane:table-cell px-2 sm:px-3 py-1.5 font-medium w-16 sm:w-28">
              {t('sftp.tableKind')}
            </th>
            <th className="px-3 py-1.5 w-7 sm:w-8" />
          </tr>
        </thead>
        <tbody>
          {files.map(file => (
            <FilePaneRow
              key={file.path}
              file={file}
              type={type}
              sessionId={sessionId}
              selected={selectedFile?.path === file.path}
              focused={focusedFile?.path === file.path}
              onSelect={onSelect}
              onFocus={onFocus}
              onDoubleClick={onDoubleClick}
              onDownload={onDownload}
              onRename={onRename}
              onDelete={onDelete}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}
