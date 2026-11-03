#!/usr/bin/env node
// One sample of the Phase 9.4 macOS cold-start stress run.
//
// The workflow loops this process instead of shell-parsing the stopwatch's
// human-readable output. A failed sample is still written as JSON so the
// summarizer can classify it rather than losing the only evidence it had.
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { runRemoteColdStartStopwatch } from './run-remote-cold-start-stopwatch.mjs'

const [sampleIndex, outputPath, appPath, timeoutArgument] = process.argv.slice(2)

if (
  sampleIndex === undefined
  || outputPath === undefined
  || appPath === undefined
) {
  console.error(
    'usage: run-cold-start-stress-sample.mjs <index> <output.json> <app-path> [timeout-ms]',
  )
  process.exit(2)
}

const timeoutMs =
  timeoutArgument === undefined ? 10_000 : Number(timeoutArgument)
if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
  console.error('timeout-ms must be a positive integer')
  process.exit(2)
}

const absoluteAppPath = path.resolve(appPath)
const capturedAt = new Date().toISOString()

try {
  const result = await runRemoteColdStartStopwatch({
    appPath: absoluteAppPath,
    timeoutMs,
  })
  await writeFile(
    outputPath,
    JSON.stringify({ ...result, sampleIndex: Number(sampleIndex), capturedAt }),
  )
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  await writeFile(
    outputPath,
    JSON.stringify({
      ok: false,
      sampleIndex: Number(sampleIndex),
      capturedAt,
      appPath: absoluteAppPath,
      timeoutMs,
      error: message,
    }),
  )
  process.exitCode = 1
}
