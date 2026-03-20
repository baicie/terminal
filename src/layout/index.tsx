import React, { useState, useEffect, useRef, useCallback } from "react";
import { Outlet } from "react-router-dom";
import { useInjectable } from "@/hooks/use-di";
import { AppStore } from "@/store/app";
import SplitPane from "@/components/split-pane";
import TerminalContainer from "@/view/terminal/terminal-container";
import AppSidebar from "@/components/app-sidebar";
import TopToolbar from "@/components/top-toolbar";
import { cn } from "@/lib/utils";

const SIDEBAR_WIDTH_KEY = "terminal.sidebar.width";
const SIDEBAR_MIN = 80;  // 软限制（足够窄时自动切换图标模式）
const SIDEBAR_MAX = 420;
const SIDEBAR_DEFAULT = 200;
const COLLAPSE_THRESHOLD = 160;  // 窄于此值自动切换为图标模式

function readSidebarWidth(): number {
  try {
    const raw = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    if (!raw) return SIDEBAR_DEFAULT;
    const n = parseInt(raw, 10);
    if (Number.isNaN(n)) return SIDEBAR_DEFAULT;
    return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, n));
  } catch {
    return SIDEBAR_DEFAULT;
  }
}

function readSidebarCollapsed(): boolean {
  try {
    const raw = localStorage.getItem("terminal.sidebar.collapsed");
    return raw === "true";
  } catch {
    return false;
  }
}

const TerminalContent: React.FC<{ tabId: string }> = ({ tabId }) => {
  const app = useInjectable(AppStore);
  const tab = app.tabs.find((t) => t.id === tabId);

  if (!tab) return null;

  return <TerminalContainer key={tabId} tabId={tabId} />;
};

const MainLayoutInner: React.FC<{
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (v: boolean) => void;
  sidebarWidth: number;
  onSidebarWidthChange: (w: number) => void;
}> = ({ sidebarOpen, onToggleSidebar, sidebarCollapsed, setSidebarCollapsed, sidebarWidth, onSidebarWidthChange }) => {
  const app = useInjectable(AppStore);
  const [resizing, setResizing] = useState(false);
  const dragRef = useRef({ startX: 0, startWidth: SIDEBAR_DEFAULT });
  const lastWidthRef = useRef(sidebarWidth);
  lastWidthRef.current = sidebarWidth;

  const renderTabContent = (tabId: string) => {
    const tab = app.tabs.find((t) => t.id === tabId);
    if (!tab) return null;

    const splitGroup = tab.splitId ? app.splitGroups.find((g) => g.id === tab.splitId) : null;

    if (splitGroup && tab.splitChildren && tab.splitChildren.length > 0) {
      const children = splitGroup.tabs.map((id) => (
        <TerminalContent key={id} tabId={id} />
      ));
      return <SplitPane group={splitGroup}>{children}</SplitPane>;
    }

    return <TerminalContent tabId={tabId} />;
  };

  const onResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragRef.current = {
        startX: e.clientX,
        startWidth: sidebarCollapsed ? 64 : sidebarWidth,
      };
      setResizing(true);
    },
    [sidebarWidth, sidebarCollapsed]
  );

  const handleToggleCollapse = useCallback(() => {
    const next = !sidebarCollapsed;
    setSidebarCollapsed(next);
    try {
      localStorage.setItem("terminal.sidebar.collapsed", String(next));
      // 展开时恢复默认宽度
      if (next === false) {
        localStorage.setItem(SIDEBAR_WIDTH_KEY, String(SIDEBAR_DEFAULT));
        onSidebarWidthChange(SIDEBAR_DEFAULT);
      }
    } catch {
      /* ignore */
    }
  }, [sidebarCollapsed, setSidebarCollapsed, onSidebarWidthChange]);

  useEffect(() => {
    if (!resizing) return;

    const onMove = (e: MouseEvent) => {
      const dx = e.clientX - dragRef.current.startX;
      let next = dragRef.current.startWidth + dx;

      // 从图标模式展开
      if (sidebarCollapsed && dx > 30) {
        setSidebarCollapsed(false);
        dragRef.current.startWidth = SIDEBAR_DEFAULT;
        dragRef.current.startX = e.clientX;
        onSidebarWidthChange(SIDEBAR_DEFAULT);
        try {
          localStorage.setItem("terminal.sidebar.collapsed", "false");
        } catch {
          /* ignore */
        }
        return;
      }

      // 缩小到阈值时切换为图标模式
      if (!sidebarCollapsed && next < COLLAPSE_THRESHOLD) {
        setSidebarCollapsed(true);
        try {
          localStorage.setItem("terminal.sidebar.collapsed", "true");
        } catch {
          /* ignore */
        }
        setResizing(false);
        return;
      }

      next = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, next));
      lastWidthRef.current = next;
      onSidebarWidthChange(next);
    };

    const onUp = () => {
      setResizing(false);
      try {
        localStorage.setItem(SIDEBAR_WIDTH_KEY, String(lastWidthRef.current));
      } catch {
        /* ignore */
      }
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [resizing, onSidebarWidthChange, sidebarCollapsed, setSidebarCollapsed]);

  return (
    <div className="h-screen flex flex-col bg-background">
      <TopToolbar onToggleSidebar={onToggleSidebar} />

      <div className="flex-1 flex overflow-hidden min-h-0">
        {sidebarOpen && (
          <>
            <AppSidebar
              collapsed={sidebarCollapsed}
              onToggleCollapse={handleToggleCollapse}
              width={sidebarCollapsed ? undefined : sidebarWidth}
              resizing={resizing}
            />
            <div
              role="separator"
              aria-orientation="vertical"
              aria-valuenow={sidebarCollapsed ? 64 : sidebarWidth}
              tabIndex={0}
              className={cn(
                "w-1.5 shrink-0 cursor-col-resize flex items-stretch justify-center group outline-none",
                "hover:bg-border/80 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
              )}
              onMouseDown={onResizeStart}
            >
              <span className="w-px h-full bg-border/60 group-hover:bg-primary/40 transition-colors" />
            </div>
          </>
        )}

        <main className="flex-1 min-w-0 overflow-hidden bg-background">
          {app.activeTabId ? renderTabContent(app.activeTabId) : <Outlet />}
        </main>
      </div>
    </div>
  );
};

const MainLayout: React.FC = () => {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsed);
  const [sidebarWidth, setSidebarWidth] = useState(readSidebarWidth);
  const app = useInjectable(AppStore);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "t") {
        e.preventDefault();
        handleNewLocalTerminal();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "b") {
        e.preventDefault();
        setSidebarOpen((prev) => !prev);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleNewLocalTerminal = () => {
    const newTab = app.addTab({
      label: "Local",
      type: "local",
    });
    app.setActiveTab(newTab.id);
  };

  return (
    <MainLayoutInner
      sidebarOpen={sidebarOpen}
      onToggleSidebar={() => setSidebarOpen((p) => !p)}
      sidebarCollapsed={sidebarCollapsed}
      setSidebarCollapsed={setSidebarCollapsed}
      sidebarWidth={sidebarWidth}
      onSidebarWidthChange={setSidebarWidth}
    />
  );
};

export default MainLayout;
