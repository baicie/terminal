/**
 * The stored-credential section of the host dialog.
 *
 * Two things decide whether the "forget the stored credential" control appears,
 * and they are not the same question:
 *
 * - a *readable* reference (`credentialRef.kinds` non-empty) — the ordinary case;
 * - a *damaged* one (`credentialRefProblem`) — the pointer exists but this build
 *   cannot follow it, so the mapper has nothing nameable to hand over and
 *   `credentialRef` is `null`. The secret is still in the provider.
 *
 * Gating on `kinds.length` alone hid exactly the hosts that most need the
 * control. Those hosts refuse to connect with "the stored credential could not be
 * read", and without this section the only way out was deleting the host — along
 * with its groups, tags and favourites. Clearing the damaged pointer *is* the
 * recovery path, which is why the state has to be reported at all.
 *
 * Split out of `host-dialog.tsx` for the size limit and because "should this
 * destructive control exist" is a rule worth reading in one place.
 */

import type { Host } from '@/types'
import { ClearCredentialAction } from './clear-credential-action'

interface HostStoredCredentialProps {
  host: Host | null | undefined
  onClear: () => Promise<void> | void
}

/**
 * Does this host have something stored, readable or not?
 *
 * `credentialRef: null` **without** a problem is "nothing stored" — agent auth,
 * or a host that expects a prompt at connect time. `credentialRef: null` **with**
 * a problem is a damaged pointer. Collapsing the two is the bug this encodes
 * against.
 */
export function storedCredentialState(host: Host | null | undefined): {
  hasReadable: boolean
  hasDamaged: boolean
  canClear: boolean
} {
  const hasReadable = (host?.credentialRef?.kinds.length ?? 0) > 0
  const hasDamaged = Boolean(host?.credentialRefProblem)
  return { hasReadable, hasDamaged, canClear: hasReadable || hasDamaged }
}

export function HostStoredCredential({ host, onClear }: HostStoredCredentialProps) {
  const { hasDamaged, canClear } = storedCredentialState(host)
  // "Clear" on a host that stores nothing would be a button that does nothing.
  if (!canClear) return null
  return <ClearCredentialAction onClear={onClear} damaged={hasDamaged} />
}
