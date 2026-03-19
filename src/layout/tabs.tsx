import { useInjectable } from "@/hooks/use-di";
import { AppStore } from "@/store/app";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { X, Columns, Rows } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useState, useRef, useEffect } from "react";

const MenuTabs: React.FC = () => {
  const app = useInjectable(AppStore);
  const navigate = useNavigate();
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    tabId: string;
  } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleContextMenu = (e: React.MouseEvent, tabId: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, tabId });
  };

  const handleSplitHorizontal = () => {
    if (contextMenu) {
      app.splitTab(contextMenu.tabId, "horizontal");
      setContextMenu(null);
    }
  };

  const handleSplitVertical = () => {
    if (contextMenu) {
      app.splitTab(contextMenu.tabId, "vertical");
      setContextMenu(null);
    }
  };

  const handleCloseSplit = () => {
    if (contextMenu) {
      app.closeSplit(contextMenu.tabId);
      setContextMenu(null);
    }
  };

  const getTabStatus = (tab: typeof app.tabs[0]) => {
    if (tab.splitMode && tab.splitMode !== "none") {
      return tab.splitMode === "horizontal" ? "⬜" : "⬛";
    }
    return "";
  };

  const isHomeActive = app.activeTabId === null;

  return (
    <div className="flex items-center gap-0.5">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => navigate("/")}
        className={cn(
          "rounded-md px-4 py-1 h-auto text-sm font-medium transition-all duration-150",
          isHomeActive
            ? "bg-secondary/80 text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground hover:bg-secondary/40"
        )}
      >
        Home
      </Button>

      {app.tabs.map((tab) => (
        <div
          key={tab.id}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1 rounded-md text-sm transition-all duration-150 cursor-pointer",
            app.activeTabId === tab.id
              ? "bg-secondary/80 text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground hover:bg-secondary/40"
          )}
          onClick={() => app.setActiveTab(tab.id)}
          onContextMenu={(e) => handleContextMenu(e, tab.id)}
        >
          <span>
            {tab.label} {getTabStatus(tab)}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="size-5 opacity-60 hover:opacity-100"
            onClick={(e) => {
              e.stopPropagation();
              app.removeTab(tab.id);
            }}
          >
            <X className="size-3" />
          </Button>
        </div>
      ))}

      {contextMenu && (
        <div
          ref={menuRef}
          className="fixed z-50 bg-popover border rounded-md shadow-lg py-1 min-w-[160px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <Button
            variant="ghost"
            className="w-full justify-start px-3 py-1.5 h-auto text-sm gap-2"
            onClick={handleSplitVertical}
          >
            <Columns className="size-4" />
            Split Vertical
          </Button>
          <Button
            variant="ghost"
            className="w-full justify-start px-3 py-1.5 h-auto text-sm gap-2"
            onClick={handleSplitHorizontal}
          >
            <Rows className="size-4" />
            Split Horizontal
          </Button>
          <Separator className="my-1" />
          <Button
            variant="ghost"
            className="w-full justify-start px-3 py-1.5 h-auto text-sm gap-2"
            onClick={handleCloseSplit}
          >
            <X className="size-4" />
            Close Split
          </Button>
        </div>
      )}
    </div>
  );
};

export default MenuTabs;
