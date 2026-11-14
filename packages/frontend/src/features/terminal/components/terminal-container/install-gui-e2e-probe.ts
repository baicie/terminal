/**
 * Conditionally attach the read-only GUI E2E probe.
 *
 * Split out for the source-size gate, and for one behaviour that is easy to get
 * wrong: the guard has to be a **build-time constant at the call site**. The first
 * version imported the probe statically and checked the flag *inside* the install
 * function, so the marker string survived into `dist/js/container.*.js` even
 * though nothing called it. A dynamic import behind a literal comparison is what
 * lets the bundler drop both the call and the module.
 *
 * `isDisposed` is read after the import resolves: unmounting during that gap must
 * not attach a probe to a disposed terminal.
 */
import type { Terminal } from '@baicie/xterm'

export function installGuiE2EProbeIfBuilt(
  terminal: Terminal,
  isDisposed: () => boolean,
): () => void {
  if (import.meta.env.VITE_TERMINAL_GUI_E2E !== '1') return () => undefined
  let dispose: () => void = () => undefined
  void import('@/features/terminal/gui-e2e-probe').then(({ installGuiE2EProbe }) => {
    if (!isDisposed()) dispose = installGuiE2EProbe(terminal)
  })
  return () => dispose()
}
