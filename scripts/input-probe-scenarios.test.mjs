import assert from 'node:assert/strict'
import test from 'node:test'
import {
  inputProbeInstruction,
  inputProbeScenario,
  validateCompositionEvidence,
} from './input-probe-scenarios.mjs'

test('overlap remains the default ASCII scenario', () => {
  assert.deepEqual(inputProbeScenario(), {
    action: 'overlap',
    expected: 'asd',
    source: 'ascii',
  })
})

test('IME commit and cancellation keep the expected PTY text independent of keystrokes', () => {
  assert.deepEqual(inputProbeScenario('ime-commit'), {
    action: 'ime-commit',
    expected: '中文',
    source: 'ime',
  })
  assert.deepEqual(inputProbeScenario('ime-cancel'), {
    action: 'ime-cancel',
    expected: '中文',
    source: 'ime',
  })
  assert.deepEqual(inputProbeScenario('ime-enter'), {
    action: 'ime-enter',
    expected: 'asd',
    source: 'ime',
  })
})

test('unknown scenarios and contradictory expected text are rejected', () => {
  assert.throws(() => inputProbeScenario('anything'), /scenario/)
  assert.throws(() => inputProbeScenario('ime-commit', 'zhongwen'), /expected/)
})

test('IME evidence requires native composition and commits for every round', () => {
  const log =
    'compositionstart data=""\n' +
    'dom-input type=insertCompositionText composing=true\n' +
    'compositionend data="中文"\n' +
    'dom-input type=insertFromComposition composing=false\n'
  assert.throws(
    () => validateCompositionEvidence('ime-commit', 2, log),
    /composition/,
  )
  assert.doesNotThrow(() =>
    validateCompositionEvidence('ime-commit', 2, log.repeat(2)),
  )
  assert.throws(
    () =>
      validateCompositionEvidence(
        'ime-commit',
        1,
        'keydown key=a\ninput kind=text bytes=3 hex=617364',
      ),
    /composition/,
  )
})

test('cancel acceptance additionally requires an Escape event per round', () => {
  const logWithoutEscape =
    'compositionstart data="nihao"\n' +
    'dom-input type=insertCompositionText composing=true\n' +
    'compositionend data=""\n' +
    'compositionstart data="zhongwen"\n' +
    'dom-input type=insertCompositionText composing=true\n' +
    'compositionend data="中文"\n' +
    'dom-input type=insertFromComposition composing=false\n'
  assert.throws(
    () => validateCompositionEvidence('ime-cancel', 1, logWithoutEscape),
    /Escape/,
  )
  const log = logWithoutEscape + 'keydown key=Escape code=Escape\n'
  assert.doesNotThrow(() =>
    validateCompositionEvidence(
      'ime-cancel',
      1,
      log,
    ),
  )
  assert.throws(
    () =>
      validateCompositionEvidence(
        'ime-cancel',
        1,
        log.replace('compositionend data=""', 'compositionend data="你好"'),
      ),
    /cancel/i,
  )
})

test('manual guidance distinguishes cancellation, candidate commit and shell submission', () => {
  assert.match(
    inputProbeInstruction('overlap', 'asd'),
    /hold 'a'.*press 's'.*'d'.*releasing/,
  )
  assert.match(inputProbeInstruction('ime-cancel', '中文'), /Escape to cancel/)
  assert.match(
    inputProbeInstruction('ime-enter', 'asd'),
    /Enter again to submit/,
  )
  assert.match(
    inputProbeInstruction('ime-commit', '中文'),
    /Space to select 中文, then Enter/,
  )
})
