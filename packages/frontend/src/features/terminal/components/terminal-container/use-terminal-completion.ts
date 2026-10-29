import type { Terminal as XTerminal } from '@baicie/xterm'
import { useRef, useState } from 'react'
import {
  extractCurrentWord,
  findAllMatches,
  getCursorScreenPosition,
  type CompletionItem,
  type CursorPosition,
} from '@/hooks/use-command-completion'
import type { RCCompletionItem } from '@/service/shell-rc'

export function useTerminalCompletion(term: XTerminal | null) {
  const [items, setItems] = useState<CompletionItem[]>([])
  const [open, setOpen] = useState(false)
  const [index, setIndex] = useState(0)
  const [position, setPosition] = useState<CursorPosition>({ x: 0, y: 0 })
  const rcItemsRef = useRef<RCCompletionItem[]>([])

  const handleTabPress = async (
    currentLine: string,
    cursorPosition: number,
    history: string[],
  ) => {
    const currentWord = extractCurrentWord(currentLine, cursorPosition)
    if (!currentWord) {
      setOpen(false)
      setItems([])
      return
    }
    const matches = await findAllMatches(
      currentWord,
      history,
      rcItemsRef.current,
    )
    if (matches.length === 0) {
      setOpen(false)
      setItems([])
      return
    }
    setItems(matches)
    setIndex(0)
    setOpen(true)
    setPosition(getCursorScreenPosition(term) ?? { x: 0, y: 0 })
  }

  const select = (item: CompletionItem) => {
    if (!term || items.length === 0) return
    term.write(item.text)
    setOpen(false)
  }

  const dismiss = () => {
    setOpen(false)
    term?.focus()
  }

  return {
    items,
    open,
    index,
    position,
    rcItemsRef,
    setIndex,
    handleTabPress,
    select,
    dismiss,
  }
}

export type TerminalCompletionController = ReturnType<
  typeof useTerminalCompletion
>
