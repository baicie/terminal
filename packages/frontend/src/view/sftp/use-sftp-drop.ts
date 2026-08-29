import { useEffect, useState } from 'react'
import { uploadPaths } from '@/service/sftp-transfer'

function detectTauri(): boolean {
  if (typeof window === 'undefined') return false
  return '__TAURI_INTERNALS__' in window || '__TAURI_INVOKE__' in window
}

interface UseSftpDropArgs {
  /** 当前 SFTP 会话 id；为空时禁用拖放 */
  sessionId: string | null
  /** 拖放结束后用于上传到的远端目录 */
  remoteDir: string
}

interface UseSftpDropResult {
  /** 是否当前有文件正在 hover 在窗口上方（驱动 UI overlay 高亮） */
  isDragging: boolean
}

/**
 * 监听 Tauri webview 的拖放事件，把文件拖入应用窗口时触发上传到 SFTP 远端目录。
 *
 * Tauri v2 事件名：
 *   - `tauri://drag-enter`：文件进入窗口
 *   - `tauri://drag-over`：文件在窗口内移动
 *   - `tauri://drag-leave`：文件移出窗口
 *   - `tauri://drag-drop`：用户松手，payload 中含有 `paths: string[]`
 *
 * 浏览器 dev 环境（非 Tauri）通过 native HTML5 drag-drop 事件 fallback 到 alert 提示。
 */
export function useSftpDrop({
  sessionId,
  remoteDir,
}: UseSftpDropArgs): UseSftpDropResult {
  const [isDragging, setIsDragging] = useState(false)

  useEffect(() => {
    if (!detectTauri()) return
    if (!sessionId) return

    const offs: Array<() => void> = []
    let cancelled = false

    import('@tauri-apps/api/webviewWindow').then(({ getCurrentWebviewWindow }) => {
      if (cancelled) return
      const win = getCurrentWebviewWindow()
      const subscribe = (event: string, fn: (paths?: string[]) => void) => {
        win
          .listen<{ paths?: string[] } | undefined>(event, evt => {
            const paths = (evt.payload as { paths?: string[] } | undefined)
              ?.paths
            fn(paths)
          })
          .then(off => {
            if (cancelled) off()
            else offs.push(off)
          })
          .catch(e => console.warn(`[useSftpDrop] listen ${event} failed`, e))
      }

      subscribe('tauri://drag-enter', () => setIsDragging(true))
      subscribe('tauri://drag-over', () => setIsDragging(true))
      subscribe('tauri://drag-leave', () => setIsDragging(false))
      subscribe('tauri://drag-drop', paths => {
        setIsDragging(false)
        if (!paths || paths.length === 0 || !sessionId) return
        void uploadPaths({ sessionId, remoteDir, localPaths: paths })
      })
    })

    return () => {
      cancelled = true
      offs.forEach(off => off())
    }
  }, [sessionId, remoteDir])

  return { isDragging }
}
