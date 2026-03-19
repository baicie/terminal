import { observer } from "mobx-react-lite";
import { useEffect, useRef, useCallback, useState } from "react";
import View from "./terminal-view";
import { useTranslation } from "react-i18next";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { useInjectable } from "@/hooks/use-di";
import { AppStore } from "@/store/app";
import { HostStore } from "@/store/host";
import { sshService, ShellOutput } from "@/service/ssh";
import { getCommandHistory } from "@/service/database";
import type { Host } from "@/types";

interface TerminalContainerProps {
  tabId?: string;
}

export default observer((props: TerminalContainerProps) => {
  const { t } = useTranslation();
  const terminalRef = useRef<HTMLDivElement | null>(null);
  const terminal = useRef<Terminal | null>(null);
  const fitAddon = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const isLocalRef = useRef<boolean>(false);
  const app = useInjectable(AppStore);
  const hostStore = useInjectable(HostStore);
  const unlistenDataRef = useRef<(() => void) | null>(null);
  const unlistenCloseRef = useRef<(() => void) | null>(null);

  // Command history for autocomplete
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const historyIndexRef = useRef<number>(-1);
  const currentInputRef = useRef<string>("");
  const terminalInstanceRef = useRef<Terminal | null>(null);
  const activeTabIdRef = useRef<string | null>(null);

  // Load command history on mount
  useEffect(() => {
    const loadHistory = async () => {
      try {
        const history = await getCommandHistory();
        const commands = history.map(h => h.command).filter(Boolean);
        setCommandHistory(commands);
      } catch (e) {
        console.error("Failed to load command history:", e);
      }
    };
    loadHistory();
  }, []);

  // Get current command line from cursor position
  const getCurrentLine = useCallback((term: Terminal): string => {
    const cursorY = term.buffer.active.cursorY;
    const line = term.buffer.active.getLine(cursorY);
    if (!line) return "";

    let result = "";
    for (let x = 0; x < term.cols; x++) {
      const cell = line.getCell(x);
      if (!cell || cell.getChars() === '') break;
      const char = cell.getChars();
      if (char === '\x00') break;
      result += char;
    }
    return result.trim();
  }, []);

  // Set terminal line
  const setCurrentLine = useCallback((term: Terminal, newLine: string) => {
    const cursorY = term.buffer.active.cursorY;
    const startX = 0;

    // Clear from startX to end of line
    for (let x = startX; x < term.cols; x++) {
      term.write('\x1b[K'); // Clear line from cursor to end
    }

    // Go to start of line
    for (let x = cursorY; x > startX; x--) {
      term.write('\x08'); // Backspace
    }

    // Write new line
    term.write(newLine);
  }, []);

  // Handle command history navigation (Up/Down arrows)
  const handleHistoryNavigation = useCallback((key: 'ArrowUp' | 'ArrowDown') => {
    const term = terminalInstanceRef.current;
    if (!term || commandHistory.length === 0) return false;

    if (key === 'ArrowUp') {
      if (historyIndexRef.current === -1) {
        // Save current input
        currentInputRef.current = getCurrentLine(term);
        historyIndexRef.current = commandHistory.length - 1;
      } else if (historyIndexRef.current > 0) {
        historyIndexRef.current--;
      }

      if (historyIndexRef.current >= 0) {
        const cmd = commandHistory[historyIndexRef.current];
        setCurrentLine(term, cmd);
      }
      return true;
    } else if (key === 'ArrowDown') {
      if (historyIndexRef.current === -1) return true;

      if (historyIndexRef.current < commandHistory.length - 1) {
        historyIndexRef.current++;
        const cmd = commandHistory[historyIndexRef.current];
        setCurrentLine(term, cmd);
      } else {
        // Back to current input
        historyIndexRef.current = -1;
        setCurrentLine(term, currentInputRef.current);
      }
      return true;
    }
    return false;
  }, [commandHistory, getCurrentLine, setCurrentLine]);

  // Use props.tabId or fall back to active tab
  const activeTabId = props.tabId || app.activeTabId;
  const activeTab = app.tabs.find((tab) => tab.id === activeTabId);

  // Keep ref in sync
  useEffect(() => {
    activeTabIdRef.current = activeTabId || null;
  }, [activeTabId]);

  const connectToHost = useCallback(async (host: Host) => {
    if (!terminal.current) return;

    isLocalRef.current = false;
    terminal.current.write('\r\nConnecting...\r\n');

    // Connect to SSH
    const result = await sshService.connect(host);

    if (!result.success || !result.sessionId) {
      terminal.current.write(`\r\nConnection failed: ${result.message}\r\n`);
      return;
    }

    sessionIdRef.current = result.sessionId;
    app.updateTab(activeTabId!, {
      hostId: host.id,
      connectionStatus: 'connected'
    });

    // Get terminal size
    const size = terminal.current?.cols && terminal.current?.rows
      ? { cols: terminal.current.cols, rows: terminal.current.rows }
      : { cols: 80, rows: 24 };

    // Start shell
    const shellResult = await sshService.startShell(result.sessionId, size.cols, size.rows);

    if (!shellResult.success) {
      terminal.current.write(`\r\nFailed to start shell: ${shellResult.message}\r\n`);
      return;
    }

    terminal.current.write('\r\n');
  }, [app, activeTabId]);

  const connectToLocal = useCallback(async () => {
    if (!terminal.current) return;

    isLocalRef.current = true;
    terminal.current.write('\r\nStarting local shell...\r\n');

    // Get terminal size
    const size = terminal.current?.cols && terminal.current?.rows
      ? { cols: terminal.current.cols, rows: terminal.current.rows }
      : { cols: 80, rows: 24 };

    // Start local shell
    const result = await sshService.startLocalShell(size.cols, size.rows);

    if (!result.success || !result.sessionId) {
      terminal.current.write(`\r\nFailed to start local shell: ${result.message}\r\n`);
      return;
    }

    sessionIdRef.current = result.sessionId;
    app.updateTab(activeTabId!, {
      connectionStatus: 'connected'
    });

    terminal.current.write('\r\n');
  }, [app, activeTabId]);

  useEffect(() => {
    if (!terminalRef.current) return;

    terminal.current = new Terminal({
      allowProposedApi: true,
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#1e1e1e',
        foreground: '#cccccc',
        cursor: '#ffffff',
        cursorAccent: '#1e1e1e',
        selectionBackground: '#264f78',
        black: '#000000',
        red: '#cd3131',
        green: '#0dbc79',
        yellow: '#e5e510',
        blue: '#2472c8',
        magenta: '#bc3fbc',
        cyan: '#11a8cd',
        white: '#e5e5e5',
        brightBlack: '#666666',
        brightRed: '#f14c4c',
        brightGreen: '#23d18b',
        brightYellow: '#f5f543',
        brightBlue: '#3b8eea',
        brightMagenta: '#d670d6',
        brightCyan: '#29b8db',
        brightWhite: '#ffffff',
      },
    });

    fitAddon.current = new FitAddon();
    terminal.current.loadAddon(fitAddon.current);

    terminal.current.open(terminalRef.current);
    fitAddon.current.fit();

    terminal.current.loadAddon(new SearchAddon());
    terminal.current.loadAddon(new WebLinksAddon());

    // Store terminal instance
    terminalInstanceRef.current = terminal.current;

    // Handle user input - send to SSH or local
    terminal.current.onData((data) => {
      const term = terminalInstanceRef.current;
      const sessionId = sessionIdRef.current;
      const tabId = activeTabIdRef.current;

      // Check for history navigation (ArrowUp/ArrowDown)
      if (data === '\x1b[A' || data === '\x1b[B') {
        const handled = handleHistoryNavigation(data === '\x1b[A' ? 'ArrowUp' : 'ArrowDown');
        if (handled) return;
      }

      if (sessionId) {
        if (isLocalRef.current) {
          sshService.writeLocal(sessionId, data);
        } else {
          sshService.write(sessionId, data);
        }

        // Save command to history when Enter is pressed
        if (data === '\r' && !isLocalRef.current && term && tabId) {
          const currentCmd = getCurrentLine(term);
          if (currentCmd) {
            sshService.saveCommandHistory(tabId, currentCmd, sessionId);
            // Update local history state
            setCommandHistory(prev => {
              if (prev.includes(currentCmd)) return prev;
              return [...prev, currentCmd];
            });
          }
          // Reset history index
          historyIndexRef.current = -1;
        }
      }
    });

    // Handle resize
    terminal.current.onResize(({ cols, rows }) => {
      if (sessionIdRef.current) {
        if (isLocalRef.current) {
          sshService.resizeLocal(sessionIdRef.current, cols, rows);
        } else {
          sshService.resize(sessionIdRef.current, cols, rows);
        }
      }
    });

    // Set up event listeners for SSH and local data
    const setupListeners = async () => {
      // SSH listeners
      unlistenDataRef.current = await sshService.onData((output: ShellOutput) => {
        if (terminal.current && output.session_id === sessionIdRef.current && !isLocalRef.current) {
          terminal.current.write(output.data);
        }
      });

      unlistenCloseRef.current = await sshService.onClose((sid: string) => {
        if (sid === sessionIdRef.current && !isLocalRef.current && terminal.current) {
          terminal.current.write('\r\n\r\n[Connection closed]\r\n');
          sessionIdRef.current = null;
          const tabId = activeTabIdRef.current;
          if (tabId) app.updateTab(tabId, { connectionStatus: 'disconnected' });
        }
      });

      // Local terminal listeners
      await sshService.onLocalData((output: ShellOutput) => {
        if (terminal.current && output.session_id === sessionIdRef.current && isLocalRef.current) {
          terminal.current.write(output.data);
        }
      });

      await sshService.onLocalClose((sid: string) => {
        if (sid === sessionIdRef.current && isLocalRef.current && terminal.current) {
          terminal.current.write('\r\n\r\n[Local shell closed]\r\n');
          sessionIdRef.current = null;
          const tabId = activeTabIdRef.current;
          if (tabId) app.updateTab(tabId, { connectionStatus: 'disconnected' });
        }
      });
    };

    setupListeners();

    // Handle window resize
    const handleResize = () => {
      fitAddon.current?.fit();
      if (sessionIdRef.current && terminal.current) {
        if (isLocalRef.current) {
          sshService.resizeLocal(sessionIdRef.current, terminal.current.cols, terminal.current.rows);
        } else {
          sshService.resize(sessionIdRef.current, terminal.current.cols, terminal.current.rows);
        }
      }
    };

    window.addEventListener('resize', handleResize);

    // Initial fit
    setTimeout(() => {
      fitAddon.current?.fit();
      if (terminal.current && sessionIdRef.current) {
        if (isLocalRef.current) {
          sshService.resizeLocal(sessionIdRef.current, terminal.current.cols, terminal.current.rows);
        } else {
          sshService.resize(sessionIdRef.current, terminal.current.cols, terminal.current.rows);
        }
      }
    }, 100);

    return () => {
      window.removeEventListener('resize', handleResize);
      unlistenDataRef.current?.();
      unlistenCloseRef.current?.();

      if (sessionIdRef.current) {
        if (isLocalRef.current) {
          sshService.disconnectLocal(sessionIdRef.current);
        } else {
          sshService.disconnect(sessionIdRef.current);
        }
      }

      terminal.current?.dispose();
    };
  }, []);

  // Connect to host when tab has hostId (remote SSH)
  useEffect(() => {
    if (activeTab?.hostId && terminal.current) {
      const host = hostStore.hosts.find(h => h.id === activeTab.hostId);
      if (host && !sessionIdRef.current) {
        connectToHost(host);
      }
    }
  }, [activeTab?.hostId, activeTabId, hostStore.hosts, connectToHost, app]);

  // Connect to local shell when tab type is local
  useEffect(() => {
    if (activeTab?.type === 'local' && terminal.current && !sessionIdRef.current) {
      connectToLocal();
    }
  }, [activeTab?.type, activeTabId, connectToLocal, app]);

  return (
    <View
      terminalRef={terminalRef}
      t={t}
    />
  );
});
