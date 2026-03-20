import { observer } from "mobx-react-lite";
import { useInjectable } from "@/hooks/use-di";
import { HostStore } from "@/store/host";
import { AppStore } from "@/store/app";
import { ViewContainer, ViewContent, ViewHeader, EmptyState } from "@/components/view-container";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  CalendarDays,
  ChevronDown,
  LayoutGrid,
  List,
  Plus,
  Server,
  Star,
  Tag,
  Terminal,
  Usb,
  UserPlus,
  Users,
} from "lucide-react";
import { HostDialog } from "@/components/host-list/host-dialog";
import SerialDialog from "@/components/serial-dialog";
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { Host } from "@/types";
import type { SerialConfig } from "@/service/serial";
import { toast } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";

const HostsView: React.FC = observer(() => {
  const { t } = useTranslation("demo");
  const hostStore = useInjectable(HostStore);
  const app = useInjectable(AppStore);

  useEffect(() => {
    void hostStore.loadHosts();
    void hostStore.loadGroups();
  }, [hostStore]);
  const [hostDialogOpen, setHostDialogOpen] = useState(false);
  const [serialDialogOpen, setSerialDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [gridView, setGridView] = useState(true);

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

  const handleConnectBarSubmit = () => {
    const q = searchQuery.trim();
    if (!q) {
      toast.info(t("toast.enterHost"));
      return;
    }
    const lower = q.toLowerCase();
    const match = hostStore.hosts.find(
      (h) =>
        h.name.toLowerCase().includes(lower) ||
        h.hostname.toLowerCase().includes(lower) ||
        `${h.username}@${h.hostname}`.toLowerCase().includes(lower.replace(/^ssh\s+/i, ""))
    );
    if (match) {
      handleConnect(match);
      return;
    }
    toast.info(t("toast.noMatchedHost"), {
      description: t("toast.useNewHost"),
    });
  };

  const handleConnectSerial = (config: SerialConfig, sessionId: string) => {
    const portName = config.name.split("/").pop() || config.name;
    const newTab = app.addTab({
      label: `Serial (${portName})`,
      type: "serial",
      serialSessionId: sessionId,
      serialConfig: {
        port: config.name,
        baudRate: config.baudRate,
      },
    });
    app.setActiveTab(newTab.id);
    setSerialDialogOpen(false);
  };

  const filteredHosts = hostStore.hosts.filter(
    (host) =>
      host.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      host.hostname.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <ViewContainer>
      {/* 参考图：主区顶部为连接条 + 工具条 */}
      <div className="shrink-0 border-b border-border/60 bg-background px-4 py-3 flex flex-col gap-3">
        <div className="flex items-stretch gap-2 w-full">
          <Input
            placeholder={t("hosts.search")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-10 flex-1 rounded-lg bg-secondary/40 border-border/60"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleConnectBarSubmit();
            }}
          />
          <Button className="h-10 px-6 shrink-0 rounded-lg" onClick={handleConnectBarSubmit}>
            {t("hosts.connect")}
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" size="sm" className="gap-1 rounded-md h-9">
                {t("hosts.newHost")}
                <ChevronDown className="size-4 opacity-70" data-icon="inline-end" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onClick={() => setHostDialogOpen(true)}>
                <Server className="size-4" data-icon="inline-start" />
                {t("hosts.sshHost")}
              </DropdownMenuItem>
              <DropdownMenuItem disabled>{t("hosts.importFromFile")}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button variant="outline" size="sm" className="h-9 rounded-md" onClick={handleNewLocalTerminal}>
            <Terminal className="size-4" data-icon="inline-start" />
            {t("hosts.terminal")}
          </Button>

          <Button variant="outline" size="sm" className="h-9 rounded-md" onClick={() => setSerialDialogOpen(true)}>
            <Usb className="size-4" data-icon="inline-start" />
            {t("hosts.serial")}
          </Button>

          <div className="flex-1" />

          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              className={cn("size-9 rounded-md", gridView && "bg-secondary/80")}
              title={t("hosts.grid")}
              onClick={() => setGridView(true)}
            >
              <LayoutGrid className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={cn("size-9 rounded-md", !gridView && "bg-secondary/80")}
              title={t("hosts.list")}
              onClick={() => setGridView(false)}
            >
              <List className="size-4" />
            </Button>
            <Button variant="ghost" size="icon" className="size-9 rounded-md" title={t("hosts.tags")}>
              <Tag className="size-4" />
            </Button>
            <Button variant="ghost" size="icon" className="size-9 rounded-md" title={t("hosts.calendar")}>
              <CalendarDays className="size-4" />
            </Button>
            <Button variant="ghost" size="icon" className="size-9 rounded-md" title={t("hosts.invite")}>
              <UserPlus className="size-4" />
            </Button>
          </div>
        </div>
      </div>

      <ViewContent className="p-6 flex flex-col gap-4 min-h-0">
        <Alert className="border-border/60 bg-secondary/20 py-3">
          <Users className="size-4" />
          <AlertTitle className="text-sm font-medium">{t("hosts.inviteMembers")}</AlertTitle>
          <AlertDescription className="text-xs text-muted-foreground">
            {t("hosts.inviteDesc")}
          </AlertDescription>
        </Alert>

        <ViewHeader title={t("hosts.title")} description={`${filteredHosts.length} ${t("hosts.title").toLowerCase()}`} />

        {filteredHosts.length === 0 ? (
          <EmptyState
            icon={<Server className="size-12" />}
            title={t("hosts.noHosts")}
            description={
              searchQuery ? t("hosts.tryDifferentSearch") : t("hosts.addFirstHost")
            }
            action={
              !searchQuery && (
                <Button onClick={() => setHostDialogOpen(true)}>
                  <Plus className="size-4 mr-1" data-icon="inline-start" />
                  {t("hosts.addHost")}
                </Button>
              )
            }
          />
        ) : gridView ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredHosts.map((host) => (
              <button
                type="button"
                key={host.id}
                className="text-left p-4 rounded-xl border border-border/50 bg-card/80 hover:bg-accent/40 cursor-pointer transition-colors shadow-sm"
                onClick={() => handleConnect(host)}
              >
                <div className="flex items-start gap-3">
                  <div className="p-2.5 rounded-lg bg-secondary/80">
                    <Server className="size-6" style={{ color: host.color || "#888" }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium truncate">{host.name}</h3>
                      {host.isFavorite && (
                        <Star className="size-4 fill-yellow-500 text-yellow-500 shrink-0" />
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground truncate mt-0.5">
                      {t("hosts.sshAuth", { username: host.username })}
                    </p>
                    <p className="text-xs text-muted-foreground/80 truncate mt-1">
                      {host.username}@{host.hostname}:{host.port}
                    </p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {filteredHosts.map((host) => (
              <button
                type="button"
                key={host.id}
                className="flex items-center gap-3 p-3 rounded-lg border border-border/50 bg-card/80 hover:bg-accent/40 text-left transition-colors"
                onClick={() => handleConnect(host)}
              >
                <Server className="size-5 shrink-0" style={{ color: host.color || "#888" }} />
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{host.name}</div>
                  <div className="text-sm text-muted-foreground truncate">
                    {t("hosts.sshAuth", { username: host.username })} · {host.hostname}
                  </div>
                </div>
                {host.isFavorite && <Star className="size-4 fill-yellow-500 text-yellow-500 shrink-0" />}
              </button>
            ))}
          </div>
        )}
      </ViewContent>

      <HostDialog open={hostDialogOpen} onClose={() => setHostDialogOpen(false)} />

      <SerialDialog
        open={serialDialogOpen}
        onClose={() => setSerialDialogOpen(false)}
        onConnect={handleConnectSerial}
      />
    </ViewContainer>
  );
});

export default HostsView;
