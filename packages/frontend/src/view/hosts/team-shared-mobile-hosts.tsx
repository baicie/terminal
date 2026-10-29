import type { SharedHost } from '@/store/team'
import { Download, Server } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface TeamSharedMobileHostsProps {
  sharedHosts: SharedHost[]
  onImportSharedHost: (host: SharedHost) => void
}

export function TeamSharedMobileHosts({
  sharedHosts,
  onImportSharedHost,
}: TeamSharedMobileHostsProps) {
  const { t } = useTranslation()

  return (
    <div className="px-3 pt-3 space-y-3">
      {sharedHosts.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium flex items-center gap-2">
            <Server className="size-4" />
            {t('teams.sharedHosts')}
            <span className="text-muted-foreground">
              ({sharedHosts.length})
            </span>
          </h3>
          <div className="flex flex-col gap-2">
            {sharedHosts.slice(0, 3).map(sharedHost => {
              const hostData = sharedHost.hostData as Record<string, unknown>
              return (
                <button
                  key={sharedHost.id}
                  className="flex items-center gap-3 p-3 rounded-lg border border-dashed border-primary/30 bg-primary/5 text-left active:scale-[0.98] transition-transform"
                  onClick={() => onImportSharedHost(sharedHost)}
                >
                  <Download className="size-4 text-primary shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {(hostData.name as string) || 'Unknown'}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {hostData.username as string}@
                      {hostData.hostname as string}
                    </p>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
