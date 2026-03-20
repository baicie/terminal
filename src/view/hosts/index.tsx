import { observer } from "mobx-react-lite";
import { useInjectable } from "@/hooks/use-di";
import { HostStore } from "@/store/host";
import { AppStore } from "@/store/app";
import { ViewContainer, ViewToolbar, ViewContent, ViewHeader, EmptyState } from "@/components/view-container";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Server, Plus, Star, Terminal } from "lucide-react";
import { HostDialog } from "@/components/host-list/host-dialog";
import { useState } from "react";
import type { Host } from "@/types";

const HostsView: React.FC = observer(() => {
  const hostStore = useInjectable(HostStore);
  const app = useInjectable(AppStore);
  const [hostDialogOpen, setHostDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const handleConnect = (host: Host) => {
    const newTab = app.addTab({
      label: host.name,
      type: "remote",
      hostId: host.id,
    });
    app.setActiveTab(newTab.id);
  };

  const handleNewLocalTerminal = () => {
    const newTab = app.addTab({
      label: "Local",
      type: "local",
    });
    app.setActiveTab(newTab.id);
  };

  const filteredHosts = hostStore.hosts.filter(
    (host) =>
      host.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      host.hostname.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <ViewContainer>
      <ViewToolbar className="gap-4">
        <Input
          placeholder="Search hosts..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="max-w-xs h-9"
        />
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={handleNewLocalTerminal}>
          <Terminal className="size-4 mr-1" data-icon="inline-start" />
          Local Terminal
        </Button>
        <Button size="sm" onClick={() => setHostDialogOpen(true)}>
          <Plus className="size-4 mr-1" data-icon="inline-start" />
          New Host
        </Button>
      </ViewToolbar>

      <ViewContent className="p-6">
        <ViewHeader
          title="Hosts"
          description={`${filteredHosts.length} hosts`}
        />

        {filteredHosts.length === 0 ? (
          <EmptyState
            icon={<Server className="size-12" />}
            title="No hosts found"
            description={searchQuery ? "Try a different search term" : "Add your first host to get started"}
            action={
              !searchQuery && (
                <Button onClick={() => setHostDialogOpen(true)}>
                  <Plus className="size-4 mr-1" data-icon="inline-start" />
                  Add Host
                </Button>
              )
            }
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredHosts.map((host) => (
              <div
                key={host.id}
                className="p-4 rounded-lg border border-border/60 bg-card hover:bg-accent/50 cursor-pointer transition-colors"
                onClick={() => handleConnect(host)}
              >
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-secondary">
                    <Server
                      className="size-5"
                      style={{ color: host.color || "#888" }}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium truncate">{host.name}</h3>
                      {host.isFavorite && (
                        <Star className="size-4 fill-yellow-500 text-yellow-500 shrink-0" />
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground truncate">
                      {host.username}@{host.hostname}:{host.port}
                    </p>
                    <p className="text-xs text-muted-foreground/70 mt-1">
                      {host.authType === "password" ? "Password" : "Key"} auth
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </ViewContent>

      <HostDialog
        open={hostDialogOpen}
        onClose={() => setHostDialogOpen(false)}
      />
    </ViewContainer>
  );
});

export default HostsView;
