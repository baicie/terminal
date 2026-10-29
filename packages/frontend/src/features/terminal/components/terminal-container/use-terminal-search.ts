import type {
  ISearchOptions,
  ISearchResultChangeEvent,
  SearchAddon,
} from '@xterm/addon-search'
import * as React from 'react'

interface UseTerminalSearchOptions {
  open: boolean
  onClose: () => void
  searchAddon: SearchAddon | null
}

export function useTerminalSearch({
  open,
  onClose,
  searchAddon,
}: UseTerminalSearchOptions) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [query, setQuery] = React.useState('')
  const [caseSensitive, setCaseSensitive] = React.useState(false)
  const [wholeWord, setWholeWord] = React.useState(false)
  const [regex, setRegex] = React.useState(false)
  const [matchInfo, setMatchInfo] = React.useState({ index: -1, count: 0 })
  const [regexError, setRegexError] = React.useState<string | null>(null)

  const buildOptions = React.useCallback(
    (): ISearchOptions => ({
      caseSensitive,
      wholeWord,
      regex,
      decorations: {
        matchBackground: '#515c6a',
        matchBorder: '#888',
        matchOverviewRuler: '#d18616',
        activeMatchBackground: '#a8ac94',
        activeMatchBorder: '#fbf6cc',
        activeMatchColorOverviewRuler: '#d18616',
      },
    }),
    [caseSensitive, wholeWord, regex],
  )

  const performSearch = React.useCallback(
    (direction: 'next' | 'previous') => {
      if (!searchAddon || !query) return
      try {
        const method = direction === 'next' ? 'findNext' : 'findPrevious'
        searchAddon[method](query, buildOptions())
        setRegexError(null)
      } catch (error) {
        if (regex) {
          setRegexError(error instanceof Error ? error.message : String(error))
        }
      }
    },
    [buildOptions, query, regex, searchAddon],
  )

  const handleNext = React.useCallback(
    () => performSearch('next'),
    [performSearch],
  )
  const handlePrevious = React.useCallback(
    () => performSearch('previous'),
    [performSearch],
  )

  React.useEffect(() => {
    if (!searchAddon || !open) return
    const handleResults = (event: ISearchResultChangeEvent) => {
      setMatchInfo({ index: event.resultIndex, count: event.resultCount })
    }
    const disposable = searchAddon.onDidChangeResults(handleResults)
    return () => disposable.dispose()
  }, [searchAddon, open])

  React.useEffect(() => {
    if (open) return
    setMatchInfo({ index: -1, count: 0 })
    setRegexError(null)
    setQuery('')
  }, [open])

  React.useEffect(() => {
    if (!open) return
    const handleFunctionKey = (event: KeyboardEvent) => {
      if (event.key !== 'F3') return
      event.preventDefault()
      event.stopPropagation()
      if (event.shiftKey) handlePrevious()
      else handleNext()
    }
    document.addEventListener('keydown', handleFunctionKey, true)
    return () =>
      document.removeEventListener('keydown', handleFunctionKey, true)
  }, [open, handleNext, handlePrevious])

  React.useEffect(() => {
    if (!open) return
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
  }, [open])

  React.useEffect(() => {
    if (!searchAddon || !open) return
    if (!query) {
      setMatchInfo({ index: -1, count: 0 })
      setRegexError(null)
      try {
        searchAddon.findNext('', buildOptions())
      } catch {
        // Clearing a malformed regular expression can race with addon state.
      }
      return
    }

    try {
      searchAddon.findNext(query, buildOptions())
      setRegexError(null)
    } catch (error) {
      if (regex) {
        setRegexError(error instanceof Error ? error.message : String(error))
      }
    }
  }, [buildOptions, open, query, regex, searchAddon])

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onClose()
      } else if (event.key === 'Enter') {
        event.preventDefault()
        if (event.shiftKey) handlePrevious()
        else handleNext()
      }
    },
    [handleNext, handlePrevious, onClose],
  )

  const matchLabel =
    matchInfo.count > 0
      ? `${matchInfo.index >= 0 ? matchInfo.index + 1 : 0} / ${matchInfo.count}`
      : null

  return {
    inputRef,
    query,
    setQuery,
    caseSensitive,
    setCaseSensitive,
    wholeWord,
    setWholeWord,
    regex,
    setRegex,
    regexError,
    matchLabel,
    handleKeyDown,
    handleNext,
    handlePrevious,
  }
}
