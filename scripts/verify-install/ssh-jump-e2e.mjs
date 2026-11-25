#!/usr/bin/env node
/**
 * SSH12 — start two real OpenSSH daemons and drive the product's Rust jump path.
 *
 * ## What this proves that unit tests cannot
 *
 * Every test of `connect_via_jump_inner` so far has been a unit test: the bastion is a
 * mock handle, the tunnel is a stub channel, `check_server_key` is never called. The
 * attribution SSH07–SSH09 added is only meaningful if it survives a **real** two-hop
 * handshake — a real `direct-tcpip` channel, a real target key, a real refusal.
 *
 * So this starts:
 *
 *   bastion  — `AllowTcpForwarding yes`, `PermitOpen 127.0.0.1:<target>`
 *   target   — `DisableForwarding yes`, its own host key
 *
 * and runs `src-tauri/src/ssh_jump_e2e_tests.rs` against them through
 * `TerminalSession::new_with_jump`, which is what the Tauri command calls.
 *
 * ## What is NOT covered
 *
 * The Tauri command wrapper (argument validation, `AppHandle`), and the frontend. This
 * is a Rust-level test — see the report's `SSH12_LEVEL` field.
 *
 * ## Usage
 *
 *   node scripts/verify-install/ssh-jump-e2e.mjs
 *   SSH_JUMP_E2E_REPORT=path.json node scripts/verify-install/ssh-jump-e2e.mjs
 */
import process from 'node:process'
import path from 'node:path'
import os from 'node:os'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { launchProcess, stopProcess } from './process-lifecycle.mjs'
import { startTerminalSmokeSshd } from '../terminal-smoke-sshd.mjs'

const PROJECT_ROOT = path.resolve(import.meta.dirname, '..', '..')

/** Report shape, so CI can tell PASS from NOT_RUN without parsing stdout. */
const report = {
  case: 'ssh12-jump-e2e',
  level: 'rust-command-level',
  bastion: null,
  target: null,
  bastionB: null,
  targetB: null,
  verdict: 'NOT_RUN',
  cases: [],
  notes: [],
}

function finish(verdict, detail) {
  report.verdict = verdict
  if (detail) report.notes.push(detail)
  if (process.env.SSH_JUMP_E2E_REPORT) {
    mkdirSync(path.dirname(path.resolve(process.env.SSH_JUMP_E2E_REPORT)), {
      recursive: true,
    })
    writeFileSync(
      path.resolve(process.env.SSH_JUMP_E2E_REPORT),
      `${JSON.stringify(report, null, 2)}\n`,
    )
  }
  console.log(`\n[ssh12] verdict: ${verdict}`)
  for (const note of report.notes) console.log(`[ssh12] ${note}`)
}

