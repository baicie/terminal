import type { Terminal as XTerminal } from '@baicie/xterm'
import { getWordStart } from './command-completion-matching'
import type { CompletionType, CursorPosition } from './command-completion-types'

export function getCursorScreenPosition(
  term: XTerminal | null,
): CursorPosition | null {
  if (!term?.element) return null
  try {
    const buffer = term.buffer.active
    const rect = (term.element as HTMLElement).getBoundingClientRect()
    const x = Math.round(rect.left + buffer.cursorX * 9)
    const y = Math.round(
      rect.top + (buffer.cursorY - buffer.viewportY + 1) * 18,
    )
    return { x, y }
  } catch {
    const rect = term.element?.getBoundingClientRect()
    return {
      x: Math.round((rect?.left ?? 0) + 10),
      y: Math.round(rect?.bottom ?? 0),
    }
  }
}

export function applyCompletion(
  term: XTerminal | null,
  currentLine: string,
  cursorPos: number,
  completion: string,
): string {
  if (!term) return currentLine
  const wordStart = getWordStart(currentLine, cursorPos)
  const newLine =
    currentLine.slice(0, wordStart) + completion + currentLine.slice(cursorPos)
  term.write('\x1b[H')
  term.write('\x1b[0K')
  term.write(newLine)
  return newLine
}

export function getNextCompletionIndex(
  current: number,
  total: number,
  shiftKey: boolean,
): number {
  if (total === 0) return 0
  return shiftKey ? (current - 1 + total) % total : (current + 1) % total
}

export function getCompletionTypeLabel(type: CompletionType): string {
  switch (type) {
    case 'history':
      return 'history'
    case 'subcommand':
      return 'subcmd'
    case 'path':
      return 'path'
    case 'snippet':
      return 'snippet'
    case 'alias':
      return 'alias'
    case 'function':
      return 'fn'
  }
}
