import { makeAutoObservable, runInAction } from "mobx";
import { singleton } from "tsyringe";
import type { Terminal as XTerminal } from "@xterm/xterm";
import { sshService, SSHConnectionResult } from "@/service/ssh";
import type { Host } from "@/types";

export interface TerminalSession {
  id: string;
  tabId: string;
  host: Host | null;
  terminal: XTerminal | null;
  status: "disconnected" | "connecting" | "connected";
  sessionId?: string;
}

@singleton()
export class TerminalStore {
  sessions: Map<string, TerminalSession> = new Map();

  constructor() {
    makeAutoObservable(this);
  }

  createSession(tabId: string, terminal: XTerminal): string {
    const sessionId = `${tabId}-session-${Date.now()}`;
    const session: TerminalSession = {
      id: sessionId,
      tabId,
      host: null,
      terminal,
      status: "disconnected",
    };
    this.sessions.set(sessionId, session);
    return sessionId;
  }

  getSession(sessionId: string): TerminalSession | undefined {
    return this.sessions.get(sessionId);
  }

  getSessionByTabId(tabId: string): TerminalSession | undefined {
    for (const session of this.sessions.values()) {
      if (session.tabId === tabId) {
        return session;
      }
    }
    return undefined;
  }

  async connect(sessionId: string, host: Host): Promise<SSHConnectionResult> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { success: false, message: "Session not found" };
    }

    runInAction(() => {
      session.status = "connecting";
      session.host = host;
    });

    try {
      const result = await sshService.connect(host);

      runInAction(() => {
        if (result.success) {
          session.status = "connected";
          session.sessionId = result.sessionId;
        } else {
          session.status = "disconnected";
        }
      });

      return result;
    } catch (error) {
      runInAction(() => {
        session.status = "disconnected";
      });
      return {
        success: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async disconnect(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    if (session.sessionId) {
      await sshService.disconnect(session.sessionId);
    }

    runInAction(() => {
      session.status = "disconnected";
      session.sessionId = undefined;
    });
  }

  removeSession(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (session) {
      if (session.sessionId) {
        sshService.disconnect(session.sessionId);
      }
      this.sessions.delete(sessionId);
    }
  }

  updateTerminal(sessionId: string, terminal: XTerminal) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.terminal = terminal;
    }
  }
}

export const terminalStore = new TerminalStore();