async function main() {
  if (process.platform !== 'darwin' && process.platform !== 'linux') {
    report.notes.push('SSHD_FIXTURE_UNAVAILABLE: this harness needs /usr/sbin/sshd')
    finish('NOT_RUN')
    return
  }

  const runDirectory = mkdtempSync(path.join(os.homedir(), '.tmp-ssh12-'))
  const daemons = []
  try {
    /*
     * The target first: the bastion's `PermitOpen` has to name the port the target will
     * actually listen on, so the target must have picked one before the bastion starts.
     */
    const target = await startTerminalSmokeSshd({
      runDirectory: path.join(runDirectory, 'target'),
      mode: 'key',
      role: 'target',
      shell: 'sh',
    })
    daemons.push(target)
    report.target = { port: target.port }

    const bastion = await startTerminalSmokeSshd({
      runDirectory: path.join(runDirectory, 'bastion'),
      mode: 'key',
      role: 'jump',
      shell: 'sh',
      targetPort: target.port,
    })
    daemons.push(bastion)
    report.bastion = { port: bastion.port }

    /*
     * F11 — a second bastion/target pair, for the identity-isolation matrix.
     *
     * Four daemons rather than two, because the question the matrix asks is whether a
     * credential can end up on the wrong machine, and that is unanswerable with one of
     * each. Target B is reachable through **both** bastions; bastion B reaches target A.
     * The test connects along every one of those paths and checks which key worked.
     *
     * Started unconditionally: a case that silently skipped for want of a fixture is what
     * this repository keeps recording as a false green. If a daemon cannot start, that is
     * a harness failure and the run says so.
     */
    const targetB = await startTerminalSmokeSshd({
      runDirectory: path.join(runDirectory, 'target-b'),
      mode: 'key',
      role: 'target',
      shell: 'sh',
    })
    daemons.push(targetB)
    report.targetB = { port: targetB.port }

    const bastionB = await startTerminalSmokeSshd({
      runDirectory: path.join(runDirectory, 'bastion-b'),
      mode: 'key',
      role: 'jump',
      shell: 'sh',
      targetPort: targetB.port,
    })
    daemons.push(bastionB)
    report.bastionB = { port: bastionB.port }
    console.log(
      `[ssh12] bastion 127.0.0.1:${bastion.port} -> target 127.0.0.1:${target.port}`,
    )

    console.log(`[ssh12] env: bastion=${bastion.port} target=${target.port} key=${String(bastion.privateKey).slice(0, 24)}...`)
    const cargo = launchProcess(
      'cargo',
      [
        'test',
        '--lib',
        'ssh_jump_e2e_tests',
        '--',
        '--ignored',
        '--nocapture',
        '--test-threads=1',
      ],
      {
        cwd: path.join(PROJECT_ROOT, 'src-tauri'),
        detached: true,
        env: {
          ...process.env,
          SSH_JUMP_E2E_BASTION_PORT: String(bastion.port),
          SSH_JUMP_E2E_TARGET_PORT: String(target.port),
          SSH_JUMP_E2E_USER: os.userInfo().username,
          SSH_JUMP_E2E_BASTION_KEY: bastion.privateKey,
          SSH_JUMP_E2E_TARGET_KEY: target.privateKey,
          // `expectedHostKey` is a russh `PublicKey`; its `toString()` is the OpenSSH
          // one-line form, which is what `PublicKey::from_openssh` on the Rust side reads.
          SSH_JUMP_E2E_TARGET_HOST_KEY: target.expectedHostKey
            ? target.expectedHostKey.toString()
            : '',
          SSH_JUMP_E2E_B_PORT: String(bastionB.port),
          SSH_JUMP_E2E_B_TARGET_PORT: String(targetB.port),
          SSH_JUMP_E2E_B_BASTION_KEY: bastionB.privateKey,
          SSH_JUMP_E2E_B_TARGET_KEY: targetB.privateKey,
          SSH_JUMP_E2E_B_TARGET_HOST_KEY: targetB.expectedHostKey
            ? targetB.expectedHostKey.toString()
            : '',
          SSH_JUMP_E2E_B_BASTION_HOST_KEY: bastionB.expectedHostKey
            ? bastionB.expectedHostKey.toString()
            : '',
          SSH_JUMP_E2E_BASTION_HOST_KEY: bastion.expectedHostKey
            ? bastion.expectedHostKey.toString()
            : '',
        },
      },
    )
    const result = await waitForTests(cargo, Number(process.env.SSH_JUMP_E2E_TIMEOUT_MS ?? 300_000))
    process.stdout.write(result.stdout)
    if (result.stderr.trim() !== '') process.stderr.write(result.stderr)

    /*
     * The verdict comes from the test binary's own summary, not from the exit code
     * alone: `cargo test` exits 0 with "0 passed" when a filter matches nothing, which
     * is exactly the shape that turns a broken harness into a green run.
     */
    const passed = Number(/test result: ok\. (\d+) passed/.exec(result.stdout)?.[1] ?? 0)
    const failed = Number(/(\d+) failed/.exec(result.stdout)?.[1] ?? 0)
    report.cases = parseCaseNames(result.stdout)
    if (result.timedOut) {
      report.notes.push(`TIMEOUT after ${process.env.SSH_JUMP_E2E_TIMEOUT_MS ?? 300_000} ms`)
      finish('FAIL')
    } else if (failed > 0) {
      finish('FAIL')
    } else if (passed === 0) {
      report.notes.push('NO_TEST_RAN: the filter matched nothing, which is not a pass')
      finish('FAIL')
    } else if (result.stdout.includes('SSH_JUMP_E2E_* not set; skipping')) {
      /*
       * A case that returns early still prints `ok`, so libtest counts it as a pass.
       * The first version of this harness reported PASS while both cases skipped —
       * measured, on the very run that was supposed to prove the attribution works.
       * The skip is now a distinct verdict; `NOT_RUN` is the honest word for it.
       */
      report.notes.push(
        'SKIPPED: the cases ran but the fixture was absent, which is NOT_RUN and not a pass',
      )
      finish('NOT_RUN')
    } else {
      finish('PASS')
    }
  } finally {
    for (const daemon of daemons.reverse()) {
      try {
        await daemon.stop()
      } catch (error) {
        report.notes.push(`cleanup failed for a daemon: ${error.message}`)
      }
    }
    await rm(runDirectory, { recursive: true, force: true })
  }
}

