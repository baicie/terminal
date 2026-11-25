import { describe, expect, it } from 'vitest'
import { classifySshHostKeyGateFailure } from './ssh-host-key-gate-failure'
import { SSH_HOST_KEY_STARTUP_DEADLINE_ERROR } from './ssh-host-key-gate-helpers'

describe('tmp drift probe', () => {
  it('reports what each drifted message classifies as', () => {
    const exact = SSH_HOST_KEY_STARTUP_DEADLINE_ERROR
    const out = {
      exact: classifySshHostKeyGateFailure(undefined, exact),
      trailingPeriod: classifySshHostKeyGateFailure(undefined, exact + '.'),
      trailingSpace: classifySshHostKeyGateFailure(undefined, exact + ' '),
      prefixed: classifySshHostKeyGateFailure(undefined, 'connection failed: ' + exact),
    }
    console.log('DRIFT', JSON.stringify(out))
    expect(out.exact).toBe('deadline')
  })
})
