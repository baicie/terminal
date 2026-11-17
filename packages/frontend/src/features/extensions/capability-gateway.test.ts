// The security boundary, tested adversarially.
//
// Every test here asks "can an extension get something it was not granted". The
// design (`06-ux3-extension-platform.md` §6) requires the gateway to check the
// extension, its capability, its activation generation and the session's visibility
// on *every* call. A gateway that checks three of four is a gateway that leaks.

import { describe, expect, it, vi } from 'vitest'
import { APPROVAL_TTL_MS } from './approval-book'
import {
  CapabilityGateway,
  GatewayError,
  createDisposable,
  type ExtensionGrant,
  type GatewayHost,
} from './capability-gateway'

function grant(overrides: Partial<ExtensionGrant> = {}): ExtensionGrant {
  return {
    extensionId: 'snippet-dock',
    capabilities: ['terminal.read-selected', 'commands.register'],
    generation: 1,
    enabled: true,
    failed: false,
    ...overrides,
  }
}

function host(overrides: Partial<GatewayHost> = {}): GatewayHost {
  return {
    visibleSessionId: () => 'ssh-1',
    selectedText: () => ({ text: 'ls -la', selectionId: 'sel-1', sessionId: 'ssh-1' }),
    ...overrides,
  }
}

function gateway(
  options: { grant?: ExtensionGrant | undefined, host?: GatewayHost, now?: () => number } = {},
) {
  const current = 'grant' in options ? options.grant : grant()
  return new CapabilityGateway(
    () => current,
    options.host ?? host(),
    options.now ?? (() => 1_000),
  )
}

describe('the gateway refuses without the right to ask', () => {
  it('refuses an unregistered extension', async () => {
    const subject = gateway({ grant: undefined })
    await expect(subject.readSelectedText('snippet-dock', 1)).rejects.toMatchObject({
      denial: 'extension-unknown',
    })
  })

  it("refuses another extension's id", async () => {
    // A registered extension must not be able to borrow someone else's grant by
    // naming their id, nor their own grant by naming a different id.
    const subject = gateway()
    await expect(subject.readSelectedText('server-inspector', 1)).rejects.toMatchObject({
      denial: 'extension-unknown',
    })
  })

  it('refuses a disabled extension', async () => {
    const subject = gateway({ grant: grant({ enabled: false }) })
    await expect(subject.readSelectedText('snippet-dock', 1)).rejects.toMatchObject({
      denial: 'extension-disabled',
    })
  })

  it('refuses a failed extension', async () => {
    const subject = gateway({ grant: grant({ failed: true }) })
    await expect(subject.readSelectedText('snippet-dock', 1)).rejects.toMatchObject({
      denial: 'extension-failed',
    })
  })

  it('refuses a capability the manifest did not declare', async () => {
    // The check that makes the manifest meaningful. An extension that declared only
    // `commands.register` cannot read terminal text however it asks.
    const subject = gateway({ grant: grant({ capabilities: ['commands.register'] }) })
    await expect(subject.readSelectedText('snippet-dock', 1)).rejects.toMatchObject({
      denial: 'capability-not-declared',
    })
  })

  it('refuses a callback from a previous activation', async () => {
    // The late-callback case: the extension was deactivated (generation 2 now) and
    // this handler was captured under generation 1. Acting on it would write into a
    // context that no longer exists.
    const subject = gateway({ grant: grant({ generation: 2 }) })
    await expect(subject.readSelectedText('snippet-dock', 1)).rejects.toMatchObject({
      denial: 'stale-generation',
    })
  })

  it('names the denial structurally, never as a bare Error', async () => {
    const subject = gateway({ grant: undefined })
    await expect(subject.readSelectedText('snippet-dock', 1)).rejects.toBeInstanceOf(GatewayError)
  })
})

describe('reading selected text', () => {
  it('returns what the user selected', async () => {
    const subject = gateway()
    await expect(subject.readSelectedText('snippet-dock', 1)).resolves.toEqual({
      text: 'ls -la',
      selectionId: 'sel-1',
      sessionId: 'ssh-1',
    })
  })

  it('returns null when nothing is selected', async () => {
    const subject = gateway({ host: host({ selectedText: () => null }) })
    await expect(subject.readSelectedText('snippet-dock', 1)).resolves.toBeNull()
  })

  it('refuses a selection from a session the user has left', async () => {
    // "Currently selected" is the requirement, not "was selected once". A stale
    // selection object must not become a way to read a background session.
    const subject = gateway({
      host: host({
        visibleSessionId: () => 'ssh-2',
        selectedText: () => ({ text: 'secret', selectionId: 'sel-1', sessionId: 'ssh-1' }),
      }),
    })
    await expect(subject.readSelectedText('snippet-dock', 1)).rejects.toMatchObject({
      denial: 'session-not-visible',
    })
  })

  it('refuses when no session is visible at all', async () => {
    const subject = gateway({
      host: host({ visibleSessionId: () => null }),
    })
    await expect(subject.readSelectedText('snippet-dock', 1)).rejects.toMatchObject({
      denial: 'session-not-visible',
    })
  })
})

