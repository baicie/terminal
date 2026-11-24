// SSH11 — what each connection diagnosis means for the machine the user must open.
//
// Its own module for the same reason `terminalStatus` has one: the sentence set is
// a feature, not a subset of `app`, and `app.ts` is at its line limit.
export default {
  'terminal.diagnostic.bastionAuthRejected':
    '跳板机拒绝了这个账号。目标主机还没有被连接过——请检查跳板机的账号或凭据。',
  'terminal.diagnostic.targetAuthRejected':
    '跳板连接成功，但目标主机拒绝了这个账号。请检查目标主机的账号或凭据。',
  'terminal.diagnostic.bastionUnreachable':
    '无法连接到跳板机，后续步骤都没有执行。',
  'terminal.diagnostic.targetHandshakeFailed':
    '跳板机连接正常，但隧道另一端的目标主机没有响应。',
  'terminal.diagnostic.tunnelFailed':
    '无法通过跳板机建立到目标主机的连接。可能是跳板机不允许转发，也可能是目标地址从跳板机不可达。',
  'terminal.diagnostic.bastionHostKeyRejected':
    '跳板机出示的主机密钥与已保存的不一致，连接已被阻止。',
  'terminal.diagnostic.targetHostKeyRejected':
    '目标主机出示的主机密钥与已保存的不一致。跳板连接本身是成功的。',
}
