/**
 * RC06 — the vault provider, backed by a JSON file that outlives the process.
 *
 * Same key layout as the product's `vaultKey` and the same four operations. Encryption
 * is the one thing not reproduced: the question here is ordering between two stores, and
 * encryption does not change which key holds what.
 *
 * Crash points live here because the interesting boundaries are on this side of the
 * write — after the first secret, after all of them, and before an old generation is
 * retired.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const dir = process.env.RC06_DIR
if (!dir) throw new Error('RC06_DIR is not set')
const file = path.join(dir, 'vault.json')

function load() {
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {}
}
function save(entries) {
  writeFileSync(file, JSON.stringify(entries))
}

const key = (r, v, k) => `${r.type}:${r.id}:${v}:${k}`

function crashAt(stage) {
  if (process.env.RC06_CRASH_AT !== stage) return
  process.kill(process.pid, 'SIGKILL')
}

export const vaultSecretProvider = {
  async availability() {
    return { ok: true, state: 'ready' }
  },
  async write(resource, version, kind, value) {
    const entries = load()
    entries[key(resource, version, kind)] = value
    save(entries)
    crashAt('after-first-secret')
  },
  async read(resource, version, kind) {
    return load()[key(resource, version, kind)]
  },
  async remove(resource, version, kind) {
    const entries = load()
    delete entries[key(resource, version, kind)]
    save(entries)
  },
  async removeVersion(resource, version, kinds) {
    crashAt('before-retire')
    const entries = load()
    for (const kind of kinds) delete entries[key(resource, version, kind)]
    save(entries)
    return []
  },
}
