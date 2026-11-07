/**
 * Recovery state machine and test-only crash points.
 *
 * The restore path is only safe if each transition is explicit. This module
 * keeps the order in one place and allows an isolated test build to stop at a
 * named point; production runs never set TERMINAL_TEST_CRASH.
 */
export const RESTORE_STAGES = [
  'PREPARE',
  'QUIESCE',
  'VERIFY_BACKUP',
  'STAGE',
  'VERIFY_STAGED',
  'COMMIT',
  'VERIFY',
  'COMPLETE',
]

export function assertStageOrder(stages) {
  let last = -1
  for (const stage of stages) {
    const index = RESTORE_STAGES.indexOf(stage)
    if (index < 0) throw new Error('unknown recovery stage: ' + stage)
    if (index <= last) throw new Error('recovery stage order regression: ' + stages.join(' -> '))
    last = index
  }
  return true
}

export function crashPoint(stage, env = process.env) {
  if (!RESTORE_STAGES.includes(stage)) throw new Error('unknown crash point: ' + stage)
  if (env.TERMINAL_TEST_CRASH !== '1') return
  if (env.TERMINAL_RESTORE_CRASH_POINT === stage) {
    throw new Error('injected recovery crash at ' + stage)
  }
}

export function restoreStagePlan(crashAt = null) {
  if (crashAt !== null && !RESTORE_STAGES.includes(crashAt)) {
    throw new Error('unknown crash point: ' + crashAt)
  }
  return RESTORE_STAGES.map(stage => ({ stage, crash: stage === crashAt }))
}
