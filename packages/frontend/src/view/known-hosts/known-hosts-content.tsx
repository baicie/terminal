import type { KnownHostRecord } from '@/service/database'
import { Fingerprint, Key, Server, Shield, Trash2, Upload } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { KeyListSkeleton } from '@/components/ui/view-skeletons'
import {
  EmptyState,
  ViewContent,
  ViewHeader,
} from '@/components/view-container'
import { format } from '@/lib/date-utils'

interface KnownHostsContentProps {
  hosts: KnownHostRecord[]
  loading: boolean
  selectedHost: KnownHostRecord | null
  setSelectedHost: (host: KnownHostRecord | null) => void
  onDelete: (host: KnownHostRecord) => void
  onDeleteFromDetails: (host: KnownHostRecord) => void
  onImport: () => void
}

export function KnownHostsContent({
  hosts,
  loading,
  selectedHost,
  setSelectedHost,
  onDelete,
  onDeleteFromDetails,
  onImport,
}: KnownHostsContentProps) {
  const { t } = useTranslation()
  return (
    <ViewContent className="p-6">
      <ViewHeader
        title={t('knownHosts.title')}
        description={t('knownHosts.description')}
      />
      {loading ? (
        <KeyListSkeleton count={6} />
      ) : hosts.length === 0 ? (
        <EmptyState
          icon={<Fingerprint className="size-12" />}
          title={t('knownHosts.noKnownHosts')}
          description={t('knownHosts.emptyDescription')}
          action={
            <Button onClick={onImport}>
              <Upload className="size-4 mr-1" data-icon="inline-start" />
              {t('knownHosts.import')}
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
          {hosts.map(host => (
            <div
              key={host.id}
              className="p-4 rounded-lg border bg-card hover:bg-accent/50 cursor-pointer transition-colors"
              onClick={() => setSelectedHost(host)}
            >
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-full bg-primary/10 text-primary">
                  <Server className="size-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{host.hostname}</div>
                  <div className="text-xs text-muted-foreground">
                    {t('knownHosts.portLabel', { port: host.port })}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1 font-mono truncate">
                    {host.key_type}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 hover:text-destructive"
                  onClick={event => {
                    event.stopPropagation()
                    onDelete(host)
                  }}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
      <Dialog open={!!selectedHost} onOpenChange={() => setSelectedHost(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Server className="size-5" />
              {selectedHost?.hostname}
            </DialogTitle>
            <DialogDescription>
              {t('knownHosts.detailsDescription')}
            </DialogDescription>
          </DialogHeader>
          {selectedHost && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm">
                <Key className="size-4 text-muted-foreground" />
                <span className="text-muted-foreground">
                  {t('knownHosts.keyType')}
                </span>
                <span className="font-mono">{selectedHost.key_type}</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Shield className="size-4 text-muted-foreground" />
                <span className="text-muted-foreground">
                  {t('knownHosts.port')}
                </span>
                <span>{selectedHost.port}</span>
              </div>
              <div className="space-y-1">
                <div className="text-sm text-muted-foreground">
                  {t('knownHosts.fingerprint')}
                </div>
                <div className="p-3 rounded-md bg-muted font-mono text-xs break-all">
                  {selectedHost.fingerprint}
                </div>
              </div>
              <div className="text-sm text-muted-foreground">
                {t('knownHosts.added', {
                  date: format(selectedHost.added_at, 'MMM dd, yyyy HH:mm'),
                })}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="destructive"
              onClick={() => {
                if (selectedHost) {
                  onDeleteFromDetails(selectedHost)
                }
              }}
            >
              <Trash2 className="size-4 mr-1" data-icon="inline-start" />
              {t('common.delete')}
            </Button>
            <Button variant="outline" onClick={() => setSelectedHost(null)}>
              {t('common.close')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ViewContent>
  )
}
