import type {
  InputProbeAutomationConfig,
  InputProbeAutomationResult,
} from './probe-automation'

export function failureResult(
  config: InputProbeAutomationConfig,
  startedAt: number,
  expectedHex: string,
  results: InputProbeAutomationResult['results'],
  error: string,
): InputProbeAutomationResult {
  return {
    ok: false,
    rounds: config.rounds,
    expectedText: config.expectedText,
    expectedHex,
    durationMs: Math.max(1, Math.ceil(performance.now() - startedAt)),
    results,
    error,
  }
}
