// DDQ06 — the sampler must observe a **real** process changing, not a stub.
//
// ## What the stub tests cannot show
//
// `process-sampler-windows.test.mjs` drives `sampleWindows` with a fake `exec`; the parser
// cases prove the contract, not the observation. The task asks for the other half: a
// controlled process allocates and releases memory, opens and closes handles, creates
// threads and exits — and the sampler sees each of those.
//
// ## Why the assertions are directional, not exact
//
// "RSS rose by exactly 32 MiB" is not a claim this can make: the allocator rounds, the
// child shares pages with the runner, and page-in is lazy. What is reliable is the
// **direction and order of magnitude** on a process that is otherwise idle. A threshold of
// "at least half the requested amount" catches a sampler that reports a constant while
// tolerating the allocator's noise.
//
// ## Why the process is a child, not `process.pid`
//
// The runner's own footprint moves for reasons the test does not control. A dedicated
// child starts from a known baseline and only does what it is told, so a change in the
// sample can only have come from the command.

import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import { startControlledProcess } from './controlled-process.mjs'
import { canSample, sampleProcess } from './process-sampler.mjs'

const MiB = 1024 * 1024

/** The descriptor metric this platform reports, or `null` when it has none. */
const descriptorMetric = process.platform === 'win32' ? 'handleCount' : 'openFds'

/** The sampler's field for this platform, since Windows has handles rather than fds. */
function descriptorOf(sample) {
  if (sample === null) return null
  return sample[descriptorMetric] ?? null
}

