import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react'
import { useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

interface TerminalSplitSashProps {
  direction: 'horizontal' | 'vertical'
  value: number
  style?: CSSProperties
  onChange: (value: number, final: boolean) => void
}

const [MIN_SIZE, MAX_SIZE] = [20, 80]
const KEYBOARD_STEP = 5
const VISUAL_SIZE = 4

function clampSize(value: number) {
  return Math.max(MIN_SIZE, Math.min(MAX_SIZE, value))
}

export function TerminalSplitSash({
  direction,
  value,
  style,
  onChange,
}: TerminalSplitSashProps) {
  const { t } = useTranslation()
  const sashRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{
    pointerId: number
    value: number
    target: HTMLDivElement
  } | null>(null)
  const frameRef = useRef<number | null>(null)

  const valueFromPointer = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const parent = sashRef.current?.parentElement
      if (!parent) return null
      const bounds = parent.getBoundingClientRect()
      const raw =
        direction === 'horizontal'
          ? ((event.clientX - bounds.left) / Math.max(bounds.width, 1)) * 100
          : ((event.clientY - bounds.top) / Math.max(bounds.height, 1)) * 100
      return clampSize(raw)
    },
    [direction],
  )

  const cancelPendingFrame = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    frameRef.current = null
  }, [])

  const schedulePreview = useCallback(
    (next: number) => {
      if (dragRef.current) dragRef.current.value = next
      if (frameRef.current !== null) return
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null
        const latest = dragRef.current?.value
        if (latest !== undefined) onChange(latest, false)
      })
    },
    [onChange],
  )

  const resetDragStyles = useCallback(() => {
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }, [])

  const releasePointer = useCallback(
    (pointerId: number, target = sashRef.current) => {
      if (!target?.hasPointerCapture(pointerId)) return
      target.releasePointerCapture(pointerId)
    },
    [],
  )

  const finishDrag = useCallback(
    (pointerId: number, next: number) => {
      const target = dragRef.current?.target
      cancelPendingFrame()
      dragRef.current = null
      onChange(next, true)
      resetDragStyles()
      releasePointer(pointerId, target)
    },
    [cancelPendingFrame, onChange, releasePointer, resetDragStyles],
  )

  useEffect(
    () => () => {
      cancelPendingFrame()
      const drag = dragRef.current
      dragRef.current = null
      resetDragStyles()
      if (drag) releasePointer(drag.pointerId, drag.target)
    },
    [cancelPendingFrame, releasePointer, resetDragStyles],
  )

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || event.isPrimary === false || dragRef.current)
      return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      pointerId: event.pointerId,
      value: clampSize(value),
      target: event.currentTarget,
    }
    document.body.style.cursor =
      direction === 'horizontal' ? 'col-resize' : 'row-resize'
    document.body.style.userSelect = 'none'
  }

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    const next = valueFromPointer(event)
    if (next !== null) schedulePreview(next)
  }

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    const next = valueFromPointer(event) ?? dragRef.current.value
    finishDrag(event.pointerId, next)
  }

  const handlePointerCancel = (event: PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    finishDrag(event.pointerId, dragRef.current.value)
  }

  const handleLostPointerCapture = (event: PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    finishDrag(event.pointerId, dragRef.current.value)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    let next: number | null = null
    if (event.key === 'Home') next = MIN_SIZE
    if (event.key === 'End') next = MAX_SIZE
    if (event.key === 'Enter') next = 50
    if (direction === 'horizontal') {
      if (event.key === 'ArrowLeft') next = value - KEYBOARD_STEP
      if (event.key === 'ArrowRight') next = value + KEYBOARD_STEP
    } else {
      if (event.key === 'ArrowUp') next = value - KEYBOARD_STEP
      if (event.key === 'ArrowDown') next = value + KEYBOARD_STEP
    }
    if (next === null) return
    event.preventDefault()
    onChange(clampSize(next), true)
  }

  const sashStyle: CSSProperties = {
    ...style,
    width: direction === 'horizontal' ? `${VISUAL_SIZE}px` : undefined,
    height: direction === 'vertical' ? `${VISUAL_SIZE}px` : undefined,
  }

  return (
    <div
      ref={sashRef}
      role="separator"
      aria-label={t('terminal.resizeSplit')}
      aria-orientation={direction === 'horizontal' ? 'vertical' : 'horizontal'}
      aria-valuemin={MIN_SIZE}
      aria-valuemax={MAX_SIZE}
      aria-valuenow={Math.round(value)}
      tabIndex={0}
      style={sashStyle}
      className={cn(
        "group relative z-10 touch-none bg-border outline-none transition-colors before:absolute before:content-[''] hover:bg-primary/60 focus-visible:bg-primary",
        direction === 'horizontal'
          ? 'cursor-col-resize before:-inset-x-2 before:inset-y-0'
          : 'cursor-row-resize before:inset-x-0 before:-inset-y-2',
      )}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onLostPointerCapture={handleLostPointerCapture}
      onDoubleClick={() => onChange(50, true)}
      onKeyDown={handleKeyDown}
    >
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute rounded-full bg-muted-foreground/70 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100',
          direction === 'horizontal'
            ? 'left-1/2 top-1/2 h-8 w-0.5 -translate-x-1/2 -translate-y-1/2'
            : 'left-1/2 top-1/2 h-0.5 w-8 -translate-x-1/2 -translate-y-1/2',
        )}
      />
    </div>
  )
}
