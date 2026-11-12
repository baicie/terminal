/**
 * The one place that decides "is the terminal visible right now".
 *
 * INV-5 said this answer had to have a single source. Until now it was the string
 * `'/terminal'` compared in eleven different files, which meant the meaning was
 * re-derived (and could drift) at every call site. Changing a route name would
 * have silently broken the ones nobody remembered.
 *
 * The eleven call sites are not the same question. They are four:
 *
 * | Question | Who asks | Consequence of getting it wrong |
 * | --- | --- | --- |
 * | Should the terminal canvas be shown? | `MainLayoutContent`, `TerminalByUrl` | a management page renders under a live terminal, or the terminal is hidden on its own route |
 * | Should a shortcut act? | `use-layout-shortcut-events`, `TerminalContainer` | `⌘B` toggles a sidebar the user cannot see; typing into a hidden pane |
 * | Is this a route to navigate to? | `MenuTabs`, `ActivityRail`, `BottomNav` | a link that goes nowhere |
 * | Should this tab be focused? | `TerminalByUrl` URL sync | the wrong pane takes focus |
 *
 * `TERMINALS_PATH` is the path; `isTerminalPath` answers "is this the canvas
 * route *and nothing else*". A deeper route such as a future
 * `/terminal/settings` is deliberately **not** the canvas: the route table has no
 * such entry today, and treating a prefix as the canvas would hide an outlet that
 * the router can actually render.
 *
 * **Route compatibility is part of the contract.** `/terminal?tab=<id>` is the
 * deep-link form used by eight call sites and by the URL sync in
 * `terminal-by-url.tsx`. `pathname` never contains the query string, so every
 * function here is unaffected by `?tab=` — that is a property these tests pin,
 * not an accident.
 */

/** The canvas route. Kept as a constant so no call site re-types the literal. */
export const TERMINALS_PATH = '/terminal'

/**
 * Is `pathname` the terminal canvas route?
 *
 * Takes a `pathname` (no query, no hash), matching what `useLocation()` returns.
 * Pass the whole `location` object to `isTerminalLocation` when that is what you
 * have.
 */
export function isTerminalPath(pathname: string): boolean {
  // Strip a query or hash if one was passed. `useLocation().pathname` never
  // contains either, but this function's parameter is a string and a caller
  // handing it `/terminal?tab=x` must not get `false` — that would hide the canvas
  // on exactly the deep links meant to show it.
  let path = pathname
  const query = path.indexOf('?')
  if (query >= 0) path = path.slice(0, query)
  const hash = path.indexOf('#')
  if (hash >= 0) path = path.slice(0, hash)
  // Trailing slashes are normalized by the router, but a manual `navigate('/terminal/')`
  // would otherwise fail this check and leave the canvas invisible.
  if (path.length > 1 && path.endsWith('/')) path = path.replace(/\/+$/, '')
  return path === TERMINALS_PATH
}

/** Convenience for the many `useLocation()` call sites. */
export function isTerminalLocation(location: { pathname: string }): boolean {
  return isTerminalPath(location.pathname)
}

/**
 * The deep-link form, for the sites that build a URL rather than read one.
 *
 * Centralised so the `?tab=` contract has one definition: `terminal-by-url.tsx`
 * reads `searchParams.get('tab')`, and eight call sites write it.
 */
export function terminalTabPath(tabId: string): string {
  return `${TERMINALS_PATH}?tab=${encodeURIComponent(tabId)}`
}
