/**
 * What to tell the user when the vault cannot take a secret.
 *
 * Both the host save path and the ssh-key save path fail here, and they must say
 * the same thing. The reason it needs its own module: these sentences name the
 * next step, and "unlock the vault" is the wrong next step on a fresh install
 * where no vault exists yet — that is the defect this replaces.
 *
 * Never contains secret material; every branch names an action.
 */

import type { VaultAvailability } from './vault-secret-provider'

type UnavailableState = Extract<VaultAvailability, { ok: false }>['state']

export function vaultUnavailableMessage(state: UnavailableState): string {
  switch (state) {
    case 'uninitialized':
      return 'This has a password or private key, but no vault has been set up yet. Create a vault on the Vaults page to store it, or connect with an SSH agent or a password typed at connect time instead.'
    case 'locked':
      return 'This has a password or private key, but the vault is locked. Unlock the vault to save it, or connect with an SSH agent or a password typed at connect time instead.'
    case 'unusable':
      return 'This has a password or private key, but the vault could not be read. Check the Vaults page, or connect with an SSH agent or a password typed at connect time instead.'
  }
}
