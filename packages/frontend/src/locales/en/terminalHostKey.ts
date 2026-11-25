// SSH host-key trust and preflight copy.
//
// Split out of `app.ts` when that file reached its 300-line limit, the same way
// `terminalDiagnostic.ts` was. Keys are unchanged; only the module moved.
export default {
  'terminal.hostKeyChangedTitle': 'SSH host key changed',
  'terminal.hostKeyTrustTitle': 'Trust this SSH host?',
  'terminal.hostKeyChangedDescription':
    'The server identity no longer matches the saved host key. The connection has been blocked.',
  'terminal.hostKeyTrustDescription':
    'Verify this fingerprint with the server administrator before connecting.',
  'terminal.hostKeyJumpDescription':
    'This identity belongs to the jump host used to reach the target.',
  'terminal.hostKeyTargetDescription':
    'This identity belongs to the target reached through the verified jump host.',
  'terminal.hostKeyHost': 'Host',
  'terminal.hostKeyAlgorithm': 'Algorithm',
  'terminal.hostKeyFingerprint': 'Fingerprint',
  'terminal.hostKeyChangedWarning':
    'Do not continue until the saved key is reviewed outside this connection attempt.',
  'terminal.hostKeyTrustOnce': 'Trust once',
  'terminal.hostKeyTrustAndSave': 'Trust and save',
  'terminal.hostKeyCheckingAria': 'Checking SSH host key',
  'terminal.hostKeyChecking': 'Checking SSH host key...',
  'terminal.hostKeyVerifyFailed': 'Could not verify the SSH host key',
  'terminal.hostKeyFailed': 'Host key verification failed. Check known_hosts.',
  'terminal.hostKeyUnreachable': 'The server did not answer',
  'terminal.hostKeyHandshakeFailed': 'The server answered, but not with a usable SSH host key',
  'terminal.hostKeyJumpAuthenticationFailed': 'The jump host refused the credential',
  'terminal.hostKeyKnownHostsFailed': 'known_hosts could not be read or updated',
  'terminal.hostKeyDeadline': 'The connection deadline passed before the host key could be checked',
  'terminal.hostKeyInputRejected': 'The host or key values were rejected before connecting',  'terminal.hostKeyConfiguration': 'The host row is incomplete or points at a jump host that no longer exists',
}
