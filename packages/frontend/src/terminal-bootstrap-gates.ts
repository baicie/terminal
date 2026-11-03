// The startup gate log.
//
// Split out of `terminal-bootstrap-deadline.ts` when reporting every gate took
// that file past its line limit. The record lives there; this module only
// renders it, so nothing here knows how a gate is loaded.
import type { BootstrapConfigReport } from './terminal-bootstrap-deadline'

/**
 * Renders the gate record as one log line.
 *
 * Says which mode this launch is in and why the others were not chosen. It
 * never prints a configuration value: gate configs carry endpoints and tokens,
 * and the report type carries only an outcome, an elapsed time and an error
 * message.
 */
export function describeBootstrapGates(
  mode: string,
  reports: readonly BootstrapConfigReport[],
): string {
  const parts = reports.map(
    entry =>
      `${entry.gate}=${entry.outcome}(${entry.elapsedMs}ms)`
      + (entry.error === undefined ? '' : `[${entry.error}]`),
  )
  return `bootstrap mode=${mode} gates: ${parts.join(' ')}`
}
