import { createElement } from 'react'
import type { RenderRoot } from './terminal-bootstrap-types'

/**
 * Renders the startup failure screen.
 *
 * The screen itself is imported lazily because it pulls in the i18next runtime
 * and every locale bundle. Importing it eagerly would put roughly 63 KB gzip
 * on the critical path to the first terminal, for a screen that only renders
 * once startup has already failed. The delay that buys is acceptable precisely
 * because the app is broken at that point.
 *
 * If even that lazy import fails, the message is rendered as plain text: the
 * one outcome that must never happen is a blank window with no explanation.
 */
export function renderStartupFailure(
  root: RenderRoot,
  error: unknown,
  onRetry: () => void,
  isDisposed: () => boolean,
): void {
  const message = error instanceof Error ? error.message : String(error)
  void import('@/components/startup-error')
    .then(({ StartupError }) => {
      // A superseded bootstrap attempt must not overwrite the current UI.
      if (isDisposed()) return
      root.render(createElement(StartupError, { error: message, onRetry }))
    })
    .catch(reportError => {
      console.error('Failed to load the startup error screen:', reportError)
      root.render(
        createElement(
          'pre',
          { style: { padding: 16, whiteSpace: 'pre-wrap' } },
          message,
        ),
      )
    })
}
