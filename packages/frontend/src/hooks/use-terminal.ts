import type { UnlistenFn } from '@tauri-apps/api/event'
import type { Terminal as XTerminal } from '@baicie/xterm'
import type { Host } from '@/types'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useCallback, useEffect, useRef } from 'react'

export interface ShellOutput {
  session_id: string
  data: string
  is_stderr: boolean
}

export interface UseTerminalOptions {
  /** Tab 类型: local | remote | serial */
  tabType: 'local' | 'remote' | 'serial'
  /** 远程主机信息（tabType=remote 时需要） */
  host?: Host
  /** Serial session ID（tabType=serial 时需要） */
  serialSessionId?: string
  /** xterm cols */
  cols?: number
  /** xterm rows */
  rows?: number
}

interface UseTerminalResult {
  /** PTY session ID */
  sessionId: string | null
  /** 连接状态 */
  status: 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error'
  /** 错误信息 */
  error: string | null
}

/**
 * 终端数据流 hook
 *
 * 职责：
 * 1. 启动 shell（本地 / SSH / 串口）
 * 2. 监听后端数据 → 写入 xterm
 * 3. 监听 xterm 按键 → 发送到后端
 * 4. 处理终端 resize
 * 5. 断开连接 & 清理
 *
 * @param term    xterm 实例（外部传入，由 terminal-container 管理）
 * @param options 连接选项
 */
export function useTerminal(
  term: XTerminal | null,
  options: UseTerminalOptions,
): UseTerminalResult {
  const {
    tabType,
    host,
    serialSessionId,
    cols: defaultCols = 80,
    rows: defaultRows = 24,
  } = options

  const sessionIdRef = useRef<string | null>(null)
  const unlistenDataRef = useRef<UnlistenFn | null>(null)
  const unlistenCloseRef = useRef<UnlistenFn | null>(null)
  const unlistenExitRef = useRef<UnlistenFn | null>(null)
  const termRef = useRef<XTerminal | null>(null)
  const statusRef = useRef<UseTerminalResult['status']>('idle')
  const errorRef = useRef<string | null>(null)

  // Keep termRef in sync without triggering re-renders
  termRef.current = term

  // ---- 启动 shell ----
  const startShell = useCallback(async (): Promise<string | null> => {
    try {
      let sid: string

      if (tabType === 'local') {
        sid = await invoke<string>('session_create_local', {
          cols: defaultCols,
          rows: defaultRows,
        })
      } else if (tabType === 'remote') {
        if (!host) {
          errorRef.current = 'Host info required for remote connection'
          return null
        }
        // Connect SSH using unified session API
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
          // Agent auth - fall back to password prompt for now
          // TODO: Implement agent auth with session_create_ssh_agent
          errorRef.current = 'Agent authentication not yet supported'
          return null
        } else {
          errorRef.current = `Unsupported auth type: ${host.authType}`
          return null
        }
      } else if (tabType === 'serial') {
        if (!serialSessionId) {
          errorRef.current = 'Serial session ID required'
          return null
        }
        sid = serialSessionId
      } else {
        errorRef.current = `Unknown tab type: ${tabType}`
        return null
      }

      sessionIdRef.current = sid
      return sid
    } catch (err) {
      errorRef.current = err instanceof Error ? err.message : String(err)
      return null
    }
  }, [tabType, host, serialSessionId, defaultCols, defaultRows])

  // ---- 发送数据到后端 ----
  const sendData = useCallback(
    async (data: string) => {
      const sid = sessionIdRef.current
      if (!sid) return

      try {
        if (tabType === 'local' || tabType === 'remote') {
          await invoke('session_write', { sessionId: sid, data })
        } else if (tabType === 'serial') {
          await invoke('serial_write', { sessionId: sid, data })
        }
      } catch (err) {
        console.error('[useTerminal] sendData error:', err)
      }
    },
    [tabType],
  )

  // ---- resize ----
  const resize = useCallback(
    async (cols: number, rows: number) => {
      const sid = sessionIdRef.current
      if (!sid) return

      try {
        if (tabType === 'local' || tabType === 'remote') {
          await invoke('session_resize', { sessionId: sid, cols, rows })
        }
        // serial resize not supported via this hook (handled in serial service)
      } catch (err) {
        console.error('[useTerminal] resize error:', err)
      }
    },
    [tabType],
  )

  // ---- 断开连接 ----
  const disconnect = useCallback(async () => {
    const sid = sessionIdRef.current
    if (!sid) return

    try {
      if (tabType === 'local' || tabType === 'remote') {
        await invoke('session_close', { sessionId: sid })
      }
    } catch (err) {
      console.error('[useTerminal] disconnect error:', err)
    }
  }, [tabType])

  // ---- 主 effect：启动 + 监听 + 转发 ----
  useEffect(() => {
    if (!term) return

    let cancelled = false
    const eventPrefix =
      tabType === 'local' ? 'local' : tabType === 'remote' ? 'ssh' : 'serial'

    const init = async () => {
      statusRef.current = 'connecting'

      // 1. 启动 shell
      const sid = await startShell()
      if (cancelled || !sid) {
        statusRef.current = 'error'
        return
      }

      statusRef.current = 'connected'

      // 2. 监听后端数据 → 写入 xterm
      // Remove zsh transient prompt artifacts: backspace-erased right-prompt leaves a trailing %
      const unlistenData = await listen<ShellOutput>(
        `${eventPrefix}-data`,
        event => {
          const output = event.payload
          if (output.session_id === sid && termRef.current) {
            const data = output.data
              // Remove % at end of line (zsh transient prompt erasure residue)
              .replace(/ %+(\r?\n)/g, '$1')
              .replace(/ %+$/gm, '')
            termRef.current.write(data)
          }
        },
      )
      unlistenDataRef.current = unlistenData

      // 3. 监听连接关闭
      const unlistenClose = await listen<string>(
        `${eventPrefix}-close`,
        event => {
          if (event.payload === sid) {
            termRef.current?.write('\r\n[disconnected]\r\n')
            cleanup()
          }
        },
      )
      unlistenCloseRef.current = unlistenClose

      // 4. 监听退出码（仅 SSH）
      if (tabType === 'remote') {
        const unlistenExit = await listen<[string, number]>(
          `ssh-exit`,
          event => {
            const [exitSid, code] = event.payload
            if (exitSid === sid) {
              termRef.current?.write(
                `\r\n[process exited with code ${code}]\r\n`,
              )
              cleanup()
            }
          },
        )
        unlistenExitRef.current = unlistenExit
      }

      // 5. 监听 xterm 按键 → 发送到后端
      const onData = (data: string) => {
        sendData(data)
      }
      term.onData(onData)

      // 6. 监听 xterm resize → 通知后端
      const onResize = ({ cols, rows }: { cols: number; rows: number }) => {
        resize(cols, rows)
      }
      term.onResize(onResize)
    }

    const cleanup = () => {
      statusRef.current = 'disconnected'
      unlistenDataRef.current?.()
      unlistenCloseRef.current?.()
      unlistenExitRef.current?.()
      unlistenDataRef.current = null
      unlistenCloseRef.current = null
      unlistenExitRef.current = null
    }

    init()

    return () => {
      cancelled = true
      cleanup()
      disconnect()
      sessionIdRef.current = null
    }
  }, [term, tabType, startShell, sendData, resize, disconnect])

  return {
    sessionId: sessionIdRef.current,
    get status() {
      return statusRef.current
    },
    get error() {
      return errorRef.current
    },
  }
}
