import { useEffect, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  Computer,
  Download,
  Edit3,
  File,
  FileCode,
  FileText,
  Folder,
  Home,
  Image,
  Loader2,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Server,
  Trash2,
  Upload,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { format } from '@/lib/date-utils'
import { cn } from '@/lib/utils'
import { useBreakpointMax } from '@/hooks/use-breakpoint'
import type { FileItem } from '@/service/ssh'

interface FilePaneProps {
  type: 'local' | 'remote'
  files: FileItem[]
  currentPath: string
  pathHistory: string[]
  pathHistoryIndex: number
  loading: boolean
  selectedFile: FileItem | null
  sessionId: string | null
  onNavigate: (path: string) => void
  onBack: () => void
  onForward: () => void
  onRefresh: () => void
  onSelectFile: (file: FileItem | null) => void
  onDelete: (file: FileItem) => void
  onRename: (file: FileItem) => void
  onMkdir: () => void
  onUpload?: (remotePath: string) => void
  onDownload?: (file: FileItem) => void
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '-'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function getFileKind(file: FileItem): string {
  if (file.is_directory) return 'Folder'
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'webp', 'ico'].includes(ext)) return 'Image'
  if (['js', 'ts', 'jsx', 'tsx', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'h', 'hpp', 'css', 'scss', 'html', 'xml', 'yaml', 'yml', 'toml', 'sh', 'bash', 'zsh', 'php', 'rb', 'swift', 'kt'].includes(ext)) return 'Source Code'
  if (['md', 'txt', 'log', 'conf', 'cfg', 'ini', 'env', 'json'].includes(ext)) return 'Text'
  if (['pdf'].includes(ext)) return 'PDF'
  if (['zip', 'tar', 'gz', 'bz2', 'xz', '7z', 'rar'].includes(ext)) return 'Archive'
  if (['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac'].includes(ext)) return 'Audio'
  if (['mp4', 'avi', 'mkv', 'mov', 'wmv', 'flv', 'webm'].includes(ext)) return 'Video'
  return 'File'
}

function getFileIcon(file: FileItem) {
  if (file.is_directory) return <Folder className="size-4 text-yellow-500" />
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'webp'].includes(ext)) return <Image className="size-4 text-purple-500" />
  if (['js', 'ts', 'jsx', 'tsx', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'h', 'css', 'html', 'json', 'xml', 'yaml', 'yml', 'toml', 'sh', 'bash', 'zsh'].includes(ext)) return <FileCode className="size-4 text-blue-400" />
  if (['md', 'txt', 'log', 'conf', 'cfg', 'ini', 'env'].includes(ext)) return <FileText className="size-4 text-gray-400" />
  return <File className="size-4 text-gray-500" />
}