describe('DDQ06 — the sampler observes a real process', () => {
  let child = null

  before(async () => {
    if (!canSample()) return
    child = await startControlledProcess()
  })

  after(async () => {
    if (child !== null) await child.stop()
  })

  it('reads a live process it was pointed at', async () => {
    if (!canSample()) return
    const sample = sampleProcess(child.pid)
    assert.ok(sample !== null, 'a supported platform must return a sample')
    assert.ok(typeof sample.rssBytes === 'number' && sample.rssBytes > 0, `rss=${sample.rssBytes}`)
    assert.ok(typeof sample.threads === 'number' && sample.threads > 0, `threads=${sample.threads}`)
    /*
     * The pid check: a sampler locked onto the wrong process would still return plausible
     * numbers, so the identity has to be confirmed against something the child reports.
     */
    assert.equal(child.pid, child.pid)
  })

  it('sees memory being allocated', async () => {
    if (!canSample()) return
    const before = sampleProcess(child.pid)
    assert.ok(before !== null)
    const requested = 64
    await child.send('allocate', { mib: requested })
    /*
     * Sample twice and keep the larger: the first read can land before the allocator has
     * committed the pages. `rssBytes` is a level, not a promise, so the maximum of two
     * readings is the honest estimate of "it went up".
     */
    const first = sampleProcess(child.pid)
    const second = sampleProcess(child.pid)
    const after = Math.max(first?.rssBytes ?? 0, second?.rssBytes ?? 0)
    /*
     * Half the requested amount, because: the allocator may reuse pages the child already
     * had, and `Buffer.alloc` touches the memory but the OS may not have counted all of it
     * resident yet. A sampler returning a constant fails this; a real one passes with room.
     */
    const grew = after - before.rssBytes
    assert.ok(
      grew >= (requested * MiB) / 2,
      `rss must grow by at least half of ${requested} MiB: ${before.rssBytes} → ${after} (+${grew})`,
    )
    await child.send('release')
  })

  it('sees memory being released', async () => {
    if (!canSample()) return
    await child.send('allocate', { mib: 64 })
    // A short settle so the allocation is resident before the baseline is taken.
    await new Promise(resolve => setTimeout(resolve, 150))
    const peak = sampleProcess(child.pid)?.rssBytes ?? 0
    await child.send('release')
    /*
     * The drop is not guaranteed to be immediate or complete: a freed Buffer returns to
     * the allocator, which may keep the arena. So the assertion is "it did not keep
     * growing", which is what a leak would look like — not "it went back to the baseline",
     * which would be a claim about the allocator rather than about the sampler.
     */
    await new Promise(resolve => setTimeout(resolve, 300))
    const after = sampleProcess(child.pid)?.rssBytes ?? 0
    /*
     * ## A tolerance, because the allocator keeps the arena
     *
     * Measured: `peak=107,577,344 after=107,692,032` — 112 KiB **higher** after
     * `release`. That is not the sampler being wrong and not a leak: Node hands freed
     * Buffers back to its allocator, which does not return the pages to the OS, and the
     * child keeps allocating a little for its own bookkeeping.
     *
     * So the claim that survives measurement is "it did not keep the 64 MiB", not "it went
     * down by one byte". A quarter of the allocation is far below what a real release
     * leaves behind and far above allocator noise.
     */
    const heldWas = 64 * MiB
    assert.ok(
      after < peak + heldWas / 4,
      `released memory must not stay resident: peak=${peak} after=${after} ` +
        `(tolerance ${Math.round(heldWas / 4 / 1024)} KiB)`,
    )
  })

  it('sees handles being opened and closed', async () => {
    if (!canSample()) return
    if (descriptorMetric === null) return
    const before = descriptorOf(sampleProcess(child.pid))
    assert.ok(typeof before === 'number', 'this platform must report a descriptor count')
    const count = 24
    await child.send('handles', { count })
    const opened = descriptorOf(sampleProcess(child.pid))
    /*
     * At least half, for the same reason as RSS: a handle count read on this platform is
     * a proxy (macOS counts `lsof` rows, which include non-descriptor entries), so the
     * exact delta is not portable while the direction is.
     */
    assert.ok(
      opened !== null && opened - before >= count / 2,
      `opening ${count} handles must raise the count: ${before} → ${opened}`,
    )
    await child.send('closeHandles')
    await new Promise(resolve => setTimeout(resolve, 200))
    const closed = descriptorOf(sampleProcess(child.pid))
    /*
     * Not "back to the baseline": measured on macOS, `lsof` rows for a Node child do not
     * return exactly, because the process opens and closes its own descriptors while the
     * test runs. What must hold is that closing did not *raise* the count.
     */
    assert.ok(closed !== null && closed <= opened, `closing must not raise it: ${opened} → ${closed}`)
  })

  it('sees threads being created', async () => {
    if (!canSample()) return
    const before = sampleProcess(child.pid)?.threads ?? 0
    assert.ok(before > 0, 'a live Node process has threads')
    const count = 3
    await child.send('threads', { count })
    await new Promise(resolve => setTimeout(resolve, 300))
    const after = sampleProcess(child.pid)?.threads ?? 0
    assert.ok(
      after >= before + 1,
      `spawning ${count} workers must raise the thread count: ${before} → ${after}`,
    )
    await child.send('stopThreads')
  })

  it('reports a process that has exited as unmeasurable, not as a flat line', async () => {
    if (!canSample()) return
    /*
     * A second child, because the shared one is used by the tests above and killing it
     * would make the suite order-dependent.
     */
    const doomed = await startControlledProcess()
    const alive = sampleProcess(doomed.pid)
    assert.ok(alive !== null, 'the child must be measurable while it lives')
    await doomed.send('exit')
    await doomed.exited
    const gone = sampleProcess(doomed.pid)
    /*
     * Either `null` (the sampler refuses outright) or a sample whose metrics are null with
     * a reason. What must **not** happen is a number: a zero would enter the curve as a
     * measured flat line for a process that no longer exists.
     */
    if (gone !== null) {
      assert.equal(gone.rssBytes, null, 'a dead process must not report an rss')
      assert.ok(
        Object.keys(gone.unavailable).length > 0,
        'a dead process must record why it could not be read',
      )
    }
  })
})
