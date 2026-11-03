#!/usr/bin/env node
// Turn the Phase 9.4 cold-start stress samples into one machine-readable summary.
//
// The point is not to turn a few successes into a reliability claim. It is to
// keep every failed sample, name the first stage it never reached, and make the
// denominator explicit so the report cannot quietly drop failures.
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const SAMPLE_PATTERN = /^sample-(\d+)\.json$/

// Measurement infrastructure, not product readiness. A sample file that never
// appears, appears twice, or cannot be parsed is a broken stress run: it must
// fail the workflow instead of shrinking the denominator.
export class ColdStartSampleIntegrityError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ColdStartSampleIntegrityError'
  }
}

function failClosed(message) {
  throw new ColdStartSampleIntegrityError(message)
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validateSample(value, fileName, expectedIndex) {
  if (!isRecord(value)) failClosed(`${fileName} is not a JSON object`)
  if (typeof value.ok !== 'boolean') {
    failClosed(`${fileName} has no boolean ok field`)
  }
  if (value.sampleIndex !== expectedIndex) {
    failClosed(
      `${fileName} carries sampleIndex=${JSON.stringify(value.sampleIndex)}, expected ${expectedIndex}`,
    )
  }
  if (typeof value.capturedAt !== 'string' || value.capturedAt.length === 0) {
    failClosed(`${fileName} has no capturedAt timestamp`)
  }
  // The 2026-11-03 post-fix samples were produced by a stopwatch that did not
  // copy the timeout into a successful result. Treat that field as missing
  // evidence, not as a damaged sample: the workflow-level TIMEOUT_MS is still
  // recorded in the provenance and every failure carries its own. A wrong type
  // is still rejected.
  if (
    value.timeoutMs !== undefined &&
    (typeof value.timeoutMs !== 'number' || value.timeoutMs <= 0)
  ) {
    failClosed(`${fileName} has an invalid timeoutMs`)
  }
  if (value.ok === true) {
    if (!Array.isArray(value.stages)) {
      failClosed(`${fileName} succeeded without a stages array`)
    }
    for (const stage of value.stages) {
      if (
        !isRecord(stage) ||
        typeof stage.stage !== 'string' ||
        typeof stage.atMs !== 'number'
      ) {
        failClosed(`${fileName} contains a malformed stage entry`)
      }
    }
    if (typeof value.spawnToReadyMs !== 'number') {
      failClosed(`${fileName} succeeded without spawnToReadyMs`)
    }
    return
  }
  if (typeof value.error !== 'string' || value.error.length === 0) {
    failClosed(`${fileName} failed without an error message`)
  }
}

function stageNames(sample) {
  if (Array.isArray(sample.stages)) {
    return sample.stages
      .map(stage => (typeof stage?.stage === 'string' ? stage.stage : null))
      .filter(Boolean)
  }
  // A failed stopwatch throws a message that still carries its timeline:
  // `stages: frontend-boot@0ms -> ready@1000ms`. Keep that evidence instead of
  // counting every failed sample as "no stage ever arrived".
  const message = typeof sample.error === 'string' ? sample.error : ''
  return [...message.matchAll(/([a-z][a-z0-9-]*)@\d+ms/g)].map(match => match[1])
}

/**
 * A timeline is only trustworthy when its repeated stages moved forward.
 *
 * `session-created` is written by the frontend after the backend command
 * resolves. Seeing it before `ssh-connect-start` means the awaited trace write
 * landed after the very operation it was supposed to precede, or that an
 * earlier stage line was lost. Either way the sample must not be counted as a
 * valid measurement of the SSH path.
 */
export function causalViolations(sample) {
  const stages = Array.isArray(sample.stages) ? sample.stages : []
  if (stages.length === 0) return []
  const at = name => stages.find(stage => stage?.stage === name)?.atMs
  const violations = []
  const requested = at('session-create-requested')
  const created = at('session-created')
  const connect = at('ssh-connect-start')
  if (created !== undefined && connect !== undefined && created < connect) {
    violations.push(
      `session-created@${created}ms precedes ssh-connect-start@${connect}ms`,
    )
  }
  if (
    requested !== undefined &&
    connect !== undefined &&
    requested > connect
  ) {
    violations.push(
      `session-create-requested@${requested}ms follows ssh-connect-start@${connect}ms`,
    )
  }
  return violations
}

function classificationOf(sample) {
  if (sample.ok === true) return 'ready'
  const message = typeof sample.error === 'string' ? sample.error : ''
  if (/no stage ever arrived/.test(message)) return 'webview-never-evaluated'
  if (/never reached db ready/.test(message)) return 'db-not-ready'
  if (/no terminal surface mounted/.test(message)) return 'terminal-not-mounted'
  if (/never requested the session/.test(message)) {
    return 'session-not-requested'
  }
  if (/failure is in the SSH\/shell path/.test(message)) {
    // The stopwatch's message only proves "the session promise resolved but the
    // prompt marker did not". Name the deepest stage the product actually
    // reported so a request that never entered Rust is not counted as an
    // authentication or PTY failure.
    const names = stageNames(sample)
    if (!names.includes('session-create-requested')) {
      return 'ssh-not-requested'
    }
    if (!names.includes('ssh-connect-start')) {
      return 'ssh-request-not-entered-rust'
    }
    if (!names.includes('ssh-tcp-handshake-done')) return 'ssh-tcp-pending'
    if (!names.includes('ssh-auth-done')) return 'ssh-auth-pending'
    if (!names.includes('ssh-pty-ready')) return 'ssh-pty-pending'
    if (!names.includes('ssh-shell-first-output')) {
      return 'ssh-shell-no-output'
    }
    return 'ssh-prompt-marker-missing'
  }
  return 'unclassified'
}

function percentile(sorted, fraction) {
  if (sorted.length === 0) return null
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * fraction) - 1),
  )
  return sorted[index]
}

