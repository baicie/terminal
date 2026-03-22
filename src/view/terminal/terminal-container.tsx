import { useEffect, useRef, useCallback } from "react";
import View from "./terminal-view";
import "@xterm/xterm/css/xterm.css";
import { useXTerm } from "react-xtermjs";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
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

export default (props: TerminalContainerProps) => {
  const sessionIdRef = useRef<string | null>(null);
  const isLocalRef = useRef<boolean>(false);
  const isSerialRef = useRef<boolean>(false);
  const unlistenDataRef = useRef<(() => void) | null>(null);
  const unlistenCloseRef = useRef<(() => void) | null>(null);
  const unlistenSerialDataRef = useRef<(() => void) | null>(null);
  const unlistenSerialCloseRef = useRef<(() => void) | null>(null);
  const unlistenLocalDataRef = useRef<(() => void) | null>(null);
  const unlistenLocalCloseRef = useRef<(() => void) | null>(null);
  const activeTabIdRef = useRef<string | null>(null);
  const inputBufferRef = useRef<string>("");
  const commandHistoryRef = useRef<string[]>([]);
  const historyIndexRef = useRef<number>(-1);
  const currentInputRef = useRef<string>("");
  const appStoreRef = useRef<AppStore | null>(null);
  const hostStoreRef = useRef<HostStore | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const listenersSetupRef = useRef<boolean>(false);

  // Initialize stores once using useRef (stable reference)
  const appStore = useInjectable(AppStore);
  const hostStore = useInjectable(HostStore);

  // Use react-xtermjs hook
  const { instance, ref } = useXTerm({
    options: {
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
    },
  });

  // Store references in refs for async access
  appStoreRef.current = appStore;
  hostStoreRef.current = hostStore;

  // Load command history on mount
  useEffect(() => {
    const loadHistory = async () => {
      try {
        const history = await getCommandHistory();
        commandHistoryRef.current = history.map(h => h.command).filter(Boolean);
      } catch (e) {
        console.error("Failed to load command history:", e);
      }
    };
    loadHistory();
  }, []);

  // Get active tab ID
  const activeTabId = props.tabId || (appStoreRef.current?.activeTabId ?? null);

  // Keep ref in sync
  useEffect(() => {
    activeTabIdRef.current = activeTabId || null;
  }, [activeTabId]);

  // Get current command line from terminal
  const getCurrentLine = (term: import("@xterm/xterm").Terminal): string => {
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

  // Set terminal line
  const setCurrentLine = (term: import("@xterm/xterm").Terminal, newLine: string) => {
    term.write('\x1b[G');
    term.write('\x1b[2K');
    term.write(newLine);
  };

  // Handle command history navigation (Up/Down arrows)
  const handleHistoryNavigation = (key: 'ArrowUp' | 'ArrowDown') => {
    const term = instance;
    if (!term || commandHistoryRef.current.length === 0) return false;

    if (key === 'ArrowUp') {
      if (historyIndexRef.current === -1) {
        currentInputRef.current = getCurrentLine(term);
        historyIndexRef.current = commandHistoryRef.current.length - 1;
      } else if (historyIndexRef.current > 0) {
        historyIndexRef.current--;
      }

      if (historyIndexRef.current >= 0) {
        const cmd = commandHistoryRef.current[historyIndexRef.current];
        setCurrentLine(term, cmd);
      }
      return true;
    } else if (key === 'ArrowDown') {
      if (historyIndexRef.current === -1) return true;

      if (historyIndexRef.current < commandHistoryRef.current.length - 1) {
        historyIndexRef.current++;
        const cmd = commandHistoryRef.current[historyIndexRef.current];
        setCurrentLine(term, cmd);
      } else {
        historyIndexRef.current = -1;
        setCurrentLine(term, currentInputRef.current);
      }
      return true;
    }
    return false;
  };

  // Set up terminal when instance is available - only run once
  useEffect(() => {
    if (!instance || !ref.current || listenersSetupRef.current) return;

    listenersSetupRef.current = true;
    const term = instance;

    // Load addons
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    fitAddonRef.current = fitAddon;
    fitAddon.fit();

    term.loadAddon(new SearchAddon());
    term.loadAddon(new WebLinksAddon());

    // Handle user input
    term.onData((data: string) => {
      const currentSessionId = sessionIdRef.current;
      const currentTerm = instance;
      const tabId = activeTabIdRef.current;

      // Enter - send newline to backend
      if (data === '\r' && currentSessionId) {
        const line = inputBufferRef.current;
        inputBufferRef.current = "";

        if (isSerialRef.current) {
          serialService.write(currentSessionId, line);
        } else if (isLocalRef.current) {
          sshService.writeLocal(currentSessionId, '\r');
        } else {
          sshService.write(currentSessionId, '\r');
        }

        // Save command to history
        if (!isLocalRef.current && !isSerialRef.current && currentTerm && tabId && line) {
          sshService.saveCommandHistory(tabId, line, currentSessionId);
          if (!commandHistoryRef.current.includes(line)) {
            commandHistoryRef.current.push(line);
          }
          historyIndexRef.current = -1;
        }
      }
      // Backspace
      else if (data === '\x7f' && currentSessionId) {
        inputBufferRef.current = inputBufferRef.current.slice(0, -1);
        if (isSerialRef.current) {
          serialService.writeRaw(currentSessionId, '\x08 \x08');
        } else if (isLocalRef.current) {
          sshService.writeLocal(currentSessionId, '\x7f');
        } else {
          sshService.write(currentSessionId, '\x7f');
        }
      }
      // Ctrl+C
      else if (data === '\x03' && currentSessionId) {
        inputBufferRef.current = "";
        if (isSerialRef.current) {
          serialService.write(currentSessionId, '\x03');
        } else if (isLocalRef.current) {
          sshService.writeLocal(currentSessionId, '\x03');
        } else {
          sshService.write(currentSessionId, '\x03');
        }
      }
      // Arrow Up/Down for history
      else if (data === '\x1b[A' || data === '\x1b[B') {
        const handled = handleHistoryNavigation(data === '\x1b[A' ? 'ArrowUp' : 'ArrowDown');
        if (handled) {
          inputBufferRef.current = getCurrentLine(currentTerm) || "";
        }
      }
      // Regular characters
      else if (data && currentSessionId) {
        inputBufferRef.current += data;
        if (isSerialRef.current) {
          serialService.writeRaw(currentSessionId, data);
        } else if (isLocalRef.current) {
          sshService.writeLocal(currentSessionId, data);
        }
        // SSH: server handles echo
      }
    });

    // Handle resize
    term.onResize(({ cols, rows }: { cols: number; rows: number }) => {
      const currentSessionId = sessionIdRef.current;
      if (currentSessionId) {
        if (isSerialRef.current) {
          // Serial port doesn't need resize
        } else if (isLocalRef.current) {
          sshService.resizeLocal(currentSessionId, cols, rows);
        } else {
          sshService.resize(currentSessionId, cols, rows);
        }
      }
    });

    // Set up event listeners
    const setupListeners = async () => {
      // SSH listeners
      unlistenDataRef.current = await sshService.onData((output: ShellOutput) => {
        const term = instance;
        if (term && output.session_id === sessionIdRef.current && !isLocalRef.current) {
          term.write(output.data);
        }
      });

      unlistenCloseRef.current = await sshService.onClose((sid: string) => {
        const term = instance;
        const currentSessionId = sessionIdRef.current;
        if (sid === currentSessionId && !isLocalRef.current && term) {
          term.write('\r\n\r\n[Connection closed]\r\n');
          sessionIdRef.current = null;
          const tabId = activeTabIdRef.current;
          const app = appStoreRef.current;
          if (tabId && app) app.updateTab(tabId, { connectionStatus: 'disconnected' });
        }
      });

      // Local terminal listeners
      unlistenLocalDataRef.current = await sshService.onLocalData((output: ShellOutput) => {
        const term = instance;
        if (term && output.session_id === sessionIdRef.current && isLocalRef.current) {
          term.write(output.data);
        }
      });

      unlistenLocalCloseRef.current = await sshService.onLocalClose((sid: string) => {
        const term = instance;
        const currentSessionId = sessionIdRef.current;
        if (sid === currentSessionId && isLocalRef.current && term) {
          term.write('\r\n\r\n[Local shell closed]\r\n');
          sessionIdRef.current = null;
          const tabId = activeTabIdRef.current;
          const app = appStoreRef.current;
          if (tabId && app) app.updateTab(tabId, { connectionStatus: 'disconnected' });
        }
      });

      // Serial port listeners
      unlistenSerialDataRef.current = await serialService.onData((output: ShellOutput) => {
        const term = instance;
        if (term && output.session_id === sessionIdRef.current && isSerialRef.current) {
          term.write(output.data);
        }
      });

      unlistenSerialCloseRef.current = await serialService.onClose((sid: string) => {
        const term = instance;
        const currentSessionId = sessionIdRef.current;
        if (sid === currentSessionId && isSerialRef.current && term) {
          term.write('\r\n\r\n[Serial port disconnected]\r\n');
          sessionIdRef.current = null;
          const tabId = activeTabIdRef.current;
          const app = appStoreRef.current;
          if (tabId && app) app.updateTab(tabId, { connectionStatus: 'disconnected' });
        }
      });
    };

    setupListeners();

    // Handle window resize
    let rafId: number | null = null;
    let resizePending = false;
    const handleResize = () => {
      if (resizePending) return;
      resizePending = true;
      rafId = requestAnimationFrame(() => {
        resizePending = false;
        fitAddon.fit();
        const currentSessionId = sessionIdRef.current;
        const term = instance;
        if (term && currentSessionId) {
          if (isSerialRef.current) {
            // Serial port doesn't need resize
          } else if (isLocalRef.current) {
            sshService.resizeLocal(currentSessionId, term.cols, term.rows);
          } else {
            sshService.resize(currentSessionId, term.cols, term.rows);
          }
        }
      });
    };

    window.addEventListener('resize', handleResize);

    // Initial fit
    setTimeout(() => {
      fitAddon.fit();
      const currentSessionId = sessionIdRef.current;
      const term = instance;
      if (term && currentSessionId && !isSerialRef.current) {
        if (isLocalRef.current) {
          sshService.resizeLocal(currentSessionId, term.cols, term.rows);
        } else {
          sshService.resize(currentSessionId, term.cols, term.rows);
        }
      }
    }, 100);

    return () => {
      listenersSetupRef.current = false;
      window.removeEventListener('resize', handleResize);
      if (rafId !== null) cancelAnimationFrame(rafId);

      // Safe cleanup - check if listeners were set before calling
      if (unlistenDataRef.current) unlistenDataRef.current();
      if (unlistenCloseRef.current) unlistenCloseRef.current();
      if (unlistenLocalDataRef.current) unlistenLocalDataRef.current();
      if (unlistenLocalCloseRef.current) unlistenLocalCloseRef.current();
      if (unlistenSerialDataRef.current) unlistenSerialDataRef.current();
      if (unlistenSerialCloseRef.current) unlistenSerialCloseRef.current();

      // Reset all refs to null
      unlistenDataRef.current = null;
      unlistenCloseRef.current = null;
      unlistenLocalDataRef.current = null;
      unlistenLocalCloseRef.current = null;
      unlistenSerialDataRef.current = null;
      unlistenSerialCloseRef.current = null;

      if (sessionIdRef.current) {
        if (isSerialRef.current) {
          serialService.disconnect(sessionIdRef.current);
        } else if (isLocalRef.current) {
          sshService.disconnectLocal(sessionIdRef.current);
        } else {
          sshService.disconnect(sessionIdRef.current);
        }
      }

      term.dispose();
    };
  }, []); // Empty deps - run only once

  // Connect functions - use refs to avoid dependency issues
  const connectToHost = useCallback(async (host: Host) => {
    const term = instance;
    if (!term) return;

    isLocalRef.current = false;
    isSerialRef.current = false;
    term.write('\r\nConnecting...\r\n');

    const result = await sshService.connect(host);

    if (!result.success || !result.sessionId) {
      term.write(`\r\nConnection failed: ${result.message}\r\n`);
      return;
    }

    sessionIdRef.current = result.sessionId;
    const currentApp = appStoreRef.current;
    const tabId = activeTabIdRef.current;
    if (currentApp && tabId) {
      currentApp.updateTab(tabId, {
        hostId: host.id,
        connectionStatus: 'connected'
      });
    }

    const size = term.cols && term.rows
      ? { cols: term.cols, rows: term.rows }
      : { cols: 80, rows: 24 };

    const shellResult = await sshService.startShell(result.sessionId, size.cols, size.rows);

    if (!shellResult.success) {
      term.write(`\r\nFailed to start shell: ${shellResult.message}\r\n`);
      return;
    }

    term.write('\r\n');
  }, []); // No deps - uses refs internally

  const connectToLocal = useCallback(async () => {
    const term = instance;
    if (!term) return;

    isLocalRef.current = true;
    isSerialRef.current = false;
    term.write('\r\nStarting local shell...\r\n');

    const size = term.cols && term.rows
      ? { cols: term.cols, rows: term.rows }
      : { cols: 80, rows: 24 };

    const result = await sshService.startLocalShell(size.cols, size.rows);

    if (!result.success || !result.sessionId) {
      term.write(`\r\nFailed to start local shell: ${result.message}\r\n`);
      return;
    }

    sessionIdRef.current = result.sessionId;
    const currentApp = appStoreRef.current;
    const tabId = activeTabIdRef.current;
    if (currentApp && tabId) {
      currentApp.updateTab(tabId, {
        connectionStatus: 'connected'
      });
    }

    term.write('\r\n');
  }, []); // No deps - uses refs internally

  const connectToSerial = useCallback(async (sessionId: string) => {
    const term = instance;
    if (!term) return;

    isSerialRef.current = true;
    isLocalRef.current = false;
    term.write('\r\nSerial port connected\r\n');

    sessionIdRef.current = sessionId;
    const currentApp = appStoreRef.current;
    const tabId = activeTabIdRef.current;
    if (currentApp && tabId) {
      currentApp.updateTab(tabId, {
        connectionStatus: 'connected'
      });
    }
  }, []); // No deps - uses refs internally

  // Connect to host when tab has hostId (remote SSH)
  useEffect(() => {
    const tabId = activeTabId;
    if (!tabId || !instance) return;

    const app = appStoreRef.current;
    const store = hostStoreRef.current;
    if (!app || !store) return;

    const tab = app.tabs.find(t => t.id === tabId);
    if (!tab) return;

    if (tab.hostId) {
      const host = store.hosts.find(h => h.id === tab.hostId);
      if (host && !sessionIdRef.current) {
        connectToHost(host);
      }
    }
  }, [activeTabId, instance]); // Only reconnect when tab changes

  // Connect to local shell when tab type is local
  useEffect(() => {
    const tabId = activeTabId;
    if (!tabId || !instance) return;

    const app = appStoreRef.current;
    if (!app) return;

    const tab = app.tabs.find(t => t.id === tabId);
    if (tab?.type === 'local' && !sessionIdRef.current) {
      connectToLocal();
    }
  }, [activeTabId, instance]); // Only reconnect when tab changes

  // Connect to serial port when tab type is serial
  useEffect(() => {
    const tabId = activeTabId;
    if (!tabId || !instance) return;

    const app = appStoreRef.current;
    if (!app) return;

    const tab = app.tabs.find(t => t.id === tabId);
    if (tab?.type === 'serial' && !sessionIdRef.current && tab.serialSessionId) {
      connectToSerial(tab.serialSessionId);
    }
  }, [activeTabId, instance]); // Only reconnect when tab changes

  return (
    <View
      xtermRef={ref}
    />
  );
};
