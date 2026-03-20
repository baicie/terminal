import { useState } from "react";
import { observer } from "mobx-react-lite";
import { useNavigate, useLocation } from "react-router-dom";
import { BellIcon, Settings, Plus, FolderUp, Terminal, Usb, PanelLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useInjectable } from "@/hooks/use-di";
import { AppStore } from "@/store/app";
import WorkspaceSwitcher from "@/components/workspace-switcher";
import MenuTabs from "@/layout/tabs";
import { HostDialog } from "@/components/host-list/host-dialog";
import SerialDialog from "@/components/serial-dialog";
import CommandPalette from "@/components/command-palette";
import CommandHistoryDialog from "@/components/command-history";
import SettingsDialog from "@/components/settings-dialog";
import type { SerialConfig } from "@/service/serial";

const TopToolbar: React.FC<{
  onToggleSidebar: () => void;
}> = observer(({ onToggleSidebar }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const app = useInjectable(AppStore);

  const [hostDialogOpen, setHostDialogOpen] = useState(false);
  const [serialDialogOpen, setSerialDialogOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [commandHistoryOpen, setCommandHistoryOpen] = useState(false);
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);

  const isHostsActive = location.pathname === "/hosts";
  const isSftpActive = location.pathname === "/sftp";

  const handleNewLocalTerminal = () => {
    const newTab = app.addTab({
      label: "Local",
      type: "local",
    });
    app.setActiveTab(newTab.id);
  };

  const handleConnectSerial = (config: SerialConfig, sessionId: string) => {
    const portName = config.name.split('/').pop() || config.name;
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
  };

  return (
    <>
      <header
        className="h-11 flex items-center justify-between px-4 border-b border-border/60 bg-background shrink-0"
        data-tauri-drag-region
      >
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground hover:text-foreground"
            onClick={onToggleSidebar}
          >
            <PanelLeft className="size-4" />
          </Button>
          <WorkspaceSwitcher onSettingsClick={() => setSettingsDialogOpen(true)} />

          {/* Navigation Tabs - SFTP and Host only */}
          <div className="flex items-center gap-0.5 ml-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate("/hosts")}
              className={cn(
                "gap-1.5 h-8 px-3 rounded-md transition-all duration-150",
                isHostsActive
                  ? "bg-secondary/80 text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Terminal className="size-4" data-icon="inline-start" />
              Host
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate("/sftp")}
              className={cn(
                "gap-1.5 h-8 px-3 rounded-md transition-all duration-150",
                isSftpActive
                  ? "bg-secondary/80 text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <FolderUp className="size-4" data-icon="inline-start" />
              SFTP
            </Button>
          </div>

          <MenuTabs />

          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 h-8 px-2.5 text-muted-foreground hover:text-foreground"
            onClick={handleNewLocalTerminal}
          >
            <Terminal className="size-4" data-icon="inline-start" />
            Local
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 h-8 px-2.5 text-muted-foreground hover:text-foreground"
            onClick={() => setHostDialogOpen(true)}
          >
            <Plus className="size-4" data-icon="inline-start" />
            New Host
          </Button>
        </div>

        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground hover:text-foreground"
            onClick={() => setSerialDialogOpen(true)}
          >
            <Usb className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground hover:text-foreground"
            onClick={() => setSettingsDialogOpen(true)}
          >
            <Settings className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground hover:text-foreground"
          >
            <BellIcon className="size-4" />
          </Button>
        </div>
      </header>

      {/* Dialogs */}
      <HostDialog
        open={hostDialogOpen}
        onClose={() => setHostDialogOpen(false)}
      />

      <SerialDialog
        open={serialDialogOpen}
        onClose={() => setSerialDialogOpen(false)}
        onConnect={handleConnectSerial}
      />

      <SettingsDialog
        open={settingsDialogOpen}
        onClose={() => setSettingsDialogOpen(false)}
      />

      <CommandPalette
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
      />

      <CommandHistoryDialog
        open={commandHistoryOpen}
        onClose={() => setCommandHistoryOpen(false)}
        onSelect={(command) => {
          console.log("Execute command from history:", command);
        }}
      />
    </>
  );
});

export default TopToolbar;
