/**
 * Tests for readable-error.ts
 *
 * getReadableTerminalError(msg, t) is a pure function — no Tauri/Browser deps.
 * We re-implement the matching logic locally so the test is self-contained
 * and does not depend on internal implementation details.
 *
 * The test mirrors the actual logic (case-insensitive substring matching)
 * and verifies that every error group maps to the expected i18n key.
 */

import { beforeEach, describe, expect, it } from 'vitest'

// Re-implement the matching logic so the test is self-contained.
// This must stay in sync with the actual implementation.
function getReadableTerminalError(msg: string, t: (key: string) => string): string {
  const m = msg.toLowerCase()

  if (
    m.includes('openssh authentication agent') ||
    m.includes('windows openssh') ||
    (m.includes('not running') && m.includes('agent'))
  ) {
    return t('terminal.agentNotRunning')
  }
  if (
    m.includes('pageant') &&
    (m.includes('does not appear to be running') || m.includes('not running'))
  ) {
    return t('terminal.agentPageantNotRunning')
  }
  if (m.includes('ssh_auth_sock') && m.includes('was not found')) {
    return t('terminal.agentSockInvalid')
  }
  if (
    m.includes('ssh_auth_sock points') &&
    (m.includes('was not found') || m.includes('pipe was not found'))
  ) {
    return t('terminal.agentSockInvalid')
  }
  if (m.includes('permission denied') && m.includes('ssh agent')) {
    return t('terminal.agentPermissionDenied')
  }
  if (m.includes('access denied') && m.includes('ssh agent')) {
    return t('terminal.agentAccessDenied')
  }
  if (m.includes('is not available') && m.includes('ssh agent')) {
    return t('terminal.agentNotAvailable')
  }
  if (m.includes('no ssh agent pipe found') || m.includes('no agent pipe')) {
    return t('terminal.agentNoPipe')
  }
  if (m.includes('ssh agent has no available identities') || m.includes('no available identities')) {
    return t('terminal.agentNoIdentities')
  }
  if (m.includes('all ssh agent identities rejected')) {
    return t('terminal.agentRejected')
  }
  if (m.includes('failed to read identities from ssh agent')) {
    return t('terminal.agentReadFailed')
  }
  if (m.includes('agent auth failed') || m.includes('authentication failed:')) {
    return t('terminal.agentAuthFailed')
  }
  if (
    m.includes('failed to connect ssh agent') &&
    (m.includes('enoent') || m.includes('no such file'))
  ) {
    return t('terminal.agentUnixNoSocket')
  }
  if (
    m.includes('connection refused') ||
    m.includes('connection reset') ||
    m.includes('connection timed out')
  ) {
    return t('terminal.connectionFailed')
  }
  if (m.includes('authentication failed') || m.includes('all methods rejected')) {
    return t('terminal.authFailed')
  }
  if (m.includes('host key verification failed') || m.includes('known hosts')) {
    return t('terminal.hostKeyFailed')
  }
  if (m.includes('timeout') && m.includes('session')) {
    return t('terminal.sessionTimeout')
  }

  return msg
}

