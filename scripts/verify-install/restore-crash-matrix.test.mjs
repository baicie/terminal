import assert from 'node:assert/strict'
import test from 'node:test'
import { runCrashMatrix } from './restore-crash-matrix.mjs'
import { RESTORE_STAGES } from './recovery-state-machine.mjs'

test('every restore stage survives a real SIGKILL and a retry converges', async () => {
  const result = await runCrashMatrix()
  assert.deepEqual(result.problems, [])
  assert.equal(result.passed, true)
  assert.equal(result.stages.length, RESTORE_STAGES.length)
  assert.equal(result.control.pass, true, result.control.problems.join('; '))
  for (const stage of result.stages) {
    assert.equal(stage.pass, true, stage.stage + ': ' + stage.problems.join('; '))
    assert.deepEqual(stage.stagesObserved, RESTORE_STAGES.slice(0, RESTORE_STAGES.indexOf(stage.stage) + 1))
    assert.equal(stage.integrity, 'ok')
    assert.equal(stage.value, 'backup')
    // A crash before the publish must redo the restore; a crash after the
    // rename must be recognized as already restored and not redone.
    const published = RESTORE_STAGES.indexOf(stage.stage) >= RESTORE_STAGES.indexOf('VERIFY')
    assert.equal(stage.retry.outcome, published ? 'already-restored' : 'restored')
  }
})
