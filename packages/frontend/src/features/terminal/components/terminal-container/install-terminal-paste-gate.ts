/**
 * Wires the DOM paste gate to a terminal instance.
 *
 * Kept out of `use-terminal-instance.ts` so that file stays inside its line limit;
 * the behaviour lives in `paste-gate.ts`, this is only the connection between the
 * hook's refs and that gate's options.
 */

import type { MutableRefObject } from 'react'
import type { Terminal as XTerminal } from '@baicie/xterm'
import type { PasteConfirmRequest } from './paste-confirm-dialog'
import { installPasteGate } from './paste-gate'

export function installTerminalPasteGate(
  container: HTMLElement,
  termRef: MutableRefObject<XTerminal | null>,
  confirm: ((request: PasteConfirmRequest) => Promise<boolean>) | undefined,
): () => void {
  return installPasteGate(container, () => termRef.current, {
    // Refusing when no dialog was supplied is deliberate: sending a risky paste
    // unchecked is the behaviour this gate exists to prevent.
    confirm: confirm ?? (async () => false),
    onPasted: () => termRef.current?.focus(),
  })
}
