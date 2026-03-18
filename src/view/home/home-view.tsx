import React from "react";
import { useInjectable } from "@/hooks/use-di";
import { AppStore } from "@/store/app";
import Terminal from "@/view/terminal/terminal-container";

const HomeView: React.FC = () => {
  const app = useInjectable(AppStore);

  // If there are tabs, show the terminal view
  if (app.tabs.length > 0 && app.activeTab) {
    return <Terminal />;
  }

  // Welcome screen when no tabs are open
  return (
    <div className="h-full flex items-center justify-center bg-background">
      <div className="text-center">
        <h1 className="text-2xl font-semibold mb-2">Welcome to Terminal</h1>
        <p className="text-muted-foreground mb-4">
          Select a host from the sidebar to connect
        </p>
        <div className="text-sm text-muted-foreground">
          <p>Or press <kbd className="px-2 py-0.5 bg-muted rounded">⌘N</kbd> to add a new host</p>
        </div>
      </div>
    </div>
  );
};

export default HomeView;
