export function parseInputProbeSource(serialized) {
  const source = JSON.parse(serialized)
  if (
    !source ||
    typeof source.id !== 'string' ||
    !source.id ||
    typeof source.asciiCapable !== 'boolean'
  ) {
    throw new Error('invalid input source reported by the native injector')
  }
  return source
}

// The first Enter in an IME can commit marked text without submitting the
// shell read. Overlap acceptance must establish its input source explicitly.
export async function withInputProbeSource(
  policy,
  invoke,
  run,
  requirement = 'ascii',
  sourceId,
) {
  const original = parseInputProbeSource(await invoke(['input-source']))
  if (!['current', 'ascii'].includes(policy))
    throw new Error('invalid input-source policy')
  if (sourceId && policy !== 'current')
    throw new Error(
      'explicit input source cannot be combined with ascii policy',
    )
  const target = sourceId
    ? parseInputProbeSource(await invoke(['lookup-source', sourceId]))
    : policy === 'ascii'
      ? parseInputProbeSource(await invoke(['ascii-source']))
      : original
  if (sourceId && target.id !== sourceId)
    throw new Error('requested input source was not found')
  if (requirement === 'ime') {
    if (
      policy !== 'current' ||
      target.asciiCapable ||
      !['TISTypeKeyboardInputMethod', 'TISTypeKeyboardInputMode'].includes(
        target.type,
      )
    ) {
      throw new Error(
        'IME acceptance requires a selected non-ASCII keyboard input method and --input-source current',
      )
    }
  } else {
    if (!target.asciiCapable) {
      throw new Error(
        `ASCII overlap probe cannot run with input source ${target.id}; ` +
          'use --input-source ascii to switch temporarily and restore it afterwards, ' +
          'or select an ASCII keyboard before running. IME requires separate acceptance.',
      )
    }
  }
  if (target.id === original.id) return run(original)
  let failure
  try {
    const selected = parseInputProbeSource(
      await invoke(['select-source', target.id]),
    )
    if (
      selected.id !== target.id ||
      selected.asciiCapable !== target.asciiCapable ||
      selected.type !== target.type
    ) {
      throw new Error(
        `native injector did not select input source ${target.id}`,
      )
    }
    return await run(selected)
  } catch (error) {
    failure = error
    throw error
  } finally {
    try {
      const restored = parseInputProbeSource(
        await invoke(['select-source', original.id]),
      )
      if (restored.id !== original.id) {
        throw new Error(`input source was not restored to ${original.id}`)
      }
    } catch (error) {
      if (failure)
        throw new AggregateError(
          [failure, error],
          `${failure.message}; ${error.message}`,
        )
      throw error
    }
  }
}
