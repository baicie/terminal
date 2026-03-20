import { useState, useEffect } from "react";
import { observer } from "mobx-react-lite";
import { useNavigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  BellIcon,
  FolderUp,
  MoreHorizontal,
  PanelLeft,
  Plus,
  Settings,
  Usb,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useInjectable } from "@/hooks/use-di";
import { AppStore } from "@/store/app";
import WorkspaceSwitcher from "@/components/workspace-switcher";
import MenuTabs from "@/layout/tabs";
import SerialDialog from "@/components/serial-dialog";
import CommandPalette from "@/components/command-palette";
import CommandHistoryDialog from "@/components/command-history";
import SettingsDialog from "@/components/settings-dialog";
import { HostDialog } from "@/components/host-list/host-dialog";
import type { SerialConfig } from "@/service/serial";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const TopToolbar: React.FC<{
  onToggleSidebar: () => void;
}> = observer(({ onToggleSidebar }) => {
  const { t } = useTranslation("demo");
  const navigate = useNavigate();
  const location = useLocation();
  const app = useInjectable(AppStore);

  const [serialDialogOpen, setSerialDialogOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [commandHistoryOpen, setCommandHistoryOpen] = useState(false);
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [hostDialogOpen, setHostDialogOpen] = useState(false);

  const isSftpActive = location.pathname === "/sftp";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "j") {
        e.preventDefault();
        setCommandPaletteOpen(true);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "n") {
        e.preventDefault();
        setHostDialogOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const handleNewLocalTerminal = () => {
    const newTab = app.addTab({
      label: "Local",
      type: "local",
    });
    app.setActiveTab(newTab.id);
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
  };

  return (
    <>
      <header
        className="h-11 flex items-center justify-between px-3 border-b border-border/60 bg-background shrink-0 gap-2"
        data-tauri-drag-region
      >
        <div className="flex items-center gap-1 min-w-0 flex-1" data-tauri-drag-region>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 shrink-0 text-muted-foreground hover:text-foreground"
            onClick={onToggleSidebar}
            title={t("toolbar.toggleSidebar")}
          >
            <PanelLeft className="size-4" />
          </Button>

          <WorkspaceSwitcher
            variant="vaults"
            onSettingsClick={() => setSettingsDialogOpen(true)}
          />

          {/* 参考图：顶栏以 SFTP 为主标签；主机从左侧栏进入 */}
          <div className="flex items-center gap-0.5 ml-2 min-w-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate("/sftp")}
              className={cn(
                "gap-1.5 h-8 px-3 rounded-md shrink-0 transition-all duration-150",
                isSftpActive
                  ? "bg-secondary/80 text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <FolderUp className="size-4" data-icon="inline-start" />
              {t("toolbar.sftp")}
            </Button>

            <MenuTabs />

            <Button
              variant="ghost"
              size="icon"
              className="size-8 shrink-0 text-muted-foreground hover:text-foreground"
              title={t("toolbar.newTab")}
              onClick={handleNewLocalTerminal}
            >
              <Plus className="size-4" />
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-0.5 shrink-0" data-tauri-drag-region>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-muted-foreground hover:text-foreground"
                title={t("toolbar.more")}
              >
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={() => setSettingsDialogOpen(true)}>
                <Settings className="size-4" data-icon="inline-start" />
                {t("toolbar.settings")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSerialDialogOpen(true)}>
                <Usb className="size-4" data-icon="inline-start" />
                {t("toolbar.serial")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setCommandPaletteOpen(true)}>
                {t("toolbar.commandPalette")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setCommandHistoryOpen(true)}>
                {t("toolbar.commandHistory")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground hover:text-foreground"
            title={t("toolbar.notifications")}
          >
            <BellIcon className="size-4" />
          </Button>
        </div>
      </header>

      <HostDialog open={hostDialogOpen} onClose={() => setHostDialogOpen(false)} />

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
