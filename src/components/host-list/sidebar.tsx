import React, { useState } from 'react'
import { useInjectable } from '@/hooks/use-di'
import { HostStore } from '@/store/host'
import { AppStore } from '@/store/app'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useNavigate } from 'react-router-dom'
import type { Host, Group } from '@/types'
import {
  ChevronRight,
  ChevronDown,
  Star,
  StarOff,
  Folder,
  FolderOpen,
  Server,
  Monitor,
} from 'lucide-react'

interface HostListProps {
  onConnect?: (host: Host) => void
}

interface HostItemProps {
  host: Host
  onConnect?: (host: Host) => void
}

const HostItem: React.FC<HostItemProps> = ({ host, onConnect }) => {
  const hostStore = useInjectable(HostStore)

  return (
    <div
      className="group flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-secondary/60 cursor-pointer text-sm transition-colors"
      onClick={() => onConnect?.(host)}
    >
      <Server
        className="size-4 text-muted-foreground shrink-0"
        style={{ color: host.color }}
      />
      <span className="flex-1 truncate text-foreground/80">{host.name}</span>
      <Button
        variant="ghost"
        size="icon"
        className="size-6 opacity-0 group-hover:opacity-100"
        onClick={e => {
          e.stopPropagation()
          hostStore.toggleFavorite(host.id)
        }}
      >
        {host.isFavorite ? (
          <Star className="size-3 fill-yellow-500 text-yellow-500" />
        ) : (
          <StarOff className="size-3 text-muted-foreground" />
        )}
      </Button>
    </div>
  )
}

interface GroupItemProps {
  group: Group
  children: React.ReactNode
}

const GroupItem: React.FC<GroupItemProps> = ({ group, children }) => {
  const [expanded, setExpanded] = useState(true)

  return (
    <div>
      <div
        className="flex items-center gap-1 px-2 py-1.5 rounded-md hover:bg-secondary/60 cursor-pointer transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? (
          <ChevronDown className="size-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-4 text-muted-foreground" />
        )}
        {expanded ? (
          <FolderOpen
            className="size-4 text-muted-foreground"
            style={{ color: group.color }}
          />
        ) : (
          <Folder
            className="size-4 text-muted-foreground"
            style={{ color: group.color }}
          />
        )}
        <span className="text-sm font-medium text-foreground/80">
          {group.name}
        </span>
      </div>
      {expanded && <div className="ml-4">{children}</div>}
    </div>
  )
}

const FavoritesSection: React.FC<{ onConnect?: (host: Host) => void }> = ({
  onConnect,
}) => {
  const hostStore = useInjectable(HostStore)
  const favorites = hostStore.favoriteHosts

  if (favorites.length === 0) return null

  return (
    <div className="mb-2">
      <div className="px-2 py-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
        Favorites
      </div>
      {favorites.map(host => (
        <HostItem key={host.id} host={host} onConnect={onConnect} />
      ))}
    </div>
  )
}

const GroupsSection: React.FC<{
  onConnect?: (host: Host) => void
  parentId?: string | null
}> = ({ onConnect, parentId = null }) => {
  const hostStore = useInjectable(HostStore)
  const rootGroups = hostStore.getGroupChildren(parentId)
  const groupHosts = hostStore.getHostsByGroup(parentId)

  if (rootGroups.length === 0 && groupHosts.length === 0) {
    return null
  }

  return (
    <div>
      {groupHosts.map(host => (
        <HostItem key={host.id} host={host} onConnect={onConnect} />
      ))}
      {rootGroups.map(group => (
        <GroupItem key={group.id} group={group}>
          <GroupsSection onConnect={onConnect} parentId={group.id} />
        </GroupItem>
      ))}
    </div>
  )
}

const Sidebar: React.FC<HostListProps> = ({ onConnect }) => {
  const hostStore = useInjectable(HostStore)
  const app = useInjectable(AppStore)
  const navigate = useNavigate()

  const handleNewLocalTerminal = () => {
    const newTab = app.addTab({
      label: 'Local',
      type: 'local',
    })
    app.setActiveTab(newTab.id)
    navigate('/terminal')
  }

  React.useEffect(() => {
    hostStore.loadHosts()
    hostStore.loadGroups()
  }, [hostStore])

  return (
    <div className="w-60 h-full bg-secondary/40 border-r border-border/60 flex flex-col shrink-0">
      <div className="p-3">
        <Input placeholder="Search hosts..." className="h-8 text-sm" />
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-3">
        <div className="mb-4">
          <div className="px-2 py-2 text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wider">
            SESSIONS
          </div>
          <div
            className="flex items-center gap-2 px-2 py-2 rounded-md hover:bg-secondary/60 cursor-pointer text-sm text-foreground/80 transition-colors"
            onClick={handleNewLocalTerminal}
          >
            <Monitor className="size-4 text-muted-foreground shrink-0" />
            <span className="truncate">Local Terminal</span>
          </div>
        </div>

        <FavoritesSection onConnect={onConnect} />
        <GroupsSection onConnect={onConnect} />
      </div>
    </div>
  )
}

export default Sidebar
