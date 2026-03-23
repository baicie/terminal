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
  Usb,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useInjectable } from "@/hooks/use-di";
import { AppStore } from "@/store/app";
import MenuTabs from "@/layout/tabs";
import SerialDialog from "@/components/serial-dialog";
import CommandPalette from "@/components/command-palette";
import CommandHistoryDialog from "@/components/command-history";
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
  const [hostDialogOpen, setHostDialogOpen] = useState(false);
  /** macOS + Tauri：为原生红绿灯留出左侧空间，避免顶栏盖住系统按钮 */
  const [padForMacTrafficLights, setPadForMacTrafficLights] = useState(false);

  const isSftpActive = location.pathname === "/sftp";

  useEffect(() => {
    if (typeof window === "undefined" || !("__TAURI__" in window)) return;
    const p = navigator.platform?.toLowerCase() ?? "";
    const ua = navigator.userAgent?.toLowerCase() ?? "";
    const isMac = p.includes("mac") || ua.includes("mac");
    if (isMac) setPadForMacTrafficLights(true);
  }, []);

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
    navigate("/terminal");
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
    navigate("/terminal");
  };

  return (
    <>
      <header
        className={cn(
          "h-11 flex items-center justify-between border-b border-border/60 bg-background shrink-0 gap-2",
          padForMacTrafficLights ? "pl-[76px] pr-3" : "px-3",
        )}
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

          {/* SFTP + Tabs + New Tab */}
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
