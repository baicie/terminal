// UX-1b — INV-5: one source for "is the terminal visible".
//
// The old form was the string `'/terminal'` compared in eleven files. That is not
// eleven copies of one decision; it is four different decisions that happened to
// share a literal. Replacing all of them with one careless helper would be as
// wrong as leaving them: the route table must keep serving the canvas, the deep
// link must keep its `?tab=`, and a deeper path must not silently become the
// canvas.
//
// These tests pin the semantics, and `terminal-route-literal-guard.test.ts` pins
// that no call site went back to comparing the raw literal.

import { describe, expect, it } from 'vitest'
import {
  TERMINALS_PATH,
  isTerminalLocation,
  isTerminalPath,
  terminalTabPath,
} from './terminal-route'

describe('isTerminalPath', () => {
  it('recognises the canvas route', () => {
    expect(isTerminalPath('/terminal')).toBe(true)
    expect(isTerminalPath(TERMINALS_PATH)).toBe(true)
  })

  it('is unaffected by the query string, which is what keeps ?tab= working', () => {
    // `useLocation().pathname` never contains the query, but a caller that passed a
    // full path-with-search must not silently get `false` — that would hide the
    // canvas on exactly the deep links that are supposed to show it.
    expect(isTerminalPath('/terminal?tab=abc')).toBe(true)
    expect(isTerminalPath('/terminal?tab=abc&x=1')).toBe(true)
  })

  it('ignores a trailing slash, which a manual navigate can produce', () => {
    expect(isTerminalPath('/terminal/')).toBe(true)
    expect(isTerminalPath('/terminal///')).toBe(true)
  })

  it('rejects a deeper path instead of treating a prefix as the canvas', () => {
    // The route table has no `/terminal/*` entry. Treating the prefix as the canvas
    // would hide an outlet the router can actually render.
    expect(isTerminalPath('/terminal/settings')).toBe(false)
    expect(isTerminalPath('/terminals')).toBe(false)
  })

  it('rejects every other route', () => {
    for (const path of ['/', '/hosts', '/sftp', '/vaults', '/terminal-x']) {
      expect(isTerminalPath(path), path).toBe(false)
    }
  })
})

describe('isTerminalLocation', () => {
  it('reads a location object', () => {
    expect(isTerminalLocation({ pathname: '/terminal' })).toBe(true)
    expect(isTerminalLocation({ pathname: '/hosts' })).toBe(false)
  })
})

describe('terminalTabPath', () => {
  it('builds the deep link the URL sync reads', () => {
    expect(terminalTabPath('tab-1')).toBe('/terminal?tab=tab-1')
  })

  it('encodes the id so a tab id with reserved characters still round-trips', () => {
    // Tab ids are generated (`local-1793728115282`), but an imported or
    // hand-constructed id must not break the URL.
    expect(terminalTabPath('a b&c=d')).toBe('/terminal?tab=a%20b%26c%3Dd')
  })

  it('produces a path the canvas recognises', () => {
    // The two halves of the contract meeting: what one function builds, the other
    // accepts.
    const path = terminalTabPath('tab-9')
    expect(isTerminalPath(path.split('?')[0])).toBe(true)
  })
})