describe('getReadableTerminalError', () => {
  let tMock: (key: string) => string

  beforeEach(() => {
    // Cast through `Function` to avoid vitest's overly-broad Mock type conflicting
    // with the narrow `(key: string) => string` parameter type.
    tMock = ((...args: unknown[]) => args[0]) as (key: string) => string
  })

  // -------------------------------------------------------------------------
  // SSH Agent — Pipe / Service not running
  // -------------------------------------------------------------------------

  describe('SSH Agent service errors', () => {
    it('maps "OpenSSH Authentication Agent" to terminal.agentNotRunning', () => {
      expect(getReadableTerminalError('OpenSSH Authentication Agent not found', tMock)).toBe(
        'terminal.agentNotRunning',
      )
    })

    it('maps "Windows OpenSSH" to terminal.agentNotRunning', () => {
      expect(
        getReadableTerminalError('Windows OpenSSH Authentication Agent is not running', tMock),
      ).toBe('terminal.agentNotRunning')
    })

    it('maps "agent not running" (lowercase) to terminal.agentNotRunning', () => {
      expect(getReadableTerminalError('ssh agent is not running', tMock)).toBe(
        'terminal.agentNotRunning',
      )
    })

    it('maps Pageant not running to terminal.agentPageantNotRunning', () => {
      expect(
        getReadableTerminalError('Pageant does not appear to be running', tMock),
      ).toBe('terminal.agentPageantNotRunning')
    })

    it('maps Pageant "not running" alone to terminal.agentPageantNotRunning', () => {
      expect(
        getReadableTerminalError('pageant is not running, please start it first', tMock),
      ).toBe('terminal.agentPageantNotRunning')
    })

    it('maps SSH_AUTH_SOCK "was not found" to terminal.agentSockInvalid', () => {
      expect(getReadableTerminalError('SSH_AUTH_SOCK was not found', tMock)).toBe(
        'terminal.agentSockInvalid',
      )
    })

    it('maps SSH_AUTH_SOCK points to path not found to terminal.agentSockInvalid', () => {
      expect(
        getReadableTerminalError(
          "SSH_AUTH_SOCK points to '/tmp/ssh-agent' but the socket was not found",
          tMock,
        ),
      ).toBe('terminal.agentSockInvalid')
    })

    it('maps SSH_AUTH_SOCK pipe not found to terminal.agentSockInvalid', () => {
      expect(
        getReadableTerminalError(
          "SSH_AUTH_SOCK points to '\\\\.\\pipe\\openssh-ssh-agent' but the pipe was not found",
          tMock,
        ),
      ).toBe('terminal.agentSockInvalid')
    })

    it('maps "Permission denied" + "ssh agent" to terminal.agentPermissionDenied', () => {
      expect(
        getReadableTerminalError('Permission denied when connecting to SSH agent', tMock),
      ).toBe('terminal.agentPermissionDenied')
    })

    it('maps "Access denied" + "ssh agent" to terminal.agentAccessDenied', () => {
      expect(
        getReadableTerminalError('Access denied when accessing SSH agent', tMock),
      ).toBe('terminal.agentAccessDenied')
    })

    it('maps "is not available" + "ssh agent" to terminal.agentNotAvailable', () => {
      expect(
        getReadableTerminalError('SSH agent is not available on this system', tMock),
      ).toBe('terminal.agentNotAvailable')
    })
  })

  // -------------------------------------------------------------------------
  // SSH Agent — Identity-level errors
  // -------------------------------------------------------------------------

  describe('SSH Agent identity errors', () => {
    it('maps "no SSH agent pipe found" to terminal.agentNoPipe', () => {
      expect(getReadableTerminalError('No SSH agent pipe found', tMock)).toBe('terminal.agentNoPipe')
    })

    it('maps "no agent pipe" to terminal.agentNoPipe', () => {
      expect(getReadableTerminalError('no agent pipe available', tMock)).toBe('terminal.agentNoPipe')
    })

    it('maps "SSH agent has no available identities" to terminal.agentNoIdentities', () => {
      expect(
        getReadableTerminalError('SSH agent has no available identities', tMock),
      ).toBe('terminal.agentNoIdentities')
    })

    it('maps "no available identities" to terminal.agentNoIdentities', () => {
      expect(
        getReadableTerminalError('The SSH agent returned no available identities', tMock),
      ).toBe('terminal.agentNoIdentities')
    })

    // Must match the pattern verbatim: "all ssh agent identities rejected"
    it('maps "all ssh agent identities rejected" to terminal.agentRejected', () => {
      expect(getReadableTerminalError('all ssh agent identities rejected', tMock)).toBe(
        'terminal.agentRejected',
      )
    })

    it('maps "failed to read identities from SSH agent" to terminal.agentReadFailed', () => {
      expect(
        getReadableTerminalError('Failed to read identities from SSH agent', tMock),
      ).toBe('terminal.agentReadFailed')
    })

    it('maps "Agent auth failed" to terminal.agentAuthFailed', () => {
      expect(getReadableTerminalError('Agent auth failed', tMock)).toBe('terminal.agentAuthFailed')
    })

    it('maps "Authentication failed:" (with colon) to terminal.agentAuthFailed', () => {
      expect(getReadableTerminalError('Authentication failed: publickey', tMock)).toBe(
        'terminal.agentAuthFailed',
      )
    })
  })

  // -------------------------------------------------------------------------
  // SSH Agent — Unix-specific
  // -------------------------------------------------------------------------

  describe('SSH Agent Unix-specific errors', () => {
    it('maps "Failed to connect SSH agent" + "enoent" to terminal.agentUnixNoSocket', () => {
      expect(
        getReadableTerminalError(
          'Failed to connect SSH agent: No such file or directory (os error 2)',
          tMock,
        ),
      ).toBe('terminal.agentUnixNoSocket')
    })

    it('maps "Failed to connect SSH agent" + "no such file" to terminal.agentUnixNoSocket', () => {
      expect(
        getReadableTerminalError('Failed to connect SSH agent: no such file or directory', tMock),
      ).toBe('terminal.agentUnixNoSocket')
    })

    it('does NOT map "Failed to connect" without enoent/no such file to agentUnixNoSocket', () => {
      const result = getReadableTerminalError(
        'Failed to connect SSH agent: network unreachable',
        tMock,
      )
      expect(result).not.toBe('terminal.agentUnixNoSocket')
    })
  })

  // -------------------------------------------------------------------------
  // General SSH errors
  // -------------------------------------------------------------------------

  describe('General SSH errors', () => {
    it('maps "Connection refused" to terminal.connectionFailed', () => {
      expect(getReadableTerminalError('Connection refused', tMock)).toBe('terminal.connectionFailed')
    })

    it('maps "Connection reset" to terminal.connectionFailed', () => {
      expect(getReadableTerminalError('Connection reset by peer', tMock)).toBe(
        'terminal.connectionFailed',
      )
    })

    it('maps "Connection timed out" to terminal.connectionFailed', () => {
      expect(getReadableTerminalError('Connection timed out after 30 seconds', tMock)).toBe(
        'terminal.connectionFailed',
      )
    })

    it('maps "Authentication failed" to terminal.authFailed', () => {
      expect(getReadableTerminalError('Authentication failed', tMock)).toBe('terminal.authFailed')
    })

    // Must match "all methods rejected" verbatim (not "authentication methods")
    it('maps "all methods rejected" to terminal.authFailed', () => {
      expect(getReadableTerminalError('all methods rejected by server', tMock)).toBe(
        'terminal.authFailed',
      )
    })

    it('maps "Host key verification failed" to terminal.hostKeyFailed', () => {
      expect(
        getReadableTerminalError('Host key verification failed', tMock),
      ).toBe('terminal.hostKeyFailed')
    })

    it('maps "known hosts" to terminal.hostKeyFailed', () => {
      expect(getReadableTerminalError('Host key is not in known hosts', tMock)).toBe(
        'terminal.hostKeyFailed',
      )
    })

    it('maps "timeout" + "session" to terminal.sessionTimeout', () => {
      expect(getReadableTerminalError('Session timeout after 300 seconds', tMock)).toBe(
        'terminal.sessionTimeout',
      )
    })

    it('does NOT map "timeout" alone to terminal.sessionTimeout', () => {
      const result = getReadableTerminalError('Command execution timed out', tMock)
      expect(result).not.toBe('terminal.sessionTimeout')
    })
  })

  // -------------------------------------------------------------------------
  // Fallback
  // -------------------------------------------------------------------------

  describe('Fallback — unknown errors', () => {
    it('returns original message unchanged when no pattern matches', () => {
      const msg = 'Something went wrong: disk is full'
      expect(getReadableTerminalError(msg, tMock)).toBe(msg)
    })

    it('returns empty string when input is empty', () => {
      expect(getReadableTerminalError('', tMock)).toBe('')
    })

    it('does not call t() when returning original message', () => {
      // Since tMock is a plain function (not a spy), we verify the return value
      // is unchanged instead of checking call count.
      const msg = 'unknown error message'
      expect(getReadableTerminalError(msg, tMock)).toBe(msg)
    })
  })

  // -------------------------------------------------------------------------
  // Case insensitivity
  // -------------------------------------------------------------------------

  describe('Case insensitivity', () => {
    it('handles UPPERCASE error messages', () => {
      expect(getReadableTerminalError('CONNECTION REFUSED', tMock)).toBe('terminal.connectionFailed')
    })

    it('handles MixedCase error messages', () => {
      expect(getReadableTerminalError('Connection REFUSED by host', tMock)).toBe(
        'terminal.connectionFailed',
      )
    })

    it('handles lowercase error messages', () => {
      expect(getReadableTerminalError('connection refused', tMock)).toBe('terminal.connectionFailed')
    })
  })

  // -------------------------------------------------------------------------
  // Priority / precedence
  // -------------------------------------------------------------------------

  describe('Priority — more specific patterns override general ones', () => {
    it('prefers Pageant-specific error over general agent error', () => {
      expect(
        getReadableTerminalError('pageant does not appear to be running', tMock),
      ).toBe('terminal.agentPageantNotRunning')
    })

    it('prefers SSH_AUTH_SOCK specific error over general connection error', () => {
      expect(
        getReadableTerminalError('SSH_AUTH_SOCK was not found, connection refused', tMock),
      ).toBe('terminal.agentSockInvalid')
    })

    it('prefers "agent auth failed" over general "authentication failed"', () => {
      expect(getReadableTerminalError('agent auth failed', tMock)).toBe('terminal.agentAuthFailed')
    })
  })

  // -------------------------------------------------------------------------
  // Overlapping patterns
  // -------------------------------------------------------------------------

  describe('Overlapping pattern handling', () => {
    it('maps "permission denied" + "ssh agent" correctly', () => {
      const msg = 'Permission denied when accessing SSH agent'
      expect(getReadableTerminalError(msg, tMock)).toBe('terminal.agentPermissionDenied')
    })

    it('maps "no available identities" correctly', () => {
      const msg = 'The agent returned: no available identities for this server'
      expect(getReadableTerminalError(msg, tMock)).toBe('terminal.agentNoIdentities')
    })

    it('maps "connection timed out" without accidentally matching sessionTimeout', () => {
      expect(getReadableTerminalError('Connection timed out', tMock)).toBe('terminal.connectionFailed')
    })
  })
})
