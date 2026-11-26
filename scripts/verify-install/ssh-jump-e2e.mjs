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
import { startShapingProxy } from '../sftp-shaping-proxy.mjs'
import { summariseCurve } from '../ssh-soak-curve.mjs'

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
  /**
   * F17 — the resource curve, when the run measured one.
   *
   * Absent on a normal PR run (12 rounds is a lifecycle regression, not a curve) and on
   * platforms that cannot measure themselves. Present on the manually dispatched soak.
   */
  curve: null,
}

/**
 * Read the per-round samples the Rust case prints.
 *
 * The format is `SSH_SOAK_METRICS round=<n> rss=<bytes> fds=<count>`, emitted after the
 * round is fully closed. Parsing it here rather than computing anything in Rust keeps
 * the decision in one place — `ssh-soak-curve.mjs` — where it is unit-tested.
 */
export function parseSoakMetrics(stdout) {
  const rss = []
  const fds = []
  const pattern = /SSH_SOAK_METRICS round=(\d+) rss=(\d+) fds=(\d+)/g
  for (const match of stdout.matchAll(pattern)) {
    const round = Number(match[1])
    // Round 0 is the baseline taken before any connection; it belongs in the series.
    if (round === 0 && rss.length > 0) continue
    rss.push(Number(match[2]))
    fds.push(Number(match[3]))
  }
  return { rss, fds }
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
  /*
   * ## A FAIL verdict has to fail the process
   *
   * Measured on run 45758649504: `finish('FAIL')` printed the verdict, wrote the report,
   * and returned — and the `Real SSH jump matrix` job went green while all three
   * disconnect scenarios had failed. Only the `main().catch` path set an exit code, so
   * every verdict reached through the normal flow was advisory.
   *
   * `NOT_RUN` is deliberately not a failure: a platform without `sshd` is a missing
   * precondition, and the job's own contract (see `ci.yml`) treats it as such.
   */
  if (verdict === 'FAIL') process.exitCode = 1
}

