import React, { useState } from "react";
import { useInjectable } from "@/hooks/use-di";
import { HostStore } from "@/store/host";
import { AppStore } from "@/store/app";
import { Button } from "@/components/ui/button";
import type { Host, Group } from "@/types";
import {
  ChevronRight,
  ChevronDown,
  Star,
  StarOff,
  Folder,
  FolderOpen,
  Server,
  Monitor,
} from "lucide-react";

interface HostListProps {
  onConnect?: (host: Host) => void;
}

interface HostItemProps {
  host: Host;
  onConnect?: (host: Host) => void;
}

const HostItem: React.FC<HostItemProps> = ({ host, onConnect }) => {
  const hostStore = useInjectable(HostStore);

  return (
    <div
      className="group flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent cursor-pointer text-sm"
      onClick={() => onConnect?.(host)}
    >
      <Server className="h-4 w-4 text-muted-foreground flex-shrink-0" style={{ color: host.color }} />
      <span className="flex-1 truncate">{host.name}</span>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 opacity-0 group-hover:opacity-100"
        onClick={(e) => {
          e.stopPropagation();
          hostStore.toggleFavorite(host.id);
        }}
      >
        {host.isFavorite ? (
          <Star className="h-3 w-3 fill-yellow-500 text-yellow-500" />
        ) : (
          <StarOff className="h-3 w-3 text-muted-foreground" />
        )}
      </Button>
    </div>
  );
};

interface GroupItemProps {
  group: Group;
  children: React.ReactNode;
}

const GroupItem: React.FC<GroupItemProps> = ({ group, children }) => {
  const [expanded, setExpanded] = useState(true);

  return (
    <div>
      <div
        className="flex items-center gap-1 px-2 py-1.5 rounded-md hover:bg-accent cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        )}
        {expanded ? (
          <FolderOpen className="h-4 w-4 text-muted-foreground" style={{ color: group.color }} />
        ) : (
          <Folder className="h-4 w-4 text-muted-foreground" style={{ color: group.color }} />
        )}
        <span className="text-sm font-medium">{group.name}</span>
      </div>
      {expanded && <div className="ml-4">{children}</div>}
    </div>
  );
};

const FavoritesSection: React.FC<{ onConnect?: (host: Host) => void }> = ({ onConnect }) => {
  const hostStore = useInjectable(HostStore);
  const favorites = hostStore.favoriteHosts;

  if (favorites.length === 0) return null;

  return (
    <div className="mb-2">
      <div className="px-2 py-1 text-xs font-semibold text-muted-foreground uppercase">
        Favorites
      </div>
      {favorites.map((host) => (
        <HostItem key={host.id} host={host} onConnect={onConnect} />
      ))}
    </div>
  );
};

const GroupsSection: React.FC<{ onConnect?: (host: Host) => void; parentId?: string | null }> = ({ onConnect, parentId = null }) => {
  const hostStore = useInjectable(HostStore);
  const rootGroups = hostStore.getGroupChildren(parentId);
  const groupHosts = hostStore.getHostsByGroup(parentId);

  if (rootGroups.length === 0 && groupHosts.length === 0) {
    return null;
  }

  return (
    <div>
      {groupHosts.map((host) => (
        <HostItem key={host.id} host={host} onConnect={onConnect} />
      ))}
      {rootGroups.map((group) => (
        <GroupItem key={group.id} group={group}>
          <GroupsSection onConnect={onConnect} parentId={group.id} />
        </GroupItem>
      ))}
    </div>
  );
};

const Sidebar: React.FC<HostListProps> = ({ onConnect }) => {
  const hostStore = useInjectable(HostStore);
  const app = useInjectable(AppStore);

  const handleNewLocalTerminal = () => {
    const newTab = app.addTab({
      label: "Local",
      type: "local",
    });
    app.setActiveTab(newTab.id);
  };

  React.useEffect(() => {
    hostStore.loadHosts();
    hostStore.loadGroups();
  }, [hostStore]);

  return (
    <div className="w-64 h-full bg-card border-r flex flex-col">
      <div className="p-2">
        <input
          type="text"
          placeholder="Search hosts..."
          className="w-full px-3 py-1.5 text-sm bg-background border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {/* Local Terminal Section */}
        <div className="mb-4">
          <div className="px-2 py-1 text-xs font-semibold text-muted-foreground uppercase">
            Sessions
          </div>
          <div
            className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent cursor-pointer text-sm"
            onClick={handleNewLocalTerminal}
          >
            <Monitor className="h-4 w-4 text-muted-foreground" />
            <span className="flex-1">Local Terminal</span>
          </div>
        </div>

        <FavoritesSection onConnect={onConnect} />
        <GroupsSection onConnect={onConnect} />
      </div>
    </div>
  );
};

export default Sidebar;
