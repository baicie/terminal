import { create } from 'zustand'
import type { SftpBindingStore } from './sftp-binding'

/**
 * The dock's pinned host.
 *
 * Separate from `AppStore` for one reason: this must **not** be part of the
 * persisted workspace layout. Everything in `AppStore` that survives a restart
 * would bring a dock that reconnects to a server on launch, which is a connection
 * nobody asked for.
 */
export const useSftpBindingStore = create<SftpBindingStore>(set => ({
  hostId: null,
  openFor: hostId => set({ hostId }),
  close: () => set({ hostId: null }),
}))
