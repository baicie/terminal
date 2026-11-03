import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { summarizeColdStartSamples } from './summarize-cold-start-samples.mjs'

async function sampleDirectory(samples) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'cold-start-samples-'))
  for (const [index, sample] of samples.entries()) {
    await writeFile(
      path.join(directory, `sample-${index + 1}.json`),
      JSON.stringify(sample),
    )
  }
  return directory
}

test('counts every sample and keeps failures in the denominator', async () => {
  const directory = await sampleDirectory([
    {
      ok: true,
      sampleIndex: 1,
      spawnToReadyMs: 5_000,
      stages: [
        { stage: 'frontend-boot' },
        { stage: 'ready' },
        { stage: 'terminal-mounted' },
        { stage: 'session-create-requested' },
        { stage: 'session-created' },
      ],
    },
    {
      ok: true,
      sampleIndex: 2,
      spawnToReadyMs: 7_000,
      stages: [
        { stage: 'frontend-boot' },
        { stage: 'ready' },
        { stage: 'terminal-mounted' },
        { stage: 'session-create-requested' },
        { stage: 'session-created' },
      ],
    },
    {
      ok: false,
      sampleIndex: 3,
      error:
        'terminal readiness did not complete within 10000 ms (stages: frontend-boot@0ms -> ready@1000ms; the app reached db ready but no terminal surface mounted)',
    },
  ])
  try {
    const summary = await summarizeColdStartSamples(directory)
    assert.equal(summary.samples, 3)
    assert.equal(summary.successes, 2)
    assert.equal(summary.failures, 1)
    assert.equal(summary.successRate, 2 / 3)
    assert.deepEqual(summary.durationMs, {
      min: 5_000,
      median: 5_000,
      p95: 7_000,
      max: 7_000,
    })
    assert.deepEqual(summary.stagePresence, {
      frontendBoot: 3,
      ready: 3,
      terminalMounted: 2,
      sessionRequested: 2,
      sessionCreated: 2,
    })
    assert.deepEqual(summary.classification, {
      ready: 2,
      'terminal-not-mounted': 1,
    })
    assert.equal(summary.failureDetails[0].sampleIndex, 3)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('refuses an empty sample directory instead of reporting zero failures', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'cold-start-empty-'))
  try {
    await assert.rejects(
      summarizeColdStartSamples(directory),
      /no sample-\*\.json files/,
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
