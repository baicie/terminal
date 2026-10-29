import { Component, type ReactNode } from 'react'
import { encodeTerminalInputProbeText } from './probe-protocol'
import {
  publishInputProbeResult,
  type InputProbeAutomationConfig,
} from './probe-automation'

const AUTOMATION_STARTED_AT = performance.now()

export class InputProbeErrorBoundary extends Component<
  { children: ReactNode; config: InputProbeAutomationConfig },
  { error: string | null }
> {
  state = { error: null as string | null }

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) }
  }

  componentDidCatch(error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    const config = this.props.config
    void publishInputProbeResult({
      ok: false,
      rounds: config.rounds,
      expectedText: config.expectedText,
      expectedHex: encodeTerminalInputProbeText(config.expectedText),
      durationMs: Math.max(
        1,
        Math.ceil(performance.now() - AUTOMATION_STARTED_AT),
      ),
      results: [],
      error: `input probe crash: ${message}`,
    }).catch(() => {})
  }

  render() {
    if (this.state.error) return null
    return this.props.children
  }
}
