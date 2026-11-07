/**
 * Smoke-build-only Vault acceptance probe.
 *
 * It drives the same `VaultService` the UI uses, so every step goes through
 * `invoke` → Tauri command → VaultState → the encrypted file. It runs only in
 * instrumented smoke builds (`VITE_TERMINAL_SMOKE_BUILD=1` +
 * `VITE_TERMINAL_VAULT_PROBE=1`); a normal build drops the branch entirely.
 *
 * The passwords and secret below are one-time test fixtures. They are never
 * logged; the probe reports booleans only.
 */
import { toVaultCommandError, VaultService } from './vault'

const PASSWORD_1 = 'phase9.7-vault-one-time-password-1'
const PASSWORD_2 = 'phase9.7-vault-one-time-password-2'
const SECRET = 'phase9.7-vault-one-time-secret'

interface ProbeResult {
  phase: 'create' | 'verify'
  ok: boolean
  [key: string]: unknown
}

async function rejectedWithInvalidPassword(
  action: () => Promise<void>,
): Promise<boolean> {
  try {
    await action()
    return false
  } catch (error) {
    return toVaultCommandError(error).kind === 'invalid_password'
  }
}

async function createPhase(vault: VaultService): Promise<ProbeResult> {
  await vault.create(PASSWORD_1)
  await vault.set('probe:secret', SECRET)
  await vault.lock()
  const wrongRejected = await rejectedWithInvalidPassword(() =>
    vault.unlock('phase9.7-not-the-password'),
  )
  await vault.unlock(PASSWORD_1)
  const secretOk = (await vault.get('probe:secret')) === SECRET
  await vault.changePassword(PASSWORD_1, PASSWORD_2)
  await vault.lock()
  const oldRejected = await rejectedWithInvalidPassword(() =>
    vault.unlock(PASSWORD_1),
  )
  await vault.unlock(PASSWORD_2)
  const afterRotation = (await vault.get('probe:secret')) === SECRET
  await vault.lock()
  return {
    phase: 'create',
    ok: wrongRejected && secretOk && oldRejected && afterRotation,
    created: true,
    wrongRejected,
    secretOk,
    rotated: true,
    oldRejected,
    afterRotation,
  }
}

async function verifyPhase(vault: VaultService): Promise<ProbeResult> {
  const oldRejected = await rejectedWithInvalidPassword(() =>
    vault.unlock(PASSWORD_1),
  )
  await vault.unlock(PASSWORD_2)
  const secretOk = (await vault.get('probe:secret')) === SECRET
  const unlocked = await vault.isUnlocked()
  await vault.lock()
  return {
    phase: 'verify',
    ok: oldRejected && secretOk && unlocked,
    oldRejected,
    secretOk,
    unlocked,
  }
}

export async function runVaultProbe(): Promise<void> {
  const vault = new VaultService()
  try {
    const exists = await vault.exists()
    const result = exists ? await verifyPhase(vault) : await createPhase(vault)
    console.info('VAULT_PROBE ' + JSON.stringify(result))
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : String(error)
    // Never include a password or secret in the log line.
    console.info(
      'VAULT_PROBE ' +
        JSON.stringify({ phase: 'error', ok: false, error: detail }),
    )
  }
}
