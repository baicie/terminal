import type { FileItem } from '@/service/ssh'
import { sshService } from '@/service/ssh'
import { toast } from '@/components/ui/sonner'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * The three operations a file listing offers: delete, rename, mkdir.
 *
 * Extracted from `use-sftp-remote` when that file hit its size limit. They share
 * one shape — resolve the session, act, check the host did not change under us,
 * reload — so they belong together rather than scattered through the hook.
 *
 * Every one re-checks `hostKey` after the await: a rename aimed at prod-01 must
 * not land on staging because the user switched hosts while the request was in
 * flight.
 */
export interface FileOperationArgs {
  activeHost: { id: string, authType: string, name: string } | null
  hostKey: string | null
  hostKeyRef: { current: string | null }
  currentSession: (
    host: FileOperationArgs['activeHost'],
    key: string | null,
  ) => Promise<string | null>
  loadDir: (path: string) => void
  path: string
}

export function useSftpFileOperations(args: FileOperationArgs) {
  const { activeHost, hostKey, hostKeyRef, currentSession, loadDir, path } = args
  const { t } = useTranslation()

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
    [activeHost, hostKey, hostKeyRef, currentSession, loadDir, path, t],
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
    [activeHost, hostKey, hostKeyRef, currentSession, loadDir, path, t],
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
    [activeHost, hostKey, hostKeyRef, currentSession, loadDir, path, t],
  )

  return { deleteFile, renameFile, mkdir }
}

function keyChanged(key: string | null, ref: { current: string | null }): boolean {
  return key !== ref.current
}
