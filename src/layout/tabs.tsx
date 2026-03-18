import { useInjectable } from "@/hooks/use-di";
import { AppStore } from "@/store/app";
import { Button } from "@/components/ui/button";
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

  return (
    <div className="flex items-center gap-1">
      <Button
        variant={app.activeTabId === null ? "secondary" : "ghost"}
        size="sm"
        onClick={() => navigate("/")}
      >
        Home
      </Button>

      {app.tabs.map((tab) => (
        <div
          key={tab.id}
          className={`flex items-center gap-1 px-3 py-1.5 rounded-md text-sm ${
            app.activeTabId === tab.id
              ? "bg-secondary text-secondary-foreground"
              : "hover:bg-accent"
          }`}
          onClick={() => app.setActiveTab(tab.id)}
          onContextMenu={(e) => handleContextMenu(e, tab.id)}
        >
          <span className="cursor-pointer">
            {tab.label} {getTabStatus(tab)}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-4 w-4"
            onClick={(e) => {
              e.stopPropagation();
              app.removeTab(tab.id);
            }}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      ))}

      {contextMenu && (
        <div
          ref={menuRef}
          className="fixed z-50 bg-popover border rounded-md shadow-lg py-1 min-w-[160px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            className="w-full px-3 py-1.5 text-left text-sm hover:bg-accent flex items-center gap-2"
            onClick={handleSplitVertical}
          >
            <Columns className="w-4 h-4" />
            Split Vertical
          </button>
          <button
            className="w-full px-3 py-1.5 text-left text-sm hover:bg-accent flex items-center gap-2"
            onClick={handleSplitHorizontal}
          >
            <Rows className="w-4 h-4" />
            Split Horizontal
          </button>
          <div className="border-t my-1" />
          <button
            className="w-full px-3 py-1.5 text-left text-sm hover:bg-accent flex items-center gap-2"
            onClick={handleCloseSplit}
          >
            <X className="w-4 h-4" />
            Close Split
          </button>
        </div>
      )}
    </div>
  );
};

export default MenuTabs;
