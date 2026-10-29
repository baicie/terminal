import type { ReactNode } from 'react'

export type PaletteTab =
  | 'all'
  | 'hosts'
  | 'snippets'
  | 'history'
  | 'actions'
  | 'sftp'
  | 'workspaces'
  | 'tabs'
export type ResultType =
  | 'host'
  | 'snippet'
  | 'history'
  | 'action'
  | 'sftp'
  | 'workspace'
  | 'closed-tab'
  | 'open-tab'

export interface SearchResult {
  id: string
  type: ResultType
  title: string
  description?: string
  hint?: string
  icon: ReactNode
  data: unknown
  score?: number
}

export interface CommandPaletteProps {
  open: boolean
  onClose: () => void
}

export interface PaletteTabItem {
  key: PaletteTab
  label: string
  icon: ReactNode
}
