import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useWorkspaceStore } from '@/store/workspace'
import { CommandPaletteDialog } from './command-palette-dialog'
import type {
  CommandPaletteProps,
  PaletteTab,
  SearchResult,
} from './command-palette-types'
import { usePaletteSearch } from './use-palette-search'
import { usePaletteSearchers } from './use-palette-searchers'
import { usePaletteSelection } from './use-palette-selection'
import { usePaletteStaticResults } from './use-palette-static-results'

const CommandPalette: React.FC<CommandPaletteProps> = ({ open, onClose }) => {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [activeTab, setActiveTab] = useState<PaletteTab>('all')
  const [loading, setLoading] = useState(false)
  const activeWorkspaceId = useWorkspaceStore(state => state.activeWorkspaceId)
  const inputRef = useRef<HTMLInputElement>(null)
  const resultsRef = useRef<HTMLDivElement>(null)
  const isOpenRef = useRef(false)
  const { allTabs, openTabs, closedTabs, workspaceResults, quickActions } =
    usePaletteStaticResults()
  const { searchHosts, sftpActions, searchSnippetsAction, searchHistory } =
    usePaletteSearchers()
  const performSearch = usePaletteSearch({
    query,
    activeTab,
    activeWorkspaceId: activeWorkspaceId ?? undefined,
    searchHosts,
    sftpActions,
    searchSnippets: searchSnippetsAction,
    searchHistory,
    quickActions,
    openTabs,
    closedTabs,
    workspaceResults,
    setResults,
    setSelectedIndex,
    setLoading,
  })
  const handleSelect = usePaletteSelection(onClose)

  useEffect(() => {
    if (open) {
      isOpenRef.current = true
      setQuery('')
      setActiveTab('all')
      performSearch()
      setTimeout(() => inputRef.current?.focus(), 50)
    } else isOpenRef.current = false
  }, [open, performSearch])

  useEffect(() => {
    if (isOpenRef.current) performSearch()
  }, [query, activeTab, performSearch])
  useEffect(() => {
    const children = resultsRef.current?.children
    if (children?.[selectedIndex])
      (children[selectedIndex] as HTMLElement).scrollIntoView({
        block: 'nearest',
      })
  }, [selectedIndex, results.length])

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault()
          setSelectedIndex(index => Math.min(index + 1, results.length - 1))
          break
        case 'ArrowUp':
          event.preventDefault()
          setSelectedIndex(index => Math.max(index - 1, 0))
          break
        case 'Enter':
          event.preventDefault()
          if (results[selectedIndex]) handleSelect(results[selectedIndex])
          break
        case 'Escape':
          event.preventDefault()
          onClose()
          break
        case 'Tab': {
          event.preventDefault()
          const tabs = allTabs.map(tab => tab.key)
          const index = tabs.indexOf(activeTab)
          setActiveTab(
            tabs[
              event.shiftKey
                ? (index - 1 + tabs.length) % tabs.length
                : (index + 1) % tabs.length
            ],
          )
        }
      }
    },
    [results, selectedIndex, handleSelect, onClose, allTabs, activeTab],
  )

  return (
    <CommandPaletteDialog
      open={open}
      onClose={onClose}
      inputRef={inputRef}
      resultsRef={resultsRef}
      query={query}
      setQuery={setQuery}
      activeTab={activeTab}
      setActiveTab={setActiveTab}
      allTabs={allTabs}
      results={results}
      selectedIndex={selectedIndex}
      setSelectedIndex={setSelectedIndex}
      loading={loading}
      onKeyDown={handleKeyDown}
      onSelect={handleSelect}
      t={t}
    />
  )
}

export default CommandPalette
