import { Code, Download, Lock, Server } from 'lucide-react'
import type { SharedHost, SharedSnippet } from '@/store/team'
import { Button } from '@/components/ui/button'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { TeamSharedMobileHosts } from './team-shared-mobile-hosts'

interface TeamSharedSectionProps {
  isMobile?: boolean
  sharedHosts: SharedHost[]
  sharedSnippets: SharedSnippet[]
  isTeamEnabled: boolean
  currentTeamId?: string
  onImportSharedHost: (host: SharedHost) => void
  onImportSharedSnippet: (snippet: SharedSnippet) => void
}

export function TeamSharedSection({
  isMobile = false,
  sharedHosts,
  sharedSnippets,
  isTeamEnabled,
  currentTeamId,
  onImportSharedHost,
  onImportSharedSnippet,
}: TeamSharedSectionProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()

  if (!isTeamEnabled || !currentTeamId) {
    return null
  }

  if (sharedHosts.length === 0 && sharedSnippets.length === 0) {
    return null
  }

  if (isMobile) {
    return (
      <TeamSharedMobileHosts
        sharedHosts={sharedHosts}
        onImportSharedHost={onImportSharedHost}
      />
    )
  }

  return (
    <div className="space-y-4">
      {sharedHosts.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium flex items-center gap-2">
              <Server className="size-4" />
              {t('teams.sharedHosts')}
              <span className="text-muted-foreground">
                ({sharedHosts.length})
              </span>
            </h3>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => navigate('/teams')}
            >
              {t('common.settings')}
            </Button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {sharedHosts.slice(0, 3).map(sharedHost => {
              const hostData = sharedHost.hostData as Record<string, unknown>
              const isEncrypted = hostData._encrypted === true
              return (
                <button
                  type="button"
                  key={sharedHost.id}
                  className="text-left p-3 rounded-lg border border-dashed border-primary/30 bg-primary/5 hover:bg-primary/10 hover:border-primary/50 transition-all duration-200"
                  onClick={() => onImportSharedHost(sharedHost)}
                >
                  <div className="flex items-start gap-2">
                    <Server className="size-4 mt-0.5 text-primary" />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate flex items-center gap-1">
                        {(hostData.name as string) || 'Unknown'}
                        {isEncrypted && (
                          <Lock className="size-3 text-amber-500" />
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {hostData.username as string}@
                        {hostData.hostname as string}:
                        {(hostData.port as number) || 22}
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/20 text-primary">
                          {sharedHost.permission === 'readonly'
                            ? t('teams.readonly')
                            : t('teams.readwrite')}
                        </span>
                        {isEncrypted && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-500">
                            {t('teams.encrypted')}
                          </span>
                        )}
                      </div>
                    </div>
                    <Download className="size-4 text-muted-foreground shrink-0" />
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {sharedSnippets.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium flex items-center gap-2">
              <Code className="size-4" />
              {t('teams.sharedSnippets')}
              <span className="text-muted-foreground">
                ({sharedSnippets.length})
              </span>
            </h3>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => navigate('/teams')}
            >
              {t('common.settings')}
            </Button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {sharedSnippets.slice(0, 3).map(sharedSnippet => {
              const snippetData = sharedSnippet.snippetData as {
                name?: string
                description?: string
                script?: string
              }
              return (
                <button
                  type="button"
                  key={sharedSnippet.id}
                  className="text-left p-3 rounded-lg border border-dashed border-secondary/50 bg-secondary/5 hover:bg-secondary/10 hover:border-secondary/70 transition-all duration-200"
                  onClick={() => onImportSharedSnippet(sharedSnippet)}
                >
                  <div className="flex items-start gap-2">
                    <Code className="size-4 mt-0.5 text-secondary" />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">
                        {snippetData.name || 'Unknown'}
                      </div>
                      {snippetData.description && (
                        <div className="text-xs text-muted-foreground truncate">
                          {snippetData.description}
                        </div>
                      )}
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary/20 text-secondary">
                          {sharedSnippet.permission === 'readonly'
                            ? t('teams.readonly')
                            : t('teams.readwrite')}
                        </span>
                      </div>
                    </div>
                    <Download className="size-4 text-muted-foreground shrink-0" />
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
