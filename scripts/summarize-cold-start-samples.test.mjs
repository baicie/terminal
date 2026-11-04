import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import {
  ColdStartSampleIntegrityError,
  causalViolations,
  mountedTerminalType,
  summarizeColdStartSamples,
} from './summarize-cold-start-samples.mjs'

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

function successSample(index, overrides = {}) {
  return {
    ok: true,
    sampleIndex: index,
    capturedAt: '2026-11-03T00:00:00.000Z',
    timeoutMs: 10_000,
    binarySha256: 'a'.repeat(64),
    spawnToReadyMs: 5_000,
    stages: [
      { stage: 'frontend-boot', atMs: 0 },
      { stage: 'ready', atMs: 1_000 },
      { stage: 'terminal-mounted', atMs: 1_500 },
      { stage: 'session-create-requested', atMs: 2_000 },
      { stage: 'session-created', atMs: 2_500 },
    ],
    ...overrides,
  }
}

function failureSample(index, error, overrides = {}) {
  return {
    ok: false,
    sampleIndex: index,
    capturedAt: '2026-11-03T00:00:00.000Z',
    timeoutMs: 10_000,
    binarySha256: 'a'.repeat(64),
    error,
    ...overrides,
  }
}

async function withDirectory(callback) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'cold-start-samples-'))
  try {
    await callback(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

async function writeSample(directory, fileName, value) {
  await writeFile(path.join(directory, fileName), JSON.stringify(value))
}

test('counts every sample and keeps failures in the denominator', async () => {
  const directory = await sampleDirectory([
    successSample(1),
    successSample(2, { spawnToReadyMs: 7_000 }),
    failureSample(
      3,
      'terminal readiness did not complete within 10000 ms (stages: frontend-boot@0ms -> ready@1000ms; the app reached db ready but no terminal surface mounted)',
    ),
  ])
  try {
    const summary = await summarizeColdStartSamples(directory, {
      expectedSamples: 3,
    })
    assert.equal(summary.samples, 3)
    assert.equal(summary.expectedSamples, 3)
    assert.equal(summary.successes, 2)
    assert.equal(summary.failures, 1)
    assert.equal(summary.successRate, 2 / 3)
    assert.equal(summary.verdict, 'MEASUREMENT_COMPLETE_WITH_FAILURES')
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
  await withDirectory(async directory => {
    await assert.rejects(
      summarizeColdStartSamples(directory),
      /no sample-\*\.json files/,
    )
  })
})

test('fails closed when a requested sample is missing', async () => {
  await withDirectory(async directory => {
    await writeSample(directory, 'sample-1.json', successSample(1))
    await writeSample(directory, 'sample-2.json', successSample(2))
    await writeSample(directory, 'sample-4.json', successSample(4))

    await assert.rejects(
      summarizeColdStartSamples(directory, { expectedSamples: 4 }),
      error => {
        assert.ok(error instanceof ColdStartSampleIntegrityError)
        assert.match(error.message, /not contiguous 1\.\.N/)
        return true
      },
    )
  })
})

test('fails closed when the expected count exceeds the collected files', async () => {
  await withDirectory(async directory => {
    await writeSample(directory, 'sample-1.json', successSample(1))
    await writeSample(directory, 'sample-2.json', successSample(2))
    await writeSample(directory, 'sample-3.json', successSample(3))
    await writeSample(directory, 'sample-4.json', successSample(4))
    await writeFile(path.join(directory, 'sample-4.json'), '{')

    await assert.rejects(
      summarizeColdStartSamples(directory, { expectedSamples: 5 }),
      /expected 5 samples, found 4; missing indices: 5/,
    )
  })
})

test('fails closed on a damaged sample instead of dropping it', async () => {
  await withDirectory(async directory => {
    await writeSample(directory, 'sample-1.json', successSample(1))
    await writeFile(path.join(directory, 'sample-2.json'), '')
    await assert.rejects(
      summarizeColdStartSamples(directory, { expectedSamples: 2 }),
      /sample-2\.json is not valid JSON/,
    )
  })
})

test('fails closed when sampleIndex disagrees with the filename', async () => {
  await withDirectory(async directory => {
    await writeSample(directory, 'sample-1.json', successSample(2))
    await assert.rejects(
      summarizeColdStartSamples(directory, { expectedSamples: 1 }),
      /carries sampleIndex=2, expected 1/,
    )
  })
})

test('fails closed on a success without stage evidence', async () => {
  await withDirectory(async directory => {
    await writeSample(
      directory,
      'sample-1.json',
      successSample(1, { stages: undefined }),
    )
    await assert.rejects(
      summarizeColdStartSamples(directory, { expectedSamples: 1 }),
      /succeeded without a stages array/,
    )
  })
})

test('fails closed on a failure without an error message', async () => {
  await withDirectory(async directory => {
    await writeSample(
      directory,
      'sample-1.json',
      failureSample(1, undefined),
    )
    await assert.rejects(
      summarizeColdStartSamples(directory, { expectedSamples: 1 }),
      /failed without an error message/,
    )
  })
})

test('all-pass samples produce RELIABILITY_PASS', async () => {
  await withDirectory(async directory => {
    await writeSample(directory, 'sample-1.json', successSample(1))
    await writeSample(directory, 'sample-2.json', successSample(2))
    const summary = await summarizeColdStartSamples(directory, {
      expectedSamples: 2,
    })
    assert.equal(summary.verdict, 'RELIABILITY_PASS')
  })
})

test('separates a local mount from a remote mount in the summary', async () => {
  await withDirectory(async directory => {
    await writeSample(directory, 'sample-1.json', successSample(1, {
      stages: [
        { stage: 'frontend-boot', atMs: 0 },
        { stage: 'ready', atMs: 400 },
        { stage: 'terminal-mounted', atMs: 900, detail: 'tab@ws@local' },
      ],
    }))
    await writeSample(directory, 'sample-2.json', successSample(2, {
      stages: [
        { stage: 'frontend-boot', atMs: 0 },
        { stage: 'ready', atMs: 400 },
        { stage: 'terminal-mounted', atMs: 900, detail: 'tab@ws@remote' },
      ],
    }))
    await writeSample(directory, 'sample-3.json', successSample(3))
    const summary = await summarizeColdStartSamples(directory, {
      expectedSamples: 3,
    })
    assert.deepEqual(summary.mountEvidence, {
      local: 1,
      remote: 1,
      unknown: 1,
    })
  })
})

test('reads the old two-part mount detail as unknown, not local', () => {
  assert.equal(
    mountedTerminalType({
      stages: [{ stage: 'terminal-mounted', atMs: 1, detail: 'tab@ws' }],
    }),
    'unknown',
  )
})

test('flags a session-created timestamp that precedes the SSH connect stage', () => {
  const violations = causalViolations({
    stages: [
      { stage: 'session-create-requested', atMs: 1_000 },
      { stage: 'ssh-connect-start', atMs: 1_100 },
      { stage: 'session-created', atMs: 1_050 },
    ],
  })
  assert.deepEqual(violations, [
    'session-created@1050ms precedes ssh-connect-start@1100ms',
  ])
})

test('flags a request stage that lands after the SSH connect it caused', () => {
  const violations = causalViolations({
    stages: [
      { stage: 'ssh-connect-start', atMs: 1_000 },
      { stage: 'session-create-requested', atMs: 1_050 },
    ],
  })
  assert.deepEqual(violations, [
    'session-create-requested@1050ms follows ssh-connect-start@1000ms',
  ])
})

test('reports causal violations in the summary without hiding the failure count', async () => {
  await withDirectory(async directory => {
    await writeSample(
      directory,
      'sample-1.json',
      successSample(1, {
        stages: [
          { stage: 'frontend-boot', atMs: 0 },
          { stage: 'ready', atMs: 500 },
          { stage: 'terminal-mounted', atMs: 900 },
          { stage: 'session-create-requested', atMs: 1_000 },
          { stage: 'ssh-connect-start', atMs: 1_100 },
          { stage: 'session-created', atMs: 1_050 },
        ],
      }),
    )
    const summary = await summarizeColdStartSamples(directory, {
      expectedSamples: 1,
    })
    assert.equal(summary.successes, 1)
    assert.deepEqual(summary.invalidSamples, [
      {
        sampleIndex: 1,
        violations: [
          'session-created@1050ms precedes ssh-connect-start@1100ms',
        ],
      },
    ])
  })
})

const provenanceFields = {
  sourceSha: 'b'.repeat(40),
  sourceParentSha: null,
  sourceParentShaSource: 'unknown',
  sourceParentShaReason: 'shallow-checkout',
}

test('fails closed when binary SHA values differ across samples', async () => {
  await withDirectory(async directory => {
    await writeSample(
      directory,
      'sample-1.json',
      successSample(1, provenanceFields),
    )
    await writeSample(
      directory,
      'sample-2.json',
      successSample(2, { ...provenanceFields, binarySha256: 'c'.repeat(64) }),
    )
    await assert.rejects(
      summarizeColdStartSamples(directory, { expectedSamples: 2 }),
      ColdStartSampleIntegrityError,
    )
  })
})

test('requires a binary SHA on every sample when provenance is mandatory', async () => {
  await withDirectory(async directory => {
    await writeSample(
      directory,
      'sample-1.json',
      successSample(1, { ...provenanceFields, binarySha256: undefined }),
    )
    await assert.rejects(
      summarizeColdStartSamples(directory, {
        expectedSamples: 1,
        requireProvenance: true,
      }),
      ColdStartSampleIntegrityError,
    )
  })
})

test('checks the expected binary, source, and timeout identities', async () => {
  await withDirectory(async directory => {
    await writeSample(
      directory,
      'sample-1.json',
      successSample(1, provenanceFields),
    )
    await assert.rejects(
      summarizeColdStartSamples(directory, {
        expectedSamples: 1,
        expectedBinarySha256: 'c'.repeat(64),
      }),
      ColdStartSampleIntegrityError,
    )
    await assert.rejects(
      summarizeColdStartSamples(directory, {
        expectedSamples: 1,
        expectedSourceSha: 'd'.repeat(40),
      }),
      ColdStartSampleIntegrityError,
    )
    await assert.rejects(
      summarizeColdStartSamples(directory, {
        expectedSamples: 1,
        expectedTimeoutMs: 4_000,
      }),
      ColdStartSampleIntegrityError,
    )
  })
})

test('rejects a successful remote sample that mounted a local terminal', async () => {
  await withDirectory(async directory => {
    await writeSample(
      directory,
      'sample-1.json',
      successSample(1, {
        ...provenanceFields,
        stages: [
          { stage: 'frontend-boot', atMs: 0 },
          { stage: 'ready', atMs: 500 },
          {
            stage: 'terminal-mounted',
            atMs: 900,
            detail: 'local-1@workspace@local',
          },
        ],
      }),
    )
    await assert.rejects(
      summarizeColdStartSamples(directory, {
        expectedSamples: 1,
        requireMount: 'remote',
      }),
      ColdStartSampleIntegrityError,
    )
  })
})

test('marks causal violations as an invalid measurement, not a pass', async () => {
  await withDirectory(async directory => {
    await writeSample(
      directory,
      'sample-1.json',
      successSample(1, {
        ...provenanceFields,
        stages: [
          { stage: 'frontend-boot', atMs: 0 },
          { stage: 'ready', atMs: 500 },
          {
            stage: 'terminal-mounted',
            atMs: 900,
            detail: 'remote-1@workspace@remote',
          },
          { stage: 'session-create-requested', atMs: 1_000 },
          { stage: 'ssh-connect-start', atMs: 1_100 },
          { stage: 'session-created', atMs: 1_050 },
        ],
      }),
    )
    const summary = await summarizeColdStartSamples(directory, {
      expectedSamples: 1,
    })
    assert.equal(summary.verdict, 'MEASUREMENT_INVALID')
  })
})

test('uses the final mount for the remote gate and keeps the first for analysis', async () => {
  await withDirectory(async directory => {
    await writeSample(
      directory,
      'sample-1.json',
      successSample(1, {
        ...provenanceFields,
        stages: [
          { stage: 'frontend-boot', atMs: 0 },
          { stage: 'ready', atMs: 500 },
          {
            stage: 'terminal-mounted',
            atMs: 900,
            detail: 'local-1@workspace@local',
          },
          {
            stage: 'terminal-mounted',
            atMs: 1_200,
            detail: 'remote-1@workspace@remote',
          },
          { stage: 'session-create-requested', atMs: 1_300 },
        ],
      }),
    )
    const summary = await summarizeColdStartSamples(directory, {
      expectedSamples: 1,
      requireMount: 'remote',
    })
    assert.deepEqual(summary.mountEvidence, { local: 1 })
    assert.deepEqual(summary.finalMountEvidence, { remote: 1 })
  })
})

test('finalMountedTerminalType reports the last mount', async () => {
  const sample = successSample(1, {
    stages: [
      { stage: 'terminal-mounted', atMs: 100, detail: 'local-1@ws@local' },
      { stage: 'terminal-mounted', atMs: 200, detail: 'remote-1@ws@remote' },
    ],
  })
  const { finalMountedTerminalType } = await import(
    './summarize-cold-start-samples.mjs'
  )
  assert.equal(finalMountedTerminalType(sample), 'remote')
})
