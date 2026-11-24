/**
 * RC06 — resolve `connection` and `vault-secret-provider` to file-backed versions.
 *
 * ## Why a loader instead of mocks
 *
 * The point of this harness is to kill a **real** `createHost` mid-write and see what it
 * leaves on disk. If the worker called a reimplementation of the write sequence, the
 * result would describe that reimplementation. A test double for the two stores keeps
 * the product's own ordering, guards and cleanup — which is exactly what the crash is
 * supposed to interrupt.
 *
 * `tsx` cannot mock modules, and adding a "if RC06 then use files" branch to the product
 * modules would put test scaffolding in the shipping path. A resolve hook does the
 * substitution from outside.
 */
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const HERE = path.dirname(new URL(import.meta.url).pathname)

export async function resolve(specifier, context, nextResolve) {
  if (specifier === './connection' && context.parentURL?.includes('/service/database/')) {
    return { url: pathToFileURL(path.join(HERE, 'rc06-connection.mjs')).href, shortCircuit: true }
  }
  if (
    specifier === '@/service/vault-secret-provider' &&
    context.parentURL?.includes('/service/database/')
  ) {
    return {
      url: pathToFileURL(path.join(HERE, 'rc06-vault.mjs')).href,
      shortCircuit: true,
    }
  }
  return nextResolve(specifier, context)
}
