import type { Terminal as XTerminal } from '@baicie/xterm'
import type { RCCompletionItem } from '../service/shell-rc'

export interface CursorPosition {
  x: number
  y: number
}

export type CompletionType =
  | 'history'
  | 'subcommand'
  | 'path'
  | 'snippet'
  | 'alias'
  | 'function'

export interface CompletionItem {
  /** The full completion text. */
  text: string
  /** Human-readable label shown in the overlay. */
  label: string
  /** Category for display. */
  type: CompletionType
}

export interface UseCommandCompletionOptions {
  term: XTerminal | null
  rcItems?: RCCompletionItem[]
}

export interface UseCommandCompletionResult {
  findMatches: (
    input: string,
    cursorPos: number,
    history: string[],
  ) => Promise<CompletionItem[]>
  getPosition: () => CursorPosition | null
  applyCompletion: (
    currentLine: string,
    cursorPos: number,
    completion: string,
  ) => string
  classifyWord: (word: string) => 'path' | 'subcommand' | 'history'
}
