import React, { useState, useEffect } from "react";
import { Outlet } from "react-router-dom";
import { useInjectable } from "@/hooks/use-di";
import { AppStore } from "@/store/app";
import SplitPane from "@/components/split-pane";
import TerminalContainer from "@/view/terminal/terminal-container";
import AppSidebar from "@/components/app-sidebar";
import TopToolbar from "@/components/top-toolbar";

const TerminalContent: React.FC<{ tabId: string }> = ({ tabId }) => {
  const app = useInjectable(AppStore);
  const tab = app.tabs.find((t) => t.id === tabId);

  if (!tab) return null;

  return <TerminalContainer key={tabId} tabId={tabId} />;
};

const MainLayoutInner: React.FC<{ sidebarOpen: boolean; onToggleSidebar: () => void }> = ({ sidebarOpen, onToggleSidebar }) => {
  const app = useInjectable(AppStore);

  const renderTabContent = (tabId: string) => {
    const tab = app.tabs.find((t) => t.id === tabId);
    if (!tab) return null;

    // Check if tab is part of a split group
    const splitGroup = tab.splitId ? app.splitGroups.find((g) => g.id === tab.splitId) : null;

    if (splitGroup && tab.splitChildren && tab.splitChildren.length > 0) {
      // Render split pane
      const children = splitGroup.tabs.map((id) => (
        <TerminalContent key={id} tabId={id} />
      ));
      return <SplitPane group={splitGroup}>{children}</SplitPane>;
    }

    // Single terminal
    return <TerminalContent tabId={tabId} />;
  };

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Top Toolbar - minimal with Host and SFTP tabs */}
      <TopToolbar onToggleSidebar={onToggleSidebar} />

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Sidebar - Navigation */}
        {sidebarOpen && <AppSidebar />}

        {/* Main Content - View Outlet or Terminal */}
        <main className="flex-1 overflow-hidden bg-background">
          {app.activeTabId ? renderTabContent(app.activeTabId) : <Outlet />}
        </main>
      </div>
    </div>
  );
};

const MainLayout: React.FC = () => {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const app = useInjectable(AppStore);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Command palette: Ctrl+J or Cmd+J
      if ((e.ctrlKey || e.metaKey) && e.key === 'j') {
        e.preventDefault();
        // Command palette will be handled by TopToolbar
      }
      // New terminal: Ctrl+T or Cmd+T
      if ((e.ctrlKey || e.metaKey) && e.key === 't') {
        e.preventDefault();
        handleNewLocalTerminal();
      }
      // New host: Ctrl+N or Cmd+N
      if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault();
        // Host dialog will be handled by TopToolbar
      }
      // Toggle sidebar: Ctrl+B or Cmd+B
      if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
        e.preventDefault();
        setSidebarOpen(prev => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleNewLocalTerminal = () => {
    const newTab = app.addTab({
      label: "Local",
      type: "local",
    });
    app.setActiveTab(newTab.id);
  };

  const handleToggleSidebar = () => {
    setSidebarOpen(prev => !prev);
  };

  return <MainLayoutInner sidebarOpen={sidebarOpen} onToggleSidebar={handleToggleSidebar} />;
};

export default MainLayout;
