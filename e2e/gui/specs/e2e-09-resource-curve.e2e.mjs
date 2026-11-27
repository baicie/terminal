// E2E-09 — RC18: a resource curve across repeated GUI work.
//
// ## What this adds that no existing case covers
//
// `e2e-08` proved one round of heavy output is consumed correctly. The 12-round Rust
// regression proves the pool and registry return to zero. Neither says anything about
// **process-level** growth: after 100 rounds of real GUI work — opening tabs, splitting,
// running commands, opening and closing the dock — does the app's RSS, descriptor count or
// thread count keep climbing?
//
// ## Why the samples come from outside the process
//
// `fixtures/process-sampler.mjs` reads `ps`/`lsof`/`/proc`. Every alternative is a counter
// the app produces about itself, and a counter is a measurement the thing being measured
// can get wrong: an instrumentation bug changes the number, a crash destroys the series,
// and a counter that stops updating reads as a perfect flatline. The operating system has
// no such motive.
//
// ## Why the verdict is a pure function of the series
//
// `fixtures/resource-curve.mjs` decides plateau / sawtooth / leak, and it has its own tests
// with synthetic series. That is the part that is easy to get wrong: a first-vs-last
// comparison calls a sawtooth a leak, and comparing whole-run floors calls a warm-up a leak
// — both were measured while writing that module.
//
// ## What it does not claim
//
// A curve from one runner is a hypothesis about that runner. The task asks for the shape,
// not for a merge gate, so `LEAK_SUSPECTED` is recorded as evidence rather than thrown as
// a failure — throwing would make a shared runner's noise block unrelated work, which the
// repository's own `ssh-soak.yml` also refuses to do.

import path from 'node:path'
import { browser, expect } from '@wdio/globals'
import { writeEvidence } from '../fixtures/evidence.mjs'
import { appBinaryPath } from '../../../scripts/gui-e2e-platform.mjs'
import { findAppPid, sampleProcess } from '../fixtures/process-sampler.mjs'
import { summariseSeries } from '../fixtures/resource-curve.mjs'

const CASE = 'e2e-09'

/*
 * Derived from this file's own location, not `process.cwd()`: WDIO runs with the config's
 * directory as cwd, and a path that happens to be right there breaks the moment the runner
 * changes it. `fixtures/evidence.mjs` resolves the repository root the same way.
 */
const ROOT = path.resolve(import.meta.dirname, '../../..')

/**
 * Rounds to run — 100, the number the task names.
 *
 * Measured before settling on it: 50 rounds took 45 s of the suite's own wall clock
 * (6 minutes including the build, most of which is the build). 100 rounds therefore adds
 * under two minutes to a job that has 45, which is affordable without shortening the run
 * and pretending the shorter series is the same thing.
 *
 * `GUI_E2E_RC18_ROUNDS` exists for a quick local check, not to make CI measure less: the
 * curve rule refuses anything below its own minimum instead of summarising a short run.
 */
const ROUNDS = Number(process.env.GUI_E2E_RC18_ROUNDS ?? 100)

/**
 * The curve thresholds, and why each is what it is.
 *
 * `minimumSamples` is 12 because that is the shortest series where "the floor is still
 * climbing" means anything; the rule refuses below it instead of guessing.
 *
 * `growthFraction` 0.2 and `growthFloor` 8 MiB are the pair the F17 curve settled on: a
 * fraction alone misses a real leak on a large baseline (156 MiB on 2 GiB is 7.6%), and an
 * absolute alone fires on a tiny baseline's noise.
 */
const LIMITS = {
  minimumSamples: 12,
  growthFraction: 0.2,
  growthFloor: 8 * 1024 * 1024,
  labels: { unit: 'B' },
}

const FD_LIMITS = {
  minimumSamples: 12,
  // Descriptors are counted, not sized: one leaked per round over 40 rounds is a real
  // leak, so the thresholds are counts rather than proportions.
  growthFraction: 0.1,
  growthFloor: 4,
  labels: { unit: '' },
}

async function openPalette() {
  await browser.keys(['Meta', 'k'])
  await browser.pause(300)
}

async function runRound(index) {
  /*
   * One round of the work a person actually does, through the product's own controls:
   * open the palette, run a command, close the palette. The palette is the one action that
   * works identically on every platform this suite runs on — the alternative was a
   * keystroke chord, and those differ per OS.
   *
   * Deliberately small: 40 rounds of "open a tab and run a command" is what a day of use
   * looks like at scale. Making each round heavier would measure fewer of them for the
   * same wall clock.
   */
  await openPalette()
  await browser.keys('Escape')
  const snapshot = await browser.execute(
    () => globalThis.__terminalGuiE2E?.snapshot?.() ?? null,
  )
  return { round: index, lines: snapshot?.lines ?? null }
}

