import type { FileItem } from '@/service/ssh'
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronRight,
  Computer,
  Download,
  Edit3,
  File,
  FileCode,
  FileText,
  Folder,
  FolderOpen,
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
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { toast } from '@/components/ui/sonner'
import {
  ViewContainer,
  ViewContent,
  ViewToolbar,
} from '@/components/view-container'
import { format } from '@/lib/date-utils'
import { sshService } from '@/service/ssh'
import { useAppStore } from '@/store/app'
import { useHostStore } from '@/store/host'

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

const FilePane: React.FC<FilePaneProps> = ({
  type,
  files,
  currentPath,
  pathHistory,
  pathHistoryIndex,
  loading,
  selectedFile,
  sessionId,
  onNavigate,
  onBack,
  onForward,
  onRefresh,
  onSelectFile,
  onDelete,
  onRename,
  onMkdir,
  onUpload,
  onDownload,
}) => {
  const [filter, setFilter] = useState('')
  const [sortBy, setSortBy] = useState<'name' | 'size' | 'modified'>('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  const filteredFiles = files
    .filter(f => f.name.toLowerCase().includes(filter.toLowerCase()))
    .sort((a, b) => {
      // Directories first
      if (a.is_directory !== b.is_directory) {
        return a.is_directory ? -1 : 1
      }
      let cmp = 0
      if (sortBy === 'name') {
        cmp = a.name.localeCompare(b.name)
      } else if (sortBy === 'size') {
        cmp = a.size - b.size
      } else {
        cmp = a.modified_time - b.modified_time
      }
      return sortDir === 'asc' ? cmp : -cmp
    })

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '-'
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 * 1024 * 1024)
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
  }

  const getFileKind = (file: FileItem): string => {
    if (file.is_directory) return 'Folder'
    const ext = file.name.split('.').pop()?.toLowerCase()
    if (
      ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'webp', 'ico'].includes(
        ext || '',
      )
    ) {
      return 'Image'
    }
    if (
      [
        'js',
        'ts',
        'jsx',
        'tsx',
        'py',
        'rs',
        'go',
        'java',
        'c',
        'cpp',
        'h',
        'hpp',
        'css',
        'scss',
        'html',
        'xml',
        'yaml',
        'yml',
        'toml',
        'sh',
        'bash',
        'zsh',
        'php',
        'rb',
        'swift',
        'kt',
      ].includes(ext || '')
    ) {
      return 'Source Code'
    }
    if (
      ['md', 'txt', 'log', 'conf', 'cfg', 'ini', 'env', 'json'].includes(
        ext || '',
      )
    ) {
      return 'Text'
    }
    if (['pdf'].includes(ext || '')) return 'PDF'
    if (['zip', 'tar', 'gz', 'bz2', 'xz', '7z', 'rar'].includes(ext || ''))
      return 'Archive'
    if (['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac'].includes(ext || ''))
      return 'Audio'
    if (['mp4', 'avi', 'mkv', 'mov', 'wmv', 'flv', 'webm'].includes(ext || ''))
      return 'Video'
    return 'File'
  }

  const getFileIcon = (file: FileItem) => {
    if (file.is_directory) return <Folder className="size-4 text-yellow-500" />
    const ext = file.name.split('.').pop()?.toLowerCase()
    if (
      ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'webp'].includes(ext || '')
    ) {
      return <Image className="size-4 text-purple-500" />
    }
    if (
      [
        'js',
        'ts',
        'jsx',
        'tsx',
        'py',
        'rs',
        'go',
        'java',
        'c',
        'cpp',
        'h',
        'css',
        'html',
        'json',
        'xml',
        'yaml',
        'yml',
        'toml',
        'sh',
        'bash',
        'zsh',
      ].includes(ext || '')
    ) {
      return <FileCode className="size-4 text-blue-400" />
    }
    if (['md', 'txt', 'log', 'conf', 'cfg', 'ini', 'env'].includes(ext || '')) {
      return <FileText className="size-4 text-gray-400" />
    }
    return <File className="size-4 text-gray-500" />
  }

  const pathParts = currentPath.split('/').filter(Boolean)

  const handleRowDoubleClick = (file: FileItem) => {
    if (file.is_directory) {
      onNavigate(
        currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`,
      )
    }
  }

  const handleSort = (col: typeof sortBy) => {
    if (sortBy === col) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortBy(col)
      setSortDir('asc')
    }
  }

  return (
    <div className="flex flex-col h-full border border-border/50 rounded-lg overflow-hidden bg-card">
      {/* Pane header */}
      <div className="shrink-0 px-3 py-2 bg-secondary/40 border-b border-border/50 flex items-center gap-2">
        <div className="flex items-center gap-1 text-sm font-medium">
          {type === 'local' ? (
            <Computer className="size-4" />
          ) : (
            <Server className="size-4" />
          )}
          <span>{type === 'local' ? 'Local' : 'Remote'}</span>
        </div>
        <div className="flex-1" />
        {/* Back/Forward */}
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={onBack}
          disabled={pathHistoryIndex <= 0}
        >
          <ArrowLeft className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={onForward}
          disabled={pathHistoryIndex >= pathHistory.length - 1}
        >
          <ArrowRight className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={onRefresh}
        >
          <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {/* Breadcrumb */}
      <div className="shrink-0 px-3 py-1.5 flex items-center gap-1 text-xs border-b border-border/50 overflow-x-auto">
        <button
          className="hover:text-primary shrink-0"
          onClick={() => onNavigate(type === 'remote' ? '/' : '')}
        >
          <Home className="size-3.5" />
        </button>
        {pathParts.map((part, i) => (
          <span key={i} className="flex items-center gap-1 shrink-0">
            <ChevronRight className="size-3 text-muted-foreground" />
            <button
              className="hover:text-primary"
              onClick={() =>
                onNavigate(`/${pathParts.slice(0, i + 1).join('/')}`)
              }
            >
              {part}
            </button>
          </span>
        ))}
        {type === 'remote' && (
          <Input
            className="h-5 text-xs ml-2 flex-1 min-w-0 max-w-[200px]"
            value={currentPath}
            onChange={e => setFilter(e.target.value)}
            placeholder="Filter..."
          />
        )}
      </div>

      {/* Local filter input (always visible) */}
      {type === 'local' && (
        <div className="shrink-0 px-3 py-1 border-b border-border/50">
          <Input
            className="h-6 text-xs"
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder="Filter files..."
          />
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
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted/80">
              <tr className="text-left text-xs text-muted-foreground">
                <th
                  className="px-3 py-1.5 font-medium cursor-pointer hover:text-foreground select-none"
                  onClick={() => handleSort('name')}
                >
                  Name {sortBy === 'name' && (sortDir === 'asc' ? '↑' : '↓')}
                </th>
                <th
                  className="px-3 py-1.5 font-medium cursor-pointer hover:text-foreground select-none w-24"
                  onClick={() => handleSort('size')}
                >
                  Size {sortBy === 'size' && (sortDir === 'asc' ? '↑' : '↓')}
                </th>
                <th
                  className="px-3 py-1.5 font-medium cursor-pointer hover:text-foreground select-none w-28"
                  onClick={() => handleSort('modified')}
                >
                  Modified{' '}
                  {sortBy === 'modified' && (sortDir === 'asc' ? '↑' : '↓')}
                </th>
                <th className="px-3 py-1.5 font-medium w-28">Kind</th>
                <th className="px-3 py-1.5 w-8" />
              </tr>
            </thead>
            <tbody>
              {filteredFiles.map(file => (
                <tr
                  key={file.path}
                  className={`cursor-pointer hover:bg-accent/50 transition-colors ${
                    selectedFile?.path === file.path ? 'bg-primary/10' : ''
                  }`}
                  onClick={() => onSelectFile(file)}
                  onDoubleClick={() => handleRowDoubleClick(file)}
                >
                  <td className="px-3 py-1.5">
                    <div className="flex items-center gap-2">
                      {getFileIcon(file)}
                      <div className="min-w-0">
                        <div className="truncate">{file.name}</div>
                        {file.permissions && (
                          <div className="text-[10px] text-muted-foreground/70 font-mono truncate">
                            {file.permissions}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-1.5 text-muted-foreground text-xs">
                    {file.is_directory ? '-' : formatSize(file.size)}
                  </td>
                  <td className="px-3 py-1.5 text-muted-foreground text-xs">
                    {format(file.modified_time, 'MMM dd, HH:mm')}
                  </td>
                  <td className="px-3 py-1.5 text-muted-foreground text-xs">
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
                            <Download className="size-3.5 mr-2" />
                            Download
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => onRename(file)}>
                            <Edit3 className="size-3.5 mr-2" />
                            Rename
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={() => onDelete(file)}
                          >
                            <Trash2 className="size-3.5 mr-2" />
                            Delete
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

      {/* Actions for remote */}
      {type === 'remote' && (
        <div className="shrink-0 px-3 py-2 border-t border-border/50 flex gap-2">
          <Button
            size="sm"
            className="h-7 text-xs gap-1"
            onClick={() => onUpload?.(currentPath)}
          >
            <Upload className="size-3" />
            Upload
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1"
            onClick={onMkdir}
          >
            <Plus className="size-3" />
            New Folder
          </Button>
        </div>
      )}
    </div>
  )
}

const SftpContainer: React.FC = () => {
  const tabs = useAppStore(s => s.tabs)
  const activeTabId = useAppStore(s => s.activeTabId)
  const hosts = useHostStore(s => s.hosts)

  // Remote state
  const [remoteFiles, setRemoteFiles] = useState<FileItem[]>([])
  const [remotePath, setRemotePath] = useState('/')
  const [remoteHistory, setRemoteHistory] = useState<string[]>(['/'])
  const [remoteHistoryIndex, setRemoteHistoryIndex] = useState(0)
  const [remoteLoading, setRemoteLoading] = useState(false)
  const [selectedRemote, setSelectedRemote] = useState<FileItem | null>(null)

  // Local state
  const [localFiles, setLocalFiles] = useState<FileItem[]>([])
  const [localPath, setLocalPath] = useState('')
  const [localHistory, setLocalHistory] = useState<string[]>([''])
  const [localHistoryIndex, setLocalHistoryIndex] = useState(0)
  const [localLoading, setLocalLoading] = useState(false)
  const [selectedLocal, setSelectedLocal] = useState<FileItem | null>(null)

  // Dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [fileToDelete, setFileToDelete] = useState<FileItem | null>(null)
  const [renameDialogOpen, setRenameDialogOpen] = useState(false)
  const [fileToRename, setFileToRename] = useState<FileItem | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [mkdirDialogOpen, setMkdirDialogOpen] = useState(false)
  const [mkdirValue, setMkdirValue] = useState('')

  // Get active SSH session
  const activeTab = tabs.find(t => t.id === activeTabId)
  const activeHost = activeTab?.hostId
    ? hosts.find(h => h.id === activeTab.hostId)
    : null

  // Find session ID from app store or create one
  const sessionIdRef = useRef<string | null>(null)

  // Load remote directory
  const loadRemoteDir = useCallback(
    async (path: string) => {
      if (!activeHost) return

      setRemoteLoading(true)
      try {
        // First ensure we have an SSH connection
        if (!sessionIdRef.current) {
          const connResult = await sshService.connect(activeHost)
          if (!connResult.success || !connResult.sessionId) {
            toast.error(`Connection failed: ${connResult.message}`)
            setRemoteLoading(false)
            return
          }
          sessionIdRef.current = connResult.sessionId

          // Initialize SFTP
          const sftpResult = await sshService.sftpConnect(connResult.sessionId)
          if (!sftpResult.success) {
            toast.error(`SFTP init failed: ${sftpResult.message}`)
            setRemoteLoading(false)
            return
          }
        }

        const result = await sshService.sftpList(sessionIdRef.current, path)
        if (result.success && result.files) {
          setRemoteFiles(result.files)
          setRemotePath(path)
        } else {
          toast.error(result.message || 'Failed to list directory')
        }
      } catch (error) {
        toast.error(`Error: ${error}`)
      } finally {
        setRemoteLoading(false)
      }
    },
    [activeHost],
  )

  // Initialize on mount or when host changes
  useEffect(() => {
    if (activeHost) {
      sessionIdRef.current = null
      void loadRemoteDir('/')
    }
  }, [activeHost, loadRemoteDir])

  // Navigate remote
  const handleRemoteNavigate = useCallback(
    (path: string) => {
      const newHistory = remoteHistory.slice(0, remoteHistoryIndex + 1)
      newHistory.push(path)
      setRemoteHistory(newHistory)
      setRemoteHistoryIndex(newHistory.length - 1)
      void loadRemoteDir(path)
    },
    [remoteHistory, remoteHistoryIndex, loadRemoteDir],
  )

  // Load local directory (using File System Access API or webkitRelativePath fallback)
  const loadLocalDir = useCallback(async (path: string) => {
    setLocalLoading(true)
    try {
      // @ts-ignore - DirectoryHandle API
      if ((window as any).showDirectoryPicker) {
        // @ts-ignore
        if (window.__localDirHandle) {
          // @ts-ignore
          const dirHandle = window.__localDirHandle
          const entries: FileItem[] = []
          for await (const [name, handle] of dirHandle.entries()) {
            const file = handle.kind === 'file' ? await handle.getFile() : null
            entries.push({
              name,
              path: name,
              is_directory: handle.kind === 'directory',
              size: file?.size || 0,
              modified_time: file?.lastModified || Date.now(),
              permissions:
                handle.kind === 'directory' ? 'drwxr-xr-x' : '-rw-r--r--',
            })
          }
          setLocalFiles(entries)
          setLocalPath(path || dirHandle.name || 'Selected Folder')
        }
      }
    } catch (error) {
      console.error('Local dir error:', error)
      setLocalFiles([])
    } finally {
      setLocalLoading(false)
    }
  }, [])

  // Handle folder picker
  const handlePickLocalFolder = useCallback(async () => {
    try {
      // @ts-ignore
      window.__localDirHandle = await window.showDirectoryPicker()
      void loadLocalDir('/')
    } catch (e) {
      // User cancelled
    }
  }, [loadLocalDir])

  // Remote navigation
  const handleRemoteBack = () => {
    if (remoteHistoryIndex > 0) {
      setRemoteHistoryIndex(remoteHistoryIndex - 1)
      void loadRemoteDir(remoteHistory[remoteHistoryIndex - 1])
    }
  }

  const handleRemoteForward = () => {
    if (remoteHistoryIndex < remoteHistory.length - 1) {
      setRemoteHistoryIndex(remoteHistoryIndex + 1)
      void loadRemoteDir(remoteHistory[remoteHistoryIndex + 1])
    }
  }

  // Delete file
  const handleDelete = async () => {
    if (!fileToDelete || !sessionIdRef.current) return
    const result = await sshService.sftpDelete(
      sessionIdRef.current,
      fileToDelete.path,
      fileToDelete.is_directory,
    )
    if (result.success) {
      toast.success('Deleted successfully')
      void loadRemoteDir(remotePath)
    } else {
      toast.error(result.message || 'Delete failed')
    }
    setDeleteDialogOpen(false)
    setFileToDelete(null)
  }

  // Rename file
  const handleRename = async () => {
    if (!fileToRename || !sessionIdRef.current || !renameValue.trim()) return
    const newPath =
      remotePath === '/' ? `/${renameValue}` : `${remotePath}/${renameValue}`
    const result = await sshService.sftpRename(
      sessionIdRef.current,
      fileToRename.path,
      newPath,
    )
    if (result.success) {
      toast.success('Renamed successfully')
      void loadRemoteDir(remotePath)
    } else {
      toast.error(result.message || 'Rename failed')
    }
    setRenameDialogOpen(false)
    setFileToRename(null)
    setRenameValue('')
  }

  // Create directory
  const handleMkdir = async () => {
    if (!sessionIdRef.current || !mkdirValue.trim()) return
    const newPath =
      remotePath === '/' ? `/${mkdirValue}` : `${remotePath}/${mkdirValue}`
    const result = await sshService.sftpMkdir(sessionIdRef.current, newPath)
    if (result.success) {
      toast.success('Folder created')
      void loadRemoteDir(remotePath)
    } else {
      toast.error(result.message || 'Create folder failed')
    }
    setMkdirDialogOpen(false)
    setMkdirValue('')
  }

  // Upload file
  const handleUpload = async () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.onchange = async () => {
      const files = input.files
      if (!files) return

      for (const file of Array.from(files)) {
        const reader = new FileReader()
        reader.onload = async () => {
          toast.info(`Upload ${file.name} - select remote destination first`)
        }
        reader.readAsDataURL(file)
      }
    }
    input.click()
  }

  // Download file
  const handleDownload = async (file: FileItem) => {
    if (!sessionIdRef.current || file.is_directory) return
    try {
      const fileName = file.name.split('/').pop() || file.name
      const localDownloadPath = `/tmp/${fileName}`
      const result = await sshService.sftpDownload(
        sessionIdRef.current,
        file.path,
        localDownloadPath,
      )
      if (result.success) {
        toast.success(`Downloaded to ${localDownloadPath}`)
      } else {
        toast.error(result.message || 'Download failed')
      }
    } catch (error) {
      toast.error(`Download error: ${error}`)
    }
  }

  // No active session
  if (!activeHost) {
    return (
      <ViewContainer>
        <ViewContent className="p-6">
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <FolderOpen className="size-16 text-muted-foreground/50" />
            <div className="text-center">
              <p className="text-lg font-medium">No active SFTP session</p>
              <p className="text-sm text-muted-foreground mt-1">
                Connect to a host first, then open SFTP to transfer files
              </p>
            </div>
          </div>
        </ViewContent>
      </ViewContainer>
    )
  }

  return (
    <ViewContainer className="overflow-hidden">
      {/* Toolbar */}
      <ViewToolbar className="gap-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Server className="size-4" />
          <span>{activeHost.name}</span>
        </div>
        <div className="flex-1" />
        <Button
          variant="outline"
          size="sm"
          onClick={() => void loadRemoteDir(remotePath)}
        >
          <RefreshCw
            className={`size-4 mr-1 ${remoteLoading ? 'animate-spin' : ''}`}
          />
          Refresh
        </Button>
      </ViewToolbar>

      {/* Dual pane */}
      <ViewContent
        className="p-3 flex gap-3 h-full overflow-hidden"
        // style={{ paddingBottom: '8px' }}
      >
        {/* Local pane */}
        <div className="flex-1 min-w-0 flex flex-col gap-2">
          <div className="flex items-center gap-2 px-1">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1"
              onClick={handlePickLocalFolder}
            >
              <FolderOpen className="size-3" />
              Pick Folder
            </Button>
            <span className="text-xs text-muted-foreground truncate">
              {localPath}
            </span>
          </div>
          <FilePane
            type="local"
            files={localFiles}
            currentPath={localPath}
            pathHistory={localHistory}
            pathHistoryIndex={localHistoryIndex}
            loading={localLoading}
            selectedFile={selectedLocal}
            sessionId={null}
            onNavigate={path => {
              const newHistory = localHistory.slice(0, localHistoryIndex + 1)
              newHistory.push(path)
              setLocalHistory(newHistory)
              setLocalHistoryIndex(newHistory.length - 1)
              void loadLocalDir(path)
            }}
            onBack={() => {
              if (localHistoryIndex > 0) {
                setLocalHistoryIndex(localHistoryIndex - 1)
                void loadLocalDir(localHistory[localHistoryIndex - 1])
              }
            }}
            onForward={() => {
              if (localHistoryIndex < localHistory.length - 1) {
                setLocalHistoryIndex(localHistoryIndex + 1)
                void loadLocalDir(localHistory[localHistoryIndex + 1])
              }
            }}
            onRefresh={() => void loadLocalDir(localPath)}
            onSelectFile={setSelectedLocal}
            onDelete={() => {}}
            onRename={() => {}}
            onMkdir={() => {}}
            onDownload={handleDownload}
          />
        </div>

        {/* Transfer indicator */}
        <div className="flex flex-col items-center justify-center">
          <ArrowUp className="size-4 text-muted-foreground" />
          <ArrowUp className="size-4 text-muted-foreground -mt-1" />
          <ArrowDown className="size-4 text-muted-foreground -mt-1" />
          <ArrowDown className="size-4 text-muted-foreground -mt-1" />
        </div>

        {/* Remote pane */}
        <div className="flex-1 min-w-0 flex flex-col gap-2">
          <div className="flex items-center gap-2 px-1">
            <span className="text-xs text-muted-foreground truncate">
              SFTP: {activeHost.hostname}
            </span>
          </div>
          <FilePane
            type="remote"
            files={remoteFiles}
            currentPath={remotePath}
            pathHistory={remoteHistory}
            pathHistoryIndex={remoteHistoryIndex}
            loading={remoteLoading}
            selectedFile={selectedRemote}
            sessionId={sessionIdRef.current}
            onNavigate={handleRemoteNavigate}
            onBack={handleRemoteBack}
            onForward={handleRemoteForward}
            onRefresh={() => void loadRemoteDir(remotePath)}
            onSelectFile={setSelectedRemote}
            onDelete={file => {
              setFileToDelete(file)
              setDeleteDialogOpen(true)
            }}
            onRename={file => {
              setFileToRename(file)
              setRenameValue(file.name.split('/').pop() || file.name)
              setRenameDialogOpen(true)
            }}
            onMkdir={() => setMkdirDialogOpen(true)}
            onUpload={handleUpload}
            onDownload={handleDownload}
          />
        </div>
      </ViewContent>

      {/* Delete Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {fileToDelete?.is_directory ? 'Folder' : 'File'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{fileToDelete?.name}
              "? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleDelete()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Rename Dialog */}
      <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename</DialogTitle>
            <DialogDescription>
              Enter the new name for this item
            </DialogDescription>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={e => setRenameValue(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') void handleRename()
            }}
            autoFocus
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRenameDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void handleRename()}
              disabled={!renameValue.trim()}
            >
              Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Mkdir Dialog */}
      <Dialog open={mkdirDialogOpen} onOpenChange={setMkdirDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>New Folder</DialogTitle>
            <DialogDescription>
              Enter the name for the new folder
            </DialogDescription>
          </DialogHeader>
          <Input
            value={mkdirValue}
            onChange={e => setMkdirValue(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') void handleMkdir()
            }}
            placeholder="folder-name"
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setMkdirDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => void handleMkdir()}
              disabled={!mkdirValue.trim()}
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ViewContainer>
  )
}

export default SftpContainer
