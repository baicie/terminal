// SSH10 — 连接上下文（hop/stage）必须到达终端错误状态，且**不改变**重试语义。
//
// ## 这条不变量的形状
//
// 用户配了跳板，连接失败。他要看到的是「跳板机的账号被拒」还是「跳板通了、目标的
// 账号被拒」——那是两台机器上的两个账号。
//
// 但「哪一台」不能影响「还要不要重试」。一次认证拒绝在两个 hop 上的含义完全相同：
// 服务器说了不，重试不会再问一次。如果 hop 参与了重试判定，就会出现「跳板拒绝不重试、
// 目标拒绝重试五次」这种荒谬的不对称。
//
// 所以这个文件的核心是一条**交叉矩阵**：同一个 kind 在 direct/bastion/target/unknown
// 四种情况下，`retryable` 与 `recovery` 必须逐字相同。

import { describe, expect, it } from 'vitest'
import { classifyTerminalFailure } from './terminal-session-manager-errors'
import { updateTerminalState } from './terminal-session-state'
import { getTerminalSnapshot } from './terminal-session-manager-types'

/**
 * A real record, built the way the manager builds one.
 *
 * The first version passed a hand-rolled object literal and failed with
 * `Cannot read properties of undefined (reading 'acknowledgeOutput')` — the real record
 * constructs `TerminalSessionAudience` and `TerminalSessionIo` from callbacks, so a fake
 * is not a stand-in for it. Using the constructor keeps these cases honest about what the
 * product actually builds.
 */
async function makeRecord() {
  const { createTerminalRecord } = await import('./terminal-session-record')
  const record = createTerminalRecord(
    { tabId: 'tab-1', tabType: 'ssh', cols: 80, rows: 24 } as never,
    'tab-1',
    { acknowledgeOutput: () => {}, handleIoError: () => {} },
  )
  return { record }
}

/** An IPC error as Rust now sends it. */
const ipc = (kind: string, extra: Record<string, unknown> = {}) => ({
  type: kind,
  message: `${kind} happened`,
  ...extra,
})

const KINDS = [
  'authentication_rejected',
  'authentication_transport_failed',
  'host_key_rejected',
  'connection_failed',
  'channel_error',
  'connection_cancelled',
]

describe('SSH10 — hop never changes the retry decision', () => {
  it('every kind classifies identically across all four hop situations', () => {
    /*
     * The cross product. `direct` sends no hop; `unknown` sends a value this build does
     * not recognise, which must degrade exactly like `direct` rather than falling into a
     * default branch that assumes "target".
     */
    const situations: Array<Record<string, unknown>> = [
      {},
      { hop: 'bastion' },
      { hop: 'target' },
      { hop: 'some-future-hop' },
    ]

    for (const kind of KINDS) {
      const baseline = classifyTerminalFailure(ipc(kind, situations[0]))
      for (const extra of situations.slice(1)) {
        const failure = classifyTerminalFailure(ipc(kind, extra))
        expect(
          { retryable: failure.retryable, recovery: failure.recovery },
          `${kind} with ${JSON.stringify(extra)} must retry like a direct failure`,
        ).toEqual({ retryable: baseline.retryable, recovery: baseline.recovery })
      }
    }
  })

  it('an authentication rejection is terminal at both hops', () => {
    // Not a tautology: this is the case the product depends on, stated at the level the
    // user experiences rather than inside the classifier.
    const bastion = classifyTerminalFailure(ipc('authentication_rejected', { hop: 'bastion' }))
    const target = classifyTerminalFailure(ipc('authentication_rejected', { hop: 'target' }))

    expect(bastion.retryable).toBe(false)
    expect(target.retryable).toBe(false)
    expect(bastion.recovery).toBe(target.recovery)
  })
})

