import { useEffect, useRef, useCallback, useState } from "react";
import { observer } from "mobx-react-lite";
import { useInjectable } from "@/hooks/use-di";
import { AppStore } from "@/store/app";
import { HostStore } from "@/store/host";
import { Terminal as TerminalComponent } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { LigaturesAddon } from "@xterm/addon-ligatures";
import { sshService } from "@/service/ssh";
import { serialService } from "@/service/serial";
import { terminalEmitter } from "@/service/terminal-emitter";
import TerminalToolSidebar from "@/components/terminal-tool-sidebar";
import { addCommandHistory } from "@/service/database";
import { toast } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { Code2, Clock } from "lucide-react";
import type { UnlistenFn } from "@tauri-apps/api/event";
import type { Host } from "@/types";
import "@xterm/xterm/css/xterm.css";

interface TerminalContainerProps {
  tabId: string;
}

const TerminalContainer: React.FC<TerminalContainerProps> = observer(({ tabId }) => {
  const app = useInjectable(AppStore);
  const hostStore = useInjectable(HostStore);

  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<TerminalComponent | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const connectionTypeRef = useRef<"local" | "remote" | "serial" | null>(null);
  const unlistenDataRef = useRef<UnlistenFn | null>(null);
  const unlistenCloseRef = useRef<UnlistenFn | null>(null);
  const historyIndexRef = useRef(-1);
  const commandHistoryRef = useRef<string[]>([]);
  const currentLineRef = useRef("");
  const cursorPosRef = useRef(0);
  const isMountedRef = useRef(false);

  const tab = app.tabs.find((t) => t.id === tabId);
  const [isReady, setIsReady] = useState(false);
  const [status, setStatus] = useState<"disconnected" | "connecting" | "connected">("disconnected");
  const [sidebarVisible, setSidebarVisible] = useState(false);

  // Connect to SSH session
  const connectSSH = useCallback(async (host: Host) => {
    setStatus("connecting");
    termRef.current?.write("\x1b[33mConnecting to ${host.hostname}...\x1b[0m\r\n");

    const connResult = await sshService.connect(host);
    if (!connResult.success || !connResult.sessionId) {
      termRef.current?.write(`\x1b[31mConnection failed: ${connResult.message}\x1b[0m\r\n`);
      setStatus("disconnected");
      toast.error(`SSH connection failed: ${connResult.message}`);
      return;
    }

    sessionIdRef.current = connResult.sessionId;

    const shellResult = await sshService.startShell(connResult.sessionId, 80, 24, {
      id: host.id,
      name: host.name,
      hostname: host.hostname,
      username: host.username,
    });

    if (!shellResult.success) {
      termRef.current?.write(`\x1b[31mShell failed: ${shellResult.message}\x1b[0m\r\n`);
      setStatus("disconnected");
      return;
    }

    setStatus("connected");
  }, []);

  // Connect to local shell
  const connectLocal = useCallback(async () => {
    setStatus("connecting");
    termRef.current?.write("\x1b[33mStarting local shell...\x1b[0m\r\n");

    const result = await sshService.startLocalShell(80, 24);
    if (!result.success || !result.sessionId) {
      termRef.current?.write(`\x1b[31mFailed: ${result.message}\x1b[0m\r\n`);
      setStatus("disconnected");
      toast.error(`Local shell failed: ${result.message}`);
      return;
    }

    sessionIdRef.current = result.sessionId;
    setStatus("connected");
  }, []);

  // Connect to serial port
  const connectSerial = useCallback(async (port: string, baudRate: number) => {
    setStatus("connecting");
    termRef.current?.write(`\x1b[33mConnecting to ${port} at ${baudRate} baud...\x1b[0m\r\n`);

    const result = await serialService.connect({
      name: port,
      baudRate,
      dataBits: 8,
      stopBits: 1,
      parity: "none",
      flowControl: "none",
    });

    if (!result.success || !result.sessionId) {
      termRef.current?.write(`\x1b[31mFailed: ${result.message}\x1b[0m\r\n`);
      setStatus("disconnected");
      toast.error(`Serial connection failed: ${result.message}`);
      return;
    }

    sessionIdRef.current = result.sessionId;
    setStatus("connected");
  }, []);

  // Handle terminal input
  const handleData = useCallback(async (data: string) => {
    if (!isMountedRef.current) return;
    const term = termRef.current;
    if (!term) return;

    const sessionId = sessionIdRef.current;
    const connType = connectionTypeRef.current;

    // For local PTY and serial: forward all input to backend and rely on its echo.
    // The backend PTY (in raw mode) provides its own echo; serial does too.
    // SSH has no echo, so we handle display in the "else" branch below.
    if (connType === "local" && sessionId) {
      await sshService.writeLocal(sessionId, data);
      return;
    }
    if (connType === "serial" && sessionId) {
      await serialService.write(sessionId, data);
      return;
    }

    // SSH path (and any unhandled type): frontend controls all display + sends to backend.
    const code = data.charCodeAt(0);

    // Enter - execute command
    if (data === "\r" || data === "\n") {
      const cmd = currentLineRef.current.trim();
      if (cmd) {
        commandHistoryRef.current.unshift(cmd);
        if (commandHistoryRef.current.length > 100) {
          commandHistoryRef.current.pop();
        }

        // Save to history DB
        const currentTab = app.tabs.find((t) => t.id === tabId);
        if (currentTab?.hostId) {
          void addCommandHistory({
            command: cmd,
            host_id: currentTab.hostId,
            executed_at: Date.now(),
            session_id: sessionId || undefined,
          });
        }
      }

      if (connType === "remote" && sessionId) {
        await sshService.write(sessionId, "\r");
      }

      currentLineRef.current = "";
      cursorPosRef.current = 0;
      historyIndexRef.current = -1;
      return;
    }

    // Backspace
    if (data === "\x7f") {
      if (cursorPosRef.current > 0) {
        currentLineRef.current =
          currentLineRef.current.slice(0, cursorPosRef.current - 1) +
          currentLineRef.current.slice(cursorPosRef.current);
        cursorPosRef.current--;
        term.write("\b \b");
        if (cursorPosRef.current < currentLineRef.current.length) {
          const rest = currentLineRef.current.slice(cursorPosRef.current);
          term.write(rest + " ");
          for (let i = 0; i < rest.length; i++) {
            term.write("\b");
          }
        }
      }
      return;
    }

    // Ctrl+C
    if (data === "\x03") {
      term.write("^C");
      currentLineRef.current = "";
      cursorPosRef.current = 0;
      historyIndexRef.current = -1;
      if (connType === "remote" && sessionId) {
        await sshService.write(sessionId, "\x03");
      }
      return;
    }

    // Ctrl+L - clear screen
    if (data === "\x0c") {
      term.write("\x1b[2J\x1b[H");
      return;
    }

    // Arrow Up - previous command
    if (data === "\x1b[A") {
      if (commandHistoryRef.current.length > 0) {
        term.write("\r\x1b[K");
        if (historyIndexRef.current < commandHistoryRef.current.length - 1) {
          historyIndexRef.current++;
        }
        const histCmd = commandHistoryRef.current[historyIndexRef.current];
        currentLineRef.current = histCmd;
        cursorPosRef.current = histCmd.length;
        term.write(histCmd);
      }
      return;
    }

    // Arrow Down - next command
    if (data === "\x1b[B") {
      if (historyIndexRef.current > 0) {
        historyIndexRef.current--;
        term.write("\r\x1b[K");
        const histCmd = commandHistoryRef.current[historyIndexRef.current];
        currentLineRef.current = histCmd;
        cursorPosRef.current = histCmd.length;
        term.write(histCmd);
      } else {
        historyIndexRef.current = -1;
        term.write("\r\x1b[K");
        currentLineRef.current = "";
        cursorPosRef.current = 0;
      }
      return;
    }

    // Arrow Left/Right
    if (data === "\x1b[C") {
      if (cursorPosRef.current < currentLineRef.current.length) {
        term.write(data);
        cursorPosRef.current++;
      }
      return;
    }
    if (data === "\x1b[D") {
      if (cursorPosRef.current > 0) {
        term.write(data);
        cursorPosRef.current--;
      }
      return;
    }

    // Tab - command completion (basic)
    if (data === "\t") {
      return;
    }

    // Regular character
    if (data.length === 1 && code >= 32) {
      currentLineRef.current =
        currentLineRef.current.slice(0, cursorPosRef.current) +
        data +
        currentLineRef.current.slice(cursorPosRef.current);
      cursorPosRef.current++;

      term.write(data);
      if (cursorPosRef.current < currentLineRef.current.length) {
        const rest = currentLineRef.current.slice(cursorPosRef.current);
        term.write(rest);
        for (let i = 0; i < rest.length; i++) {
          term.write("\b");
        }
      }

      if (connType === "remote" && sessionId) {
        await sshService.write(sessionId, data);
      }
    }
  }, [app.tabs, tabId]);

  // Initialize xterm and establish connection
  useEffect(() => {
    if (!containerRef.current || !tab) return;

    const term = new TerminalComponent({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      theme: {
        background: "#1e1e1e",
        foreground: "#d4d4d4",
        cursor: "#d4d4d4",
      },
      scrollback: 10000,
      allowProposedApi: true,
    });

    termRef.current = term;

    const fitAddon = new FitAddon();
    fitAddonRef.current = fitAddon;
    term.loadAddon(fitAddon);

    const searchAddon = new SearchAddon();
    term.loadAddon(searchAddon);

    const webLinksAddon = new WebLinksAddon();
    term.loadAddon(webLinksAddon);

    try {
      const webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => {
        webglAddon.dispose();
      });
      term.loadAddon(webglAddon);
    } catch {
      // WebGL addon may not be available; xterm falls back to DOM renderer
    }

    const unicode11Addon = new Unicode11Addon();
    term.loadAddon(unicode11Addon);

    try {
      const ligaturesAddon = new LigaturesAddon();
      term.loadAddon(ligaturesAddon);
    } catch {
      // Ligatures addon may not be available
    }

    term.open(containerRef.current);
    setTimeout(() => {
      fitAddon.fit();
      term.focus();
    }, 50);

    // Set up data listener
    term.onData(handleData);

    // Set up close listener
    term.onResize(({ cols, rows }) => {
      const sessionId = sessionIdRef.current;
      const connType = connectionTypeRef.current;
      if (!sessionId || !connType) return;

      if (connType === "remote") {
        void sshService.resize(sessionId, cols, rows);
      } else if (connType === "local") {
        void sshService.resizeLocal(sessionId, cols, rows);
      }
    });

    setIsReady(true);
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      term.dispose();
      termRef.current = null;
      setIsReady(false);
    };
  }, [tabId, tab, handleData]);

  // Establish connection when ready
  useEffect(() => {
    if (!isReady || !tab) return;

    // Set up event listeners for data from backend
    const setupListeners = async () => {
      if (tab.type === "remote" && tab.hostId) {
        connectionTypeRef.current = "remote";
        const host = hostStore.hosts.find((h) => h.id === tab.hostId);
        if (host) {
          void connectSSH(host);
        } else {
          termRef.current?.write("\x1b[31mHost not found\x1b[0m\r\n");
        }
      } else if (tab.type === "local") {
        connectionTypeRef.current = "local";
        void connectLocal();
      } else if (tab.type === "serial" && tab.serialConfig) {
        connectionTypeRef.current = "serial";
        void connectSerial(tab.serialConfig.port, tab.serialConfig.baudRate);
      }
    };

    void setupListeners();

    return () => {
      // Cleanup: disconnect session
      const sessionId = sessionIdRef.current;
      const connType = connectionTypeRef.current;

      if (sessionId && connType === "remote") {
        void sshService.disconnect(sessionId);
      } else if (sessionId && connType === "local") {
        void sshService.disconnectLocal(sessionId);
      } else if (sessionId && connType === "serial") {
        void serialService.disconnect(sessionId);
      }

      sessionIdRef.current = null;
      connectionTypeRef.current = null;
    };
  }, [isReady, tab, connectSSH, connectLocal, connectSerial]);

  // Listen for data from backend
  useEffect(() => {
    if (!isReady || !tab) return;

    let unlisten: UnlistenFn | null = null;
    let unlistenClose: UnlistenFn | null = null;

    const setupListeners = async () => {
      const term = termRef.current;
      if (!term) return;

      if (tab.type === "remote") {
        unlisten = await sshService.onData((output) => {
          if (!isMountedRef.current) return;
          term.write(output.data);
        });
        unlistenClose = await sshService.onClose((closedSessionId) => {
          if (closedSessionId === sessionIdRef.current) {
            if (isMountedRef.current) term.write("\r\n\x1b[33mConnection closed\x1b[0m\r\n");
            setStatus("disconnected");
          }
        });
      } else if (tab.type === "local") {
        unlisten = await sshService.onLocalData((output) => {
          if (!isMountedRef.current) return;
          term.write(output.data);
        });
        unlistenClose = await sshService.onLocalClose((closedSessionId) => {
          if (closedSessionId === sessionIdRef.current) {
            if (isMountedRef.current) term.write("\r\n\x1b[33mShell closed\x1b[0m\r\n");
            setStatus("disconnected");
          }
        });
      } else if (tab.type === "serial") {
        unlisten = await serialService.onData((output) => {
          if (!isMountedRef.current) return;
          term.write(output.data);
        });
        unlistenClose = await serialService.onClose((closedSessionId) => {
          if (closedSessionId === sessionIdRef.current) {
            if (isMountedRef.current) term.write("\r\n\x1b[33mSerial port disconnected\x1b[0m\r\n");
            setStatus("disconnected");
          }
        });
      }

      unlistenDataRef.current = unlisten;
      unlistenCloseRef.current = unlistenClose;
    };

    void setupListeners();

    return () => {
      unlisten?.();
      unlistenClose?.();
      unlistenDataRef.current = null;
      unlistenCloseRef.current = null;
    };
  }, [isReady, tab]);

  // Listen for commands from command palette / snippet execution
  useEffect(() => {
    if (!isReady) return;

    const handleWrite = (data: string) => {
      if (!isMountedRef.current) return;
      const term = termRef.current;
      const sessionId = sessionIdRef.current;
      const connType = connectionTypeRef.current;
      if (!term || !sessionId || !connType) return;

      // Write to terminal display
      term.write(data);

      // Write to backend
      if (connType === "remote") {
        void sshService.write(sessionId, data);
      } else if (connType === "local") {
        void sshService.writeLocal(sessionId, data);
      } else if (connType === "serial") {
        void serialService.write(sessionId, data);
      }
    };

    terminalEmitter.onWrite(handleWrite);

    return () => {
      terminalEmitter.removeListener(handleWrite);
    };
  }, [isReady]);

  // Handle resize
  useEffect(() => {
    if (!isReady) return;

    const handleWindowResize = () => {
      fitAddonRef.current?.fit();
    };

    // Also handle container resize
    const resizeObserver = new ResizeObserver(() => {
      fitAddonRef.current?.fit();
    });

    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    window.addEventListener("resize", handleWindowResize);

    return () => {
      window.removeEventListener("resize", handleWindowResize);
      resizeObserver.disconnect();
    };
  }, [isReady]);

  if (!tab) {
    return (
      <div className="h-full flex items-center justify-center bg-[#1e1e1e]">
        <div className="text-center">
          <p className="text-[#d4d4d4] mb-4">No active session</p>
          <p className="text-[#858585] text-sm">
            Select a host from the Hosts page to start a terminal session.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex bg-[#1e1e1e]">
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Status bar */}
        <div className="shrink-0 h-6 bg-[#252526] flex items-center px-3 gap-2 text-xs text-[#d4d4d4] border-b border-[#3c3c3c]">
          <span className={`
            inline-block w-2 h-2 rounded-full
            ${status === "connected" ? "bg-green-500" : status === "connecting" ? "bg-yellow-500 animate-pulse" : "bg-gray-500"}
          `} />
          <span>{tab.label}</span>
          <div className="ml-auto flex items-center gap-1">
            {/* Tool buttons */}
            <Button
              variant="ghost"
              size="icon"
              className="size-5 text-[#858585] hover:text-[#d4d4d4]"
              title="Snippets"
              onClick={() => setSidebarVisible((v) => !v)}
            >
              <Code2 className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-5 text-[#858585] hover:text-[#d4d4d4]"
              title="Command History"
              onClick={() => { setSidebarVisible(true); }}
            >
              <Clock className="size-3.5" />
            </Button>
          </div>
          <span className="text-[#858585]">
            {tab.type === "local" ? "Local Shell" : tab.type === "serial" ? `Serial ${tab.serialConfig?.port}` : "SSH"}
          </span>
        </div>

        {/* Terminal */}
        <div ref={containerRef} className="flex-1 overflow-hidden" />
      </div>

      {/* Tool Sidebar */}
      <TerminalToolSidebar
        visible={sidebarVisible}
        onToggle={() => setSidebarVisible((v) => !v)}
      />
    </div>
  );
});

export default TerminalContainer;
