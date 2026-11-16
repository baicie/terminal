/**
 * The connect action with the one-time-credential branch, in one hook.
 *
 * Split out of `use-hosts-view-handlers.ts` for the size limit, and because this is
 * the one place that decides what "connect" means for a host with nothing stored:
 *
 * - a stored, readable credential → connect immediately (the ordinary path);
 * - a damaged reference, or an imported key that was never bound → refuse with the
 *   one action that fixes it, rather than a form that would always fail;
 * - nothing stored → ask for a secret, keep it on a process-local profile, connect.
 *
 * The secret never touches the store, the tab or the database. See
 * `one-time-credential.ts` for why the profile is the right carrier.
 */

import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { Host } from '@/types'
import { useAppStore } from '@/store/app'
import { useConnectToHost } from '@/features/connection-explorer/use-connect-to-host'
import { terminalTabPath } from '@/router/terminal-route'
import { toast } from '@/components/ui/sonner'
import {
  needsOneTimeCredential,
  oneTimeCredentialBlocker,
  registerOneTimeProfile,
  type OneTimeSecret,
} from '@/features/terminal/services/one-time-credential'
import { removeTemporaryTerminalProfile } from '@/features/terminal/services/temporary-terminal-profiles'

export interface HostConnectActions {
  credentialPromptHost: Host | null
  setCredentialPromptHost: (host: Host | null) => void
  handleConnect: (host: Host) => void
  handleOneTimeConnect: (secret: OneTimeSecret) => void
}

export function useHostConnectActions(): HostConnectActions {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { connectToHost } = useConnectToHost()
  const addTab = useAppStore(state => state.addTab)
  const [credentialPromptHost, setCredentialPromptHost] = useState<Host | null>(null)

  const handleConnect = useCallback(
    (host: Host) => {
      const blocker = oneTimeCredentialBlocker(host)
      if (blocker) {
        toast.error(t('hosts.connect.blocked'), { description: blocker })
        return
      }
      if (needsOneTimeCredential(host)) {
        setCredentialPromptHost(host)
        return
      }
      // One connect path for the whole app: the Connection Explorer calls the same
      // hook. Duplicating `addTab` + `navigate` here is how the two surfaces would
      // drift into opening sessions differently.
      connectToHost(host)
    },
    [connectToHost, t],
  )

  const handleOneTimeConnect = useCallback(
    (secret: OneTimeSecret) => {
      const host = credentialPromptHost
      if (!host) return
      const profileId = registerOneTimeProfile(host, secret)
      try {
        const newTab = addTab({
          label: host.name,
          type: 'remote',
          // The secret rides on the process-local profile: not on the tab, not in
          // the store. `TerminalContainer` prefers this over the saved row.
          profileId,
          hostId: host.id,
        })
        setCredentialPromptHost(null)
        navigate(terminalTabPath(newTab.id))
      } catch (error) {
        // A tab that failed to open must not leave a profile holding a secret.
        removeTemporaryTerminalProfile(profileId)
        throw error
      }
    },
    [addTab, credentialPromptHost, navigate],
  )

  return {
    credentialPromptHost,
    setCredentialPromptHost,
    handleConnect,
    handleOneTimeConnect,
  }
}
