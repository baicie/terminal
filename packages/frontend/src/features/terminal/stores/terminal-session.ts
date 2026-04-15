/**
 * Terminal Session Store
 * 终端会话状态管理
 */

import type { Terminal as XTerminal } from '@baicie/xterm'
import type { Host } from '@/types'
import type { ConnectionResult } from '../types'
import { create } from 'zustand'
import { sessionService } from '../services'

export interface TerminalSession {
  id: string
  tabId: string
  host: Host | null
  isLocal: boolean
  terminal: XTerminal | null
  status: 'disconnected' | 'connecting' | 'connected'
  sessionId?: string
}

export interface TerminalSessionState {
  sessions: Map<string, TerminalSession>

  // Actions
  createSession: (tabId: string, terminal: XTerminal) => string
  getSession: (sessionId: string) => TerminalSession | undefined
  getSessionByTabId: (tabId: string) => TerminalSession | undefined
  connect: (sessionId: string, host: Host | null, cols?: number, rows?: number) => Promise<ConnectionResult>
  disconnect: (sessionId: string) => Promise<void>
  removeSession: (sessionId: string) => void
  updateTerminal: (sessionId: string, terminal: XTerminal) => void
}

export const useTerminalSessionStore = create<TerminalSessionState>((set, get) => ({
  sessions: new Map(),

  createSession(tabId, terminal) {
    const sessionId = `${tabId}-session-${Date.now()}`
    const session: TerminalSession = {
      id: sessionId,
      tabId,
      host: null,
      isLocal: false,
      terminal,
      status: 'disconnected',
    }
    const newSessions = new Map(get().sessions)
    newSessions.set(sessionId, session)
    set({ sessions: newSessions })
    return sessionId
  },

  getSession(sessionId) {
    return get().sessions.get(sessionId)
  },

  getSessionByTabId(tabId) {
    for (const session of get().sessions.values()) {
      if (session.tabId === tabId) {
        return session
      }
    }
    return undefined
  },

  async connect(sessionId, host, cols = 80, rows = 24) {
    const session = get().sessions.get(sessionId)
    if (!session) {
      return { success: false, message: 'Session not found' }
    }

    const newSessions = new Map(get().sessions)
    newSessions.set(sessionId, {
      ...session,
      status: 'connecting',
      host,
      isLocal: host === null,
    })
    set({ sessions: newSessions })

    try {
      let result: ConnectionResult

      if (host === null) {
        // Local terminal
        result = await sessionService.createLocal({
          cols,
          rows,
          hostInfo: { name: 'Local Terminal' },
        })
      } else if (host.jumpHostId) {
        return {
          success: false,
          message: 'Jump host connection not yet implemented',
        }
      } else if (host.authType === 'password') {
        result = await sessionService.createSshPassword({ host, cols, rows })
      } else if (host.authType === 'key') {
        result = await sessionService.createSshKey({ host, cols, rows })
      } else {
        return {
          success: false,
          message: `Unsupported auth type: ${host.authType}`,
        }
      }

      const current = get().sessions.get(sessionId)
      if (!current) return { success: false, message: 'Session removed' }

      const updatedSessions = new Map(get().sessions)
      updatedSessions.set(sessionId, {
        ...current,
        status: result.success ? 'connected' : 'disconnected',
        sessionId: result.sessionId,
      })
      set({ sessions: updatedSessions })
      return result
    } catch (error) {
      const current = get().sessions.get(sessionId)
      if (current) {
        const updatedSessions = new Map(get().sessions)
        updatedSessions.set(sessionId, { ...current, status: 'disconnected' })
        set({ sessions: updatedSessions })
      }
      return {
        success: false,
        message: error instanceof Error ? error.message : String(error),
      }
    }
  },

  async disconnect(sessionId) {
    const session = get().sessions.get(sessionId)
    if (!session) return

    if (session.sessionId) {
      await sessionService.close(session.sessionId)
    }

    const updatedSessions = new Map(get().sessions)
    updatedSessions.set(sessionId, {
      ...session,
      status: 'disconnected',
      sessionId: undefined,
    })
    set({ sessions: updatedSessions })
  },

  removeSession(sessionId) {
    const session = get().sessions.get(sessionId)
    if (session) {
      if (session.sessionId) {
        sessionService.close(session.sessionId)
      }
      const newSessions = new Map(get().sessions)
      newSessions.delete(sessionId)
      set({ sessions: newSessions })
    }
  },

  updateTerminal(sessionId, terminal) {
    const session = get().sessions.get(sessionId)
    if (session) {
      const newSessions = new Map(get().sessions)
      newSessions.set(sessionId, { ...session, terminal })
      set({ sessions: newSessions })
    }
  },
}))
