/**
 * The pane's own UI state: the menus, overlays and shell-status readouts.
 *
 * Grouped in one hook so `container.tsx` stays a wiring file inside its line
 * limit; nothing here touches the terminal, the session or a credential.
 */

import { useState } from 'react'

export interface TerminalPaneUi {
  mobileMenuOpen: boolean
  setMobileMenuOpen: (open: boolean) => void
  isFullscreen: boolean
  setIsFullscreen: (fullscreen: boolean) => void
  searchOpen: boolean
  setSearchOpen: (open: boolean) => void
  toolSidebarOpen: boolean
  setToolSidebarOpen: (open: boolean) => void
  shellCwd: string | undefined
  setShellCwd: (cwd: string | undefined) => void
  lastExitCode: number | undefined
  setLastExitCode: (code: number | undefined) => void
}

export function useTerminalPaneUi(): TerminalPaneUi {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [toolSidebarOpen, setToolSidebarOpen] = useState(false)
  const [shellCwd, setShellCwd] = useState<string | undefined>()
  const [lastExitCode, setLastExitCode] = useState<number | undefined>()
  return {
    mobileMenuOpen,
    setMobileMenuOpen,
    isFullscreen,
    setIsFullscreen,
    searchOpen,
    setSearchOpen,
    toolSidebarOpen,
    setToolSidebarOpen,
    shellCwd,
    setShellCwd,
    lastExitCode,
    setLastExitCode,
  }
}