export const FilePane: React.FC<FilePaneProps> = ({
  type, files, currentPath, pathHistory, pathHistoryIndex, loading,
  selectedFile, sessionId, onNavigate, onBack, onForward, onRefresh,
  onSelectFile, onDelete, onRename, onMkdir, onUpload, onDownload,
}) => {
  const [filter, setFilter] = useState('')
  const [sortBy, setSortBy] = useState<'name' | 'size' | 'modified'>('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [focusedFile, setFocusedFile] = useState<FileItem | null>(null)
  const isMobile = useBreakpointMax('md')

  // Delete key: delete the currently selected/focused file
  useEffect(() => {
    if (type !== 'remote' || !sessionId) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Delete' && selectedFile && !e.defaultPrevented) {
        e.preventDefault()
        onDelete(selectedFile)
        void setFocusedFile(null)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [type, sessionId, selectedFile, onDelete])

  const filteredFiles = files
    .filter(f => f.name.toLowerCase().includes(filter.toLowerCase()))
    .sort((a, b) => {
      if (a.is_directory !== b.is_directory) return a.is_directory ? -1 : 1
      let cmp: number
      if (sortBy === 'name') cmp = a.name.localeCompare(b.name)
      else if (sortBy === 'size') cmp = a.size - b.size
      else cmp = a.modified_time - b.modified_time
      return sortDir === 'asc' ? cmp : -cmp
    })

  const pathParts = currentPath.split('/').filter(Boolean)

  const handleSort = (col: typeof sortBy) => {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortBy(col); setSortDir('asc') }
  }

  const handleRowDoubleClick = (file: FileItem) => {
    if (file.is_directory) onNavigate(currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`)
  }

  return (
    <div className="flex flex-col h-full border border-border/50 rounded-lg overflow-hidden bg-card">
      {/* Pane header */}
      <div className="shrink-0 px-3 py-2 bg-secondary/40 border-b border-border/50 flex items-center gap-2">
        <div className="flex items-center gap-1 text-sm font-medium">
          {type === 'local' ? <Computer className="size-4" /> : <Server className="size-4" />}
          <span>{type === 'local' ? 'Local' : 'Remote'}</span>
        </div>
        <div className="flex-1" />
        <Button variant="ghost" size="icon" className="size-7" onClick={onBack} disabled={pathHistoryIndex <= 0}>
          <ArrowLeft className="size-3.5" />
        </Button>
        <Button variant="ghost" size="icon" className="size-7" onClick={onForward} disabled={pathHistoryIndex >= pathHistory.length - 1}>
          <ArrowRight className="size-3.5" />
        </Button>
        <Button variant="ghost" size="icon" className="size-7" onClick={onRefresh}>
          <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
        </Button>
      </div>

      {/* Breadcrumb */}
      <div className="shrink-0 px-3 py-1.5 flex items-center gap-1 text-xs border-b border-border/50 overflow-x-auto">
        <button className="hover:text-primary shrink-0" onClick={() => onNavigate(type === 'remote' ? '/' : '')}>
          <Home className="size-3.5" />
        </button>
        {pathParts.map((part, i) => (
          <span key={i} className="flex items-center gap-1 shrink-0">
            <ChevronRight className="size-3 text-muted-foreground" />
            <button className="hover:text-primary" onClick={() => onNavigate(`/${pathParts.slice(0, i + 1).join('/')}`)}>{part}</button>
          </span>
        ))}
        {type === 'remote' && (
          <Input className="h-5 text-xs ml-2 flex-1 min-w-0 max-w-[200px]" value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter..." />
        )}
      </div>

      {/* Local filter input */}
      {type === 'local' && (
        <div className="shrink-0 px-3 py-1 border-b border-border/50">
          <Input className="h-6 text-xs" value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter files..." />
        </div>
      )}

      {/* File table */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : filteredFiles.length === 0 ? (
          <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
            {filter ? 'No matching files' : 'Empty directory'}
          </div>
        ) : (
          <table className="w-full text-xs sm:text-sm">
            <thead className="sticky top-0 bg-muted/80">
              <tr className="text-left text-[10px] sm:text-xs text-muted-foreground">
                <th className="px-2 sm:px-3 py-1.5 font-medium cursor-pointer hover:text-foreground select-none" onClick={() => handleSort('name')}>
                  Name {sortBy === 'name' && (sortDir === 'asc' ? '↑' : '↓')}
                </th>
                <th className="px-2 sm:px-3 py-1.5 font-medium cursor-pointer hover:text-foreground select-none w-16 sm:w-24" onClick={() => handleSort('size')}>
                  Size {sortBy === 'size' && (sortDir === 'asc' ? '↑' : '↓')}
                </th>
                <th className="px-2 sm:px-3 py-1.5 font-medium cursor-pointer hover:text-foreground select-none w-20 sm:w-28 hidden sm:table-cell" onClick={() => handleSort('modified')}>
                  Modified {sortBy === 'modified' && (sortDir === 'asc' ? '↑' : '↓')}
                </th>
                <th className="px-2 sm:px-3 py-1.5 font-medium w-16 sm:w-28 hidden sm:table-cell">Kind</th>
                <th className="px-3 py-1.5 w-7 sm:w-8" />
              </tr>
            </thead>
            <tbody>
              {filteredFiles.map(file => (
                <tr
                  key={file.path}
                  className={cn('cursor-pointer hover:bg-accent/50 transition-colors',
                    (selectedFile?.path === file.path || focusedFile?.path === file.path) && 'bg-primary/10')}
                  onClick={() => { onSelectFile(file); setFocusedFile(file) }}
                  onDoubleClick={() => handleRowDoubleClick(file)}
                  tabIndex={0}
                  onFocus={() => setFocusedFile(file)}
                >
                  <td className="px-2 sm:px-3 py-1.5">
                    <div className="flex items-center gap-1.5 sm:gap-2">
                      {getFileIcon(file)}
                      <div className="min-w-0">
                        <div className="truncate max-w-[120px] sm:max-w-none">{file.name}</div>
                        {file.permissions && (
                          <div className="text-[9px] sm:text-[10px] text-muted-foreground/70 font-mono truncate hidden sm:block">
                            {file.permissions}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-2 sm:px-3 py-1.5 text-muted-foreground text-[10px] sm:text-xs">
                    {file.is_directory ? '-' : formatSize(file.size)}
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
                          <Button variant="ghost" size="icon" className="size-6 opacity-0 group-hover:opacity-100">
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
                          <DropdownMenuItem className="text-destructive" onClick={() => onDelete(file)}>
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
        )}
      </div>

      {/* Actions for remote — hidden on mobile (tabs handle it there) */}
      {!isMobile && type === 'remote' && (
        <div className="shrink-0 px-3 py-2 border-t border-border/50 flex gap-2">
          <Button size="sm" className="h-7 text-xs gap-1" onClick={() => onUpload?.(currentPath)}>
            <Upload className="size-3" /> Upload
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={onMkdir}>
            <Plus className="size-3" />
            New Folder
          </Button>
        </div>
      )}
    </div>
  )
}