/**
 * Every `test <path> ... ok` line, so a reader sees which cases ran.
 *
 * The path is the module path libtest prints — `session::ssh::ssh_jump_e2e_tests::name`
 * — not the bare name. The first version matched `^test ssh_jump_e2e_tests::` and so
 * matched nothing: `report.cases` was `[]` on every run, including a PASS. A report that
 * cannot list the cases it ran is not evidence that any case ran.
 */
export function parseCaseNames(stdout) {
  return stdout
    .split('\n')
    .map(line => /^test (\S*ssh_jump_e2e_tests::\S+) \.\.\. (ok|FAILED)/.exec(line.trim()))
    .filter(Boolean)
    .map(match => ({ name: match[1], outcome: match[2] }))
}

/**
 * Wait for the test process, bounded, on real exit.
 *
 * The same rule the SFTP harness learned: a deadline that only reaches the direct child
 * leaves the test binary orphaned with the pipes still open, so the wait never ends.
 */
async function waitForTests(child, timeoutMs) {
  const exited = await Promise.race([
    child.lifecycle.exitPromise.then(() => 'exited'),
    new Promise(resolve => setTimeout(() => resolve('timeout'), timeoutMs)),
  ])
  if (exited === 'timeout') {
    /*
     * Signal the **group**. `detached: true` makes the cargo process its own group leader,
     * so `kill(-pid)` reaches the test binary cargo forked. Killing cargo alone orphans that
     * binary to init (PPID 1) — it keeps running and, worse, keeps the inherited stdout
     * pipe open. Proven in this session: `execFile`'s `timeout` + `killSignal: 'SIGKILL'`
     * left a `sleep 300` grandchild alive with PPID 1.
     */
    const pid = child.pid
    if (pid) {
      try {
        process.kill(-pid, 'SIGKILL')
      } catch {
        // The group is already gone; the per-process stop below still runs.
      }
    }
    await stopProcess(child, { waitMs: 5_000, killWaitMs: 5_000 })
    return {
      timedOut: true,
      code: null,
      stdout: child.lifecycle.output.join(''),
      stderr: '',
    }
  }
  // Real exit observed: give `close` a moment for the pipes to drain, but never wait on it
  // as proof of exit — that was the R02 defect.
  await Promise.race([
    child.lifecycle.closePromise,
    new Promise(resolve => setTimeout(resolve, 2_000)),
  ])
  /*
   * ## Destroying the pipes is what lets this process exit
   *
   * Measured: the first version of this function returned here without touching the
   * streams, and the harness printed `PASS` and then **never exited** — the raw pipe handles
   * stay referenced even after the child is gone, and `process.exitCode` does not force an
   * exit while a handle is alive. `execFile` destroys them internally; `launchProcess` hands
   * the streams to the caller, so the caller owns that duty.
   *
   * The exit did not come from `detached` (removing it changed nothing) and not from the
   * timeout (a minimal `execFile` + `timeout` change exited in 30 s). It came from here.
   */
  child.stdout?.destroy()
  child.stderr?.destroy()
  return {
    timedOut: false,
    code: child.lifecycle.exitCode,
    // stdout and stderr are interleaved on purpose: `launchProcess` pushes both into one
    // array so ordering is preserved, and libtest writes its `test result:` lines to
    // stdout while panic output goes to stderr. Splitting them would reorder the evidence.
    stdout: child.lifecycle.output.join(''),
    stderr: '',
  }
}


/*
 * Run only when this file is the entry point.
 *
 * Nothing else imported it until the case-name parser got a unit test, and an
 * unconditional `main()` made that import start two sshd daemons and a cargo build —
 * the test hung until the runner killed it. Same guard the other harnesses use.
 */
const isDirectRun =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isDirectRun) {
  main().catch(error => {
    report.notes.push(`HARNESS_ERROR: ${error.message}`)
    finish('FAIL')
    process.exitCode = 1
  })
}
