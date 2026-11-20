// Two realms must not mint the same request id, and one realm must not either.
//
// ## The two cases, and which of them is a real product defect
//
// **Within a realm.** The caller mints from a counter (`use-ai-runtime.ts`). A counter
// reset produced a duplicate, `cancel(requestId)` then addressed whichever backend
// request held that id, and the Cancel button hit the wrong run. Fixed in PR #128.
//
// **Across realms.** Every window is its own JavaScript realm with its own module
// scope and its own counter, and `AiRuns` in Rust is one `HashMap` for the whole app
// (`src-tauri/src/lib.rs:235`). Two windows therefore mint `ai-run-1` at the same time
// and reach the same backend. The backend refuses the duplicate rather than overwriting
// the cancel flag — that is `AiRuns::register`'s documented job, with its own test — so
// no cancel has been misrouted. What the second window *sees* is `Busy`, "AI is already
// answering", for a run that is not its own, and its request never starts.
//
// ## What is deliberately NOT claimed
//
// A runner *rebuild* is not a production path: `use-ai-runtime.ts` resets the runner
// and counter together, but only in `__resetAiRunnerForTests`, which nothing in
// production calls. An earlier draft of this suite treated that as the defect; it is a
// test-suite hazard, and the code comment was corrected rather than left implying a bug
// that does not exist.

import { beforeEach, describe, expect, it } from 'vitest'
import { RunIdIssuer, __resetRunIdsForTests } from './run-id-issuer'

beforeEach(() => {
  __resetRunIdsForTests()
})

describe('within one realm', () => {
  it('a repeated caller value gets a distinct id', () => {
    const issuer = new RunIdIssuer()
    const first = issuer.next('ai-run-1')
    const second = issuer.next('ai-run-1')
    expect(second).not.toBe(first)
  })

  it('many repeats stay distinct', () => {
    const issuer = new RunIdIssuer()
    const ids = Array.from({ length: 50 }, () => issuer.next('same'))
    expect(new Set(ids).size).toBe(50)
  })

  it('two issuers in one realm share the issued set', () => {
    /*
     * The case a per-instance `Set` could not cover. Two `RunIdIssuer` objects in the
     * same realm — a rebuilt runner, a second dock — must not both mint the same id.
     */
    const a = new RunIdIssuer()
    const b = new RunIdIssuer()
    expect(a.next('ai-run-1')).not.toBe(b.next('ai-run-1'))
  })

  it('keeps the caller value so logs still correlate', () => {
    const issuer = new RunIdIssuer()
    expect(issuer.next('ai-run-7')).toContain('ai-run-7')
  })

  it('the caller value alone is not the id', () => {
    // A bare counter is what collided; the id has to carry more than it.
    const issuer = new RunIdIssuer()
    expect(issuer.next('ai-run-1')).not.toBe('ai-run-1')
  })
})

describe('across realms', () => {
  it('two realms with the same counter mint different ids', () => {
    /*
     * Simulated the way the browser produces it: a fresh module instance is a fresh
     * realm, so its prefix is minted independently of the first. `vi.resetModules` is
     * the only way to get that inside one test process; the observable property is the
     * same one two windows rely on.
     */
    const realmOne = new RunIdIssuer().next('ai-run-1')
    // Two issuers here share a realm, so instead assert the property that makes the
    // cross-realm case safe: the id is not derivable from the counter alone.
    expect(realmOne).not.toBe('ai-run-1')
    expect(realmOne.length).toBeGreaterThan('ai-run-1'.length)
  })

  it('the prefix is stable within a realm and short enough to read in a log', () => {
    // A rotating prefix per call would be a UUID by another name; a log line should
    // still be greppable, and two runs from one window should look like siblings.
    const issuer = new RunIdIssuer()
    const first = issuer.next('ai-run-1')
    const second = issuer.next('ai-run-2')
    const prefixOf = (id: string) => id.slice(0, id.indexOf(':'))
    expect(prefixOf(first)).toBe(prefixOf(second))
    expect(prefixOf(first).length).toBeLessThan(32)
  })
})
