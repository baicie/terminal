import type { FileItem } from '@/service/ssh'
import { Computer, FolderOpen, Plus, RefreshCw, Server } from 'lucide-react'
import { useCallback, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useBreakpointMax } from '@/hooks/use-breakpoint'
import { ViewContainer, ViewContent, ViewToolbar } from '@/components/view-container'
import { cn } from '@/lib/utils'
import { uploadPaths } from '@/service/sftp-transfer'
import { useAppStore } from '@/store/app'
import { useHostStore } from '@/store/host'
import { FilePane } from './components/file-pane'
import { DeleteDialog } from './components/delete-dialog'
import { RenameDialog } from './components/rename-dialog'
import { MkdirDialog } from './components/mkdir-dialog'
import TransferPanel from './transfer-panel'
import { useSftpDrop } from './use-sftp-drop'
import { useSftpRemote } from './hooks/use-sftp-remote'
import { useSftpLocal } from './hooks/use-sftp-local'

const SftpContainer: React.FC = () => {
  const tabs = useAppStore(s => s.tabs)
  const activeTabId = useAppStore(s => s.activeTabId)
  const hosts = useHostStore(s => s.hosts)
  const isMobile = useBreakpointMax('md')

  const activeTab = tabs.find(t => t.id === activeTabId)
  const activeHost = activeTab?.hostId ? hosts.find(h => h.id === activeTab.hostId) : null

  // Mobile pane
  const [mobilePane, setMobilePane] = useState<'local' | 'remote'>('local')

  // Dialog state
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [fileToDelete, setFileToDelete] = useState<FileItem | null>(null)
  const [renameOpen, setRenameOpen] = useState(false)
  const [fileToRename, setFileToRename] = useState<FileItem | null>(null)
  const [mkdirOpen, setMkdirOpen] = useState(false)

  // Hooks
  const remote = useSftpRemote({ activeHost })
  const local = useSftpLocal()

  // Upload
  const handleUpload = useCallback(async () => {
    if (!remote.sessionId) return
    const { open } = await import('@tauri-apps/plugin-dialog')
    const selected = await open({ multiple: true })
    if (!selected) return
    const paths = Array.isArray(selected) ? selected : [selected]
    await uploadPaths({ sessionId: remote.sessionId, remoteDir: remote.path, localPaths: paths })
    void remote.loadDir(remote.path)
  }, [remote.sessionId, remote.path, remote.loadDir])

  // Download
  const handleDownload = useCallback(async (file: FileItem) => {
    if (!remote.sessionId || file.is_directory) return
    const { save } = await import('@tauri-apps/plugin-dialog')
    const fileName = file.name.split('/').pop() || file.name
    const target = await save({ defaultPath: fileName })
    if (!target) return
    const { downloadFile } = await import('@/service/sftp-transfer')
    await downloadFile({ sessionId: remote.sessionId, remotePath: file.path, localPath: target, displayName: fileName, bytesTotal: file.size })
  }, [remote.sessionId, remote.loadDir])

  const { isDragging } = useSftpDrop({ sessionId: remote.sessionId, remoteDir: remote.path })

  // No session
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
    <ViewContainer className="overflow-hidden relative">
      {isDragging && (
        <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-primary/5 border-2 border-primary border-dashed rounded-md">
          <div className="bg-popover px-6 py-4 rounded-lg shadow-lg border text-sm font-medium">
            Drop files to upload to <code className="font-mono">{remote.path}</code>
          </div>
        </div>
      )}

      <TransferPanel />

      <ViewToolbar className="gap-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Server className="size-4" />
          <span>{activeHost.name}</span>
        </div>
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={() => remote.loadDir(remote.path)}>
          <RefreshCw className={cn('size-4 mr-1', remote.loading && 'animate-spin')} />
          Refresh
        </Button>
      </ViewToolbar>

      <ViewContent className={cn('p-3 flex gap-3 h-full overflow-hidden', isMobile ? 'flex-col' : 'flex-row')}>
        {/* Mobile tabs */}
        {isMobile && (
          <div className="flex shrink-0 gap-1 mb-2">
            <Button size="sm" variant={mobilePane === 'local' ? 'default' : 'outline'} className="flex-1 text-xs" onClick={() => setMobilePane('local')}>
              <Computer className="size-3 mr-1" /> Local
            </Button>
            <Button size="sm" variant={mobilePane === 'remote' ? 'default' : 'outline'} className="flex-1 text-xs" onClick={() => setMobilePane('remote')}>
              <Server className="size-3 mr-1" /> Remote
            </Button>
          </div>
        )}

        {/* Local pane */}
        <div className={cn('flex-1 min-w-0 flex flex-col gap-2', isMobile && mobilePane !== 'local' && 'hidden')}>
          <div className="flex items-center gap-2 px-1">
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={local.pickFolder}>
              <FolderOpen className="size-3" /> Pick Folder
            </Button>
            <span className="text-xs text-muted-foreground truncate">{local.path}</span>
          </div>
          <FilePane
            type="local"
            files={local.files}
            currentPath={local.path}
            pathHistory={local.history}
            pathHistoryIndex={local.historyIndex}
            loading={local.loading}
            selectedFile={local.selectedFile}
            sessionId={null}
            onNavigate={local.navigate}
            onBack={local.goBack}
            onForward={local.goForward}
            onRefresh={() => local.loadDir(local.path)}
            onSelectFile={local.selectFile}
            onDelete={() => {}}
            onRename={() => {}}
            onMkdir={() => {}}
            onDownload={handleDownload}
          />
        </div>

        {/* Remote pane */}
        <div className={cn('flex-1 min-w-0 flex flex-col gap-2', isMobile && mobilePane !== 'remote' && 'hidden')}>
          <div className="flex items-center gap-2 px-1">
            <span className="text-xs text-muted-foreground truncate">SFTP: {activeHost.hostname}</span>
            {isMobile && (
              <Button size="sm" className="h-7 text-xs gap-1 ml-auto" onClick={() => setMkdirOpen(true)}>
                <Plus className="size-3" /> Folder
              </Button>
            )}
          </div>
          <FilePane
            type="remote"
            files={remote.files}
            currentPath={remote.path}
            pathHistory={remote.history}
            pathHistoryIndex={remote.historyIndex}
            loading={remote.loading}
            selectedFile={remote.selectedFile}
            sessionId={remote.sessionId}
            onNavigate={remote.navigate}
            onBack={remote.goBack}
            onForward={remote.goForward}
            onRefresh={() => remote.loadDir(remote.path)}
            onSelectFile={remote.selectFile}
            onDelete={file => { setFileToDelete(file); setDeleteOpen(true) }}
            onRename={file => { setFileToRename(file); setRenameOpen(true) }}
            onMkdir={() => setMkdirOpen(true)}
            onUpload={handleUpload}
            onDownload={handleDownload}
          />
        </div>
      </ViewContent>

      <DeleteDialog
        open={deleteOpen}
        file={fileToDelete}
        onOpenChange={setDeleteOpen}
        onConfirm={() => {
          if (fileToDelete) void remote.deleteFile(fileToDelete)
          setFileToDelete(null)
        }}
      />
      <RenameDialog
        open={renameOpen}
        file={fileToRename}
        onOpenChange={v => {
          setRenameOpen(v)
          if (!v) setFileToRename(null)
        }}
        onConfirm={newName => {
          void remote.renameFile(fileToRename!, newName)
          setRenameOpen(false)
          setFileToRename(null)
        }}
      />
      <MkdirDialog
        open={mkdirOpen}
        onOpenChange={setMkdirOpen}
        onConfirm={name => { void remote.mkdir(name); setMkdirOpen(false) }}
      />
    </ViewContainer>
  )
}

export default SftpContainer
