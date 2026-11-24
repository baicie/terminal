// SSH11 — what each connection diagnosis means for the machine the user must open.
//
// Its own module for the same reason `terminalStatus` has one: the sentence set is
// a feature, not a subset of `app`, and `app.ts` is at its line limit.
export default {
  'terminal.diagnostic.bastionAuthRejected':
    'The bastion refused this login. The host behind it was never contacted — check the bastion account.',
  'terminal.diagnostic.targetAuthRejected':
    'The bastion accepted the connection, but the target host refused this login. Check the target account.',
  'terminal.diagnostic.bastionUnreachable':
    'The bastion could not be reached. Nothing was tried after it.',
  'terminal.diagnostic.targetHandshakeFailed':
    'The bastion worked, but the target host at the far end of the tunnel did not answer.',
  'terminal.diagnostic.tunnelFailed':
    'The tunnel from the bastion to the target could not be opened. The bastion may refuse forwarding, or the target address may be unreachable from it.',
  'terminal.diagnostic.bastionHostKeyRejected':
    'The bastion presented a host key that does not match the one saved for it. The connection was blocked.',
  'terminal.diagnostic.targetHostKeyRejected':
    'The target host presented a host key that does not match the one saved for it. The bastion connection itself succeeded.',
}
