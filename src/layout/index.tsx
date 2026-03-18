import React, { useState } from "react";
import { Outlet } from "react-router-dom";
import { BellIcon, PanelLeft, Plus, Settings, Terminal, Code } from "lucide-react";
import { Button } from "@/components/ui/button";
import MenuTabs from "./tabs";
import { Sidebar, HostDialog } from "@/components/host-list";
import { useInjectable } from "@/hooks/use-di";
import { AppStore } from "@/store/app";
import SplitPane from "@/components/split-pane";
import TerminalContainer from "@/view/terminal/terminal-container";
import { observer } from "mobx-react-lite";
import SnippetManager from "@/components/snippet-manager";
import SettingsDialog from "@/components/settings-dialog";

const TerminalContent: React.FC<{ tabId: string }> = observer(({ tabId }) => {
  const app = useInjectable(AppStore);
  const tab = app.tabs.find((t) => t.id === tabId);

  if (!tab) return null;

  return <TerminalContainer key={tabId} tabId={tabId} />;
});

const DeftLayout: React.FC = () => {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [hostDialogOpen, setHostDialogOpen] = useState(false);
  const [snippetManagerOpen, setSnippetManagerOpen] = useState(false);
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const app = useInjectable(AppStore);

  const handleNewLocalTerminal = () => {
    const newTab = app.addTab({
      label: "Local",
      type: "local",
    });
    app.setActiveTab(newTab.id);
  };

  const handleExecuteSnippet = (script: string) => {
    // Find the active session and execute the script
    const activeTab = app.activeTab;
    if (activeTab && app.activeTabId) {
      // Get the session from the terminal store
      // For now, we'll just write the script to the terminal
      // The actual implementation would need to get the session ID
      console.log("Executing snippet:", script);
    }
    setSnippetManagerOpen(false);
  };

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
    <div className="h-screen flex flex-col">
      <header
        className="h-[50px] flex items-center justify-between px-4 border-b"
        data-tauri-drag-region
      >
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSidebarOpen(!sidebarOpen)}
          >
            <PanelLeft className="h-5 w-5" />
          </Button>
          <MenuTabs />
          <Button
            variant="ghost"
            size="sm"
            onClick={handleNewLocalTerminal}
          >
            <Terminal className="h-4 w-4 mr-1" />
            Local
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setHostDialogOpen(true)}
          >
            <Plus className="h-4 w-4 mr-1" />
            New Host
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSnippetManagerOpen(true)}
          >
            <Code className="h-4 w-4 mr-1" />
            Snippets
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => setSettingsDialogOpen(true)}>
            <Settings className="h-5 w-5" />
          </Button>
          <Button variant="ghost" size="icon">
            <BellIcon className="h-5 w-5" />
          </Button>
        </div>
      </header>
      <div className="flex-1 flex overflow-hidden">
        {sidebarOpen && (
          <Sidebar onConnect={(host) => {
            const newTab = app.addTab({
              label: host.name,
              type: "remote",
              hostId: host.id,
            });
            app.setActiveTab(newTab.id);
          }} />
        )}
        <main className="flex-1 overflow-hidden">
          {app.activeTabId ? renderTabContent(app.activeTabId) : <Outlet />}
        </main>
      </div>

      <HostDialog
        open={hostDialogOpen}
        onClose={() => setHostDialogOpen(false)}
      />

      <SnippetManager
        open={snippetManagerOpen}
        onClose={() => setSnippetManagerOpen(false)}
        onExecute={handleExecuteSnippet}
      />

      <SettingsDialog
        open={settingsDialogOpen}
        onClose={() => setSettingsDialogOpen(false)}
      />
    </div>
  );
};

export default observer(DeftLayout);
