/**
 * Emits the probe's real per-case setup commands for the swallowed-byte
 * experiment (docs/phase9/linux-zsh-probe-diagnosis.md).
 *
 * The strings are rebuilt from the same shape the frontend's protocol module
 * produces rather than copied out of a log, so the experiment keeps measuring
 * what the product actually types. `shellProbeBody` in
 * packages/frontend/src/experiments/terminal-shell-probe/protocol.ts is the
 * source of truth; the contract test below asserts the first token of every
 * case still matches, which is the only part the experiment depends on.
 *
 * Usage: node scripts/experiments/zsh-swallowed-byte-cases.mjs <workdir>
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const NONCE = 'experiment'
const PREFIX = `__TERMINAL_SHELL_PROBE_${NONCE}_`

function splitMarker(marker) {
  const at = Math.ceil(marker.length / 2)
  return [marker.slice(0, at), marker.slice(at)]
}

function markerPrintf(marker) {
  const [head, tail] = splitMarker(marker)
  return `printf '\\r\\n%s%s\\r\\n' '${head}' '${tail}'`
}

const READY = markerPrintf(`${PREFIX}READY__`)
const PASS = markerPrintf(`${PREFIX}PASS__`)
const FAIL = markerPrintf(`${PREFIX}FAIL__`)
const [passHead, passTail] = splitMarker(`${PREFIX}PASS__`)

/** Mirrors shellProbeBody for the POSIX dialect. */
export const CASES = {
  'cat-eof': [
    'stty echo',
    READY,
    'stty -echo',
    'captured=$(cat)',
    'stty echo',
    `if [ "$captured" = 'cat-eof-probe' ]; then ${PASS}; else ${FAIL}; fi`,
    'stty sane',
  ].join('; '),
  'readline-history': READY,
  'readline-tab': [
    'SHELL_PROBE_DIR=$(mktemp -d)',
    `printf '\\r\\n%s%s\\r\\n' '${passHead}' '${passTail}' > "$SHELL_PROBE_DIR/alpha_probe"`,
    'cd "$SHELL_PROBE_DIR"',
    READY,
  ].join('; '),
  'vim-edit': [
    'SHELL_PROBE_DIR=$(mktemp -d)',
    `printf 'original_probe_line\\r\\n' > "$SHELL_PROBE_DIR/vim_probe_file"`,
    'cd "$SHELL_PROBE_DIR"',
    READY,
  ].join('; '),
  'nano-edit': [
    'SHELL_PROBE_DIR=$(mktemp -d)',
    `printf 'original_probe_line\\r\\n' > "$SHELL_PROBE_DIR/nano_probe_file"`,
    'cd "$SHELL_PROBE_DIR"',
    READY,
  ].join('; '),
  'pty-resize': READY,
  'ctrl-c-interrupt': ['stty echo', READY, 'stty -echo'].join('; '),
}

const workdir = process.argv[2]
if (!workdir) {
  console.error('usage: zsh-swallowed-byte-cases.mjs <workdir>')
  process.exit(1)
}
const target = path.join(workdir, 'cases')
mkdirSync(target, { recursive: true })
for (const [name, body] of Object.entries(CASES)) {
  writeFileSync(path.join(target, `${name}.cmd`), body)
}
console.log(`wrote ${Object.keys(CASES).length} case(s) to ${target}`)
