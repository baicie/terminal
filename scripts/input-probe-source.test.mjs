import assert from 'node:assert/strict'
import test from 'node:test'
import { withInputProbeSource } from './input-probe-source.mjs'

const ascii = { id: 'com.apple.keylayout.ABC', asciiCapable: true }
const ime = {
  id: 'com.apple.inputmethod.SCIM.ITABC',
  asciiCapable: false,
  type: 'TISTypeKeyboardInputMode',
}

function fixture(initial = ime) {
  let selected = initial
  const selections = []
  return {
    selections,
    current: () => selected,
    async invoke(args) {
      if (args[0] === 'input-source') return JSON.stringify(selected)
      if (args[0] === 'ascii-source') return JSON.stringify(ascii)
      if (args[0] === 'lookup-source')
        return JSON.stringify(args[1] === ime.id ? ime : ascii)
      if (args[0] === 'select-source') {
        selections.push(args[1])
        selected = args[1] === ascii.id ? ascii : ime
        return JSON.stringify(selected)
      }
      throw new Error('unexpected command')
    },
  }
}

test('current mode rejects IME before posting any keys', async () => {
  const source = fixture()
  let ran = false
  await assert.rejects(
    withInputProbeSource('current', source.invoke, async () => {
      ran = true
    }),
    /ASCII.*--input-source ascii/,
  )
  assert.equal(ran, false)
  assert.deepEqual(source.selections, [])
})

test('ASCII overlap run records its input source and restores the original IME', async () => {
  const source = fixture()
  const result = await withInputProbeSource(
    'ascii',
    source.invoke,
    async active => {
      assert.equal(source.current().id, ascii.id)
      return { ok: true, inputSource: active.id }
    },
  )
  assert.deepEqual(result, { ok: true, inputSource: ascii.id })
  assert.deepEqual(source.selections, [ascii.id, ime.id])
  assert.equal(source.current().id, ime.id)
})

test('restores the original input source when the actual probe fails', async () => {
  const source = fixture()
  await assert.rejects(
    withInputProbeSource('ascii', source.invoke, async () => {
      throw new Error('lost byte')
    }),
    /lost byte/,
  )
  assert.equal(source.current().id, ime.id)
})

test('requires observed input-source selection before posting keys', async () => {
  const source = fixture()
  let ran = false
  const invoke = args =>
    args[0] === 'select-source' && args[1] === ascii.id
      ? Promise.resolve(JSON.stringify(ime))
      : source.invoke(args)
  await assert.rejects(
    withInputProbeSource('ascii', invoke, async () => {
      ran = true
    }),
    /did not select/,
  )
  assert.equal(ran, false)
  assert.equal(source.current().id, ime.id)
})

test('a passing probe is failed if restoring the original source fails', async () => {
  const source = fixture()
  const invoke = args =>
    args[0] === 'select-source' && args[1] === ime.id
      ? Promise.reject(new Error('restore denied'))
      : source.invoke(args)
  await assert.rejects(
    withInputProbeSource('ascii', invoke, async () => ({ ok: true })),
    /restore denied/,
  )
})

test('an ASCII input source needs no mutation in current mode', async () => {
  const source = fixture(ascii)
  await withInputProbeSource('current', source.invoke, async active => {
    assert.deepEqual(active, ascii)
  })
  assert.deepEqual(source.selections, [])
})

test('invalid source metadata cannot count as an ASCII input source', async () => {
  await assert.rejects(
    withInputProbeSource(
      'current',
      async () => '{}',
      async () => {},
    ),
    /invalid input source/,
  )
})

test('IME acceptance requires an actual active keyboard input method', async () => {
  const source = fixture({ ...ime, type: 'TISTypeKeyboardInputMode' })
  let ran = false
  await withInputProbeSource(
    'current',
    source.invoke,
    async () => {
      ran = true
    },
    'ime',
  )
  assert.equal(ran, true)
  assert.deepEqual(source.selections, [])
  await assert.rejects(
    withInputProbeSource(
      'current',
      fixture(ascii).invoke,
      async () => {},
      'ime',
    ),
    /IME/,
  )
  await assert.rejects(
    withInputProbeSource(
      'current',
      fixture({ ...ime, type: 'TISTypeKeyboardLayout' }).invoke,
      async () => {},
      'ime',
    ),
    /IME/,
  )
})

test('an explicitly selected enabled IME is restored after a failed probe', async () => {
  const source = fixture(ascii)
  await assert.rejects(
    withInputProbeSource(
      'current',
      source.invoke,
      async active => {
        assert.equal(active.id, ime.id)
        assert.equal(source.current().id, ime.id)
        throw new Error('cancel mismatch')
      },
      'ime',
      ime.id,
    ),
    /cancel mismatch/,
  )
  assert.deepEqual(source.selections, [ime.id, ascii.id])
  assert.equal(source.current().id, ascii.id)
})
