/**
 * useTerminalResize Hook
 * 终端 Resize 处理
 */

import type { Terminal as XTerminal } from '@baicie/xterm'
import { useEffect, useRef } from 'react'

export interface UseTerminalResizeOptions {
  /** xterm 实例 */
  term: XTerminal | null
  /** 容器 ref */
  containerRef: React.RefObject<HTMLElement | null>
  /** Resize 回调 */
  onResize?: (cols: number, rows: number) => void
}

/**
 * 终端 Resize Hook
 *
 * 职责：
 * - 使用 ResizeObserver 监听容器大小变化
 * - 调用 fitAddon.fit() 调整终端大小
 * - 通知后端新的 cols/rows
 */
export function useTerminalResize({
  term,
  containerRef,
  onResize,
}: UseTerminalResizeOptions) {
  const fitAddonRef = useRef<{ fit: () => void } | null>(null)
  const termRef = useRef<XTerminal | null>(null)
  termRef.current = term

  // 初始化 FitAddon
  useEffect(() => {
    if (!term) return

    // 动态导入 fit addon
    import('@xterm/addon-fit').then(mod => {
      if (termRef.current) {
        // 创建 FitAddon 实例
        const AddonFitClass = mod.AddonFitType || mod.FitAddon
        if (AddonFitClass) {
          // @ts-expect-error dynamic addon
          const fitAddon = new AddonFitClass()
          fitAddonRef.current = fitAddon
          term.loadAddon(fitAddon)
        }
      }
    }).catch(console.error)

    return () => {
      fitAddonRef.current = null
    }
  }, [term])

  // 监听容器大小变化
  useEffect(() => {
    const container = containerRef.current
    if (!container || !term) return

    const resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        if (entry.target === container && fitAddonRef.current) {
          fitAddonRef.current.fit()

          // 通知新的尺寸
          if (onResize && termRef.current) {
            const { cols, rows } = termRef.current
            onResize(cols, rows)
          }
        }
      }
    })

    resizeObserver.observe(container)

    return () => {
      resizeObserver.disconnect()
    }
  }, [containerRef, term, onResize])
}
