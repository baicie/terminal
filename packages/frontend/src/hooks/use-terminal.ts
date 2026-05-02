/**
 * useTerminal Hook
 *
 * 终端数据流统一 hook，负责：
 * 1. 注册 xterm 输入/resize 监听（同步注册，保证用户输入永不丢失）
 * 2. 注册后端数据/关闭/退出事件监听（在 invoke 启动 shell *之前* 注册，
 *    保证 shell 启动后输出的初始 prompt 不会因竞态而丢失）
 * 3. 启动 shell（local / SSH-password / SSH-key / serial）
 * 4. cleanup 时关闭 session 并取消所有监听
 */

import type { Terminal as XTerminal } from '@baicie/xterm'
import type { UseTerminalSessionOptions } from '@/features/terminal/hooks'
import type { Host } from '@/types'
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { useEffect, useRef, useState } from 'react'

export interface ShellOutput {
  session_id: string
  data: string
  is_stderr: boolean
}

export interface UseTerminalOptions extends UseTerminalSessionOptions {}

interface UseTerminalResult {
  sessionId: string | null
  status: 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error'
  error: string | null
}

/** 清理 zsh transient prompt 的 `%` 残留 */
function sanitize(data: string): string {
  return data
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[0-9;]*m%\x1b\[[0-9;]*m+\r?\n/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[[0-9;]*m%\r?\n/g, '')
    .replace(/^%\r?\n/gm, '')
}

async function startShell(
  tabType: UseTerminalOptions['tabType'],
  host: Host | undefined,
  serialSessionId: string | undefined,
  cols: number,
  rows: number,
): Promise<string> {
  if (tabType === 'local') {
    return invoke<string>('session_create_local', { cols, rows })
  }

  if (tabType === 'remote') {
    if (!host) throw new Error('Host info required for remote connection')
    if (host.authType === 'password') {
      return invoke<string>('session_create_ssh_password', {
        host: host.hostname,
        port: host.port,
        username: host.username,
        password: host.password,
        cols,
        rows,
      })
    }
    if (host.authType === 'key') {
      return invoke<string>('session_create_ssh_key', {
        host: host.hostname,
        port: host.port,
        username: host.username,
        privateKey: host.privateKey ?? '',
        password: host.password ?? null,
        cols,
        rows,
      })
    }
    if (host.authType === 'agent') {
      throw new Error('Agent authentication not yet supported')
    }
    throw new Error(`Unsupported auth type: ${host.authType}`)
  }

  if (tabType === 'serial') {
    if (!serialSessionId) throw new Error('Serial session ID required')
    return serialSessionId
  }

  throw new Error(`Unknown tab type: ${tabType}`)
}

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

  // 用 state 触发重渲染，让 SessionStatusBar 等订阅 status 的 UI 即时更新
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [status, setStatus] = useState<UseTerminalResult['status']>('idle')
  const [error, setError] = useState<string | null>(null)

  // 监听器回调内动态读取的可变引用
  const termRef = useRef<XTerminal | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const hostRef = useRef<Host | undefined>(host)

  termRef.current = term
  hostRef.current = host

  useEffect(() => {
    if (!term) return

    let cancelled = false
    let started = false
    const cleanupFns: Array<() => void | Promise<void>> = []
    const eventPrefix =
      tabType === 'local' ? 'local' : tabType === 'remote' ? 'ssh' : 'serial'

    // ── 1. 立即同步注册 xterm 监听器 ─────────────────────────
    // 必须在 effect 第一行注册（不等 await），否则 React Strict Mode 下
    // 双重 mount 或依赖项变化导致 init() 中途 cleanup 时，onData 可能
    // 永远绑不上 → 用户输入完全没反应
    const onDataDisp = term.onData(data => {
      const sid = sessionIdRef.current
      if (!sid) return
      const cmd = tabType === 'serial' ? 'serial_write' : 'session_write'
      void invoke(cmd, { sessionId: sid, data }).catch(err => {
        console.error('[useTerminal] write failed:', err)
      })
    })
    cleanupFns.push(() => onDataDisp.dispose())

    if (tabType !== 'serial') {
      const onResizeDisp = term.onResize(({ cols, rows }) => {
        const sid = sessionIdRef.current
        if (!sid) return
        void invoke('session_resize', { sessionId: sid, cols, rows }).catch(
          err => {
            console.error('[useTerminal] resize failed:', err)
          },
        )
      })
      cleanupFns.push(() => onResizeDisp.dispose())
    }

    // ── 2. 异步：先注册后端事件监听，再启动 shell ─────────────
    const init = async () => {
      setStatus('connecting')
      setError(null)

      const listens: UnlistenFn[] = []

      // 数据缓冲：在 sessionId 确定前到达的数据先缓存，sessionId 设置后再 flush。
      // 关键：shell 启动后立刻输出 prompt，emit 事件可能早于 invoke 返回 sid 给
      // 前端，监听器若直接用 sessionIdRef 过滤会丢弃这部分数据。
      const pendingData: ShellOutput[] = []
      let sidReady = false

      try {
        // 先注册 data 监听器（关键：在 invoke 启动 shell 之前）
        const unlistenData = await listen<ShellOutput>(
          `${eventPrefix}-data`,
          event => {
            const out = event.payload
            if (!sidReady) {
              pendingData.push(out)
              return
            }
            if (out.session_id !== sessionIdRef.current) return
            termRef.current?.write(sanitize(out.data))
          },
        )
        listens.push(unlistenData)

        const unlistenClose = await listen<string>(
          `${eventPrefix}-close`,
          event => {
            if (event.payload === sessionIdRef.current) {
              termRef.current?.write('\r\n[disconnected]\r\n')
              setStatus('disconnected')
            }
          },
        )
        listens.push(unlistenClose)

        if (tabType === 'remote') {
          const unlistenExit = await listen<[string, number]>(
            'ssh-exit',
            event => {
              const [exitSid, code] = event.payload
              if (exitSid === sessionIdRef.current) {
                termRef.current?.write(
                  `\r\n[process exited with code ${code}]\r\n`,
                )
              }
            },
          )
          listens.push(unlistenExit)
        }

        if (cancelled) {
          listens.forEach(fn => fn())
          return
        }

        // 把所有 unlisten 加入 cleanup（要在启动 shell 之前注册到 cleanup
        // 列表，否则 cleanup 早触发时会漏掉）
        for (const fn of listens) cleanupFns.push(fn)

        const sid = await startShell(
          tabType,
          hostRef.current,
          serialSessionId,
          defaultCols,
          defaultRows,
        )

        if (cancelled) {
          // 启动后才被取消：主动关闭后端会话
          if (tabType === 'local' || tabType === 'remote') {
            void invoke('session_close', { sessionId: sid }).catch(() => {})
          }
          return
        }

        sessionIdRef.current = sid
        sidReady = true
        setSessionId(sid)
        setStatus('connected')
        started = true

        // flush 缓冲数据：写入 session_id 匹配的早期输出
        for (const out of pendingData) {
          if (out.session_id === sid) {
            termRef.current?.write(sanitize(out.data))
          }
        }
        pendingData.length = 0

        // sid 就绪后立即同步当前实际尺寸到后端，避免 fit() 触发的 resize
        // 因 sid 还未 ready 而被 onResize 内的 if(!sid) 丢弃
        if (termRef.current && tabType !== 'serial') {
          const { cols, rows } = termRef.current
          void invoke('session_resize', { sessionId: sid, cols, rows }).catch(
            err => {
              console.error('[useTerminal] post-connect resize failed:', err)
            },
          )
        }
      } catch (err) {
        if (cancelled) return
        console.error('[useTerminal] init failed:', err)
        listens.forEach(fn => fn())
        const msg = err instanceof Error ? err.message : String(err)
        setError(msg)
        setStatus('error')
      }
    }

    void init()

    return () => {
      cancelled = true
      for (const fn of cleanupFns) {
        try {
          const ret = fn()
          if (ret instanceof Promise) ret.catch(() => {})
        } catch {
          /* ignore */
        }
      }
      const sid = sessionIdRef.current
      if (sid && started && (tabType === 'local' || tabType === 'remote')) {
        void invoke('session_close', { sessionId: sid }).catch(() => {})
      }
      sessionIdRef.current = null
    }
    // 依赖项保持最小：term 实例、tab 类型、host 标识、serial session。
    // host 字段变化通过 hostRef 透传，避免每次 hosts 数组变化都重启会话。
  }, [term, tabType, host?.id, serialSessionId, defaultCols, defaultRows])

  return { sessionId, status, error }
}
