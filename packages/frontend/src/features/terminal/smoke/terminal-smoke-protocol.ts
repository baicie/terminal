import type { TerminalSmokeConfig } from './terminal-smoke-contract'

const LOAD_BLOCK_BYTES = 1024
const SAFE_NONCE = /^[a-f0-9]{16,64}$/

export interface TerminalSmokeProtocol {
  readyMarker: string
  unicodeMarker: string
  loadEndMarker: string
  afterLoadMarker: string
  resizeMarker: string
  readyCommand: string
  unicodeCommand: string
  loadCommand: string
  afterLoadCommand: string
  resizeProbeCommand: string
}

export function createTerminalSmokeProtocol(
  config: TerminalSmokeConfig,
  nonce: string,
): TerminalSmokeProtocol {
  if (!SAFE_NONCE.test(nonce)) {
    throw new Error('Invalid terminal smoke nonce')
  }
  const blockCount = config.loadBytes / LOAD_BLOCK_BYTES
  if (!Number.isSafeInteger(blockCount)) {
    throw new Error('Invalid terminal smoke load size')
  }
  const readyMarker = `READY_${nonce}`
  const unicodeMarker = `UNICODE_${nonce}_中文🙂`
  const loadEndMarker = `LOAD_END_${nonce}`
  const afterLoadMarker = `AFTER_LOAD_OK_${nonce}`
  const resizeMarker = `RESIZED_SIZE_${nonce} ${config.targetRows} ${config.targetCols}`
  return {
    readyMarker,
    unicodeMarker,
    loadEndMarker,
    afterLoadMarker,
    resizeMarker,
    readyCommand: `printf '\\n%s%s\\n' 'READY_' '${nonce}'\r`,
    unicodeCommand:
      `printf '\\n%s%s%s\\n' 'UNICODE_' '${nonce}' '_中文🙂'\r`,
    loadCommand:
      `i=0; while [ "$i" -lt ${blockCount} ]; do ` +
      `printf '%01024d' 0 || exit 97; i=$((i + 1)); done; ` +
      `printf '\\n%s%s\\n' 'LOAD_END_' '${nonce}'\r`,
    afterLoadCommand: `printf '\\n%s%s\\n' 'AFTER_LOAD_OK_' '${nonce}'\r`,
    resizeProbeCommand:
      `set -- $(stty size); printf '\\n%s%s %s %s\\n' ` +
      `'RESIZED_SIZE_' '${nonce}' "$1" "$2"\r`,
  }
}

export function createTerminalSmokeNonce(): string {
  return crypto.randomUUID().replaceAll('-', '')
}
