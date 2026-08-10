import type { TerminalThemePreset } from '@/service/database'
import { useEffect, useRef } from 'react'
import { getThemeColors } from '@/utils/terminal-themes'

export function TerminalThemePreview({
  themeId,
}: {
  themeId: TerminalThemePreset
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return

    const devicePixelRatio = window.devicePixelRatio || 1
    const colors = getThemeColors(themeId)
    canvas.width = 120 * devicePixelRatio
    canvas.height = 52 * devicePixelRatio
    context.scale(devicePixelRatio, devicePixelRatio)
    context.fillStyle = colors.background
    context.fillRect(0, 0, 120, 52)
    context.font = '5.5px monospace'
    context.textBaseline = 'top'

    const lines: Array<[string, number, number, string]> = [
      ['❯', 4, 4, colors.green],
      [' ls -la /home', 14, 4, colors.foreground],
      [
        'drwxr-xr-x  4 user  staff   128 May  3 13:00 .config',
        4,
        11,
        colors.foreground,
      ],
      [
        'drwxr-xr-x  2 user  staff   256 May  3 13:00 projects',
        4,
        18,
        colors.foreground,
      ],
      [
        '-rw-r--r--  1 user  staff  4096 May  3 13:00 README.md',
        4,
        25,
        colors.foreground,
      ],
      ['total 12', 4, 32, colors.cyan],
      ['README.md', 4, 39, colors.blue],
    ]

    for (const [text, x, y, color] of lines) {
      context.fillStyle = color
      context.fillText(text, x, y)
    }

    context.fillStyle = colors.cursor
    context.fillRect(4 + 12 * 5.5 * 0.55, 4, 5.5 * 0.55, 6.5)
  }, [themeId])

  return (
    <canvas
      ref={canvasRef}
      className="block h-[52px] w-[120px] rounded"
      style={{ imageRendering: 'pixelated' }}
    />
  )
}