async function main() {
  if (process.platform !== 'darwin' && process.platform !== 'linux') {
    report.notes.push('SSHD_FIXTURE_UNAVAILABLE: this harness needs /usr/sbin/sshd')
    finish('NOT_RUN')
    return
  }

  const runDirectory = mkdtempSync(path.join(os.homedir(), '.tmp-ssh12-'))
  const daemons = []
  const proxies = []
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

    /*
     * F11 — bastion A may reach **both** targets.
     *
     * The isolation matrix asks whether a credential can end up on the wrong machine, and
     * that question only has an answer if the bastion is allowed to go to the wrong one.
     * With `PermitOpen` naming a single address, "the connection reached target B" is
     * impossible rather than isolated, and the case would pass on a product that never
     * isolated anything.
     */
    /*
     * F11 — target B is created **before** bastion A, because bastion A has to be
     * configured with every address it may forward to, and that list includes target B.
     *
     * The isolation matrix asks whether a credential can end up on the wrong machine, and
     * that question only has an answer if the bastion is *allowed* to reach the wrong one.
     * A `PermitOpen` naming a single address makes "reached the other target" impossible
     * rather than isolated, and the case would then pass on a product that never isolated
     * anything.
     */
    const targetB = await startTerminalSmokeSshd({
      runDirectory: path.join(runDirectory, 'target-b'),
      mode: 'key',
      role: 'target',
      shell: 'sh',
    })
    daemons.push(targetB)
    report.targetB = { port: targetB.port }

    const bastion = await startTerminalSmokeSshd({
      runDirectory: path.join(runDirectory, 'bastion'),
      mode: 'key',
      role: 'jump',
      shell: 'sh',
      targetPort: target.port,
      targetPorts: [target.port, targetB.port],
    })
    daemons.push(bastion)
    report.bastion = { port: bastion.port }



    const bastionB = await startTerminalSmokeSshd({
      runDirectory: path.join(runDirectory, 'bastion-b'),
      mode: 'key',
      role: 'jump',
      shell: 'sh',
      targetPort: targetB.port,
      // Bastion B may also reach target A, so "the same target through either bastion"
      // is a real question rather than one the configuration makes impossible.
      targetPorts: [targetB.port, target.port],
    })
    daemons.push(bastionB)
    report.bastionB = { port: bastionB.port }
    console.log(
      `[ssh12] bastion 127.0.0.1:${bastion.port} -> targets ${target.port}/${targetB.port}, ` +
        `bastion-b 127.0.0.1:${bastionB.port} -> targets ${targetB.port}/${target.port}`,
    )

    /*
     * F12 — a proxy in front of each daemon, so a case can break a *specific* leg at a
     * *specific* moment.
     *
     * The scenarios are the ones `sftp-shaping-proxy.mjs` already implements and tests:
     * `resetAfterMs` kills the connection mid-handshake, `cutAfterBytes` breaks a stream
     * that was working, `blackhole` accepts and says nothing. Injecting them at the
     * proxy rather than inside a daemon keeps the daemons real and the injection honest:
     * the product sees exactly what a network fault looks like.
     *
     * One proxy per leg, because "which transport was interrupted" is the whole question a
     * disconnect matrix has to answer. A single shared proxy could only say "something
     * broke".
     */
    const targetProxy = await startShapingProxy({ targetPort: target.port })
    const bastionProxy = await startShapingProxy({ targetPort: bastion.port })
    proxies.push(targetProxy, bastionProxy)
    report.proxies = {
      target: { port: targetProxy.port },
      bastion: { port: bastionProxy.port },
    }

    console.log(`[ssh12] env: bastion=${bastion.port} target=${target.port} key=${String(bastion.privateKey).slice(0, 24)}...`)
    /*
     * One source for the fixture environment, because the disconnect matrix below runs
     * cargo again per scenario. The first version of that matrix referenced a helper that
     * did not exist (`fixtureEnvironment()`); sharing this object is what keeps the two
     * invocations from drifting — a scenario run that forgot `SSH_JUMP_E2E_TARGET_PORT`
     * would fail for a reason that has nothing to do with the injected fault.
     */
    const fixtureEnvironment = {
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
      SSH_JUMP_E2E_BASTION_PROXY_PORT: String(bastionProxy.port),
      SSH_JUMP_E2E_TARGET_PROXY_PORT: String(targetProxy.port),
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
    }
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
        env: fixtureEnvironment,
      },
    )
    /*
     * ## F12 — the disconnect matrix, one proxy per scenario
     *
     * Each scenario needs a *fresh* proxy: a proxy that already cut one connection is not
     * the clean fault injector the next one needs (`resetAfterMs` fires once, per
     * connection, but a partially-consumed `cutAfterBytes` budget is not reusable).
     *
     * They also need a *separate* cargo invocation with `SSH_JUMP_E2E_SCENARIO` set,
     * because the case reads its scenario from the environment. Rather than run cargo
     * five times for five scenarios inside the main invocation, the matrix runs here and
     * its results land in `report.disconnectMatrix`.
     */
    const result = await waitForTests(cargo, Number(process.env.SSH_JUMP_E2E_TIMEOUT_MS ?? 300_000))
    process.stdout.write(result.stdout)
    if (result.stderr.trim() !== '') process.stderr.write(result.stderr)
    /*
     * ## The matrix runs AFTER the main invocation
     *
     * Ordering is right even though it turned out not to be the whole fix.
     *
     * Measured on run 45758649504, the matrix ran first and its three scenarios failed
     * with `failed to run custom build command for gobject-sys`. That looked like a
     * build race, and moving the matrix after the main build is what a race would call
     * for — but run 45763897639, with the move in place, failed identically *before* the
     * main invocation had produced any binary:
     *
     *     pkg-config --libs --cflags glib-2.0 → Package glib-2.0 was not found
     *
     * The real cause was that `ci.yml`'s `real-ssh-jump` job never installed the Tauri
     * system libraries, so `cargo test --lib` could not compile the WebKit stack at all.
     * That is fixed in the workflow.
     *
     * The ordering stays: running on an already-built tree means a scenario failure is
     * a product result rather than a compile error, which is what makes the verdict
     * mean something.
     */
    report.disconnectMatrix = []
    const scenarios = [
      { name: 'healthy', proxy: {} },
      // The bastion accepts and forwards nothing: the client's own deadline is the only
      // thing that can end this, so the case asserts it ends rather than hangs.
      { name: 'blackhole', proxy: { blackhole: true } },
      /*
       * Destroyed after a small amount of traffic, which lands during the handshake.
       *
       * `resetAfterMs` was the first choice and it did not fire: measured on a local run,
       * a healthy two-hop connection completes in **97 ms**, so a 250 ms timer never ran
       * before the socket closed on its own (`cut: 0` in the report, and the scenario
       * failed for a reason that had nothing to do with the product). A byte threshold
       * has no such race — the handshake always moves bytes, so this cuts inside it.
       */
      { name: 'reset', proxy: { cutAfterBytes: { up: 512, down: 512 } } },
    ]
    const runScenario = async scenario => {
      const proxy = await startShapingProxy({
        targetPort: bastion.port,
        ...scenario.proxy,
      })
      proxies.push(proxy)
      try {
        const run = launchProcess(
          'cargo',
          [
            'test',
            '--lib',
            'an_injected_fault_names_its_own_leg_and_no_more',
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
              ...fixtureEnvironment,
              SSH_JUMP_E2E_BASTION_PROXY_PORT: String(proxy.port),
              SSH_JUMP_E2E_SCENARIO: scenario.name,
            },
          },
        )
        const outcome = await waitForTests(run, Number(process.env.SSH_JUMP_E2E_SCENARIO_TIMEOUT_MS ?? 120_000))
        const ok = /test result: ok\. 1 passed/.test(outcome.stdout)
        /*
         * Print the scenario's output either way.
         *
         * Measured on the first real run: the matrix reported `scenario reset failed` and
         * nothing else — the cargo output was captured and discarded, so the reason (the
         * proxy never fired, the hop was wrong, the case panicked) was not recoverable
         * from the log. A scenario that fails silently is not a diagnosis.
         */
        if (!ok) {
          process.stdout.write(`[ssh12] scenario ${scenario.name} output:\n${outcome.stdout}`)
          if (outcome.stderr.trim() !== '') process.stderr.write(outcome.stderr)
        }
        report.disconnectMatrix.push({
          scenario: scenario.name,
          proxyPort: proxy.port,
          passed: ok,
          cut: proxy.stats.cut,
          accepted: proxy.stats.accepted,
          note: ok ? null : (outcome.timedOut ? 'TIMEOUT' : 'the case failed'),
        })
        return ok
      } finally {
        await proxy.close()
      }
    }
    for (const scenario of scenarios) {
      const ok = await runScenario(scenario)
      if (!ok) {
        report.notes.push(`DISCONNECT_MATRIX: scenario ${scenario.name} failed`)
      }
    }



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
    } else if (report.disconnectMatrix.some(entry => !entry.passed)) {
      /*
       * F12 — a failed injected-fault scenario fails the harness.
       *
       * It is checked before the generic PASS branch because the matrix runs in its own
       * cargo invocations: their exit codes never reach `failed` above, so without this
       * line a scenario that reported the wrong hop would be recorded in the report and
       * still finish PASS. A recorded-but-ignored result is worse than no matrix.
       */
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
      /*
       * F17 — judge the curve before declaring PASS.
       *
       * Only when the run produced one: a 12-round PR regression prints samples too, but
       * 12 is below the minimum-sample rule and would report INSUFFICIENT_DATA, which is
       * correct and not a failure. The curve never fails this harness on its own — the
       * soak is manual, and a slope on a shared runner is a hypothesis, not a fact. It
       * is recorded so a person reading the report has the numbers and the rule.
       */
      const measured = parseSoakMetrics(result.stdout)
      if (measured.rss.length > 0) {
        report.curve = summariseCurve(measured)
        report.notes.push(
          `CURVE ${report.curve.verdict}: ${report.curve.rss.reason}; ${report.curve.fds.reason}`,
        )
      }
      finish('PASS')
    }
  } finally {
    for (const proxy of proxies) {
      try {
        await proxy.close()
      } catch (error) {
        report.notes.push(`proxy cleanup failed: ${error.message}`)
      }
    }
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