export async function summarizeColdStartSamples(
  directory,
  { expectedSamples } = {},
) {
  const entries = await readdir(directory, { withFileTypes: true })
  const sampleFiles = entries
    .filter(entry => entry.isFile() && SAMPLE_PATTERN.test(entry.name))
    .map(entry => entry.name)
    .sort((left, right) => {
      const a = Number(SAMPLE_PATTERN.exec(left)?.[1] ?? 0)
      const b = Number(SAMPLE_PATTERN.exec(right)?.[1] ?? 0)
      return a - b
    })
  if (sampleFiles.length === 0) {
    failClosed(`no sample-*.json files in ${directory}`)
  }

  const byIndex = new Map()
  for (const file of sampleFiles) {
    const index = Number(SAMPLE_PATTERN.exec(file)?.[1])
    if (byIndex.has(index)) {
      failClosed(
        `duplicate sample index ${index}: ${byIndex.get(index)} and ${file}`,
      )
    }
    byIndex.set(index, file)
  }
  if (byIndex.size !== sampleFiles.length) {
    failClosed('duplicate sample indices in the sample directory')
  }
  const highestIndex = Math.max(...byIndex.keys())
  if (highestIndex !== sampleFiles.length) {
    failClosed(
      `sample numbering is not contiguous 1..N: ${sampleFiles.length} file(s), highest index ${highestIndex}`,
    )
  }
  if (expectedSamples !== undefined) {
    if (!Number.isSafeInteger(expectedSamples) || expectedSamples < 1) {
      failClosed('expectedSamples must be a positive integer')
    }
    if (sampleFiles.length !== expectedSamples) {
      const missing = []
      for (let index = 1; index <= expectedSamples; index += 1) {
        if (!byIndex.has(index)) missing.push(index)
      }
      failClosed(
        `expected ${expectedSamples} samples, found ${sampleFiles.length}` +
          (missing.length === 0
            ? ''
            : `; missing indices: ${missing.slice(0, 20).join(',')}${missing.length > 20 ? ` (+${missing.length - 20} more)` : ''}`),
      )
    }
  }

  const samples = []
  for (const file of sampleFiles) {
    const expectedIndex = Number(SAMPLE_PATTERN.exec(file)?.[1])
    let parsed
    try {
      parsed = JSON.parse(await readFile(path.join(directory, file), 'utf8'))
    } catch (error) {
      failClosed(
        `${file} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    validateSample(parsed, file, expectedIndex)
    samples.push(parsed)
  }

  const successes = samples.filter(sample => sample.ok === true)
  const failures = samples.filter(sample => sample.ok !== true)
  const durations = successes
    .map(sample => sample.spawnToReadyMs)
    .filter(value => typeof value === 'number' && Number.isFinite(value))
    .sort((a, b) => a - b)
  const presence = {
    frontendBoot: 0,
    ready: 0,
    terminalMounted: 0,
    sessionRequested: 0,
    sessionCreated: 0,
  }
  for (const sample of samples) {
    const names = stageNames(sample)
    if (names.includes('frontend-boot')) presence.frontendBoot += 1
    if (names.includes('ready')) presence.ready += 1
    if (names.includes('terminal-mounted')) presence.terminalMounted += 1
    if (names.includes('session-create-requested')) presence.sessionRequested += 1
    if (names.includes('session-created')) presence.sessionCreated += 1
  }

  const classification = {}
  const invalidSamples = []
  for (const sample of samples) {
    const key = classificationOf(sample)
    classification[key] = (classification[key] ?? 0) + 1
    const violations = causalViolations(sample)
    if (violations.length > 0) {
      invalidSamples.push({
        sampleIndex: sample.sampleIndex,
        violations,
      })
    }
  }

  const verdict =
    failures.length > 0
      ? 'MEASUREMENT_COMPLETE_WITH_FAILURES'
      : 'RELIABILITY_PASS'

  return {
    generatedAt: new Date().toISOString(),
    expectedSamples: expectedSamples ?? samples.length,
    samples: samples.length,
    successes: successes.length,
    failures: failures.length,
    verdict,
    successRate: successes.length / samples.length,
    durationMs: {
      min: durations[0] ?? null,
      median: percentile(durations, 0.5),
      p95: percentile(durations, 0.95),
      max: durations.at(-1) ?? null,
    },
    stagePresence: presence,
    classification,
    invalidSamples,
    failureDetails: failures.map(sample => ({
      sampleIndex: sample.sampleIndex ?? null,
      capturedAt: sample.capturedAt ?? null,
      timeoutMs: sample.timeoutMs ?? null,
      binarySha256: sample.binarySha256 ?? null,
      classification: classificationOf(sample),
      lastStage: stageNames(sample).at(-1) ?? null,
      error: sample.error ?? null,
    })),
  }
}

/**
 * A green workflow icon must not stand in for a reliability claim.
 *
 * A run that preserves product failures is still a complete measurement, but
 * it says nothing positive about reliability and gets its own status.
 */
export function reliabilityVerdict(summary) {
  return summary.failures > 0
    ? 'MEASUREMENT_COMPLETE_WITH_FAILURES'
    : 'RELIABILITY_PASS'
}

function renderSummary(summary, verdict) {
  const lines = [
    `verdict=${verdict}`,
    `samples=${summary.samples}/${summary.expectedSamples} success=${summary.successes} failure=${summary.failures} successRate=${(summary.successRate * 100).toFixed(1)}%`,
    `durationMs min=${summary.durationMs.min} median=${summary.durationMs.median} p95=${summary.durationMs.p95} max=${summary.durationMs.max}`,
    `stagePresence=${JSON.stringify(summary.stagePresence)}`,
    `classification=${JSON.stringify(summary.classification)}`,
  ]
  for (const failure of summary.failureDetails) {
    lines.push(
      `failure sample=${failure.sampleIndex} class=${failure.classification} lastStage=${failure.lastStage ?? 'none'} timeoutMs=${failure.timeoutMs ?? 'unknown'} binarySha256=${failure.binarySha256 ?? 'unknown'} error=${failure.error ?? ''}`,
    )
  }
  return lines.join('\n')
}

const isDirectRun =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
  const argv = process.argv.slice(2)
  const expectedArgument = argv.includes('--expected-samples')
    ? argv[argv.indexOf('--expected-samples') + 1]
    : undefined
  const expectedFlagIndex = argv.indexOf('--expected-samples')
  const directory = argv.find(
    (argument, index) =>
      !argument.startsWith('--') &&
      !(expectedFlagIndex !== -1 && index === expectedFlagIndex + 1),
  )
  if (directory === undefined) {
    console.error(
      'usage: summarize-cold-start-samples.mjs <sample-directory> [--expected-samples N]',
    )
    process.exit(2)
  }
  const expectedSamples =
    expectedArgument === undefined ? undefined : Number(expectedArgument)
  try {
    const summary = await summarizeColdStartSamples(path.resolve(directory), {
      expectedSamples,
    })
    const verdict = reliabilityVerdict(summary)
    console.log(JSON.stringify(summary, null, 2))
    console.error(renderSummary(summary, verdict))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(error instanceof ColdStartSampleIntegrityError ? 3 : 1)
  }
}
