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
    <div className="flex-1 overflow-auto">
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
              className="px-2 sm:px-3 py-1.5 font-medium cursor-pointer hover:text-foreground select-none w-16 sm:w-24"
              onClick={() => onSort('size')}
            >
              {t('sftp.tableSize')}{' '}
              {sortBy === 'size' && (sortDir === 'asc' ? '↑' : '↓')}
            </th>
            <th
              className="px-2 sm:px-3 py-1.5 font-medium cursor-pointer hover:text-foreground select-none w-20 sm:w-28 hidden sm:table-cell"
              onClick={() => onSort('modified')}
            >
              {t('sftp.tableModified')}{' '}
              {sortBy === 'modified' && (sortDir === 'asc' ? '↑' : '↓')}
            </th>
            <th className="px-2 sm:px-3 py-1.5 font-medium w-16 sm:w-28 hidden sm:table-cell">
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
