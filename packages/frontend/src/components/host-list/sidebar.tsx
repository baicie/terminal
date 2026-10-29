import type { Host } from '@/types'
import { Monitor } from 'lucide-react'
import { useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Input } from '@/components/ui/input'
import { useAppStore } from '@/store/app'
import { useHostStore } from '@/store/host'
import { FavoritesSection, GroupsSection } from './sidebar-sections'

interface HostListProps {
  onConnect?: (host: Host) => void
}

const Sidebar: React.FC<HostListProps> = ({ onConnect }) => {
  const addTab = useAppStore(s => s.addTab)
  const loadHosts = useHostStore(s => s.loadHosts)
  const loadGroups = useHostStore(s => s.loadGroups)
  const navigate = useNavigate()

  const handleConnectHost = useCallback(
    (host: Host) => {
      onConnect?.(host)
      const newTab = addTab({
        label: host.name,
        type: 'remote',
        hostId: host.id,
      })
      navigate(`/terminal?tab=${newTab.id}`)
    },
    [addTab, navigate, onConnect],
  )

  const handleNewLocalTerminal = () => {
    const newTab = addTab({
      label: 'Local',
      type: 'local',
    })
    navigate(`/terminal?tab=${newTab.id}`)
  }

  useEffect(() => {
    loadHosts()
    loadGroups()
  }, [loadHosts, loadGroups])

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

        <FavoritesSection onConnect={handleConnectHost} />
        <GroupsSection onConnect={handleConnectHost} />
      </div>
    </div>
  )
}

export default Sidebar
