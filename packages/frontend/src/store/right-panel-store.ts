import { create } from 'zustand'
import { toggleRightPanel, withRightPanel, type RightPanelMode } from './right-panel-state'

/**
 * The dock's occupant.
 *
 * Its own store rather than part of `AppStore`: `AppStore` is at its file-size
 * limit, and this state must *not* be restored with the workspace layout — a dock
 * that reopens by itself on launch is a UI the user did not ask for, and with
 * SFTP in it, a connection they did not ask for either.
 */
export interface RightPanelStore {
  rightPanel: RightPanelMode
  setRightPanel: (panel: RightPanelMode) => void
  toggleRightPanel: () => void
}

export const useRightPanelStore = create<RightPanelStore>(set => ({
  rightPanel: 'none',
  setRightPanel: panel => set(withRightPanel(panel)),
  toggleRightPanel: () => set(state => toggleRightPanel(state.rightPanel)),
}))
