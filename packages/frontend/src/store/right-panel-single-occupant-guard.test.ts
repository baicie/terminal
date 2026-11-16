// A source-level guard against reintroducing the two-boolean bug.
//
// The left column's version of this defect was `allowLeft` derived from one of two
// flags, so a `drawer` decision silently rendered nothing. The right column's
// version would be a second boolean beside `rightPanel` — e.g. `sftpOpen` next to
// `aiOpen` — which no amount of behavioural testing catches, because each panel
// works on its own and only their *combination* is wrong.
//
// So this reads the source. It is deliberately brittle: adding an exception should
// require editing this file, which is the review moment.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const storeDir = join(process.cwd(), 'src/store')

function read(name: string): string {
  return readFileSync(join(storeDir, name), 'utf8')
}

describe('the dock has exactly one occupant field', () => {
  it('the store exposes `rightPanel` and no per-panel boolean', () => {
    const source = read('right-panel-store.ts')
    // No `xxxOpen: boolean` / `showXxx: boolean` / `isXxxPanelOpen` anywhere.
    expect(source).not.toMatch(/\b(?:sftp|snippets|inspector|ai)Open\b/i)
    expect(source).not.toMatch(/\bshow(?:Sftp|Snippets|Inspector|Ai)\b/i)
    expect(source).not.toMatch(/\bis(?:Sftp|Snippets|Inspector|Ai)PanelOpen\b/i)
    // And the one field it does have is the union.
    expect(source).toMatch(/rightPanel:\s*RightPanelMode/)
  })

  it('the state module never stores a boolean beside the mode', () => {
    const source = read('right-panel-state.ts')
    // `interface RightPanelState` must have exactly one member. A second field is
    // how "the dock is open" and "which panel" drift apart.
    const match = source.match(/export interface RightPanelState \{([\s\S]*?)\}/)
    expect(match, 'RightPanelState must exist').toBeTruthy()
    const body = match![1]
    const fields = body
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.startsWith('//') && !line.startsWith('*'))
    expect(fields, `RightPanelState has: ${fields.join(' | ')}`).toHaveLength(1)
    expect(fields[0]).toMatch(/^rightPanel:\s*RightPanelMode$/)
  })

  it('every declared occupant appears in the implemented-or-declared lists', () => {
    // Guards the pair of lists from drifting: a new union member that is in
    // neither list would type-check and then render nothing, which is the failure
    // mode `resolveRightPanelMode` exists to prevent but cannot see at build time.
    const source = read('right-panel-state.ts')
    const union = source.match(/RIGHT_PANEL_OCCUPANTS = \[([\s\S]*?)\] as const/)
    expect(union, 'the occupant list must exist').toBeTruthy()
    const declared = union![1]
      .split(',')
      .map(entry => entry.replace(/[/'"]/g, '').trim())
      .filter(Boolean)
    expect(declared.sort()).toEqual(
      ['ai', 'inspector', 'none', 'sftp', 'snippets'].sort(),
    )
  })
})
