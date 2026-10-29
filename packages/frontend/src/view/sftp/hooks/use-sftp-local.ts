import type { FileItem } from '@/service/ssh'
import { useCallback, useState } from 'react'

interface UseSftpLocalResult {
  files: FileItem[]
  path: string
  history: string[]
  historyIndex: number
  loading: boolean
  selectedFile: FileItem | null
  loadDir: (path: string) => void
  navigate: (path: string) => void
  goBack: () => void
  goForward: () => void
  selectFile: (file: FileItem | null) => void
  pickFolder: () => void
}

export function useSftpLocal(): UseSftpLocalResult {
  const [files, setFiles] = useState<FileItem[]>([])
  const [path, setPath] = useState('')
  const [history, setHistory] = useState([''])
  const [historyIndex, setHistoryIndex] = useState(0)
  const [loading, setLoading] = useState(false)
  const [selectedFile, setSelectedFile] = useState<FileItem | null>(null)

  const loadDir = useCallback(async (p: string) => {
    setLoading(true)
    try {
      if (window.showDirectoryPicker && window.__localDirHandle) {
        const entries: FileItem[] = []
        for await (const [name, handle] of window.__localDirHandle.entries()) {
          const file = handle.kind === 'file' ? await handle.getFile() : null
          entries.push({
            name,
            path: name,
            is_directory: handle.kind === 'directory',
            size: file?.size || 0,
            modified_time: file?.lastModified || Date.now(),
            permissions:
              handle.kind === 'directory' ? 'drwxr-xr-x' : '-rw-r--r--',
          })
        }
        setFiles(entries)
        setPath(p || window.__localDirHandle.name || 'Selected Folder')
      }
    } catch {
      setFiles([])
    } finally {
      setLoading(false)
    }
  }, [])

  const pickFolder = useCallback(async () => {
    try {
      if (window.showDirectoryPicker) {
        window.__localDirHandle = await window.showDirectoryPicker()
        void loadDir('/')
      }
    } catch {
      // cancelled
    }
  }, [loadDir])

  const navigate = useCallback(
    (p: string) => {
      const h = history.slice(0, historyIndex + 1)
      h.push(p)
      setHistory(h)
      setHistoryIndex(h.length - 1)
      void loadDir(p)
    },
    [history, historyIndex, loadDir],
  )

  const goBack = useCallback(() => {
    if (historyIndex <= 0) return
    const idx = historyIndex - 1
    setHistoryIndex(idx)
    void loadDir(history[idx])
  }, [historyIndex, history, loadDir])

  const goForward = useCallback(() => {
    if (historyIndex >= history.length - 1) return
    const idx = historyIndex + 1
    setHistoryIndex(idx)
    void loadDir(history[idx])
  }, [historyIndex, history, loadDir])

  return {
    files,
    path,
    history,
    historyIndex,
    loading,
    selectedFile,
    loadDir,
    navigate,
    goBack,
    goForward,
    selectFile: setSelectedFile,
    pickFolder,
  }
}
