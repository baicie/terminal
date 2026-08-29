import { Plus, Server } from 'lucide-react'
import type { Host } from '@/types'
import { Button } from '@/components/ui/button'
import { HostListSkeleton } from '@/components/ui/view-skeletons'
import { EmptyState } from '@/components/view-container'
import { HostCard } from '../host-card'
import { HostListView } from '../host-list-view'

interface RenderListBodyProps {
  loading: boolean
  filteredHosts: Host[]
  searchQuery: string
  isMobile: boolean
  gridView: boolean
  isTeamEnabled: boolean
  currentTeamId?: string
  onConnect: (host: Host) => void
  onShareHostClick: (host: Host) => void
  onAddHost: () => void
}

export const RenderListBody: React.FC<RenderListBodyProps> = ({
  loading,
  filteredHosts,
  searchQuery,
  isMobile,
  gridView,
  isTeamEnabled,
  currentTeamId,
  onConnect,
  onShareHostClick,
  onAddHost,
}) => {
  if (loading && isMobile) {
    return <HostListSkeleton count={8} />
  }

  if (filteredHosts.length === 0 && !loading) {
    return (
      <EmptyState
        icon={<Server className="size-12" />}
        title={
          searchQuery
            ? 'No hosts found'
            : 'No hosts yet'
        }
        description={
          searchQuery
            ? 'Try a different search term'
            : 'Add your first host to get started'
        }
        action={
          !searchQuery && (
            <Button
              size={isMobile ? 'sm' : 'default'}
              onClick={onAddHost}
            >
              <Plus className="size-4 mr-1" data-icon="inline-start" />
              Add Host
            </Button>
          )
        }
      />
    )
  }

  if (isMobile) {
    return (
      <div className="flex flex-col gap-2 px-3 pb-3">
        {filteredHosts.map((host, index) => (
          <HostCard
            key={host.id}
            host={host}
            variant="mobile"
            index={index}
            isTeamEnabled={isTeamEnabled}
            currentTeamId={currentTeamId}
            onConnect={onConnect}
            onShare={onShareHostClick}
          />
        ))}
      </div>
    )
  }

  return (
    <HostListView
      hosts={filteredHosts}
      searchQuery={searchQuery}
      loading={loading}
      gridView={gridView}
      handleConnect={onConnect}
      handleShareHostClick={onShareHostClick}
      isTeamEnabled={isTeamEnabled}
      currentTeamId={currentTeamId}
    />
  )
}
