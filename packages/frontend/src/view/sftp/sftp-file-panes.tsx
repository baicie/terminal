import type { FileItem } from '@/service/ssh'
import type { Host } from '@/types'
import { Computer, FolderOpen, Plus, Server } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ViewContent } from '@/components/view-container'
import { cn } from '@/lib/utils'
import type { useSftpLocal } from './hooks/use-sftp-local'
import type { useSftpRemote } from './hooks/use-sftp-remote'
import { FilePane } from './components/file-pane'

interface SftpFilePanesProps {
  activeHost: Host
  isMobile: boolean
  mobilePane: 'local' | 'remote'
  onMobilePaneChange: (pane: 'local' | 'remote') => void
  local: ReturnType<typeof useSftpLocal>
  remote: ReturnType<typeof useSftpRemote>
  onMkdir: () => void
  onUpload: () => void
  onDownload: (file: FileItem) => void
  onDelete: (file: FileItem) => void
  onRename: (file: FileItem) => void
}

export function SftpFilePanes({
  activeHost,
  isMobile,
  mobilePane,
  onMobilePaneChange,
  local,
  remote,
  onMkdir,
  onUpload,
  onDownload,
  onDelete,
  onRename,
}: SftpFilePanesProps) {
  return (
    <ViewContent
      className={cn(
        'p-3 flex gap-3 h-full overflow-hidden',
        isMobile ? 'flex-col' : 'flex-row',
      )}
    >
      {isMobile && (
        <div className="flex shrink-0 gap-1 mb-2">
          <Button
            size="sm"
            variant={mobilePane === 'local' ? 'default' : 'outline'}
            className="flex-1 text-xs"
            onClick={() => onMobilePaneChange('local')}
          >
            <Computer className="size-3 mr-1" /> Local
          </Button>
          <Button
            size="sm"
            variant={mobilePane === 'remote' ? 'default' : 'outline'}
            className="flex-1 text-xs"
            onClick={() => onMobilePaneChange('remote')}
          >
            <Server className="size-3 mr-1" /> Remote
          </Button>
        </div>
      )}

      <div
        className={cn(
          'flex-1 min-w-0 flex flex-col gap-2',
          isMobile && mobilePane !== 'local' && 'hidden',
        )}
      >
        <div className="flex items-center gap-2 px-1">
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1"
            onClick={local.pickFolder}
          >
            <FolderOpen className="size-3" /> Pick Folder
          </Button>
          <span className="text-xs text-muted-foreground truncate">
            {local.path}
          </span>
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
          onDownload={onDownload}
        />
      </div>

      <div
        className={cn(
          'flex-1 min-w-0 flex flex-col gap-2',
          isMobile && mobilePane !== 'remote' && 'hidden',
        )}
      >
        <div className="flex items-center gap-2 px-1">
          <span className="text-xs text-muted-foreground truncate">
            SFTP: {activeHost.hostname}
          </span>
          {isMobile && (
            <Button
              size="sm"
              className="h-7 text-xs gap-1 ml-auto"
              onClick={onMkdir}
            >
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
          onDelete={onDelete}
          onRename={onRename}
          onMkdir={onMkdir}
          onUpload={onUpload}
          onDownload={onDownload}
        />
      </div>
    </ViewContent>
  )
}
