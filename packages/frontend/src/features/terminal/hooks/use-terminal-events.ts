/**
 * useTerminalEvents Hook
 * 终端事件处理 - 数据流、按键、关闭
 */

import type { UnlistenFn } from '@tauri-apps/api/event'
import type { Terminal as XTerminal } from '@baicie/xterm'
import type { ShellOutput, TabType } from '../types'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useCallback, useEffect, useRef } from 'react'

export interface UseTerminalEventsOptions {
  /** xterm 实例 */
  term: XTerminal | null
  /** Session ID */
  sessionId: string | null
  /** Tab 类型 */
  tabType: TabType
}

/**
 * 终端事件 Hook
 *
 * 职责：
 * - 监听后端数据 → 写入 xterm
 * - 监听 xterm 按键 → 发送到后端
 * - 监听连接关闭
 * - 清理事件监听器
 */
export function useTerminalEvents({
  term,
  sessionId,
  tabType,
}: UseTerminalEventsOptions) {
  const unlistenDataRef = useRef<UnlistenFn | null>(null)
  const unlistenCloseRef = useRef<UnlistenFn | null>(null)
  const unlistenExitRef = useRef<UnlistenFn | null>(null)
  const termRef = useRef<XTerminal | null>(null)
  const sessionIdRef = useRef<string | null>(null)

  // Keep refs in sync
  termRef.current = term
  sessionIdRef.current = sessionId

  // 发送数据到后端
  const write = useCallback(
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
        console.error('[useTerminalEvents] write error:', err)
      }
    },
    [tabType],
  )

  // Resize
  const resize = useCallback(
    async (cols: number, rows: number) => {
      const sid = sessionIdRef.current
      if (!sid) return

      try {
        if (tabType === 'local' || tabType === 'remote') {
          await invoke('session_resize', { sessionId: sid, cols, rows })
        }
      } catch (err) {
        console.error('[useTerminalEvents] resize error:', err)
      }
    },
    [tabType],
  )

  // 清理函数
  const cleanup = useCallback(() => {
    unlistenDataRef.current?.()
    unlistenCloseRef.current?.()
    unlistenExitRef.current?.()
    unlistenDataRef.current = null
    unlistenCloseRef.current = null
    unlistenExitRef.current = null
  }, [])

  // 设置事件监听
  useEffect(() => {
    if (!term || !sessionId) return

    const eventPrefix =
      tabType === 'local' ? 'local' : tabType === 'remote' ? 'ssh' : 'serial'

    // 监听后端数据 → 写入 xterm
    listen<ShellOutput>(`${eventPrefix}-data`, event => {
      const output = event.payload
      if (output.session_id === sessionId && termRef.current) {
        let data = output.data
          // Remove zsh transient prompt % residue
          // eslint-disable-next-line no-control-regex
          .replace(/\x1b\[[0-9;]*m%\x1b\[[0-9;]*m+\r?\n/g, '')
          // eslint-disable-next-line no-control-regex
          .replace(/\x1b\[[0-9;]*m%\r?\n/g, '')
          .replace(/^%\r?\n/gm, '')
        termRef.current.write(data)
      }
    }).then(unlisten => {
      unlistenDataRef.current = unlisten
    })

    // 监听连接关闭
    listen<string>(`${eventPrefix}-close`, event => {
      if (event.payload === sessionId) {
        termRef.current?.write('\r\n[disconnected]\r\n')
      }
    }).then(unlisten => {
      unlistenCloseRef.current = unlisten
    })

    // 监听退出码（仅 SSH）
    if (tabType === 'remote') {
      listen<[string, number]>('ssh-exit', event => {
        const [exitSid, code] = event.payload
        if (exitSid === sessionId) {
          termRef.current?.write(`\r\n[process exited with code ${code}]\r\n`)
        }
      }).then(unlisten => {
        unlistenExitRef.current = unlisten
      })
    }

    // 监听 xterm 按键
    const onData = (data: string) => {
      write(data)
    }
    term.onData(onData)

    // 监听 xterm resize
    const onResize = ({ cols, rows }: { cols: number; rows: number }) => {
      resize(cols, rows)
    }
    term.onResize(onResize)

    return () => {
      cleanup()
    }
  }, [term, sessionId, tabType, write, resize, cleanup])

  return {
    write,
    resize,
    cleanup,
  }
}
