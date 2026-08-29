import type { FileItem } from '@/service/ssh'
import { sshService } from '@/service/ssh'
import { toast } from '@/components/ui/sonner'
import { useCallback, useEffect, useState } from 'react'

interface UseSftpRemoteOptions {
  activeHost: { authType: string; name: string } | null
}

interface UseSftpRemoteResult {
  files: FileItem[]
  path: string
  history: string[]
  historyIndex: number
  loading: boolean
  selectedFile: FileItem | null
  sessionId: string | null
  loadDir: (path: string) => void
  navigate: (path: string) => void
  goBack: () => void
  goForward: () => void
  selectFile: (file: FileItem | null) => void
  deleteFile: (file: FileItem) => Promise<void>
  renameFile: (file: FileItem, newName: string) => Promise<void>
  mkdir: (name: string) => Promise<void>
}

export function useSftpRemote({ activeHost }: UseSftpRemoteOptions): UseSftpRemoteResult {
  const [files, setFiles] = useState<FileItem[]>([])
  const [path, setPath] = useState('/')
  const [history, setHistory] = useState(['/'])
  const [historyIndex, setHistoryIndex] = useState(0)
  const [loading, setLoading] = useState(false)
  const [selectedFile, setSelectedFile] = useState<FileItem | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)

  const ensureSession = useCallback(async (): Promise<string | null> => {
    if (!activeHost) return null
    if (sessionId) return sessionId

    let connResult
    if (activeHost.authType === 'password') {
      connResult = await sshService.createSshSessionPassword(activeHost as Parameters<typeof sshService.createSshSessionPassword>[0])
    } else if (activeHost.authType === 'key') {
      connResult = await sshService.createSshSessionKey(activeHost as Parameters<typeof sshService.createSshSessionKey>[0])
    } else {
      toast.error('Unsupported auth type')
      return null
    }
    if (!connResult.success || !connResult.sessionId) {
      toast.error(`Connection failed: ${connResult.message}`)
      return null
    }
    const sftpResult = await sshService.sftpConnect(connResult.sessionId)
    if (!sftpResult.success) {
      toast.error(`SFTP init failed: ${sftpResult.message}`)
      return null
    }
    setSessionId(connResult.sessionId)
    return connResult.sessionId
  }, [activeHost, sessionId])

  const loadDir = useCallback(
    async (p: string) => {
      setLoading(true)
      try {
        const sid = await ensureSession()
        if (!sid) return
        const result = await sshService.sftpList(sid, p)
        if (result.success && result.files) {
          setFiles(result.files)
          setPath(p)
        } else {
          toast.error(result.message || 'Failed to list directory')
        }
      } catch (e) {
        toast.error(`Error: ${e}`)
      } finally {
        setLoading(false)
      }
    },
    [ensureSession],
  )

  // Reset on host change
  useEffect(() => {
    setSessionId(null)
    if (activeHost) void loadDir('/')
  }, [activeHost]) // eslint-disable-line react-hooks/exhaustive-deps

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

  const deleteFile = useCallback(
    async (file: FileItem) => {
      const sid = await ensureSession()
      if (!sid) return
      const result = await sshService.sftpDelete(sid, file.path, file.is_directory)
      if (result.success) {
        toast.success('Deleted successfully')
        void loadDir(path)
      } else {
        toast.error(result.message || 'Delete failed')
      }
    },
    [path, loadDir, ensureSession],
  )

  const renameFile = useCallback(
    async (file: FileItem, newName: string) => {
      const sid = await ensureSession()
      if (!sid || !newName.trim()) return
      const newPath = path === '/' ? `/${newName}` : `${path}/${newName}`
      const result = await sshService.sftpRename(sid, file.path, newPath)
      if (result.success) {
        toast.success('Renamed successfully')
        void loadDir(path)
      } else {
        toast.error(result.message || 'Rename failed')
      }
    },
    [path, loadDir, ensureSession],
  )

  const mkdir = useCallback(
    async (name: string) => {
      const sid = await ensureSession()
      if (!sid || !name.trim()) return
      const newPath = path === '/' ? `/${name}` : `${path}/${name}`
      const result = await sshService.sftpMkdir(sid, newPath)
      if (result.success) {
        toast.success('Folder created')
        void loadDir(path)
      } else {
        toast.error(result.message || 'Create folder failed')
      }
    },
    [path, loadDir, ensureSession],
  )

  return {
    files,
    path,
    history,
    historyIndex,
    loading,
    selectedFile,
    sessionId,
    loadDir,
    navigate,
    goBack,
    goForward,
    selectFile: setSelectedFile,
    deleteFile,
    renameFile,
    mkdir,
  }
}
