import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import test from 'node:test'

/**
 * The rc-matrix diagnostic decides which of three classes a result belongs to:
 * an expected failure (a negative control that blocked as designed), a
 * diagnostic failure (the script itself broke) or a product failure. Getting
 * that wrong either hides a product defect behind "expected" or turns a
 * harness bug into a red gate, so the rules are pinned here.
 *
 * The rules themselves are cheap to check and need no shell, no PTY and no
 * runner: the script exposes --self-test for exactly this. The whole python
 * module is skipped when python3 is unavailable instead of reporting a pass.
 */
const script = path.join(import.meta.dirname, 'diagnose-zsh-rc.py')
const python = spawnSync('python3', ['--version'], { encoding: 'utf8' })

test(
  'classifies expected, diagnostic and product failures apart',
  { skip: python.status === 0 ? false : 'python3 is not available' },
  () => {
    const result = spawnSync('python3', [script, '--self-test'], {
      encoding: 'utf8',
    })
    assert.equal(result.stderr, '')
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.match(result.stdout, /SELF-TEST PASS: \d+ classification checks/)
  },
)

test(
  'refuses a launch model it does not model instead of guessing',
  { skip: python.status === 0 ? false : 'python3 is not available' },
  () => {
    const result = spawnSync(
      'python3',
      [
        script,
        '--launch',
        'app,imaginary',
        '--shells',
        'zsh',
        '--cases',
        'readline-tab',
        '--out',
        '/tmp/diagnose-zsh-rc-unknown-launch.log',
      ],
      { encoding: 'utf8' },
    )
    // The launch list is validated before any shell starts, so an unknown model
    // is rejected instead of silently measuring something else - which is the
    // mistake that made the earlier matrix unreadable.
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /unsupported launch model: imaginary/)
  },
)
