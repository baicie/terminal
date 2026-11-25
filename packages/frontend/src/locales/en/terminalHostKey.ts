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
}
