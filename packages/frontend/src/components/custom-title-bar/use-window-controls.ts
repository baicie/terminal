import { useCallback, useEffect, useState } from 'react'

export function useWindowControls() {
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    let disposed = false
    let removeResizeListener: (() => void) | undefined

    const initialize = async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window')
        const currentWindow = getCurrentWindow()
        setIsMaximized(await currentWindow.isMaximized())
        removeResizeListener = await currentWindow.onResized(async () => {
          const maximized = await currentWindow.isMaximized()
          if (!disposed) setIsMaximized(maximized)
        })
      } catch {
        // Browser previews do not expose the Tauri window API.
      }
    }

    void initialize()
    return () => {
      disposed = true
      removeResizeListener?.()
    }
  }, [])

  const minimize = useCallback(async () => {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      await getCurrentWindow().minimize()
    } catch (error) {
      console.error('Failed to minimize:', error)
    }
  }, [])

  const toggleMaximize = useCallback(async () => {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      const currentWindow = getCurrentWindow()
      if (await currentWindow.isMaximized()) await currentWindow.unmaximize()
      else await currentWindow.maximize()
      setIsMaximized(await currentWindow.isMaximized())
    } catch (error) {
      console.error('Failed to toggle maximize:', error)
    }
  }, [])

  const close = useCallback(async () => {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      await getCurrentWindow().close()
    } catch (error) {
      console.error('Failed to close:', error)
    }
  }, [])

  return { isMaximized, minimize, toggleMaximize, close }
}
