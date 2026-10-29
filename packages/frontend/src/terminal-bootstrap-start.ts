import { renderStartupFailure } from './terminal-bootstrap-failure-ui'
import { reportTerminalSmokeBootstrapFailure } from './terminal-bootstrap-failure'
import type { RenderRoot } from './terminal-bootstrap-types'
import {
  bootstrapTerminalApp,
  type BootstrapDependencies,
} from './terminal-bootstrap'
import {
  BOOTSTRAP_APP_DEADLINE_MS,
  bootstrapNow,
} from './terminal-bootstrap-deadline'

type BootstrapFailureReporter = (error: unknown) => Promise<void>

export function startTerminalApp(
  root: RenderRoot,
  dependencies?: BootstrapDependencies,
  reportFailure: BootstrapFailureReporter = reportTerminalSmokeBootstrapFailure,
): () => void {
  let starting = false
  let disposed = false
  let attempt = 0
  let activeController: AbortController | undefined

  const start = async (): Promise<void> => {
    if (starting || disposed) return
    const currentAttempt = ++attempt
    const startupDeadlineAt = bootstrapNow() + BOOTSTRAP_APP_DEADLINE_MS
    const guardedRoot: RenderRoot = {
      render(children) {
        if (disposed || currentAttempt !== attempt) return
        root.render(children)
      },
    }
    starting = true
    const controller = new AbortController()
    activeController = controller
    try {
      await bootstrapTerminalApp(
        guardedRoot,
        dependencies,
        controller.signal,
        startupDeadlineAt,
      )
    } catch (error) {
      console.error('Failed to bootstrap terminal application:', error)
      if (disposed || currentAttempt !== attempt) return
      renderStartupFailure(
        guardedRoot,
        error,
        () => {
          if (disposed || starting || currentAttempt !== attempt) return
          ++attempt
          void start()
        },
        () => disposed || currentAttempt !== attempt,
      )
      void reportFailure(error).catch(reportError => {
        console.error(
          'Failed to report terminal smoke bootstrap error:',
          reportError,
        )
      })
    } finally {
      if (activeController === controller) activeController = undefined
      starting = false
    }
  }

  void start()
  return () => {
    disposed = true
    ++attempt
    activeController?.abort(new Error('Terminal bootstrap disposed'))
    activeController = undefined
  }
}
