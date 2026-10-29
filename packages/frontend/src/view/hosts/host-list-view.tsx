import type { Host } from '@/types'
import { Server } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { HostCard } from './host-card'

interface HostListViewProps {
  hosts: Host[]
  searchQuery: string
  loading: boolean
  gridView: boolean
  handleConnect: (host: Host) => void
  handleShareHostClick: (host: Host) => void
  isTeamEnabled: boolean
  currentTeamId?: string
}

/**
 * 桌面端主机网格/列表容器，仅负责布局，单卡片渲染交给 HostCard。
 */
export function HostListView({
  hosts,
  searchQuery,
  loading,
  gridView,
  handleConnect,
  handleShareHostClick,
  isTeamEnabled,
  currentTeamId,
}: HostListViewProps) {
  const { t } = useTranslation()

  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="h-24 rounded-xl border border-border/50 bg-card/80 animate-pulse"
          />
        ))}
      </div>
    )
  }

  if (hosts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Server className="size-12 text-muted-foreground/50 mb-4" />
        <h3 className="font-medium mb-1">{t('hosts.noHosts')}</h3>
        <p className="text-sm text-muted-foreground">
          {searchQuery
            ? t('hosts.tryDifferentSearch')
            : t('hosts.addFirstHost')}
        </p>
      </div>
    )
  }

  if (gridView) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {hosts.map((host, index) => (
          <HostCard
            key={host.id}
            host={host}
            variant="grid"
            index={index}
            isTeamEnabled={isTeamEnabled}
            currentTeamId={currentTeamId}
            onConnect={handleConnect}
            onShare={handleShareHostClick}
          />
        ))}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {hosts.map((host, index) => (
        <HostCard
          key={host.id}
          host={host}
          variant="list"
          index={index}
          isTeamEnabled={isTeamEnabled}
          currentTeamId={currentTeamId}
          onConnect={handleConnect}
          onShare={handleShareHostClick}
        />
      ))}
    </div>
  )
}
