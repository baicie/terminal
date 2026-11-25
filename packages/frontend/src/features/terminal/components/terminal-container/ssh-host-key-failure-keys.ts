import type { SshHostKeyGateFailure } from '@/features/terminal/hooks/ssh-host-key-gate-failure'

/**
 * One headline per failure step.
 *
 * Each says what the *user* has to look at, which is never the same thing twice:
 * a closed port is a service that is not running, a refused credential is an account,
 * a known_hosts failure is a file. The generic "could not verify the host key" is kept
 * for the two states a probe never produced, where there is no step to name.
 *
 * Exported as a table because these keys are selected by value at runtime, so the
 * repository's static `t('literal')` scan cannot see them. Nothing enumerated the table
 * against the locales when it was written — the six keys were missing from all three
 * languages and shipped as raw key names, caught only by a component test and by CI.
 * `ssh-host-key-failure-keys.test.ts` now does that enumeration.
 */
export const SSH_HOST_KEY_FAILURE_KEYS: Record<SshHostKeyGateFailure, string> = {
  unreachable: 'terminal.hostKeyUnreachable',
  handshake: 'terminal.hostKeyHandshakeFailed',
  'jump-authentication': 'terminal.hostKeyJumpAuthenticationFailed',
  'known-hosts': 'terminal.hostKeyKnownHostsFailed',
  deadline: 'terminal.hostKeyDeadline',
  input: 'terminal.hostKeyInputRejected',
}
