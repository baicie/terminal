import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/** Everything the orchestrator hands to the two client processes. */
export interface CrossVersionBootstrap {
  base: string
  teamId: string
  userA: { id: string, token: string }
  userB: { id: string, token: string }
  dbA: string
  dbB: string
  upgradedDb: string
}

export interface SeedResult {
  ok: boolean
  seededAt: number
  teamId: string
  hostIds: string[]
  snippetIds: string[]
  serverShareIds: string[]
  syncError: string | null
  pushConflicts: string[]
  legacyUpdateProbe: {
    conflictIds: string[]
    errorIds: string[]
    requestError: string | null
  } | null
  failedAssertions: string[]
}

export interface BResult {
  ok: boolean
  role: string
  failedAssertions: string[]
  details: Record<string, unknown>
}

export interface VerifyResult {
  ok: boolean
  failedAssertions: string[]
  details: Record<string, unknown>
}

export function requiredEnv(name: string): string {
  const value = process.env[name]
  if (value === undefined || value === '') {
    throw new Error(`${name} is not set; the cross-version orchestrator owns this process`)
  }
  return value
}

export function stateDir(): string {
  return requiredEnv('TEAM_SYNC_E2E_STATE_DIR')
}

export function statePath(name: string): string {
  return path.join(stateDir(), name)
}

export function readState<T>(name: string): T {
  return JSON.parse(readFileSync(statePath(name), 'utf8')) as T
}

export function writeState(name: string, value: unknown): void {
  writeFileSync(statePath(name), `${JSON.stringify(value, null, 2)}\n`)
}
