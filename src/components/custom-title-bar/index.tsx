import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Minus, Square, X, Minimize2, Copy, Settings, Cloud } from "lucide-react";
import { useState, useEffect } from "react";
import { useInjectable } from "@/hooks/use-di";
import { WorkspaceStore } from "@/store/workspace";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Plus, Check } from "lucide-react";
import type { Workspace } from "@/types";
import { Input } from "@/components/ui/input";
import { useRef } from "react";

export type TitleBarStyle = "macos" | "windows" | "linux";

interface CustomTitleBarProps {
  className?: string;
  style?: TitleBarStyle;
  title?: string;
  onSettingsClick?: () => void;
}

const detectPlatform = (): TitleBarStyle => {
  if (typeof navigator !== "undefined") {
    const platform = navigator.platform.toLowerCase();
    if (platform.includes("mac") || platform.includes("darwin")) {
      return "macos";
    }
    if (platform.includes("win") || platform.includes("windows")) {
      return "windows";
    }
  }
  return "linux";
};

// WorkspaceSwitcher component inline for simplicity
const WorkspaceSwitcher: React.FC<{ onSettingsClick?: () => void }> = ({ onSettingsClick }) => {
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const workspaceStore = useInjectable(WorkspaceStore);

  useEffect(() => {
    workspaceStore.loadWorkspaces();
  }, [workspaceStore]);

  const handleCreateWorkspace = async () => {
    if (!newName.trim()) return;
    await workspaceStore.addWorkspace({
      name: newName.trim(),
      icon: "📁",
      color: "#3b82f6",
    });
    setNewName("");
    setIsCreating(false);
  };

  const handleSelectWorkspace = async (workspace: Workspace) => {
    await workspaceStore.setActiveWorkspace(workspace.id);
  };

  const handleSaveEdit = async () => {
    if (editingId && editName.trim()) {
      await workspaceStore.updateWorkspace(editingId, { name: editName.trim() });
    }
    setEditingId(null);
    setEditName("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      if (isCreating) {
        handleCreateWorkspace();
      } else if (editingId) {
        handleSaveEdit();
      }
    } else if (e.key === "Escape") {
      setIsCreating(false);
      setEditingId(null);
      setEditName("");
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="gap-2 h-6 px-2 text-[#cccccc] hover:bg-[#3c3c3c] text-xs"
        >
          <Cloud className="size-3.5 shrink-0" />
          <span className="max-w-[80px] truncate">
            {workspaceStore.activeWorkspace?.name || "Vaults"}
          </span>
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-56">
        <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Workspaces
        </div>

        {workspaceStore.workspaces.map((workspace) => (
          <DropdownMenuItem
            key={workspace.id}
            onSelect={() => handleSelectWorkspace(workspace)}
            className="flex items-center gap-2 cursor-pointer py-2"
          >
            {editingId === workspace.id ? (
              <Input
                ref={inputRef}
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={handleSaveEdit}
                className="h-6 text-sm"
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <>
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: workspace.color || "#3b82f6" }}
                />
                <span className="flex-1 truncate">{workspace.name}</span>
                {workspace.isActive && (
                  <Check className="h-3.5 w-3.5 text-primary shrink-0" />
                )}
              </>
            )}
          </DropdownMenuItem>
        ))}

        {isCreating ? (
          <div className="px-2 py-2 flex items-center gap-2">
            <Input
              autoFocus
              placeholder="Workspace name..."
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={() => {
                if (!newName.trim()) setIsCreating(false);
              }}
              className="h-7 text-sm"
            />
          </div>
        ) : (
          <DropdownMenuItem
            onSelect={() => setIsCreating(true)}
            className="flex items-center gap-2 cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>New Workspace</span>
          </DropdownMenuItem>
        )}

        <DropdownMenuSeparator />

        <DropdownMenuItem
          onSelect={onSettingsClick}
          className="flex items-center gap-2 cursor-pointer"
        >
          <Settings className="h-3.5 w-3.5" />
          <span>Settings</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export const CustomTitleBar: React.FC<CustomTitleBarProps> = ({
  className,
  style = detectPlatform(),
  title = "Terminal",
  onSettingsClick,
}) => {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    const checkMaximized = async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const window = getCurrentWindow();
        const maximized = await window.isMaximized();
        setIsMaximized(maximized);
      } catch {
        // Not in Tauri context
      }
    };

    checkMaximized();

    const setupListener = async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const window = getCurrentWindow();
        const unlisten = await window.onResized(async () => {
          const maximized = await window.isMaximized();
          setIsMaximized(maximized);
        });
        return unlisten;
      } catch {
        return null;
      }
    };

    setupListener().then((unlisten) => {
      if (unlisten) {
        return () => unlisten();
      }
    });
  }, []);

  const handleMinimize = async () => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().minimize();
    } catch (e) {
      console.error("Failed to minimize:", e);
    }
  };

  const handleMaximize = async () => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const window = getCurrentWindow();
      if (isMaximized) {
        await window.unmaximize();
      } else {
        await window.maximize();
      }
      setIsMaximized(!isMaximized);
    } catch (e) {
      console.error("Failed to toggle maximize:", e);
    }
  };

  const handleClose = async () => {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().close();
    } catch (e) {
      console.error("Failed to close:", e);
    }
  };

  // macOS style - traffic lights on the left, title centered
  if (style === "macos") {
    return (
      <div
        className={cn(
          "h-8 flex items-center justify-between bg-[#1e1e1e] select-none",
          "border-b border-[#333333]",
          className
        )}
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      >
        {/* Left: Traffic lights + Workspace */}
        <div className="flex items-center gap-3 pl-3" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
          <div className="flex items-center gap-2" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
            <Button
              variant="ghost"
              size="icon"
              className="size-3 rounded-full bg-[#ff5f57] hover:bg-[#ff5f57]/80 border border-[#e0443b]"
              onClick={handleClose}
              aria-label="Close"
              style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
            />
            <Button
              variant="ghost"
              size="icon"
              className="size-3 rounded-full bg-[#febc2e] hover:bg-[#febc2e]/80 border border-[#e09a1f]"
              onClick={handleMinimize}
              aria-label="Minimize"
              style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
            />
            <Button
              variant="ghost"
              size="icon"
              className="size-3 rounded-full bg-[#28c840] hover:bg-[#28c840]/80 border border-[#1aab29]"
              onClick={handleMaximize}
              aria-label={isMaximized ? "Restore" : "Maximize"}
              style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
            />
          </div>
          <WorkspaceSwitcher onSettingsClick={onSettingsClick} />
        </div>

        {/* Title */}
        <span
          className="text-xs text-[#cccccc] font-medium absolute left-1/2 -translate-x-1/2"
        >
          {title}
        </span>

        {/* Right: Settings */}
        <div className="flex items-center gap-2 pr-3" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
          <Button
            variant="ghost"
            size="icon"
            className="size-6 text-[#cccccc] hover:bg-[#3c3c3c]"
            onClick={onSettingsClick}
            aria-label="Settings"
          >
            <Settings className="size-3.5" />
          </Button>
        </div>
      </div>
    );
  }

  // Windows/Linux style - title + workspace on left, settings + controls on right
  return (
    <div
      className={cn(
        "h-8 flex items-center justify-between bg-[#1e1e1e] select-none",
        "border-b border-[#333333]",
        className
      )}
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      {/* Left: Title + Workspace */}
      <div className="flex items-center gap-3 pl-3" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
        <span
          className="text-xs text-[#cccccc] font-medium"
        >
          {title}
        </span>
        <div className="h-4 w-px bg-[#333333]" />
        <WorkspaceSwitcher onSettingsClick={onSettingsClick} />
      </div>

      {/* Right: Settings + Window controls */}
      <div className="flex items-center h-full" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
        <Button
          variant="ghost"
          size="icon"
          className={cn(style === "windows" ? "size-10" : "size-8", "rounded-none hover:bg-[#3c3c3c] text-[#cccccc]")}
          onClick={onSettingsClick}
          aria-label="Settings"
        >
          <Settings className="size-4" />
        </Button>

        {style === "linux" ? (
          <>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 rounded-none hover:bg-[#3c3c3c]"
              onClick={handleMinimize}
              aria-label="Minimize"
            >
              <Minus className="size-4 text-[#cccccc]" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 rounded-none hover:bg-[#3c3c3c]"
              onClick={handleMaximize}
              aria-label={isMaximized ? "Restore" : "Maximize"}
            >
              {isMaximized ? (
                <Minimize2 className="size-4 text-[#cccccc]" />
              ) : (
                <Copy className="size-3.5 text-[#cccccc]" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 rounded-none hover:bg-[#c42b1c] hover:text-white"
              onClick={handleClose}
              aria-label="Close"
            >
              <X className="size-4" />
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="ghost"
              size="icon"
              className="size-10 rounded-none hover:bg-[#3c3c3c]"
              onClick={handleMinimize}
              aria-label="Minimize"
            >
              <Minus className="size-4 text-[#cccccc]" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-10 rounded-none hover:bg-[#3c3c3c]"
              onClick={handleMaximize}
              aria-label={isMaximized ? "Restore" : "Maximize"}
            >
              {isMaximized ? (
                <Minimize2 className="size-4 text-[#cccccc]" />
              ) : (
                <Square className="size-3.5 text-[#cccccc]" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-10 rounded-none hover:bg-[#c42b1c] hover:text-white"
              onClick={handleClose}
              aria-label="Close"
            >
              <X className="size-4" />
            </Button>
          </>
        )}
      </div>
    </div>
  );
};

export default CustomTitleBar;