describe('sending text needs a one-shot, expiring, user-bound approval', () => {
  it('mints a token rather than writing anything', async () => {
    // The only path from extension output to a shell. It produces a token; the host
    // performs the write after the *user* confirms. Nothing here touches a terminal.
    const subject = gateway()
    const result = await subject.requestSendText('snippet-dock', 1, {
      sessionId: 'ssh-1',
      text: 'ls -la',
    })
    expect(result).toEqual({ approved: true, token: expect.stringMatching(/^approval-/) })
  })

  it('refuses for a session the user cannot see', async () => {
    const subject = gateway()
    const result = await subject.requestSendText('snippet-dock', 1, {
      sessionId: 'ssh-other',
      text: 'rm -rf /',
    })
    expect(result).toEqual({ approved: false, reason: 'unknown-session' })
  })

  it('refuses when the user has selected nothing', async () => {
    // An approval has to name a user gesture. Otherwise "approve this draft"
    // silently becomes "execute anything the extension composed".
    const subject = gateway({ host: host({ selectedText: () => null }) })
    const result = await subject.requestSendText('snippet-dock', 1, {
      sessionId: 'ssh-1',
      text: 'ls -la',
    })
    expect(result).toEqual({ approved: false, reason: 'no-selection' })
  })

  it('consumes an approval exactly once', async () => {
    // A replayable approval is a permission that outlives the gesture granting it.
    const subject = gateway()
    const result = await subject.requestSendText('snippet-dock', 1, {
      sessionId: 'ssh-1',
      text: 'ls -la',
    })
    expect(result.approved).toBe(true)
    const token = result.approved ? result.token : ''

    expect(subject.consumeApproval(token, 'snippet-dock', 1, 'ls -la')).toEqual({
      sessionId: 'ssh-1',
    })
    expect(() => subject.consumeApproval(token, 'snippet-dock', 1, 'ls -la')).toThrow(
      /does not exist|already used/,
    )
  })

  it('refuses text that differs from what was approved', async () => {
    // The substitution case: approve "ls" then send "rm -rf /". The hash binds the
    // token to the exact bytes.
    const subject = gateway()
    const result = await subject.requestSendText('snippet-dock', 1, {
      sessionId: 'ssh-1',
      text: 'ls -la',
    })
    const token = result.approved ? result.token : ''
    expect(() => subject.consumeApproval(token, 'snippet-dock', 1, 'rm -rf /')).toThrow()
  })

  it('refuses redemption by a different extension', async () => {
    const subject = gateway()
    const result = await subject.requestSendText('snippet-dock', 1, {
      sessionId: 'ssh-1',
      text: 'ls -la',
    })
    const token = result.approved ? result.token : ''
    expect(() => subject.consumeApproval(token, 'server-inspector', 1, 'ls')).toThrow()
  })

  it('refuses redemption under a different activation', async () => {
    const subject = gateway()
    const result = await subject.requestSendText('snippet-dock', 1, {
      sessionId: 'ssh-1',
      text: 'ls -la',
    })
    const token = result.approved ? result.token : ''
    expect(() => subject.consumeApproval(token, 'snippet-dock', 2, 'ls')).toThrow()
  })

  it('expires an approval at its deadline', async () => {
    let now = 1_000
    const subject = gateway({ now: () => now })
    const result = await subject.requestSendText('snippet-dock', 1, {
      sessionId: 'ssh-1',
      text: 'ls -la',
    })
    const token = result.approved ? result.token : ''

    now += APPROVAL_TTL_MS
    expect(() => subject.consumeApproval(token, 'snippet-dock', 1, 'ls')).toThrow(
      /expired/i,
    )
  })

  it('does not expire one millisecond early', async () => {
    let now = 1_000
    const subject = gateway({ now: () => now })
    const result = await subject.requestSendText('snippet-dock', 1, {
      sessionId: 'ssh-1',
      text: 'ls -la',
    })
    const token = result.approved ? result.token : ''

    now += APPROVAL_TTL_MS - 1
    expect(subject.consumeApproval(token, 'snippet-dock', 1, 'ls -la')).toEqual({
      sessionId: 'ssh-1',
    })
  })

  it('drops outstanding approvals for a deactivated extension', async () => {
    // After deactivate, a token minted before it must not still be redeemable.
    const subject = gateway()
    await subject.requestSendText('snippet-dock', 1, { sessionId: 'ssh-1', text: 'ls -la' })
    expect(subject.approvalCount()).toBe(1)
    subject.clearApprovalsFor('snippet-dock')
    expect(subject.approvalCount()).toBe(0)
  })

  it('leaves other extensions approvals alone when clearing', async () => {
    const grants = new Map<string, ExtensionGrant>()
    const subject = new CapabilityGateway(
      () => grants.get('snippet-dock'),
      host(),
      () => 1_000,
    )
    grants.set('snippet-dock', grant())
    await subject.requestSendText('snippet-dock', 1, { sessionId: 'ssh-1', text: 'ls -la' })
    subject.clearApprovalsFor('someone-else')
    expect(subject.approvalCount()).toBe(1)
  })
})

describe('the bound terminal context', () => {
  it('captures the generation at creation, so a late call is refused', async () => {
    // A context handed to an extension before deactivate must fail *every* call
    // after it, not silently use the new generation.
    let current = grant({ generation: 1 })
    const subject = new CapabilityGateway(() => current, host(), () => 1_000)
    const context = subject.terminalContextFor('snippet-dock', 1)

    await expect(context.readSelectedText()).resolves.toBeTruthy()

    current = grant({ generation: 2 })
    await expect(context.readSelectedText()).rejects.toMatchObject({
      denial: 'stale-generation',
    })
  })
})

describe('disposables', () => {
  it('runs cleanup exactly once', () => {
    // Double-dispose is normal: unmount plus explicit teardown. Running cleanup
    // twice would remove someone else's registration the second time.
    const cleanup = vi.fn()
    const disposable = createDisposable(cleanup)
    disposable.dispose()
    disposable.dispose()
    expect(cleanup).toHaveBeenCalledTimes(1)
  })

  it('passes an async cleanup through', async () => {
    const cleanup = vi.fn(async () => undefined)
    await createDisposable(cleanup).dispose()
    expect(cleanup).toHaveBeenCalledTimes(1)
  })
})
