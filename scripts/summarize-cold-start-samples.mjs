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

function classificationOf(sample) {
  if (sample.ok === true) return 'ready'
  const message = typeof sample.error === 'string' ? sample.error : ''
  if (/no stage ever arrived/.test(message)) return 'webview-never-evaluated'
  if (/never reached db ready/.test(message)) return 'db-not-ready'
  if (/no terminal surface mounted/.test(message)) return 'terminal-not-mounted'
  if (/never requested the session/.test(message)) {
    return 'session-not-requested'
  }
  if (/failure is in the SSH\/shell path/.test(message)) return 'ssh-path'
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

export async function summarizeColdStartSamples(directory) {
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
    throw new Error(`no sample-*.json files in ${directory}`)
  }

  const samples = []
  for (const file of sampleFiles) {
    const parsed = JSON.parse(await readFile(path.join(directory, file), 'utf8'))
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
  for (const sample of samples) {
    const key = classificationOf(sample)
    classification[key] = (classification[key] ?? 0) + 1
  }

  return {
    generatedAt: new Date().toISOString(),
    samples: samples.length,
    successes: successes.length,
    failures: failures.length,
    successRate: successes.length / samples.length,
    durationMs: {
      min: durations[0] ?? null,
      median: percentile(durations, 0.5),
      p95: percentile(durations, 0.95),
      max: durations.at(-1) ?? null,
    },
    stagePresence: presence,
    classification,
    failureDetails: failures.map(sample => ({
      sampleIndex: sample.sampleIndex ?? null,
      capturedAt: sample.capturedAt ?? null,
      classification: classificationOf(sample),
      error: sample.error ?? null,
    })),
  }
}

function renderSummary(summary) {
  const lines = [
    `samples=${summary.samples} success=${summary.successes} failure=${summary.failures} successRate=${(summary.successRate * 100).toFixed(1)}%`,
    `durationMs min=${summary.durationMs.min} median=${summary.durationMs.median} p95=${summary.durationMs.p95} max=${summary.durationMs.max}`,
    `stagePresence=${JSON.stringify(summary.stagePresence)}`,
    `classification=${JSON.stringify(summary.classification)}`,
  ]
  for (const failure of summary.failureDetails) {
    lines.push(
      `failure sample=${failure.sampleIndex} class=${failure.classification} error=${failure.error ?? ''}`,
    )
  }
  return lines.join('\n')
}

const isDirectRun =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
  const directory = process.argv[2]
  if (directory === undefined) {
    console.error('usage: summarize-cold-start-samples.mjs <sample-directory>')
    process.exit(2)
  }
  try {
    const summary = await summarizeColdStartSamples(path.resolve(directory))
    console.log(JSON.stringify(summary, null, 2))
    console.error(renderSummary(summary))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
