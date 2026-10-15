import { useEffect } from 'react'
import type { Terminal } from '@baicie/xterm'
import { publishInputProbeDiag } from './probe-automation'
import {
  formatInputProbeDiagnostic,
  type TerminalInputProbeDiagnosticEvent,
} from './probe-input-diagnostic'

function reportDiagnostic(message: string): void {
  // The Rust diagnostic endpoint accepts at most 256 bytes per line.
  let bounded = ''
  for (const raw of message) {
    const code = raw.charCodeAt(0)
    const character = code <= 31 || code === 127 ? ' ' : raw
    if (new TextEncoder().encode(bounded + character).byteLength > 256) break
    bounded += character
  }
  void publishInputProbeDiag(bounded).catch(() => {})
}

export function inputProbeDiagnostic(
  event: TerminalInputProbeDiagnosticEvent,
): void {
  reportDiagnostic(formatInputProbeDiagnostic(event))
}

export function useInputProbeDiagnostics(term: Terminal): void {
  // Diagnostics: observe keydown delivery and focus transitions.
  useEffect(() => {
    const diag = reportDiagnostic
    const keyDisposable = term.onKey(({ key, domEvent }) => {
      const bytes = Array.from(new TextEncoder().encode(key), byte =>
        byte.toString(16).padStart(2, '0'),
      ).join('')
      diag(
        `xterm-key key=${JSON.stringify(key)} code=${domEvent.code} hex=${bytes}`,
      )
    })
    const onKeyDown = (event: KeyboardEvent) => {
      const target =
        event.target instanceof Element
          ? `${event.target.tagName}.${event.target.className}`
          : 'unknown'
      const active =
        document.activeElement instanceof Element
          ? `${document.activeElement.tagName}.${document.activeElement.className}`
          : 'unknown'
      diag(
        `keydown key=${event.key} code=${event.code} keyCode=${event.keyCode} which=${event.which} charCode=${event.charCode} target=${target} active=${active}`,
      )
    }
    const onInput = (event: InputEvent) => {
      diag(
        `dom-input type=${event.inputType} data=${JSON.stringify(event.data ?? '')} composing=${event.isComposing} value=${JSON.stringify((event.target as HTMLTextAreaElement | null)?.value ?? '')}`,
      )
    }
    const onCompositionStart = (event: CompositionEvent) =>
      diag(`compositionstart data=${JSON.stringify(event.data ?? '')}`)
    const onCompositionUpdate = (event: CompositionEvent) =>
      diag(`compositionupdate data=${JSON.stringify(event.data ?? '')}`)
    const onCompositionEnd = (event: CompositionEvent) =>
      diag(`compositionend data=${JSON.stringify(event.data ?? '')}`)
    const onFocus = () => {
      const active =
        document.activeElement instanceof Element
          ? `${document.activeElement.tagName}.${document.activeElement.className}`
          : 'unknown'
      diag(`window-focus active=${active}`)
      // The window can become key long after mount; WebKit does not always
      // route keystrokes to the xterm textarea that was focused earlier.
      term.focus()
    }
    const onBlur = () => diag('window-blur')
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('input', onInput, true)
    window.addEventListener('compositionstart', onCompositionStart, true)
    window.addEventListener('compositionupdate', onCompositionUpdate, true)
    window.addEventListener('compositionend', onCompositionEnd, true)
    window.addEventListener('focus', onFocus)
    window.addEventListener('blur', onBlur)
    return () => {
      keyDisposable.dispose()
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('input', onInput, true)
      window.removeEventListener('compositionstart', onCompositionStart, true)
      window.removeEventListener('compositionupdate', onCompositionUpdate, true)
      window.removeEventListener('compositionend', onCompositionEnd, true)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('blur', onBlur)
    }
  }, [term])
}
