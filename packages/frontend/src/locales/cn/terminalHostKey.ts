// SSH host-key trust and preflight copy.
//
// Split out of `app.ts` when that file reached its 300-line limit, the same way
// `terminalDiagnostic.ts` was. Keys are unchanged; only the module moved.
export default {
  'terminal.hostKeyChangedTitle': 'SSH 主机密钥已变更',
  'terminal.hostKeyTrustTitle': '是否信任此 SSH 主机？',
  'terminal.hostKeyChangedDescription':
    '服务器身份与已保存的主机密钥不再匹配，连接已被阻止。',
  'terminal.hostKeyTrustDescription':
    '连接前请通过服务器管理员或其他可信渠道核对该指纹。',
  'terminal.hostKeyJumpDescription': '这是用于访问目标主机的跳板机身份。',
  'terminal.hostKeyTargetDescription':
    '这是通过已验证跳板机访问到的目标主机身份。',
  'terminal.hostKeyHost': '主机',
  'terminal.hostKeyAlgorithm': '算法',
  'terminal.hostKeyFingerprint': '指纹',
  'terminal.hostKeyChangedWarning':
    '在通过本次连接以外的可信渠道核实已保存密钥前，请勿继续。',
  'terminal.hostKeyTrustOnce': '仅信任本次',
  'terminal.hostKeyTrustAndSave': '信任并保存',
  'terminal.hostKeyCheckingAria': '正在检查 SSH 主机密钥',
  'terminal.hostKeyChecking': '正在检查 SSH 主机密钥...',
  'terminal.hostKeyVerifyFailed': '无法验证 SSH 主机密钥',
  'terminal.hostKeyFailed': '主机密钥验证失败。请检查 known_hosts。',
  'terminal.hostKeyUnreachable': '服务器没有响应',
  'terminal.hostKeyHandshakeFailed': '服务器有响应，但没有返回可用的 SSH 主机密钥',
  'terminal.hostKeyJumpAuthenticationFailed': '跳板机拒绝了该凭据',
  'terminal.hostKeyKnownHostsFailed': '无法读取或写入 known_hosts',
  'terminal.hostKeyDeadline': '在检查主机密钥之前，连接时限已用尽',
  'terminal.hostKeyInputRejected': '主机或密钥取值在连接前即被拒绝',
}
