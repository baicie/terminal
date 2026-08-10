import type { KnownHostRecord } from '@/service/database'
import { useCallback, useEffect, useState } from 'react'
import {
  addKnownHosts,
  clearAllKnownHosts,
  deleteKnownHost,
  getKnownHosts,
  searchKnownHosts,
} from '@/service/database'
import { parseKnownHostsLine } from './known-hosts-utils'

export function useKnownHosts() {
  const [hosts, setHosts] = useState<KnownHostRecord[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [hostToDelete, setHostToDelete] = useState<KnownHostRecord | null>(null)
  const [clearAllDialogOpen, setClearAllDialogOpen] = useState(false)
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [importContent, setImportContent] = useState('')
  const [importError, setImportError] = useState('')
  const [selectedHost, setSelectedHost] = useState<KnownHostRecord | null>(null)
  const loadHosts = async () => {
    setLoading(true)
    try {
      setHosts(await getKnownHosts())
    } catch (error) {
      console.error('Failed to load known hosts:', error)
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    loadHosts()
  }, [])
  const handleSearch = async (query: string) => {
    setSearchQuery(query)
    if (query.trim()) setHosts(await searchKnownHosts(query))
    else loadHosts()
  }
  const handleDelete = async () => {
    if (!hostToDelete) return
    await deleteKnownHost(hostToDelete.id)
    setHosts(hosts.filter(host => host.id !== hostToDelete.id))
    setHostToDelete(null)
    setDeleteDialogOpen(false)
  }
  const handleClearAll = async () => {
    await clearAllKnownHosts()
    setHosts([])
    setClearAllDialogOpen(false)
  }
  const handleImport = async () => {
    setImportError('')
    const validHosts: Omit<KnownHostRecord, 'id'>[] = []
    for (const line of importContent.split('\n')) {
      const parsed = parseKnownHostsLine(line)
      if (parsed) validHosts.push({ ...parsed, added_at: Date.now() })
    }
    if (validHosts.length === 0) {
      setImportError(
        'No valid SSH known hosts entries found. Format should be: hostname ssh-rsa KEY',
      )
      return
    }
    await addKnownHosts(validHosts)
    await loadHosts()
    setImportDialogOpen(false)
    setImportContent('')
  }
  const handleImportFromFile = useCallback(async () => {
    try {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.known_hosts,.ssh'
      input.onchange = async event => {
        const file = (event.target as HTMLInputElement).files?.[0]
        if (file) {
          setImportContent(await file.text())
          setImportDialogOpen(true)
        }
      }
      input.click()
    } catch (error) {
      console.error('Failed to import file:', error)
    }
  }, [])
  return {
    hosts,
    searchQuery,
    loading,
    deleteDialogOpen,
    setDeleteDialogOpen,
    hostToDelete,
    setHostToDelete,
    clearAllDialogOpen,
    setClearAllDialogOpen,
    importDialogOpen,
    setImportDialogOpen,
    importContent,
    setImportContent,
    importError,
    selectedHost,
    setSelectedHost,
    handleSearch,
    handleDelete,
    handleClearAll,
    handleImport,
    handleImportFromFile,
  }
}
