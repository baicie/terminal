import type { FileItem } from '@/service/ssh'
import { FolderOpen } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useBreakpointMax } from '@/hooks/use-breakpoint'
import { ViewContainer, ViewContent } from '@/components/view-container'
import { uploadPaths } from '@/service/sftp-transfer'
import { useAppStore } from '@/store/app'
import { useHostStore } from '@/store/host'
import { useSftpBindingStore } from '@/store/sftp-binding-store'
import {
  differsFromActiveTab,
  resolveSftpHostId,
} from '@/store/sftp-binding'
import { SftpDialogs } from './components/sftp-dialogs'
import TransferPanel from './transfer-panel'
import { useSftpDrop } from './use-sftp-drop'
import { useSftpRemote } from './hooks/use-sftp-remote'
import { useSftpLocal } from './hooks/use-sftp-local'
import { SftpFilePanes } from './sftp-file-panes'
import { SftpDockToolbar } from './sftp-dock-toolbar'

const SftpContainer: React.FC = () => {
  const { t } = useTranslation()
  const tabs = useAppStore(s => s.tabs)
  const activeTabId = useAppStore(s => s.activeTabId)
  const hosts = useHostStore(s => s.hosts)
  const isMobile = useBreakpointMax('md')

  const activeTab = tabs.find(t => t.id === activeTabId)
  const pinnedHostId = useSftpBindingStore(state => state.hostId)
  // `INV-13`: a pin wins over the active tab; focus is not an instruction to
  // open a different server. First visit pins the current tab's host.
  const hostId = resolveSftpHostId(pinnedHostId, activeTab?.hostId)
  const activeHost = hostId ? (hosts.find(h => h.id === hostId) ?? null) : null
  const followsAnotherTab = differsFromActiveTab(pinnedHostId, activeTab?.hostId)

  // Mobile pane
  const [mobilePane, setMobilePane] = useState<'local' | 'remote'>('local')

  // Dialog state
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [fileToDelete, setFileToDelete] = useState<FileItem | null>(null)
  const [renameOpen, setRenameOpen] = useState(false)
  const [fileToRename, setFileToRename] = useState<FileItem | null>(null)
  const [mkdirOpen, setMkdirOpen] = useState(false)

  // Pin on first open; a later tab switch leaves the panel where it is.
  const openFor = useSftpBindingStore(state => state.openFor)
  useEffect(() => {
    if (pinnedHostId === null && activeTab?.hostId) openFor(activeTab.hostId)
    // Deliberately keyed on the pin, not on the active tab: re-pinning whenever
    // focus moves is the defect this replaced.
  }, [pinnedHostId, activeTab?.hostId, openFor])

  const followHostOfActiveTab = useCallback(() => {
    if (activeTab?.hostId) openFor(activeTab.hostId)
  }, [activeTab?.hostId, openFor])

  // Hooks
  const remote = useSftpRemote({ activeHost })
  const local = useSftpLocal()
  const {
    loadDir: loadRemoteDir,
    path: remotePath,
    sessionId: remoteSessionId,
  } = remote

  // Upload
  const handleUpload = useCallback(async () => {
    if (!remoteSessionId) return
    const { open } = await import('@tauri-apps/plugin-dialog')
    const selected = await open({ multiple: true })
    if (!selected) return
    const paths = Array.isArray(selected) ? selected : [selected]
    await uploadPaths({
      sessionId: remoteSessionId,
      remoteDir: remotePath,
      localPaths: paths,
    })
    void loadRemoteDir(remotePath)
  }, [loadRemoteDir, remotePath, remoteSessionId])

  // Download
  const handleDownload = useCallback(
    async (file: FileItem) => {
      if (!remoteSessionId || file.is_directory) return
      const { save } = await import('@tauri-apps/plugin-dialog')
      const fileName = file.name.split('/').pop() || file.name
      const target = await save({ defaultPath: fileName })
      if (!target) return
      const { downloadFile } = await import('@/service/sftp-transfer')
      await downloadFile({
        sessionId: remoteSessionId,
        remotePath: file.path,
        localPath: target,
        displayName: fileName,
        bytesTotal: file.size,
      })
    },
    [remoteSessionId],
  )

  const { isDragging } = useSftpDrop({
    sessionId: remote.sessionId,
    remoteDir: remote.path,
  })

  // No session
  if (!activeHost) {
    return (
      <ViewContainer>
        <ViewContent className="p-6">
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <FolderOpen className="size-16 text-muted-foreground/50" />
            <div className="text-center">
              <p className="text-lg font-medium">
                {t('sftp.noActiveSession')}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                {t('sftp.noActiveSessionDesc')}
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
            {t('sftp.dropToUpload', { path: remote.path })}
          </div>
        </div>
      )}

      <TransferPanel />

      <SftpDockToolbar
        boundHostName={activeHost.name}
        followsAnotherTab={followsAnotherTab}
        loading={remote.loading}
        onFollowActiveTab={followHostOfActiveTab}
        onRefresh={() => remote.loadDir(remote.path)}
      />

      <SftpFilePanes
        activeHost={activeHost}
        isMobile={isMobile}
        mobilePane={mobilePane}
        onMobilePaneChange={setMobilePane}
        local={local}
        remote={remote}
        onMkdir={() => setMkdirOpen(true)}
        onUpload={handleUpload}
        onDownload={handleDownload}
        onDelete={file => {
          setFileToDelete(file)
          setDeleteOpen(true)
        }}
        onRename={file => {
          setFileToRename(file)
          setRenameOpen(true)
        }}
      />

      <SftpDialogs
        deleteOpen={deleteOpen}
        fileToDelete={fileToDelete}
        onDeleteOpenChange={setDeleteOpen}
        onDeleteConfirm={() => {
          if (fileToDelete) void remote.deleteFile(fileToDelete)
          setFileToDelete(null)
        }}
        renameOpen={renameOpen}
        fileToRename={fileToRename}
        onRenameOpenChange={v => {
          setRenameOpen(v)
          if (!v) setFileToRename(null)
        }}
        onRenameConfirm={newName => {
          void remote.renameFile(fileToRename!, newName)
          setRenameOpen(false)
          setFileToRename(null)
        }}
        mkdirOpen={mkdirOpen}
        onMkdirOpenChange={setMkdirOpen}
        onMkdirConfirm={name => {
          void remote.mkdir(name)
          setMkdirOpen(false)
        }}
      />
    </ViewContainer>
  )
}

export default SftpContainer
