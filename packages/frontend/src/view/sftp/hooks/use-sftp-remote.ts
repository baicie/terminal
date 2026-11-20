import type { FileItem } from '@/service/ssh'
import { sshService } from '@/service/ssh'
import { toast } from '@/components/ui/sonner'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { registerSession } from '@/service/sftp-session-claim'
import { isSessionBusy } from '@/service/sftp-transfer-session'
import { releaseOrDefer } from './sftp-deferred-release'
import { connectionIdentity, type ConnectionFields } from './host-identity'
import { loadDirectory } from './load-directory'
import { createNavigationTracker, isTicketCurrent } from './navigation-token'
import { traceSftp } from './sftp-trace'
import { useSftpFileOperations } from './use-sftp-file-operations'

interface UseSftpRemoteOptions {
  activeHost: (ConnectionFields & { name: string }) | null
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
  const hostKey = activeHost ? connectionIdentity(activeHost) : null
  const hostKeyRef = useRef(hostKey)
  hostKeyRef.current = hostKey
  const sessionRef = useRef<SessionBinding | null>(null)
  // A second caller while the first is still connecting must wait for that
  // connection instead of opening another SSH+SFTP session that nobody owns.
  const inflightRef = useRef<{ key: string, promise: Promise<string | null> } | null>(null)
  // Every host switch starts a new generation; responses from older
  // generations are dropped instead of overwriting the new host's listing.
  const generationRef = useRef(0)
  /** Which listing is current; `generationRef` only moves on a host change. */
  const navigations = useRef(createNavigationTracker())
  const unmountedRef = useRef(false)

  /**
   * Close the session now, unless a transfer is still using it.
   *
   * When something is running or queued, the session is handed to a watcher that
   * polls the queue and closes it once the last transfer for it settles. The
   * watcher owns the id from that moment, so a remount cannot double-close or
   * lose the connection.
   *
   * Polling rather than subscribing because the queue is a plain zustand store
   * with no "last of this session settled" event, and a 1 s cadence costs
   * nothing while a panel is closing.
   */
  const releaseSessionUnlessBusy = useCallback((): boolean => {
    const current = sessionRef.current
    if (!current) {
      inflightRef.current = null
      setSessionId(null)
      return true
    }
    const released = releaseOrDefer(current.id, isSessionBusy)
    if (released) {
      sessionRef.current = null
      inflightRef.current = null
      setSessionId(null)
    }
    return released
  }, [])

  const ensureSession = useCallback(
    async (
      host: UseSftpRemoteOptions['activeHost'],
      expectedKey: string | null,
    ): Promise<string | null> => {
      if (!host || expectedKey === null) return null
      const current = sessionRef.current
      if (current?.key === expectedKey) return current.id

      const inflight = inflightRef.current
      if (inflight?.key === expectedKey) return inflight.promise

      // A session for another host (or none) must not be reused. It also must
      // not be *closed* while a transfer is still using it — that is `INV-14`
      // on the host-switch path, and it goes through the same guard as unmount.
      if (current) {
        const released = releaseSessionUnlessBusy()
        // A deferred session belongs to another host and cannot be reused here;
        // drop the reference without closing the connection.
        if (!released) sessionRef.current = null
      }

      const promise = (async () => {
        let connResult
        if (host.authType === 'password') {
          connResult = await sshService.createSshSessionPassword(host as Parameters<typeof sshService.createSshSessionPassword>[0])
        } else if (host.authType === 'key') {
          connResult = await sshService.createSshSessionKey(host as Parameters<typeof sshService.createSshSessionKey>[0])
        } else {
          toast.error(t('sftp.unsupportedAuthType'))
          return null
        }
        // The host changed while connecting: the session is unusable here and
        // must not leak, even though nobody has stored it yet.
        if (unmountedRef.current || expectedKey !== hostKeyRef.current) {
          if (connResult.success && connResult.sessionId) {
            void sshService.close(connResult.sessionId).catch(() => undefined)
          }
          return null
        }
        if (!connResult.success || !connResult.sessionId) {
          traceSftp(`connect failed: ${JSON.stringify(connResult.message)}`)
          toast.error(t('sftp.connectionFailed', { error: connResult.message }))
          return null
        }
        const sftpResult = await sshService.sftpConnect(connResult.sessionId)
        if (unmountedRef.current || expectedKey !== hostKeyRef.current) {
          void sshService.close(connResult.sessionId).catch(() => undefined)
          return null
        }
        if (!sftpResult.success) {
          traceSftp(`sftpConnect failed: ${JSON.stringify(sftpResult.message)}`)
          toast.error(t('sftp.initFailed', { error: sftpResult.message }))
          void sshService.close(connResult.sessionId).catch(() => undefined)
          return null
        }
        // Register before anything can claim it. The claim module is an allowlist:
        // an id it has never seen is refused, which is how a closed connection
        // stays closed without keeping a tombstone for it.
        registerSession(connResult.sessionId)
        sessionRef.current = { key: expectedKey, id: connResult.sessionId }
        setSessionId(connResult.sessionId)
        return connResult.sessionId
      })()
      inflightRef.current = { key: expectedKey, promise }
      try {
        return await promise
      } finally {
        if (inflightRef.current?.promise === promise) inflightRef.current = null
      }
    },
    [releaseSessionUnlessBusy, t],
  )

