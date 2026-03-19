import React, { useState, useEffect } from "react";
import { Outlet } from "react-router-dom";
import { BellIcon, PanelLeft, Plus, Settings, Terminal, Code, History } from "lucide-react";
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
import CommandHistoryDialog from "@/components/command-history";
import CommandPalette from "@/components/command-palette";
import WorkspaceSwitcher from "@/components/workspace-switcher";

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
  const [commandHistoryOpen, setCommandHistoryOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const app = useInjectable(AppStore);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Command palette: Ctrl+J or Cmd+J
      if ((e.ctrlKey || e.metaKey) && e.key === 'j') {
        e.preventDefault();
        setCommandPaletteOpen(true);
      }
      // New terminal: Ctrl+T or Cmd+T
      if ((e.ctrlKey || e.metaKey) && e.key === 't') {
        e.preventDefault();
        handleNewLocalTerminal();
      }
      // New host: Ctrl+N or Cmd+N
      if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault();
        setHostDialogOpen(true);
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
    <div className="h-screen flex flex-col bg-background">
      <header
        className="h-11 flex items-center justify-between px-4 border-b border-border/60 bg-background shrink-0"
        data-tauri-drag-region
      >
        <div className="flex items-center gap-0.5">
          <WorkspaceSwitcher />
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground hover:text-foreground"
            onClick={() => setSidebarOpen(!sidebarOpen)}
          >
            <PanelLeft className="size-4" />
          </Button>
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
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 h-8 px-2.5 text-muted-foreground hover:text-foreground"
            onClick={() => setCommandHistoryOpen(true)}
          >
            <History className="size-4" data-icon="inline-start" />
            History
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 h-8 px-2.5 text-muted-foreground hover:text-foreground"
            onClick={() => setCommandPaletteOpen(true)}
            title="Command Palette (⌘J)"
          >
            <Terminal className="size-4" data-icon="inline-start" />
            <span className="opacity-60">⌘J</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 h-8 px-2.5 text-muted-foreground hover:text-foreground"
            onClick={() => setSnippetManagerOpen(true)}
          >
            <Code className="size-4" data-icon="inline-start" />
            Snippets
          </Button>
        </div>
        <div className="flex items-center gap-0.5">
          <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-foreground" onClick={() => setSettingsDialogOpen(true)}>
            <Settings className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" className="size-8 text-muted-foreground hover:text-foreground">
            <BellIcon className="size-4" />
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
        <main className="flex-1 overflow-hidden bg-background">
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

      <CommandHistoryDialog
        open={commandHistoryOpen}
        onClose={() => setCommandHistoryOpen(false)}
        onSelect={(command) => {
          // Execute the selected command in the active terminal
          const activeTab = app.activeTab;
          if (activeTab) {
            // The command will be sent to the terminal via the sshService
            // This is handled by the terminal component
            console.log("Execute command from history:", command);
          }
        }}
      />

      <CommandPalette
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
      />
    </div>
  );
};

export default observer(DeftLayout);
