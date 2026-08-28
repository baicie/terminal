const RESIZE_MIN_INTERVAL_MS = 32

interface TerminalBufferView {
  readonly viewportY: number
  readonly baseY: number
}

interface TerminalViewportAdapter {
  readonly buffer: { readonly active: TerminalBufferView }
  readonly rows: number
  scrollToBottom(): void
  scrollToLine(line: number): void
  refresh(start: number, end: number): void
  write(data: string | Uint8Array, callback?: () => void): void
}

interface ViewportAnchor {
  pinnedToBottom: boolean
  viewportY: number
}

export class TerminalViewportController {
  private pinnedToBottom = true
  private disposed = false
  private attached = false
  private lastFitAt = Number.NEGATIVE_INFINITY
  private resizeFrame: number | null = null
  private resizeTimer: ReturnType<typeof setTimeout> | null = null
  private pinnedStateFrame: number | null = null
  private touchY: number | null = null

  constructor(
    private readonly terminal: TerminalViewportAdapter,
    private readonly fit: () => void,
    private readonly host: HTMLElement,
  ) {}

  attach(): void {
    if (this.attached || this.disposed) return
    this.attached = true
    this.host.addEventListener('wheel', this.handleWheel, {
      capture: true,
      passive: true,
    })
    this.host.addEventListener('keydown', this.handleKeyDown, true)
    this.host.addEventListener('touchstart', this.handleTouchStart, {
      capture: true,
      passive: true,
    })
    this.host.addEventListener('touchmove', this.handleTouchMove, {
      capture: true,
      passive: true,
    })
  }

  requestFit(): void {
    if (
      this.disposed ||
      this.resizeFrame !== null ||
      this.resizeTimer !== null
    ) {
      return
    }
    const wait = Math.max(
      0,
      RESIZE_MIN_INTERVAL_MS - (Date.now() - this.lastFitAt),
    )
    const scheduleFrame = () => {
      this.resizeTimer = null
      this.resizeFrame = requestAnimationFrame(() => {
        this.resizeFrame = null
        this.lastFitAt = Date.now()
        this.fitNow()
      })
    }
    if (wait > 0) {
      this.resizeTimer = setTimeout(scheduleFrame, wait)
    } else {
      scheduleFrame()
    }
  }

  fitNow(): void {
    if (this.disposed) return
    const anchor = this.captureAnchor()
    this.fit()
    this.restoreAnchor(anchor)
    this.refresh()
  }

  write(data: string | Uint8Array, callback?: () => void): void {
    const anchor = this.captureAnchor()
    this.terminal.write(data, () => {
      if (!this.disposed) this.restoreAnchor(anchor)
      callback?.()
    })
  }

  reactivate(): void {
    this.fitNow()
  }

  refresh(): void {
    if (this.disposed || this.terminal.rows < 1) return
    this.terminal.refresh(0, this.terminal.rows - 1)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.attached) {
      this.host.removeEventListener('wheel', this.handleWheel, true)
      this.host.removeEventListener('keydown', this.handleKeyDown, true)
      this.host.removeEventListener('touchstart', this.handleTouchStart, true)
      this.host.removeEventListener('touchmove', this.handleTouchMove, true)
    }
    if (this.resizeFrame !== null) cancelAnimationFrame(this.resizeFrame)
    if (this.pinnedStateFrame !== null)
      cancelAnimationFrame(this.pinnedStateFrame)
    if (this.resizeTimer !== null) clearTimeout(this.resizeTimer)
    this.resizeFrame = null
    this.pinnedStateFrame = null
    this.resizeTimer = null
  }

  private captureAnchor(): ViewportAnchor {
    return {
      pinnedToBottom: this.pinnedToBottom,
      viewportY: this.terminal.buffer.active.viewportY,
    }
  }

  private restoreAnchor(anchor: ViewportAnchor): void {
    if (anchor.pinnedToBottom) {
      this.terminal.scrollToBottom()
      return
    }
    const maxScroll = this.terminal.buffer.active.baseY
    this.terminal.scrollToLine(Math.min(anchor.viewportY, maxScroll))
  }

  private schedulePinnedStateUpdate(): void {
    if (this.pinnedStateFrame !== null || this.disposed) return
    this.pinnedStateFrame = requestAnimationFrame(() => {
      this.pinnedStateFrame = null
      const buffer = this.terminal.buffer.active
      this.pinnedToBottom = buffer.viewportY >= buffer.baseY - 1
    })
  }

  private readonly handleWheel = (event: WheelEvent) => {
    if (event.deltaY < 0) this.pinnedToBottom = false
    this.schedulePinnedStateUpdate()
  }

  private readonly handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'PageUp' || event.key === 'Home') {
      this.pinnedToBottom = false
    }
    if (
      event.key === 'PageUp' ||
      event.key === 'PageDown' ||
      event.key === 'Home' ||
      event.key === 'End'
    ) {
      this.schedulePinnedStateUpdate()
    }
  }

  private readonly handleTouchStart = (event: TouchEvent) => {
    this.touchY = event.touches[0]?.clientY ?? null
  }

  private readonly handleTouchMove = (event: TouchEvent) => {
    const nextY = event.touches[0]?.clientY
    if (nextY === undefined || this.touchY === null) return
    if (nextY < this.touchY) this.pinnedToBottom = false
    this.touchY = nextY
    this.schedulePinnedStateUpdate()
  }
}
