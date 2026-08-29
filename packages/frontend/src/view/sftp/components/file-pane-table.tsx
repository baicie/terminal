import type { FileItem } from '@/service/ssh'
import { Download, Edit3, Loader2, MoreHorizontal, Trash2 } from 'lucide-react'
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
import { formatFileSize, getFileIcon, getFileKind } from './file-pane-file-info'

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
          {filter ? 'No matching files' : 'Empty directory'}
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
              Name {sortBy === 'name' && (sortDir === 'asc' ? '↑' : '↓')}
            </th>
            <th
              className="px-2 sm:px-3 py-1.5 font-medium cursor-pointer hover:text-foreground select-none w-16 sm:w-24"
              onClick={() => onSort('size')}
            >
              Size {sortBy === 'size' && (sortDir === 'asc' ? '↑' : '↓')}
            </th>
            <th
              className="px-2 sm:px-3 py-1.5 font-medium cursor-pointer hover:text-foreground select-none w-20 sm:w-28 hidden sm:table-cell"
              onClick={() => onSort('modified')}
            >
              Modified{' '}
              {sortBy === 'modified' && (sortDir === 'asc' ? '↑' : '↓')}
            </th>
            <th className="px-2 sm:px-3 py-1.5 font-medium w-16 sm:w-28 hidden sm:table-cell">
              Kind
            </th>
            <th className="px-3 py-1.5 w-7 sm:w-8" />
          </tr>
        </thead>
        <tbody>
          {files.map(file => (
            <tr
              key={file.path}
              className={cn(
                'cursor-pointer hover:bg-accent/50 transition-colors',
                (selectedFile?.path === file.path ||
                  focusedFile?.path === file.path) &&
                  'bg-primary/10',
              )}
              onClick={() => onSelect(file)}
              onDoubleClick={() => onDoubleClick(file)}
              tabIndex={0}
              onFocus={() => onFocus(file)}
            >
              <td className="px-2 sm:px-3 py-1.5">
                <div className="flex items-center gap-1.5 sm:gap-2">
                  {getFileIcon(file)}
                  <div className="min-w-0">
                    <div className="truncate max-w-[120px] sm:max-w-none">
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
                {format(file.modified_time, 'MMM dd, HH:mm')}
              </td>
              <td className="px-2 sm:px-3 py-1.5 text-muted-foreground text-[10px] sm:text-xs hidden sm:table-cell">
                {getFileKind(file)}
              </td>
              <td className="px-3 py-1.5">
                {type === 'remote' && sessionId && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-6 opacity-0 group-hover:opacity-100"
                      >
                        <MoreHorizontal className="size-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => onDownload?.(file)}>
                        <Download className="size-3.5 mr-2" /> Download
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onRename(file)}>
                        <Edit3 className="size-3.5 mr-2" /> Rename
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={() => onDelete(file)}
                      >
                        <Trash2 className="size-3.5 mr-2" /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
