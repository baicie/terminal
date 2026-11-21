// The argument list must match the statement it is bound to.
//
// ## The defect this exists for
//
// `hostUpdateArgs` has three call shapes: no options (the plain update), options with
// the secret columns (a credential write), and `dropIdentityFilePathArgument` (the
// clear and switch-to-agent statements, whose SQL writes `identity_file_path = NULL`
// as a literal and so binds one value fewer).
//
// That third shape was **declared in the options type and never read**. The two call
// sites passed `{ dropIdentityFilePathArgument: true }`, the function ignored it and
// returned the full 23-argument list, and the statements it was bound to have 19
// placeholders.
//
// ## Why nothing caught it
//
// sqlx binds positionally up to the placeholder count and **ignores the rest**
// (`sqlx-sqlite` `arguments.rs`: `for param_i in 1..=cnt`). It does not error. So the
// statement ran with every value shifted by four from the seventh placeholder onward,
// `WHERE id = ?` received `agent_forwarding` (0 or 1), and the UPDATE matched no row —
// after which the caller deleted the credential from the vault anyway, because the
// retirement step does not check `rowsAffected`.
//
// Every existing test mocked `executeQuery` and asserted on the SQL *text*, or read an
// argument by a fixed offset. None compared the list length to the statement.
//
// ## What this file asserts
//
// The property that makes the class of bug impossible: for each statement the product
// actually runs, `hostUpdateArgs` must return exactly as many values as it has
// placeholders. The SQL is read from `hosts.ts` itself rather than restated here, so
// editing one without the other fails.

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Host } from '@/types'
import type { CredentialRef } from '@/service/credential-boundary'
import { hostUpdateArgs } from './host-update-args'

const HOSTS_SOURCE = path.resolve(import.meta.dirname, 'hosts.ts')

/**
 * The host UPDATE statements in `hosts.ts`, in source order.
 *
 * Three of them: the switch-to-agent clear, the explicit clear, and the ordinary
 * write. Matching on the literal text keeps this tied to the real statements instead
 * of a copy that could drift.
 */
function updateStatements(): string[] {
  const source = readFileSync(HOSTS_SOURCE, 'utf8')
  const statements: string[] = []
  const pattern = /`(UPDATE hosts SET[^`]+)`/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(source)) !== null) statements.push(match[1])
  return statements
}

/** Count `?` placeholders that are not inside a quoted string literal. */
function placeholders(sql: string): number {
  let count = 0
  let quote: string | null = null
  for (const character of sql) {
    if (quote !== null) {
      if (character === quote) quote = null
      continue
    }
    if (character === "'" || character === '"') {
      quote = character
      continue
    }
    if (character === '?') count += 1
  }
  return count
}

function host(overrides: Partial<Host> = {}): Host {
  return {
    id: 'h-1',
    name: 'prod',
    hostname: 'p.example',
    port: 22,
    username: 'root',
    authType: 'password',
    groupId: null,
    isFavorite: false,
    color: null,
    tags: [],
    portForwards: [],
    startupCommand: null,
    environment: {},
    jumpHostId: null,
    jumpHostAuthType: null,
    agentForwarding: false,
    shellIntegration: 'off',
    identityFilePath: null,
    ...overrides,
  } as Host
}

const NOW = 1_700_000_000_000
const REF: CredentialRef = { provider: 'vault', kinds: ['password'], version: 2 }

describe('the argument list matches the statement', () => {
  it('finds the statements it is checking', () => {
    // A regex that silently matched nothing would make every case below vacuous.
    const statements = updateStatements()
    expect(statements.length, 'hosts.ts must contain the host UPDATE statements').toBe(3)
    for (const statement of statements) {
      expect(placeholders(statement)).toBeGreaterThan(0)
    }
  })

  it('the clear statement and the switch-to-agent statement bind 19 values each', () => {
    const statements = updateStatements()
    /*
     * Both clear shapes write `identity_file_path = NULL` in their SQL text, so they
     * take one value fewer than the ordinary write. The exact number is asserted
     * against the SQL rather than hard-coded — this case exists to catch the two
     * clear statements drifting to a different placeholder count, not to pin 19.
     */
    const clearStatements = statements.filter(statement => /identity_file_path = NULL/.test(statement))
    expect(clearStatements.length, 'clear and switch-to-agent share this shape').toBe(2)
    for (const statement of clearStatements) {
      const args = hostUpdateArgs(host(), NOW, 'h-1', { dropIdentityFilePathArgument: true })
      expect(
        args.length,
        `${placeholders(statement)} placeholders but ${args.length} arguments — sqlx ` +
          'ignores the extras and every later value binds to the wrong column',
      ).toBe(placeholders(statement))
    }
  })

  it('the ordinary write binds as many values as its statement has placeholders', () => {
    const statements = updateStatements()
    const write = statements.find(statement => !/identity_file_path = NULL/.test(statement))
    expect(write, 'the ordinary UPDATE hosts statement must exist').toBeTruthy()
    const args = hostUpdateArgs(host(), NOW, 'h-1', {
      rewriteSecrets: true,
      newRef: REF,
      clearIdentityFilePath: true,
    })
    expect(args.length).toBe(placeholders(write!))
  })

  it('the no-options shape binds the clear statements', () => {
    /*
     * `!options` produces the same 19-value list as `dropIdentityFilePathArgument`,
     * because it is the clear shape. It has no call site today — every caller passes
     * options — but the two shapes must agree: if they diverged, whichever one a future
     * caller picked would silently bind the wrong columns.
     *
     * Asserted against the clear statements rather than the ordinary write, which is
     * what the first version of this case got wrong: it compared the 19-value list to
     * the 23-placeholder statement and reported a defect that did not exist.
     */
    const clearStatements = updateStatements().filter(statement =>
      /identity_file_path = NULL/.test(statement),
    )
    const args = hostUpdateArgs(host(), NOW, 'h-1')
    expect(args.length).toBe(placeholders(clearStatements[0]))
    expect(args).toEqual(hostUpdateArgs(host(), NOW, 'h-1', { dropIdentityFilePathArgument: true }))
  })

  it('the id is the last value, where the WHERE clause binds it', () => {
    /*
     * The shift above put `agent_forwarding` (0 or 1) where the id belonged. Asserting
     * the last value is the id is the cheapest way to say "the list ends where the
     * statement ends" without restating all 19 positions.
     */
    for (const options of [
      { dropIdentityFilePathArgument: true },
      { rewriteSecrets: true, newRef: REF },
      undefined,
    ]) {
      const args = hostUpdateArgs(host(), NOW, 'the-real-id', options)
      expect(args[args.length - 1]).toBe('the-real-id')
    }
  })
})
