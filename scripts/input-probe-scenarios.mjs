const IME_SCENARIOS = {
  'ime-commit': '中文',
  'ime-cancel': '中文',
  'ime-enter': 'asd',
}

const OPTION_DEAD_KEY_SCENARIO = 'option-dead-key'

export function inputProbeScenario(action = 'overlap', expected) {
  if (action === 'overlap')
    return { action, expected: expected ?? 'asd', source: 'ascii' }
  if (action === OPTION_DEAD_KEY_SCENARIO) {
    const text = 'é'
    if (expected !== undefined && expected !== text)
      throw new Error(`scenario ${action} expected text must be ${text}`)
    return { action, expected: text, source: 'ascii', manualOnly: true }
  }
  if (!Object.hasOwn(IME_SCENARIOS, action))
    throw new Error(`unknown input probe scenario: ${action}`)
  const text = IME_SCENARIOS[action]
  if (expected !== undefined && expected !== text)
    throw new Error(`scenario ${action} expected text must be ${text}`)
  return { action, expected: text, source: 'ime' }
}

export function inputProbeInstruction(action, expected) {
  if (action === 'ime-commit')
    return 'type zhongwen in Chinese Pinyin, press Space to select 中文, then Enter'
  if (action === 'ime-cancel')
    return 'type nihao, press Escape to cancel, type zhongwen, press Space to select 中文, then Enter'
  if (action === 'ime-enter')
    return 'type asd in Chinese Pinyin, press Enter to commit asd, then press Enter again to submit'
  if (action === OPTION_DEAD_KEY_SCENARIO)
    return 'hold Option and press e to produce a dead key, release Option, press e again for é, then press Enter'
  return `press and hold '${expected[0]}', then press '${expected[1]}' and '${expected[2]}' before releasing them; release all three and press Enter`
}

export function validateCompositionEvidence(action, rounds, log) {
  const starts = (log.match(/compositionstart\b/g) ?? []).length
  const updates = (log.match(/dom-input type=insertCompositionText\b/g) ?? [])
    .length
  const ends = (log.match(/compositionend\b/g) ?? []).length
  const commits = (log.match(/dom-input type=insertFromComposition\b/g) ?? [])
    .length
  const cancels = (log.match(/keydown key=Escape\b/g) ?? []).length
  const emptyEnds =
    (log.match(/compositionend\b[^\n]*data=(?:""|'')/g) ?? []).length
  const requiredCompositions = action === 'ime-cancel' ? rounds * 2 : rounds
  if (
    starts < requiredCompositions ||
    updates < requiredCompositions ||
    ends < requiredCompositions ||
    commits < rounds
  ) {
    throw new Error(
      `IME composition evidence is incomplete: starts=${starts}, updates=${updates}, ends=${ends}, commits=${commits}, rounds=${rounds}`,
    )
  }
  if (action === 'ime-cancel') {
    if (cancels < rounds)
      throw new Error('IME cancellation is missing native Escape events')
    if (emptyEnds < rounds)
      throw new Error(
        `IME cancellation evidence is incomplete: empty compositionend events=${emptyEnds}, rounds=${rounds}`,
      )
  }
  return {
    compositionStarts: starts,
    compositionUpdates: updates,
    compositionEnds: ends,
    compositionCommits: commits,
    escapeKeyDowns: cancels,
    cancelledCompositions: emptyEnds,
  }
}

function diagnosticRounds(log) {
  const lines = log.split(/\r?\n/)
  const rounds = new Map()
  let active
  for (const line of lines) {
    const ready = line.match(/probe-round-ready round=(\d+)\b/)
    if (ready) {
      active = Number(ready[1])
      rounds.set(active, [])
      continue
    }
    if (active !== undefined) rounds.get(active)?.push(line)
    const result = line.match(/probe-round-result round=(\d+)\b/)
    if (result && Number(result[1]) === active) active = undefined
  }
  return rounds
}

export function validateManualInputEvidence(action, rounds, expected, log) {
  const segments = diagnosticRounds(log)
  if (segments.size !== rounds)
    throw new Error(
      `manual input evidence is missing round markers: observed=${segments.size}, rounds=${rounds}`,
    )
  for (let round = 1; round <= rounds; round += 1) {
    const lines = segments.get(round) ?? []
    if (!lines.some(line => line.startsWith('keydown ')))
      throw new Error(`manual input evidence is missing keydown events for round ${round}`)
    if (action === OPTION_DEAD_KEY_SCENARIO) {
      if (
        !lines.some(
          line =>
            /keydown .*altKey=true\b/.test(line) &&
            /code=KeyE\b/.test(line),
        )
      )
        throw new Error(`Option/dead-key evidence is missing Option+E for round ${round}`)
      if (!lines.some(line => line.includes(`data=${JSON.stringify(expected)}`)))
        throw new Error(`Option/dead-key evidence is missing committed ${expected} for round ${round}`)
    }
  }
  return { rounds: segments.size, action }
}