  const loadDir = useCallback(
    async (p: string) => {
      const key = hostKey
      if (key === null) return
      const generation = generationRef.current
      const ticket = navigations.current.next(generation, key)
      // A host change OR a newer navigation makes this answer irrelevant.
      const stale = () =>
        !isTicketCurrent(ticket, navigations.current, generationRef.current, hostKeyRef.current)
      setLoading(true)
      try {
        const sid = await ensureSession(activeHost, key)
        traceSftp(`loadDir ${p} sid=${sid ?? 'null'}`)
        if (!sid) return
        const outcome = await loadDirectory({ sessionId: sid, requestedPath: p, isStale: stale })
        if (outcome.kind === 'stale' || outcome.kind === 'no-session') return
        if (outcome.kind === 'failed') {
          toast.error(outcome.message || t('sftp.listFailed'))
          return
        }
        setFiles(outcome.files as FileItem[])
        setPath(outcome.path)
      } catch (e) {
        if (!stale()) toast.error(t('sftp.genericError', { error: String(e) }))
      } finally {
        // Only the newest listing owns the spinner.
        if (ticket.navigation === navigations.current.newest()) setLoading(false)
      }
    },
    [activeHost, hostKey, ensureSession, t],
  )

  useEffect(() => () => {
    unmountedRef.current = true
  }, [])

  // `INV-14`: closing a panel must not truncate a transfer. The effect decides *when*
  // to ask; `releaseSessionUnlessBusy` decides *whether*. Calling it from both the body
  // and the cleanup double-released: the body cleared `sessionRef`, `loadDir`
  // reconnected, then the cleanup cleared it again on the next host change.
  useEffect(() => {
    generationRef.current += 1
    // The previous host's connection is released here, not in the cleanup: by
    // the time the cleanup runs, `loadDir` below has already opened the new one.
    releaseSessionUnlessBusy()
    setFiles([])
    // `.` so the server decides where the user starts (`resolve-listing-path.ts`).
    const startPath = '.'
    setPath(startPath)
    setHistory([startPath])
    setHistoryIndex(0)
    setSelectedFile(null)
    setLoading(false)
    if (hostKey !== null) void loadDir(startPath)
    return () => {
      // Unmount only. Nothing to reconnect to, so this is the last chance to
      // release — and it still refuses while a transfer is using the session.
      releaseSessionUnlessBusy()
    }
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

  const { deleteFile, renameFile, mkdir } = useSftpFileOperations({
    activeHost,
    hostKey,
    hostKeyRef,
    currentSession,
    loadDir,
    path,
  })

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
