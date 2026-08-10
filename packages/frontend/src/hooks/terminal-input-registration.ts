import type { Terminal as XTerminal } from '@baicie/xterm'
import { invoke } from '@tauri-apps/api/core'
import type { Host } from '@/types'
import { setupWebKitInputCompensation } from './terminal-session-helpers'
import type { UseTerminalOptions } from './terminal-session-types'

type Cleanup = () => void | Promise<void>

interface RegisterTerminalInputOptions {
  term: XTerminal
  tabType: UseTerminalOptions['tabType']
  sessionIdRef: { current: string | null }
  hostRef: { current: Host | undefined }
  onTabPressRef: { current: UseTerminalOptions['onTabPress'] }
}

export function registerTerminalInput({
  term,
  tabType,
  sessionIdRef,
  hostRef,
  onTabPressRef,
}: RegisterTerminalInputOptions): Cleanup[] {
  const cleanupFns: Cleanup[] = []
  const sendInput = (data: string) => {
    const sessionId = sessionIdRef.current
    if (!sessionId) return
    const command = tabType === 'serial' ? 'serial_write' : 'session_write'
    void invoke(command, { sessionId, data }).catch(error => {
      console.error('[useTerminal] write failed:', error)
    })
  }

  const currentLineRef = { value: '' }
  const cursorPosRef = { value: 0 }
  const historyIndexRef = { value: -1 }
  const currentInputBeforeNavRef = { value: '' }
  const historyCacheRef = { value: [] as string[] }
  let historyLoaded = false

  const writeAndMoveEnd = (text: string) => {
    term.write('\x1b[H' + text)
    currentLineRef.value = text
    cursorPosRef.value = text.length
  }

  const saveToHistory = async (command: string) => {
    const trimmed = command.trim()
    if (!trimmed) return
    const cache = historyCacheRef.value
    if (cache[0] !== trimmed) {
      const existingIndex = cache.indexOf(trimmed)
      if (existingIndex !== -1) cache.splice(existingIndex, 1)
      cache.unshift(trimmed)
      if (cache.length > 100) cache.length = 100
    }
    historyIndexRef.value = -1
    currentInputBeforeNavRef.value = ''
    const hostId = hostRef.current?.id
    if (hostId) {
      const { addCommandHistory } = await import('@/service/database')
      void addCommandHistory({
        host_id: hostId,
        command: trimmed,
        executed_at: Date.now(),
        session_id: sessionIdRef.current ?? undefined,
      }).catch(() => {})
    }
  }

  const loadHistoryFromDatabase = async () => {
    try {
      const { getCommandHistory } = await import('@/service/database')
      const records = await getCommandHistory(hostRef.current?.id, 50)
      const seen = new Set<string>()
      historyCacheRef.value = records
        .map(record => record.command)
        .filter(command => {
          if (!command || seen.has(command)) return false
          seen.add(command)
          return true
        })
    } catch {
      // History is optional for terminal input.
    }
  }

  const onDataDisposable = term.onData((data: string) => {
    if (data === '\r') {
      const command = currentLineRef.value
      currentLineRef.value = ''
      cursorPosRef.value = 0
      void saveToHistory(command)
      sendInput(data)
      return
    }
    if (data === '\x7f') {
      if (cursorPosRef.value > 0) {
        currentLineRef.value =
          currentLineRef.value.slice(0, cursorPosRef.value - 1) +
          currentLineRef.value.slice(cursorPosRef.value)
        cursorPosRef.value--
      }
      sendInput(data)
      return
    }
    if (data === '\t') {
      if (!historyLoaded) {
        void loadHistoryFromDatabase()
        historyLoaded = true
      }
      onTabPressRef.current?.(
        currentLineRef.value,
        cursorPosRef.value,
        historyCacheRef.value,
      )
      return
    }
    if (data === '\x1b[A') {
      if (historyIndexRef.value === -1) {
        currentInputBeforeNavRef.value = currentLineRef.value
        if (!historyLoaded) {
          void loadHistoryFromDatabase()
          historyLoaded = true
        }
      }
      const history = historyCacheRef.value
      if (history.length === 0) return
      historyIndexRef.value = Math.min(
        historyIndexRef.value + 1,
        history.length - 1,
      )
      writeAndMoveEnd(history[historyIndexRef.value])
      return
    }
    if (data === '\x1b[B') {
      const history = historyCacheRef.value
      if (history.length === 0) return
      historyIndexRef.value--
      writeAndMoveEnd(
        historyIndexRef.value < 0
          ? currentInputBeforeNavRef.value
          : history[historyIndexRef.value],
      )
      if (historyIndexRef.value < 0) historyIndexRef.value = -1
      return
    }
    if (data.length === 1 && data.charCodeAt(0) >= 32) {
      const position = cursorPosRef.value
      currentLineRef.value =
        currentLineRef.value.slice(0, position) +
        data +
        currentLineRef.value.slice(position)
      cursorPosRef.value++
    }
    historyIndexRef.value = -1
    currentInputBeforeNavRef.value = ''
    sendInput(data)
  })
  cleanupFns.push(() => onDataDisposable.dispose())
  cleanupFns.push(setupWebKitInputCompensation(term, sendInput))

  if (tabType !== 'serial') {
    const onResizeDisposable = term.onResize(({ cols, rows }) => {
      const sessionId = sessionIdRef.current
      if (!sessionId) return
      void invoke('session_resize', { sessionId, cols, rows }).catch(error => {
        console.error('[useTerminal] resize failed:', error)
      })
    })
    cleanupFns.push(() => onResizeDisposable.dispose())
  }
  return cleanupFns
}
