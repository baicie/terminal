/**
 * useTerminalSession Hook
 * 终端会话生命周期管理
 */

import type { Terminal as XTerminal } from '@baicie/xterm'
import type { Host } from '@/types'
import type { SessionStatus, TabType } from '../types'
import { invoke } from '@tauri-apps/api/core'
import { useCallback, useRef, useState } from 'react'

export interface UseTerminalSessionOptions {
  /** Tab 类型: local | remote | serial */
  tabType: TabType
  /** 远程主机信息（tabType=remote 时需要） */
  host?: Host
  /** Serial session ID（tabType=serial 时需要） */
  serialSessionId?: string
  /** xterm cols */
  cols?: number
  /** xterm rows */
  rows?: number
}

export interface UseTerminalSessionResult {
  /** PTY session ID */
  sessionId: string | null
  /** 连接状态 */
  status: SessionStatus
  /** 错误信息 */
  error: string | null
}

/**
 * 终端会话 Hook
 *
 * 职责：
 * - 创建会话（本地/SSH/串口）
 * - 管理会话状态
 * - 提供连接/断开方法
 */
export function useTerminalSession(
  term: XTerminal | null,
  options: UseTerminalSessionOptions,
): UseTerminalSessionResult {
  const {
    tabType,
    host,
    serialSessionId,
    cols: defaultCols = 80,
    rows: defaultRows = 24,
  } = options

  const [status, setStatus] = useState<SessionStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const sessionIdRef = useRef<string | null>(null)

  // 启动 shell
  const startShell = useCallback(async (): Promise<string | null> => {
    setStatus('connecting')
    setError(null)

    try {
      let sid: string

      if (tabType === 'local') {
        sid = await invoke<string>('session_create_local', {
          cols: defaultCols,
          rows: defaultRows,
        })
      } else if (tabType === 'remote') {
        if (!host) {
          const err = 'Host info required for remote connection'
          setError(err)
          setStatus('error')
          return null
        }

        if (host.authType === 'password') {
          sid = await invoke<string>('session_create_ssh_password', {
            host: host.hostname,
            port: host.port,
            username: host.username,
            password: host.password,
            cols: defaultCols,
            rows: defaultRows,
          })
        } else if (host.authType === 'key') {
          sid = await invoke<string>('session_create_ssh_key', {
            host: host.hostname,
            port: host.port,
            username: host.username,
            privateKey: host.privateKey ?? '',
            password: host.password ?? null,
            cols: defaultCols,
            rows: defaultRows,
          })
        } else if (host.authType === 'agent') {
          const err = 'Agent authentication not yet supported'
          setError(err)
          setStatus('error')
          return null
        } else {
          const err = `Unsupported auth type: ${host.authType}`
          setError(err)
          setStatus('error')
          return null
        }
      } else if (tabType === 'serial') {
        if (!serialSessionId) {
          const err = 'Serial session ID required'
          setError(err)
          setStatus('error')
          return null
        }
        sid = serialSessionId
      } else {
        const err = `Unknown tab type: ${tabType}`
        setError(err)
        setStatus('error')
        return null
      }

      sessionIdRef.current = sid
      setStatus('connected')
      return sid
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      setError(errMsg)
      setStatus('error')
      return null
    }
  }, [tabType, host, serialSessionId, defaultCols, defaultRows])

  // 断开连接
  const disconnect = useCallback(async () => {
    const sid = sessionIdRef.current
    if (!sid) return

    try {
      if (tabType === 'local' || tabType === 'remote') {
        await invoke('session_close', { sessionId: sid })
      }
      sessionIdRef.current = null
      setStatus('disconnected')
    } catch (err) {
      console.error('[useTerminalSession] disconnect error:', err)
    }
  }, [tabType])

  // 启动会话
  const connect = useCallback(async () => {
    if (!term) return
    await startShell()
  }, [term, startShell])

  return {
    sessionId: sessionIdRef.current,
    status,
    error,
    connect,
    disconnect,
  }
}
