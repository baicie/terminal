/**
 * Trusted built-in extension manifests: what an extension may declare, and what the
 * registry refuses.
 *
 * ## The trust model, stated once
 *
 * A "built-in" extension is compiled into this application and runs in the main
 * WebView. It is therefore *not* sandboxed by anything — it shares the app's full
 * privilege. The manifest is not a security boundary in the way a browser extension
 * manifest is; it is the **declaration** the Registry and the Capability Gateway
 * check against, which is what makes "this extension may not read terminal text" a
 * fact the code enforces rather than a note in a review.
 *
 * Third-party JavaScript is not loaded, evaluated or imported. `entry` is
 * `built-in:<name>`, a compile-time key; there is no URL, path or module specifier
 * anywhere in this type. That is deliberate: a field that could name dynamic code
 * would be an invitation to add one later without redesigning the trust model.
 *
 * ## What validation rejects, and why each matters
 *
 * | rejection | the failure it prevents |
 * | --- | --- |
 * | unknown API version | an extension written for a newer contract running against older behaviour |
 * | duplicate id | two extensions sharing one disposable bucket, so deactivating one clears the other |
 * | unknown capability | a manifest granting itself something the gateway does not check for |
 * | empty capability list | an extension that registers nothing but is reported as active |
 * | unsupported platform | an extension that cannot work here being enabled and then failing at use |
 */

import type { ExtensionCapability } from './capability-gateway'
import { EXTENSION_CAPABILITIES } from './capability-gateway'
import type { BuiltInViewId, ExtensionId } from './extension-types'
import { isBuiltInViewId } from './extension-types'

/** The API version this build implements. One value, not a range. */
export const EXTENSION_API_VERSION = 1

export type ExtensionPlatform = 'macos' | 'windows' | 'linux'

export const EXTENSION_PLATFORMS: readonly ExtensionPlatform[] = [
  'macos',
  'windows',
  'linux',
]

export interface BuiltInExtensionManifest {
  id: ExtensionId
  /** A translation key, never a user-facing literal: the app ships three languages. */
  nameKey: string
  version: string
  apiVersion: number
  /** `built-in:<name>`. Never a path, URL or module specifier. */
  entry: `built-in:${string}`
  capabilities: readonly ExtensionCapability[]
  platforms: readonly ExtensionPlatform[]
  defaultEnabled: boolean
  /**
   * Views this extension registers, if any.
   *
   * Declared on the manifest rather than discovered at activation so the dock can
   * decide what is available *before* an extension runs, and so a view id cannot be
   * invented at runtime.
   */
  views?: readonly BuiltInViewId[]
}

export type ManifestRejection =
  | 'invalid-id'
  | 'invalid-name-key'
  | 'invalid-version'
  | 'unsupported-api-version'
  | 'invalid-entry'
  | 'empty-capabilities'
  | 'unknown-capability'
  | 'empty-platforms'
  | 'unknown-platform'
  | 'unknown-view'
  | 'duplicate-id'

export interface ManifestProblem {
  rejection: ManifestRejection
  detail: string
}

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

/**
 * Validate one manifest against the contract.
 *
 * Pure: no registry state, no platform detection, no I/O. `duplicate-id` is checked
 * by the registry, which is the only thing that knows what else is registered; this
 * function cannot and should not guess.
 */
export function validateManifest(manifest: BuiltInExtensionManifest): ManifestProblem | null {
  // Kebab-case ids. An id with a space, colon or slash would make every keyed map,
  // diagnostic line and settings row ambiguous.
  if (!ID_PATTERN.test(manifest.id)) {
    return { rejection: 'invalid-id', detail: `"${manifest.id}" is not a kebab-case id` }
  }
  if (!manifest.nameKey || !manifest.nameKey.includes('.')) {
    return {
      rejection: 'invalid-name-key',
      detail: 'nameKey must be a translation key, not a literal name',
    }
  }
  if (!SEMVER_PATTERN.test(manifest.version)) {
    return {
      rejection: 'invalid-version',
      detail: `"${manifest.version}" is not a version`,
    }
  }
  // Exact match, not ">= 1". An extension that asks for API 2 is asking for
  // behaviour this build does not have, and running it anyway is how a newer
  // extension silently loses a guarantee.
  if (manifest.apiVersion !== EXTENSION_API_VERSION) {
    return {
      rejection: 'unsupported-api-version',
      detail: `API version ${manifest.apiVersion} is not supported (this build implements ${EXTENSION_API_VERSION})`,
    }
  }
  if (!manifest.entry.startsWith('built-in:')) {
    return {
      rejection: 'invalid-entry',
      detail: 'entry must be "built-in:<name>"; dynamic code loading is not supported',
    }
  }
  if (manifest.capabilities.length === 0) {
    return {
      rejection: 'empty-capabilities',
      detail: 'an extension that declares no capability cannot do anything',
    }
  }
  const known = new Set<string>(EXTENSION_CAPABILITIES)
  for (const capability of manifest.capabilities) {
    if (!known.has(capability)) {
      return {
        rejection: 'unknown-capability',
        detail: `"${capability}" is not a capability this build implements`,
      }
    }
  }
  if (manifest.platforms.length === 0) {
    return {
      rejection: 'empty-platforms',
      detail: 'an extension with no platform will never run',
    }
  }
  for (const platform of manifest.platforms) {
    if (!EXTENSION_PLATFORMS.includes(platform)) {
      return {
        rejection: 'unknown-platform',
        detail: `"${platform}" is not a platform`,
      }
    }
  }
  for (const view of manifest.views ?? []) {
    if (!isBuiltInViewId(view)) {
      return {
        rejection: 'unknown-view',
        detail: `"${view}" is not a built-in view`,
      }
    }
  }
  return null
}

/** Does this manifest support the running platform? */
export function supportsPlatform(
  manifest: BuiltInExtensionManifest,
  platform: ExtensionPlatform,
): boolean {
  return manifest.platforms.includes(platform)
}

/**
 * The platform this build is running on.
 *
 * Read from the user agent rather than a Tauri API so the registry stays importable
 * outside a Tauri host — the same reason the credential registry takes its provider
 * as an argument. `linux` is the fallback: an unrecognised platform is not macOS or
 * Windows, and guessing one of those would enable extensions that cannot work.
 */
export function currentExtensionPlatform(
  userAgent: string = typeof navigator === 'undefined' ? '' : navigator.userAgent,
): ExtensionPlatform {
  const agent = userAgent.toLowerCase()
  if (agent.includes('mac')) return 'macos'
  if (agent.includes('win')) return 'windows'
  return 'linux'
}
