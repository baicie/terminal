/**
 * useTerminal Hook
 *
 * 此 Hook 已重构为使用 features/terminal/hooks/ 中的独立模块。
 * 保留此文件以保持向后兼容，新代码应直接使用新 hooks 模块。
 *
 * @deprecated 请使用 features/terminal/hooks/ 中的对应 hooks
 */

import type { Terminal as XTerminal } from '@baicie/xterm'
import type { UseTerminalSessionOptions } from '@/features/terminal/hooks'
import { useCallback, useEffect, useRef, useState } from 'react'

export interface ShellOutput {
  session_id: string
  data: string
  is_stderr: boolean
}

export interface UseTerminalOptions extends UseTerminalSessionOptions {}

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
  const statusRef = useRef<UseTerminalResult['status']>('idle')
  const errorRef = useRef<string | null>(null)
  const termRef = useRef<XTerminal | null>(null)

  // Keep termRef in sync
  termRef.current = term

  const [, forceUpdate] = useState({})

  // ---- 启动 shell ----
  const startShell = useCallback(async (): Promise<string | null> => {
    try {
      let sid: string

      if (tabType === 'local') {
        const { invoke } = await import('@tauri-apps/api/core')
        sid = await invoke<string>('session_create_local', {
          cols: defaultCols,
          rows: defaultRows,
        })
      } else if (tabType === 'remote') {
        if (!host) {
          errorRef.current = 'Host info required for remote connection'
          return null
        }
        const { invoke } = await import('@tauri-apps/api/core')
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
      statusRef.current = 'connected'
      forceUpdate({})
      return sid
    } catch (err) {
      errorRef.current = err instanceof Error ? err.message : String(err)
      statusRef.current = 'error'
      forceUpdate({})
      return null
    }
  }, [tabType, host, serialSessionId, defaultCols, defaultRows])

  // ---- 发送数据到后端 ----
  const sendData = useCallback(
    async (data: string) => {
      const sid = sessionIdRef.current
      if (!sid) return

      try {
        const { invoke } = await import('@tauri-apps/api/core')
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
        const { invoke } = await import('@tauri-apps/api/core')
        if (tabType === 'local' || tabType === 'remote') {
          await invoke('session_resize', { sessionId: sid, cols, rows })
        }
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
      const { invoke } = await import('@tauri-apps/api/core')
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
      forceUpdate({})

      // 1. 启动 shell
      const sid = await startShell()
      if (cancelled || !sid) {
        statusRef.current = 'error'
        forceUpdate({})
        return
      }

      // 2. 监听后端数据 → 写入 xterm
      const { listen } = await import('@tauri-apps/api/event')
      const unlistenData = await listen<ShellOutput>(
        `${eventPrefix}-data`,
        async event => {
          const output = event.payload
          if (output.session_id === sid && termRef.current) {
            let data = output.data
              // Remove zsh transient prompt % residue
              // eslint-disable-next-line no-control-regex
              .replace(/\x1b\[[0-9;]*m%\x1b\[[0-9;]*m+\r?\n/g, '')
              // eslint-disable-next-line no-control-regex
              .replace(/\x1b\[[0-9;]*m%\r?\n/g, '')
              .replace(/^%\r?\n/gm, '')
            termRef.current.write(data)
          }
        },
      )

      // 3. 监听连接关闭
      const unlistenClose = await listen<string>(
        `${eventPrefix}-close`,
        event => {
          if (event.payload === sid) {
            termRef.current?.write('\r\n[disconnected]\r\n')
          }
        },
      )

      // 4. 监听退出码（仅 SSH）
      let unlistenExit: (() => void) | undefined
      if (tabType === 'remote') {
        const unlistenExitPromise = listen<[string, number]>(
          `ssh-exit`,
          event => {
            const [exitSid, code] = event.payload
            if (exitSid === sid) {
              termRef.current?.write(
                `\r\n[process exited with code ${code}]\r\n`,
              )
            }
          },
        )
        unlistenExitPromise.then(unlisten => {
          unlistenExit = unlisten
        })
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

      // Cleanup function stored for later
      return () => {
        unlistenData()
        unlistenClose()
        unlistenExit?.()
      }
    }

    let cleanupFn: (() => void) | undefined

    init().then(fn => {
      cleanupFn = fn
    })

    return () => {
      cancelled = true
      cleanupFn?.()
      disconnect()
      sessionIdRef.current = null
      statusRef.current = 'idle'
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
