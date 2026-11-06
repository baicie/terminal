#!/usr/bin/env node
// Cross-sample isolation gate for the macOS cold-start stress workflow.
//
// The forced sample is deliberately given a 1 ms readiness budget. The control
// sample then runs on the same binary with the normal budget. A pass means the
// timeout did not leak a process, a temporary home, an SSH fixture port, or a
// recovery journal into the next sample.
import { access, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const directory = process.argv[2]
if (directory === undefined) {
  console.error(
    'usage: verify-cold-start-isolation.mjs <isolation-directory>',
  )
  process.exit(2)
}

const read = async name =>
  JSON.parse(await readFile(path.join(directory, name), 'utf8'))

const forced = await read('forced.json')
const control = await read('control.json')
const problems = []

if (forced.ok !== false) {
  problems.push('the forced-timeout sample unexpectedly succeeded')
}
if (typeof forced.binarySha256 !== 'string' || !/^[a-f0-9]{64}$/.test(forced.binarySha256)) {
  problems.push('the forced-timeout sample has no verifiable binarySha256')
}
if (control.binarySha256 !== forced.binarySha256) {
  problems.push('the control and forced samples used different binaries')
}
// The control is an isolation witness, not a product-readiness assertion.
// It must prove that the next sample got a fresh fixture and really entered
// the remote path; a prompt-marker timeout after `ssh-connect-start` is a
// product measurement for the 300-sample denominator, not contamination.
const controlStages = Array.isArray(control.stages) ? control.stages : []
const controlMount = controlStages.find(
  stage => stage?.stage === 'terminal-mounted',
)
const controlMountDetail =
  typeof controlMount?.detail === 'string' ? controlMount.detail : ''
const controlMountedRemote = controlMountDetail.endsWith('@remote')
const controlEnteredSsh = controlStages.some(
  stage => stage?.stage === 'ssh-connect-start',
)
if (!controlMountedRemote) {
  problems.push('the control sample did not mount a remote terminal')
}
if (!controlEnteredSsh) {
  problems.push('the control sample did not enter the SSH path')
}
if (!forced.fixture || !control.fixture) {
  problems.push('fixture metadata is missing from one of the samples')
} else if (forced.fixture.port === control.fixture.port) {
  problems.push('the control sample reused the forced sample SSH fixture port')
}
for (const [name, directoryPath] of Object.entries(
  forced.tempDirectories ?? {},
)) {
  try {
    await access(directoryPath)
    problems.push(`the forced sample left ${name} behind: ${directoryPath}`)
  } catch {
    // Expected: the sample's finally block removed it.
  }
}
if (
  Array.isArray(forced.cleanupErrors) &&
  forced.cleanupErrors.length > 0
) {
  problems.push(`the forced sample reported cleanup errors: ${forced.cleanupErrors.join('; ')}`)
}

const result = {
  verdict: problems.length === 0 ? 'ISOLATION_PASS' : 'ISOLATION_FAIL',
  problems,
  forced: {
    ok: forced.ok,
    binarySha256: forced.binarySha256 ?? null,
    fixturePort: forced.fixture?.port ?? null,
  },
  control: {
    ok: control.ok,
    binarySha256: control.binarySha256 ?? null,
    fixturePort: control.fixture?.port ?? null,
    mountedRemote: controlMountedRemote,
    enteredSsh: controlEnteredSsh,
    ...(typeof control.error === 'string' ? { error: control.error } : {}),
  },
}
await writeFile(
  path.join(directory, 'result.json'),
  JSON.stringify(result, null, 2),
)
console.log(JSON.stringify(result, null, 2))
if (problems.length > 0) process.exit(1)
