// F13 — the reconnect policy this run was asked to walk.
//
// ## Why this is its own module
//
// `terminal-smoke-contract.ts` sits at its 300-line limit and is imported by the smoke root
// through a dynamic `import()` (the import test forbids evaluating it at module load). The
// policy probe is a separate question — "did the harness inject a budget?" — with its own
// validation, so it lives here and the hook imports it together with the contract.
//
// ## Why it is validated rather than trusted
//
// The value crosses IPC and becomes the attempt count of a real ladder. A non-integer or a
// zero would mean "one attempt, never retry" — a different scenario than the one the
// harness asked for — so it is rejected instead of being normalised into an ordinary run
// that would then pass while proving nothing.

import {
  terminalSmokeIpc as defaultIpc,
  type TerminalSmokeIpc,
} from './terminal-smoke-renderer-heartbeat-contract'

export interface TerminalSmokeReconnectPolicy {
  baseDelayMs?: number
  maxAttempts?: number
}

export async function loadTerminalSmokeReconnectPolicy(
  ipc: Pick<TerminalSmokeIpc, 'invoke'> = defaultIpc,
): Promise<TerminalSmokeReconnectPolicy | null> {
  const raw = await ipc.invoke('terminal_smoke_reconnect_policy')
  if (raw === null || raw === undefined) return null
  if (typeof raw !== 'object') {
    throw new Error('Invalid terminal smoke reconnect policy')
  }
  const record = raw as Record<string, unknown>
  const baseDelayMs = optionalPositiveInteger(record.baseDelayMs)
  const maxAttempts = optionalPositiveInteger(record.maxAttempts)
  if (baseDelayMs === undefined && maxAttempts === undefined) return null
  return {
    ...(baseDelayMs === undefined ? {} : { baseDelayMs }),
    ...(maxAttempts === undefined ? {} : { maxAttempts }),
  }
}

function optionalPositiveInteger(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new Error('Invalid terminal smoke reconnect policy')
  }
  return value as number
}
