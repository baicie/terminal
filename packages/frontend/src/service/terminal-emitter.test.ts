import { afterEach, describe, expect, it, vi } from 'vitest'
import { terminalEmitter } from './terminal-emitter'
import { useAppStore } from '@/store/app'

describe('terminalEmitter routing', () => {
  afterEach(() => {
    useAppStore.setState({ activeTabId: null })
  })

  it.each([
    ['write', (data: string) => terminalEmitter.write(data), 'payload'],
    [
      'writeCommand',
      (data: string) => terminalEmitter.writeCommand(data),
      'payload\r',
    ],
  ])(
    'routes %s without a target to the active tab',
    (_name, emit, expected) => {
      useAppStore.setState({ activeTabId: 'tab-active' })
      const listener = vi.fn()
      const removeListener = terminalEmitter.onWrite(listener)

      try {
        emit('payload')
        expect(listener).toHaveBeenCalledOnce()
        expect(listener).toHaveBeenCalledWith(expected, 'tab-active')
      } finally {
        removeListener()
      }
    },
  )

  it('keeps an explicit target instead of replacing it with the active tab', () => {
    useAppStore.setState({ activeTabId: 'tab-active' })
    const listener = vi.fn()
    const removeListener = terminalEmitter.onWrite(listener)

    try {
      terminalEmitter.write('payload', 'tab-explicit')
      expect(listener).toHaveBeenCalledWith('payload', 'tab-explicit')
    } finally {
      removeListener()
    }
  })

  it.each([
    ['write', (data: string) => terminalEmitter.write(data)],
    ['writeCommand', (data: string) => terminalEmitter.writeCommand(data)],
  ])('does not emit %s when no target tab exists', (_name, emit) => {
    useAppStore.setState({ activeTabId: null })
    const listener = vi.fn()
    const removeListener = terminalEmitter.onWrite(listener)

    try {
      emit('payload')
      expect(listener).not.toHaveBeenCalled()
    } finally {
      removeListener()
    }
  })
})
