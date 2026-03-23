import { useEffect, useRef, useCallback, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SerializeAddon } from "@xterm/addon-serialize";
import { ClipboardAddon } from "@xterm/addon-clipboard";
import { ProgressAddon } from "@xterm/addon-progress";
import "@xterm/xterm/css/xterm.css";
import { useInjectable } from "@/hooks/use-di";
import { AppStore } from "@/store/app";
import { HostStore } from "@/store/host";
import { sshService, ShellOutput } from "@/service/ssh";
import { serialService } from "@/service/serial";
import { getCommandHistory } from "@/service/database";
import type { Host } from "@/types";

interface TerminalContainerProps {
  tabId?: string;
}

// VS Code Dark+ 主题
const TERMINAL_THEME = {
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
};

export default (props: TerminalContainerProps) => {
  // Stores
  const appStore = useInjectable(AppStore);
  const hostStore = useInjectable(HostStore);

  // Terminal refs
  const terminalRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const serializeAddonRef = useRef<SerializeAddon | null>(null);

  // Connection refs
  const sessionIdRef = useRef<string | null>(null);
  const connectionTypeRef = useRef<'ssh' | 'local' | 'serial' | null>(null);

  // Command history refs
  const commandHistoryRef = useRef<string[]>([]);
  const historyIndexRef = useRef<number>(-1);
  const currentInputRef = useRef<string>("");

  // Listener cleanup refs
  const listenersRef = useRef<(() => void)[]>([]);

  // Active tab tracking
  const activeTabIdRef = useRef<string | null>(null);

  // Mount state to prevent double initialization
  const [isReady, setIsReady] = useState(false);

  // Get active tab ID
  const activeTabId = props.tabId || appStore.activeTabId;

  // Sync active tab ref
  useEffect(() => {
    activeTabIdRef.current = activeTabId || null;
  }, [activeTabId]);

  // Load command history on mount
  useEffect(() => {
    const loadHistory = async () => {
      // Retry logic for database initialization
      const maxRetries = 5;
      const retryDelay = 500;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const history = await getCommandHistory();
          commandHistoryRef.current = history.map(h => h.command).filter(Boolean);
          return;
        } catch (e) {
          console.warn(`Load history attempt ${attempt}/${maxRetries} failed:`, e);
          if (attempt < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, retryDelay * attempt));
          } else {
            console.error("Failed to load command history after retries:", e);
          }
        }
      }
    };

    // Delay initial load to ensure Tauri context is ready
    const timeoutId = setTimeout(loadHistory, 100);
    return () => clearTimeout(timeoutId);
  }, []);

  // Initialize terminal
  useEffect(() => {
    if (!terminalRef.current || termRef.current) return;

    // Create terminal
    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'block' as const,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      fontWeight: 'normal',
      fontWeightBold: 'bold',
      theme: TERMINAL_THEME,
      scrollback: 10000,
      scrollSensitivity: 1,
      fastScrollSensitivity: 5,
      scrollOnUserInput: true,
      rightClickSelectsWord: true,
      convertEol: true,
      allowProposedApi: true,
    });

    termRef.current = term;

    // Load addons
    const fitAddon = new FitAddon();
    const searchAddon = new SearchAddon();
    const webLinksAddon = new WebLinksAddon();
    const serializeAddon = new SerializeAddon();
    const clipboardAddon = new ClipboardAddon();
    const progressAddon = new ProgressAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(searchAddon);
    term.loadAddon(webLinksAddon);
    term.loadAddon(serializeAddon);
    term.loadAddon(clipboardAddon);
    term.loadAddon(progressAddon);

    fitAddonRef.current = fitAddon;
    serializeAddonRef.current = serializeAddon;

    // Open terminal
    term.open(terminalRef.current);

    // Initial fit after DOM is ready
    requestAnimationFrame(() => {
      fitAddon.fit();
      setIsReady(true);
    });

    // Handle resize
    let rafId: number | null = null;
    const handleResize = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        fitAddon.fit();

        const term = termRef.current;
        const sessionId = sessionIdRef.current;
        const type = connectionTypeRef.current;

        if (term && sessionId) {
          if (type === 'local') {
            sshService.resizeLocal(sessionId, term.cols, term.rows);
          } else if (type === 'ssh') {
            sshService.resize(sessionId, term.cols, term.rows);
          }
        }
      });
    };

    window.addEventListener('resize', handleResize);

    // Cleanup
    return () => {
      window.removeEventListener('resize', handleResize);
      if (rafId !== null) cancelAnimationFrame(rafId);

      // Cleanup listeners
      listenersRef.current.forEach(unlisten => unlisten());
      listenersRef.current = [];

      // Disconnect if connected
      const sessionId = sessionIdRef.current;
      const type = connectionTypeRef.current;
      if (sessionId) {
        if (type === 'serial') {
          serialService.disconnect(sessionId);
        } else if (type === 'local') {
          sshService.disconnectLocal(sessionId);
        } else if (type === 'ssh') {
          sshService.disconnect(sessionId);
        }
      }

      // Dispose terminal
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  // Set up data and close listeners
  useEffect(() => {
    if (!isReady) return;

    const term = termRef.current;
    if (!term) return;

    // Check if Tauri context is available
    if (typeof window === 'undefined' || !('__TAURI__' in window)) {
      console.warn('Tauri context not available, skipping event listeners');
      return;
    }

    let mounted = true;

    // SSH data listener
    const setupSshListeners = async () => {
      try {
        const unlistenData = await sshService.onData((output: ShellOutput) => {
          if (!mounted) return;
          const term = termRef.current;
          if (term && output.session_id === sessionIdRef.current && connectionTypeRef.current === 'ssh') {
            term.write(output.data);
          }
        });

        const unlistenClose = await sshService.onClose((sid: string) => {
          if (!mounted) return;
          const term = termRef.current;
          if (sid === sessionIdRef.current && connectionTypeRef.current === 'ssh' && term) {
            term.write('\r\n\r\n[Connection closed]\r\n');
            sessionIdRef.current = null;
            connectionTypeRef.current = null;
            const tabId = activeTabIdRef.current;
            if (tabId) appStore.updateTab(tabId, { connectionStatus: 'disconnected' });
          }
        });

        listenersRef.current.push(unlistenData, unlistenClose);
      } catch (e) {
        console.warn('Failed to setup SSH listeners:', e);
      }
    };

    // Local terminal listeners
    const setupLocalListeners = async () => {
      try {
        const unlistenData = await sshService.onLocalData((output: ShellOutput) => {
          if (!mounted) return;
          const term = termRef.current;
          if (term && output.session_id === sessionIdRef.current && connectionTypeRef.current === 'local') {
            term.write(output.data);
          }
        });

        const unlistenClose = await sshService.onLocalClose((sid: string) => {
          if (!mounted) return;
          const term = termRef.current;
          if (sid === sessionIdRef.current && connectionTypeRef.current === 'local' && term) {
            term.write('\r\n\r\n[Local shell closed]\r\n');
            sessionIdRef.current = null;
            connectionTypeRef.current = null;
            const tabId = activeTabIdRef.current;
            if (tabId) appStore.updateTab(tabId, { connectionStatus: 'disconnected' });
          }
        });

        listenersRef.current.push(unlistenData, unlistenClose);
      } catch (e) {
        console.warn('Failed to setup local listeners:', e);
      }
    };

    // Serial port listeners
    const setupSerialListeners = async () => {
      try {
        const unlistenData = await serialService.onData((output: ShellOutput) => {
          if (!mounted) return;
          const term = termRef.current;
          if (term && output.session_id === sessionIdRef.current && connectionTypeRef.current === 'serial') {
            term.write(output.data);
          }
        });

        const unlistenClose = await serialService.onClose((sid: string) => {
          if (!mounted) return;
          const term = termRef.current;
          if (sid === sessionIdRef.current && connectionTypeRef.current === 'serial' && term) {
            term.write('\r\n\r\n[Serial port disconnected]\r\n');
            sessionIdRef.current = null;
            connectionTypeRef.current = null;
            const tabId = activeTabIdRef.current;
            if (tabId) appStore.updateTab(tabId, { connectionStatus: 'disconnected' });
          }
        });

        listenersRef.current.push(unlistenData, unlistenClose);
      } catch (e) {
        console.warn('Failed to setup serial listeners:', e);
      }
    };

    setupSshListeners();
    setupLocalListeners();
    setupSerialListeners();

    return () => {
      mounted = false;
    };
  }, [isReady]); // Only depend on isReady, not appStore

  // Set up terminal input handler
  useEffect(() => {
    if (!isReady) return;

    const term = termRef.current;
    if (!term) return;

    // Get current line from terminal buffer
    const getCurrentLine = (): string => {
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
    };

    // Clear current line and write new content
    const setCurrentLine = (newLine: string) => {
      term.write('\x1b[G');  // Move to beginning of line
      term.write('\x1b[2K'); // Clear entire line
      term.write(newLine);
    };

    // Handle command history navigation
    const handleHistoryNavigation = (key: 'ArrowUp' | 'ArrowDown') => {
      const history = commandHistoryRef.current;
      if (history.length === 0) return;

      if (key === 'ArrowUp') {
        if (historyIndexRef.current === -1) {
          currentInputRef.current = getCurrentLine();
          historyIndexRef.current = history.length - 1;
        } else if (historyIndexRef.current > 0) {
          historyIndexRef.current--;
        }

        if (historyIndexRef.current >= 0) {
          const cmd = history[historyIndexRef.current];
          setCurrentLine(cmd);
        }
      } else if (key === 'ArrowDown') {
        if (historyIndexRef.current === -1) return;

        if (historyIndexRef.current < history.length - 1) {
          historyIndexRef.current++;
          const cmd = history[historyIndexRef.current];
          setCurrentLine(cmd);
        } else {
          historyIndexRef.current = -1;
          setCurrentLine(currentInputRef.current);
        }
      }
    };

    // Handle user input
    const handleInput = term.onData((data: string) => {
      const sessionId = sessionIdRef.current;
      const type = connectionTypeRef.current;

      // Enter key - send command
      if (data === '\r') {
        const line = getCurrentLine();

        if (type === 'serial') {
          serialService.write(sessionId!, line + '\r');
        } else if (type === 'local') {
          sshService.writeLocal(sessionId!, '\r');
        } else if (type === 'ssh') {
          sshService.write(sessionId!, '\r');
        }

        // Save to history
        if (line && type === 'ssh') {
          sshService.saveCommandHistory(activeTabIdRef.current!, line, sessionId!);
          if (!commandHistoryRef.current.includes(line)) {
            commandHistoryRef.current.push(line);
          }
          historyIndexRef.current = -1;
        }
      }
      // Backspace
      else if (data === '\x7f') {
        if (type === 'serial') {
          serialService.writeRaw(sessionId!, '\x08 \x08');
        } else if (type === 'local') {
          sshService.writeLocal(sessionId!, '\x7f');
        } else if (type === 'ssh') {
          sshService.write(sessionId!, '\x7f');
        }
      }
      // Ctrl+C
      else if (data === '\x03') {
        if (type === 'serial') {
          serialService.write(sessionId!, '\x03');
        } else if (type === 'local') {
          sshService.writeLocal(sessionId!, '\x03');
        } else if (type === 'ssh') {
          sshService.write(sessionId!, '\x03');
        }
      }
      // Arrow Up - history previous
      else if (data === '\x1b[A') {
        handleHistoryNavigation('ArrowUp');
      }
      // Arrow Down - history next
      else if (data === '\x1b[B') {
        handleHistoryNavigation('ArrowDown');
      }
      // Regular characters - forward to backend
      // SSH/Local: server handles echo, Serial: we also don't echo (server should handle it)
      else if (data && sessionId) {
        if (type === 'serial') {
          serialService.writeRaw(sessionId, data);
        } else if (type === 'local') {
          sshService.writeLocal(sessionId, data);
        } else if (type === 'ssh') {
          sshService.write(sessionId, data);
        }
      }
    });

    // Handle resize
    const handleResize = term.onResize(({ cols, rows }) => {
      const sessionId = sessionIdRef.current;
      const type = connectionTypeRef.current;

      if (sessionId && type === 'local') {
        sshService.resizeLocal(sessionId, cols, rows);
      } else if (sessionId && type === 'ssh') {
        sshService.resize(sessionId, cols, rows);
      }
    });

    return () => {
      handleInput.dispose();
      handleResize.dispose();
    };
  }, [isReady]);

  // Connect to SSH host
  const connectToHost = useCallback(async (host: Host) => {
    const term = termRef.current;
    if (!term) return;

    connectionTypeRef.current = 'ssh';
    term.write('\r\nConnecting...\r\n');

    const result = await sshService.connect(host);

    if (!result.success || !result.sessionId) {
      term.write(`\r\nConnection failed: ${result.message}\r\n`);
      connectionTypeRef.current = null;
      return;
    }

    sessionIdRef.current = result.sessionId;

    const tabId = activeTabIdRef.current;
    if (tabId) {
      // Use runInAction to avoid triggering MobX reactions
      appStore.updateTab(tabId, {
        hostId: host.id,
        connectionStatus: 'connected'
      });
    }

    const size = { cols: term.cols, rows: term.rows };
    const shellResult = await sshService.startShell(result.sessionId, size.cols, size.rows);

    if (!shellResult.success) {
      term.write(`\r\nFailed to start shell: ${shellResult.message}\r\n`);
      return;
    }

    term.write('\r\n');
  }, []); // Remove appStore dependency to prevent recreation

  // Connect to local shell
  const connectToLocal = useCallback(async () => {
    const term = termRef.current;
    if (!term) return;

    connectionTypeRef.current = 'local';
    term.write('\r\nStarting local shell...\r\n');

    const size = { cols: term.cols, rows: term.rows };
    const result = await sshService.startLocalShell(size.cols, size.rows);

    if (!result.success || !result.sessionId) {
      term.write(`\r\nFailed to start local shell: ${result.message}\r\n`);
      connectionTypeRef.current = null;
      return;
    }

    sessionIdRef.current = result.sessionId;

    const tabId = activeTabIdRef.current;
    if (tabId) {
      appStore.updateTab(tabId, { connectionStatus: 'connected' });
    }

    term.write('\r\n');
  }, []); // Remove appStore dependency

  // Connect to serial port
  const connectToSerial = useCallback(async (serialSessionId: string) => {
    const term = termRef.current;
    if (!term) return;

    connectionTypeRef.current = 'serial';
    term.write('\r\nSerial port connected\r\n');

    sessionIdRef.current = serialSessionId;

    const tabId = activeTabIdRef.current;
    if (tabId) {
      appStore.updateTab(tabId, { connectionStatus: 'connected' });
    }
  }, []); // Remove appStore dependency

  // Store refs for tabs and hosts to avoid triggering re-renders
  const tabsRef = useRef(appStore.tabs);
  const hostsRef = useRef(hostStore.hosts);

  // Update refs when stores change
  useEffect(() => {
    tabsRef.current = appStore.tabs;
  }, [appStore.tabs]);

  useEffect(() => {
    hostsRef.current = hostStore.hosts;
  }, [hostStore.hosts]);

  // Connect to host when tab has hostId (remote SSH)
  useEffect(() => {
    if (!isReady || !activeTabId) return;

    const tabs = tabsRef.current;
    const hosts = hostsRef.current;
    const tab = tabs.find(t => t.id === activeTabId);
    if (!tab) return;

    if (tab.hostId && !sessionIdRef.current) {
      const host = hosts.find(h => h.id === tab.hostId);
      if (host) {
        connectToHost(host);
      }
    }
  }, [isReady, activeTabId, connectToHost]); // Remove tabs and hosts dependencies

  // Connect to local shell when tab type is local
  useEffect(() => {
    if (!isReady || !activeTabId) return;

    const tabs = tabsRef.current;
    const tab = tabs.find(t => t.id === activeTabId);
    if (tab?.type === 'local' && !sessionIdRef.current) {
      connectToLocal();
    }
  }, [isReady, activeTabId, connectToLocal]); // Remove tabs dependency

  // Connect to serial port when tab type is serial
  useEffect(() => {
    if (!isReady || !activeTabId) return;

    const tabs = tabsRef.current;
    const tab = tabs.find(t => t.id === activeTabId);
    if (tab?.type === 'serial' && !sessionIdRef.current && tab.serialSessionId) {
      connectToSerial(tab.serialSessionId);
    }
  }, [isReady, activeTabId, connectToSerial]); // Remove tabs dependency

  // Export terminal content as text/log
  const exportTerminalLog = useCallback((format: 'text' | 'html' | 'json' = 'text') => {
    const term = termRef.current;
    const serializeAddon = serializeAddonRef.current;
    if (!term) return null;

    try {
      if (format === 'text') {
        // Get plain text content from the terminal buffer
        let content = '';
        const buffer = term.buffer.active;
        for (let y = 0; y < buffer.length; y++) {
          const line = buffer.getLine(y);
          if (line) {
            let lineContent = '';
            for (let x = 0; x < term.cols; x++) {
              const cell = line.getCell(x);
              if (cell) {
                lineContent += cell.getChars();
              }
            }
            content += lineContent.trimEnd() + '\n';
          }
        }
        return content;
      } else if (format === 'html' && serializeAddon) {
        return serializeAddon.serializeAsHTML();
      } else if (format === 'json') {
        // Export as JSON with metadata
        const data: Record<string, unknown> = {
          exportedAt: new Date().toISOString(),
          cols: term.cols,
          rows: term.rows,
          content: '',
        };

        const buffer = term.buffer.active;
        const lines: string[] = [];
        for (let y = 0; y < buffer.length; y++) {
          const line = buffer.getLine(y);
          if (line) {
            let lineContent = '';
            for (let x = 0; x < term.cols; x++) {
              const cell = line.getCell(x);
              if (cell) {
                lineContent += cell.getChars();
              }
            }
            lines.push(lineContent);
          }
        }
        data.content = lines.join('\n');

        return JSON.stringify(data, null, 2);
      }
    } catch (error) {
      console.error('Failed to export terminal content:', error);
      return null;
    }

    return null;
  }, []);

  // Download terminal log
  const downloadTerminalLog = useCallback((format: 'text' | 'html' | 'json' = 'text') => {
    const content = exportTerminalLog(format);
    if (!content) return;

    const mimeTypes = {
      text: 'text/plain',
      html: 'text/html',
      json: 'application/json',
    };

    const extensions = {
      text: 'txt',
      html: 'html',
      json: 'json',
    };

    const blob = new Blob([content], { type: mimeTypes[format] });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `terminal-log-${Date.now()}.${extensions[format]}`;
    a.click();
    URL.revokeObjectURL(url);
  }, [exportTerminalLog]);

  // Copy terminal content to clipboard
  const copyTerminalContent = useCallback(async () => {
    const content = exportTerminalLog('text');
    if (!content) return;

    try {
      await navigator.clipboard.writeText(content);
      return true;
    } catch {
      console.error('Failed to copy to clipboard');
      return false;
    }
  }, [exportTerminalLog]);

  // Expose methods to window for external access (e.g., from command palette)
  useEffect(() => {
    (window as unknown as { terminalExport: typeof exportTerminalLog }).terminalExport = exportTerminalLog;
    (window as unknown as { terminalDownload: typeof downloadTerminalLog }).terminalDownload = downloadTerminalLog;
    (window as unknown as { terminalCopy: typeof copyTerminalContent }).terminalCopy = copyTerminalContent;

    return () => {
      delete (window as unknown as { terminalExport?: typeof exportTerminalLog }).terminalExport;
      delete (window as unknown as { terminalDownload?: typeof downloadTerminalLog }).terminalDownload;
      delete (window as unknown as { terminalCopy?: typeof copyTerminalContent }).terminalCopy;
    };
  }, [exportTerminalLog, downloadTerminalLog, copyTerminalContent]);

  return (
    <div
      ref={terminalRef}
      className="w-full h-full"
      style={{ background: '#1e1e1e' }}
    />
  );
};
