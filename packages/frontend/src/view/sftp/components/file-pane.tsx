import { useEffect, useState } from 'react'
import { Plus, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useBreakpointMax } from '@/hooks/use-breakpoint'
import type { FileItem } from '@/service/ssh'
import { FilePaneNavigation } from './file-pane-navigation'
import { FilePaneTable, type FilePaneSortBy } from './file-pane-table'

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

export const FilePane: React.FC<FilePaneProps> = ({
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
  const [sortBy, setSortBy] = useState<FilePaneSortBy>('name')
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

  const handleSort = (col: typeof sortBy) => {
    if (sortBy === col) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortBy(col)
      setSortDir('asc')
    }
  }

  const handleRowDoubleClick = (file: FileItem) => {
    if (file.is_directory)
      onNavigate(
        currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`,
      )
  }

  return (
    <div className="flex flex-col h-full border border-border/50 rounded-lg overflow-hidden bg-card">
      <FilePaneNavigation
        type={type}
        currentPath={currentPath}
        pathHistoryLength={pathHistory.length}
        pathHistoryIndex={pathHistoryIndex}
        loading={loading}
        filter={filter}
        onFilterChange={setFilter}
        onNavigate={onNavigate}
        onBack={onBack}
        onForward={onForward}
        onRefresh={onRefresh}
      />

      <FilePaneTable
        files={filteredFiles}
        loading={loading}
        filter={filter}
        type={type}
        sessionId={sessionId}
        sortBy={sortBy}
        sortDir={sortDir}
        selectedFile={selectedFile}
        focusedFile={focusedFile}
        onSort={handleSort}
        onSelect={file => {
          onSelectFile(file)
          setFocusedFile(file)
        }}
        onFocus={setFocusedFile}
        onDoubleClick={handleRowDoubleClick}
        onDownload={onDownload}
        onRename={onRename}
        onDelete={onDelete}
      />

      {/* Actions for remote — hidden on mobile (tabs handle it there) */}
      {!isMobile && type === 'remote' && (
        <div className="shrink-0 px-3 py-2 border-t border-border/50 flex gap-2">
          <Button
            size="sm"
            className="h-7 text-xs gap-1"
            onClick={() => onUpload?.(currentPath)}
          >
            <Upload className="size-3" /> Upload
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