describe('SSH10 — the context reaches the terminal failure', () => {
  it('a bastion failure reports hop and stage', () => {
    const failure = classifyTerminalFailure(
      ipc('authentication_rejected', { hop: 'bastion', stage: 'authentication' }),
    )
    expect(failure.hop).toBe('bastion')
    expect(failure.stage).toBe('authentication')
    // The original kind survives in the message; the fields are additive.
    expect(failure.error).toMatch(/authentication_rejected/)
  })

  it('a target failure reports the target, not the bastion', () => {
    const failure = classifyTerminalFailure(
      ipc('host_key_rejected', { hop: 'target', stage: 'handshake' }),
    )
    expect(failure.hop).toBe('target')
    expect(failure.stage).toBe('handshake')
  })

  it('a direct failure has no hop and does not invent one', () => {
    const failure = classifyTerminalFailure(ipc('connection_failed'))
    expect(failure.hop).toBeUndefined()
    expect(failure.stage).toBeUndefined()
  })

  it('an unrecognised hop or stage degrades to absent, not to a default case', () => {
    /*
     * The failure mode this prevents: a newer Rust build adds `hop: "jump"`, this build
     * does not know the word, and a consumer's switch statement falls into a default
     * branch that treats everything unknown as "target". Unknown must read as
     * "not recorded".
     */
    const failure = classifyTerminalFailure(
      ipc('connection_failed', { hop: 'relay', stage: 'kex' }),
    )
    expect(failure.hop).toBeUndefined()
    expect(failure.stage).toBeUndefined()
  })

  it('a stage without a hop is kept — that is the direct-connection shape', () => {
    // Rust records the stage for direct connections too: they perform the same steps,
    // they just have no hop to name.
    const failure = classifyTerminalFailure(
      ipc('authentication_rejected', { stage: 'authentication' }),
    )
    expect(failure.hop).toBeUndefined()
    expect(failure.stage).toBe('authentication')
  })

  it('a legacy error object without the new fields still classifies', () => {
    // Old IPC payloads (and every existing test fixture) must keep working.
    const failure = classifyTerminalFailure({ type: 'connection_failed', message: 'boom' })
    expect(failure.retryable).toBeDefined()
    expect(failure.hop).toBeUndefined()
  })

  it('a malformed hop does not crash the classifier', () => {
    for (const bad of [42, null, {}, [], true]) {
      expect(() =>
        classifyTerminalFailure(ipc('connection_failed', { hop: bad, stage: bad })),
      ).not.toThrow()
    }
  })
})

describe('SSH10 — the record does not inherit a stale hop', () => {
  it('a direct failure after a bastion failure clears the hop', async () => {
    /*
     * The failure mode this prevents: the pane renders "check the bastion's account" for a
     * connection that has no bastion, because `updateTerminalState` kept the previous
     * failure's hop when the new one had none.
     *
     * The same rule already existed for `credentialKind` (a vault error followed by a
     * network drop must stop offering "Unlock the vault"); hop and stage are the same
     * shape of stale diagnosis.
     */
    const { record } = await makeRecord()

    updateTerminalState(record, {
      status: 'error',
      error: 'bastion refused',
      retryable: false,
      recovery: 'manual',
      hop: 'bastion',
      stage: 'authentication',
    })
    expect(getTerminalSnapshot(record)).toMatchObject({
      hop: 'bastion',
      stage: 'authentication',
    })

    updateTerminalState(record, {
      status: 'error',
      error: 'network dropped',
      retryable: true,
      recovery: 'automatic',
    })

    const snapshot = getTerminalSnapshot(record)
    expect(snapshot.hop, 'a direct failure must not inherit a bastion hop').toBeUndefined()
    expect(snapshot.stage).toBeUndefined()
  })

  it('a successful connection clears the context', async () => {
    const { record } = await makeRecord()
    updateTerminalState(record, {
      status: 'error',
      error: 'bastion refused',
      retryable: false,
      recovery: 'manual',
      hop: 'bastion',
    })
    updateTerminalState(record, { status: 'connected', sessionId: 's-1' })

    const snapshot = getTerminalSnapshot(record)
    expect(snapshot.hop).toBeUndefined()
    expect(snapshot.stage).toBeUndefined()
  })

  it('a failure with no diagnosis clears the previous one', async () => {
    /*
     * SSH11. The same stale-claim problem as `hop`, one level up: the diagnosis is the
     * sentence the pane renders, so inheriting "the bastion refused this login" onto a
     * direct-connection failure sends the user to a machine that is not involved.
     *
     * Found by mutation: deleting the clear in `updateTerminalState` left every test
     * green, because nothing asserted the second render.
     */
    const { record } = await makeRecord()

    updateTerminalState(record, {
      status: 'error',
      error: 'bastion refused',
      retryable: false,
      recovery: 'manual',
      hop: 'bastion',
      diagnosis: 'bastion-auth-rejected',
    })
    expect(getTerminalSnapshot(record).diagnosis).toBe('bastion-auth-rejected')

    updateTerminalState(record, {
      status: 'error',
      error: 'network dropped',
      retryable: true,
      recovery: 'automatic',
    })

    expect(
      getTerminalSnapshot(record).diagnosis,
      'a failure with no diagnosis must not inherit the previous one',
    ).toBeUndefined()
  })

  it('a successful connection clears the diagnosis', async () => {
    const { record } = await makeRecord()
    updateTerminalState(record, {
      status: 'error',
      error: 'tunnel died',
      retryable: false,
      recovery: 'manual',
      diagnosis: 'tunnel-failed',
    })
    updateTerminalState(record, { status: 'connected', sessionId: 's-1' })
    expect(getTerminalSnapshot(record).diagnosis).toBeUndefined()
  })
})
