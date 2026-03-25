import React from 'react'
import { useAppStore } from '@/store/app'
import Terminal from '@/view/terminal/terminal-container'

const HomeView: React.FC = () => {
  const tabs = useAppStore(s => s.tabs)
  const activeTabId = useAppStore(s => s.activeTabId)
  const activeTab = tabs.find(t => t.id === activeTabId)

  // If there are tabs, show the terminal view
  if (tabs.length > 0 && activeTab) {
    return <Terminal tabId={activeTabId!} />
  }

  // Welcome screen when no tabs are open
  return (
    <div className="h-full flex items-center justify-center bg-background">
      <div className="text-center max-w-md px-6">
        <h1 className="text-3xl font-semibold text-foreground tracking-tight mb-3">
          Welcome to Terminal
        </h1>
        <p className="text-sm text-muted-foreground mb-1">
          Select a host from the sidebar to connect
        </p>
        <p className="text-xs text-muted-foreground/70">
          Or press{' '}
          <kbd className="inline-flex items-center px-2 py-0.5 text-[11px] font-medium bg-secondary text-muted-foreground border border-border/60 rounded shadow-sm">
            ⌘N
          </kbd>{' '}
          to add a new host
        </p>
      </div>
    </div>
  )
}

export default HomeView
