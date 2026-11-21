/**
 * Preconditions the GUI E2E runner can refuse on, kept out of the CLI.
 *
 * ## Why this is a module and not a function in `run-gui-e2e.mjs`
 *
 * The first version put `sqliteProblem` in the runner and the test imported it from
 * there. That import ran the entire CLI — it builds the app, starts sshd and launches
 * wdio at module scope — so `node --test` hung instead of testing anything. A file
 * whose top level has side effects cannot be imported by a test, and pretending
 * otherwise produces a suite that appears to cover the guard while executing the
 * program.
 *
 * ## The measurement behind the guard
 *
 * `node scripts/run-gui-e2e.mjs --spec specs/e2e-03-sftp-dock.e2e.mjs` on Node 22.12.0:
 *
 *     ✓ creates, renames and deletes a directory on the bound host — verified on the server
 *     ✓ navigates into a directory and reports the destination the filesystem has
 *     11 passing (1m 17.1s)
 *     [gui-e2e] finished with exit 0
 *
 * The evidence file for that same run:
 *
 *     verdict: PARTIAL      notRunCount: 10      sshFixture: false
 *     write case NOT_RUN: no SSH fixture this run
 *     navigation case NOT_RUN: no SSH fixture this run
 *
 * Every remote case returns early when there is no fixture, so the assertions that run
 * was built to exercise **never executed** — while both cases printed a tick. The cause
 * (`node:sqlite`, which the fixture needs to write its host row) was named in a summary
 * written after the suite had already finished.
 */
import process from 'node:process'

/**
 * Why this Node cannot run the SSH fixture, or `null` when it can.
 *
 * `resolve` is injected so the answer can be tested without depending on the runtime
 * running the tests. The contract is narrow on purpose: the guard asks the runtime to
 * resolve the module, it does not compare version numbers. `--experimental-sqlite`
 * makes `node:sqlite` available on 22.5+, so a `major < 24` check would reject a Node
 * that works.
 */
export function sqliteProblem(resolve) {
  try {
    resolve('node:sqlite')
    return null
  } catch (error) {
    return (
      'this Node cannot provide `node:sqlite`, so the SSH fixture cannot seed its ' +
      `host row and every remote-directory case would record NOT_RUN with the suite ` +
      `still green.\n  node: ${process.version}\n  error: ${error.message}\n` +
      '  Use Node >= 24 (or `NODE_OPTIONS=--experimental-sqlite` on 22.5+), or pass ' +
      '--no-ssh-fixture and read the run as a layout-only run.'
    )
  }
}
