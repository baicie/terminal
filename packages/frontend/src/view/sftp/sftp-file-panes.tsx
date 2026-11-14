import type { FileItem } from '@/service/ssh'
import type { Host } from '@/types'
import { Computer, FolderOpen, Plus, Server } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { ViewContent } from '@/components/view-container'
import { cn } from '@/lib/utils'
import type { useSftpLocal } from './hooks/use-sftp-local'
import type { useSftpRemote } from './hooks/use-sftp-remote'
import { FilePane } from './components/file-pane'
import { pansNeedSingleColumn, useContainerWidth } from './use-container-width'

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

/**
 * One pane or two, decided by the width this component actually has.
 *
 * Two presentations, not two components:
 *
 * - **full** (`/sftp`, and the dock when it is wide enough) — local and remote side
 *   by side, both mounted, each with its own navigation and actions.
 * - **single** — one pane at a time with a local/remote switch. The dock is 300px
 *   inside a 1440px viewport, so a breakpoint cannot see that it is narrow; the
 *   switch is driven by a `ResizeObserver` on this element.
 *
 * The hidden pane stays **mounted**. Unmounting it would drop its directory listing,
 * scroll position and in-flight requests every time the user toggled, which is the
 * difference between a file browser and a file browser that reloads the server every
 * time you look at the other side.
 *
 * `isMobile` still forces single: the phone layout has its own navigation and the
 * viewport measurement alone would not catch a wide phone in landscape.
 */
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
  const { t } = useTranslation()
  const { width, ref } = useContainerWidth()
  const single = isMobile || pansNeedSingleColumn(width)

  return (
    <ViewContent className="h-full">
      {/*
        The measured element is inside `ViewContent` rather than being it: that
        component is shared with every other view and takes no ref, and widening its
        contract for one caller is a worse trade than one extra div. `h-full` on both
        keeps the layout identical to what the panes saw before.
      */}
      <div
        ref={ref}
        data-testid="sftp-file-panes"
        data-presentation={single ? 'single' : 'split'}
        // The measured content width, for the real-WebView spec (E2E-03): the same
        // number the decision uses, so the spec does not re-derive it from CSS.
        {...{ 'data-width': width ?? undefined }}
        className={cn(
          'p-3 flex gap-3 h-full overflow-hidden',
          single ? 'flex-col' : 'flex-row',
        )}
      >
        {single && (
          <div className="flex shrink-0 gap-1 mb-2" data-testid="pane-switch">
            <Button
              size="sm"
              variant={mobilePane === 'local' ? 'default' : 'outline'}
              className="flex-1 text-xs"
              aria-pressed={mobilePane === 'local'}
              onClick={() => onMobilePaneChange('local')}
            >
              <Computer className="size-3 mr-1" /> {t('sftp.local')}
            </Button>
            <Button
              size="sm"
              variant={mobilePane === 'remote' ? 'default' : 'outline'}
              className="flex-1 text-xs"
              aria-pressed={mobilePane === 'remote'}
              onClick={() => onMobilePaneChange('remote')}
            >
              <Server className="size-3 mr-1" /> {t('sftp.remote')}
            </Button>
          </div>
        )}

        <div
          data-testid="sftp-pane-local"
          className={cn(
            'flex-1 min-w-0 flex flex-col gap-2',
            single && mobilePane !== 'local' && 'hidden',
          )}
        >
          <div className="flex items-center gap-2 px-1 min-w-0">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1 shrink-0"
              onClick={local.pickFolder}
            >
              <FolderOpen className="size-3" /> {t('sftp.pickFolder')}
            </Button>
            <span
              className="text-xs text-muted-foreground truncate min-w-0"
              title={local.path}
            >
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
          data-testid="sftp-pane-remote"
          className={cn(
            'flex-1 min-w-0 flex flex-col gap-2',
            single && mobilePane !== 'remote' && 'hidden',
          )}
        >
          <div className="flex items-center gap-2 px-1 min-w-0">
            <span
              className="text-xs text-muted-foreground truncate min-w-0"
              title={`SFTP: ${activeHost.hostname}`}
            >
              SFTP: {activeHost.hostname}
            </span>
            {single && (
              <Button
                size="sm"
                className="h-7 text-xs gap-1 ml-auto shrink-0"
                onClick={onMkdir}
              >
                <Plus className="size-3" /> {t('sftp.folder')}
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
      </div>
    </ViewContent>
  )
}
