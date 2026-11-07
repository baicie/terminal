import type { FileItem } from '@/service/ssh'
import { sshService } from '@/service/ssh'
import { toast } from '@/components/ui/sonner'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface UseSftpRemoteOptions {
  activeHost: { id: string, authType: string, name: string } | null
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

interface SessionBinding {
  /** Host identity this session belongs to. */
  key: string
  id: string
}

export function useSftpRemote({ activeHost }: UseSftpRemoteOptions): UseSftpRemoteResult {
  const { t } = useTranslation()
  const [files, setFiles] = useState<FileItem[]>([])
  const [path, setPath] = useState('/')
  const [history, setHistory] = useState(['/'])
  const [historyIndex, setHistoryIndex] = useState(0)
  const [loading, setLoading] = useState(false)
  const [selectedFile, setSelectedFile] = useState<FileItem | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)

  // A session is only valid for the host it was opened for. Keeping that
  // binding next to the id is what makes "switch host then load" safe: the
  // previous implementation kept the old id in the state closure and could
  // list the new host through the old connection.
  const hostKey = activeHost ? `${activeHost.id}:${activeHost.authType}` : null
  const hostKeyRef = useRef(hostKey)
  hostKeyRef.current = hostKey
  const sessionRef = useRef<SessionBinding | null>(null)
  // Every host switch starts a new generation; responses from older
  // generations are dropped instead of overwriting the new host's listing.
  const generationRef = useRef(0)

  const releaseSession = useCallback(() => {
    const current = sessionRef.current
    sessionRef.current = null
    setSessionId(null)
    if (current) void sshService.close(current.id).catch(() => undefined)
  }, [])

  const ensureSession = useCallback(
    async (
      host: UseSftpRemoteOptions['activeHost'],
      expectedKey: string | null,
    ): Promise<string | null> => {
      if (!host || expectedKey === null) return null
      const current = sessionRef.current
      if (current?.key === expectedKey) return current.id

      // A session for another host (or none) must not be reused.
      if (current) {
        sessionRef.current = null
        setSessionId(null)
        void sshService.close(current.id).catch(() => undefined)
      }

      let connResult
      if (host.authType === 'password') {
        connResult = await sshService.createSshSessionPassword(host as Parameters<typeof sshService.createSshSessionPassword>[0])
      } else if (host.authType === 'key') {
        connResult = await sshService.createSshSessionKey(host as Parameters<typeof sshService.createSshSessionKey>[0])
      } else {
        toast.error(t('sftp.unsupportedAuthType'))
        return null
      }
      if (!connResult.success || !connResult.sessionId) {
        toast.error(t('sftp.connectionFailed', { error: connResult.message }))
        return null
      }
      const sftpResult = await sshService.sftpConnect(connResult.sessionId)
      if (!sftpResult.success) {
        toast.error(t('sftp.initFailed', { error: sftpResult.message }))
        void sshService.close(connResult.sessionId).catch(() => undefined)
        return null
      }
      sessionRef.current = { key: expectedKey, id: connResult.sessionId }
      setSessionId(connResult.sessionId)
      return connResult.sessionId
    },
    [t],
  )

  const loadDir = useCallback(
    async (p: string) => {
      const key = hostKey
      if (key === null) return
      const generation = generationRef.current
      setLoading(true)
      try {
        const sid = await ensureSession(activeHost, key)
        if (!sid) return
        const result = await sshService.sftpList(sid, p)
        // The host may have changed while the listing was in flight; the
        // answer describes the previous host and must not reach the UI.
        if (generation !== generationRef.current || key !== hostKeyRef.current) return
        if (result.success && result.files) {
          setFiles(result.files)
          setPath(p)
        } else {
          toast.error(result.message || t('sftp.listFailed'))
        }
      } catch (e) {
        if (generation === generationRef.current && key === hostKeyRef.current) {
          toast.error(t('sftp.genericError', { error: String(e) }))
        }
      } finally {
        if (generation === generationRef.current) setLoading(false)
      }
    },
    [activeHost, hostKey, ensureSession, t],
  )

  // Reset and release on host change, and close the last session on unmount.
  useEffect(() => {
    generationRef.current += 1
    releaseSession()
    setFiles([])
    setPath('/')
    setHistory(['/'])
    setHistoryIndex(0)
    setSelectedFile(null)
    setLoading(false)
    if (hostKey !== null) void loadDir('/')
    return () => releaseSession()
    // loadDir changes with the host it was built for; hostKey is the trigger.
  }, [hostKey]) // eslint-disable-line react-hooks/exhaustive-deps

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

  /** True when the session still belongs to the host this render shows. */
  const currentSession = useCallback(
    async (host: UseSftpRemoteOptions['activeHost'], key: string | null) => {
      const sid = await ensureSession(host, key)
      if (!sid || key !== hostKeyRef.current) return null
      return sid
    },
    [ensureSession],
  )

  const deleteFile = useCallback(
    async (file: FileItem) => {
      const sid = await currentSession(activeHost, hostKey)
      if (!sid) return
      const result = await sshService.sftpDelete(sid, file.path, file.is_directory)
      if (keyChanged(hostKey, hostKeyRef)) return
      if (result.success) {
        toast.success(t('sftp.deleted'))
        void loadDir(path)
      } else {
        toast.error(result.message || t('sftp.deleteFailed'))
      }
    },
    [activeHost, hostKey, currentSession, loadDir, path, t],
  )

  const renameFile = useCallback(
    async (file: FileItem, newName: string) => {
      const sid = await currentSession(activeHost, hostKey)
      if (!sid || !newName.trim()) return
      const newPath = path === '/' ? `/${newName}` : `${path}/${newName}`
      const result = await sshService.sftpRename(sid, file.path, newPath)
      if (keyChanged(hostKey, hostKeyRef)) return
      if (result.success) {
        toast.success(t('sftp.renamed'))
        void loadDir(path)
      } else {
        toast.error(result.message || t('sftp.renameFailed'))
      }
    },
    [activeHost, hostKey, currentSession, loadDir, path, t],
  )

  const mkdir = useCallback(
    async (name: string) => {
      const sid = await currentSession(activeHost, hostKey)
      if (!sid || !name.trim()) return
      const newPath = path === '/' ? `/${name}` : `${path}/${name}`
      const result = await sshService.sftpMkdir(sid, newPath)
      if (keyChanged(hostKey, hostKeyRef)) return
      if (result.success) {
        toast.success(t('sftp.folderCreated'))
        void loadDir(path)
      } else {
        toast.error(result.message || t('sftp.createFolderFailed'))
      }
    },
    [activeHost, hostKey, currentSession, loadDir, path, t],
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

function keyChanged(key: string | null, ref: { current: string | null }): boolean {
  return key !== ref.current
}