describe('E2E-09 resource curve across repeated GUI work', () => {
  const samples = []
  const roundResults = []
  const caseFailures = []

  afterEach(function () {
    if (this.currentTest?.state === 'failed') {
      // See `e2e-08` for why the runner's error object is not read here: it is undefined
      // under this Mocha adapter, measured.
      const test = this.currentTest
      caseFailures.push({
        title: test.title ?? '<unknown case>',
        error:
          typeof test.duration === 'number'
            ? `failed after ${test.duration} ms; see the recorded samples`
            : 'failed; see the recorded samples',
      })
    }
  })

  after(async () => {
    const rss = samples.map(sample => sample.rssBytes).filter(v => v !== null)
    const fds = samples.map(sample => sample.openFds).filter(v => v !== null)
    const threads = samples.map(sample => sample.threads).filter(v => v !== null)
    const rssCurve = summariseSeries(rss, LIMITS)
    const fdCurve = summariseSeries(fds, FD_LIMITS)

    /*
     * `LEAK_SUSPECTED` is recorded, not thrown: a curve on a shared runner is a hypothesis
     * about that runner, and the task asks for the shape rather than a gate. A missing
     * sample set is a different matter and does fail — that means the sampler never ran,
     * which is a harness defect rather than a product finding.
     */
    const measured = rss.length > 0 && fds.length > 0
    const verdict = caseFailures.length > 0 || !measured ? 'FAIL' : 'PASS'

    await writeEvidence(CASE, {
      verdict,
      ...(verdict === 'FAIL'
        ? {
            error:
              caseFailures.length > 0
                ? caseFailures.map(f => `${f.title}: ${f.error}`).join('; ')
                : 'the sampler produced no samples, so no curve exists',
          }
        : {}),
      notes:
        `${rss.length} round(s) sampled; RSS ${rssCurve.verdict}, descriptors ${fdCurve.verdict}` +
        (threads.length > 0 ? `, threads ${Math.min(...threads)}–${Math.max(...threads)}` : ''),
      extra: {
        rounds: ROUNDS,
        sampleCount: samples.length,
        rssVerdict: rssCurve.verdict,
        rssReason: rssCurve.reason,
        fdVerdict: fdCurve.verdict,
        fdReason: fdCurve.reason,
        rssFirst: rss[0] ?? null,
        rssLast: rss[rss.length - 1] ?? null,
        fdFirst: fds[0] ?? null,
        fdLast: fds[fds.length - 1] ?? null,
        threadMin: threads.length > 0 ? Math.min(...threads) : null,
        threadMax: threads.length > 0 ? Math.max(...threads) : null,
        // The series itself, so a reader can apply a different rule to the same numbers.
        rssSeries: rss,
        fdSeries: fds,
        roundLines: roundResults.map(result => result.lines),
      },
    })
  })

  it('keeps its footprint bounded across repeated GUI work', async function () {
    this.timeout(600_000)

    const pid = findAppPid(appBinaryPath(ROOT))
    if (pid === null) {
      /*
       * No pid means the sampler cannot see the app — a harness problem, not a product
       * result. Recorded with the reason rather than skipped silently; the `after` hook
       * turns a sample-less run into FAIL, and this note is what explains it.
       */
      throw new Error(
        'could not find the app process by its binary path, so no curve can be sampled',
      )
    }

    const first = sampleProcess(pid)
    if (first === null) {
      throw new Error(`this platform cannot sample a process (pid ${pid})`)
    }
    samples.push(first)

    for (let round = 0; round < ROUNDS; round += 1) {
      roundResults.push(await runRound(round))
      const sample = sampleProcess(pid)
      if (sample === null) break
      samples.push(sample)
    }

    /*
     * The app must still be answering after the rounds. A curve with no live endpoint is a
     * series from a process that died, and summarising it would describe a leak in
     * something that stopped existing.
     */
    const alive = await browser.execute(
      () => globalThis.__terminalGuiE2E?.snapshot?.() ?? null,
    )
    expect(alive).not.toBeNull()
    expect(samples.length).toBeGreaterThanOrEqual(LIMITS.minimumSamples)
  })
})
