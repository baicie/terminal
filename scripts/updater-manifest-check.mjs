/**
 * Validate an updater manifest against the release it claims to describe.
 *
 * ## Why `jq -e '.version and .platforms'` is not a check
 *
 * Measured on the real expression: all four of these **pass** it.
 *
 * ```json
 * {"version":"0.0.1-dev.2","platforms":{"darwin-aarch64":{"signature":"","url":""}}}
 * {"version":"9.9.9","platforms":{"darwin-aarch64":{"signature":"X","url":"https://example.com/evil"}}}
 * {"version":"0.0.1","platforms":{"darwin-aarch64":{"signature":"S","url":"u"},
 *                                 "darwin-x86_64":{"signature":"S","url":"u"}}}
 * {"version":"","platforms":{}}
 * ```
 *
 * An empty signature, a version that is not the one being released, a URL pointing at
 * somebody else's host, two platforms sharing one payload, and a manifest with no
 * platforms at all — every one of them is "truthy" in jq. Worse, the workflow then
 * clobbers the live channel with whatever it validated, so a malformed manifest can
 * replace a working one.
 *
 * ## What is verified here, and what is not
 *
 * | Fact | How |
 * | --- | --- |
 * | version matches the release | string equality against the tag's version |
 * | every expected platform is present | exact key set |
 * | no unexpected platform | exact key set |
 * | signature non-empty | length check |
 * | url non-empty and https | parse |
 * | url points at this release | prefix check against the release's own URL base |
 * | each payload is distinct | duplicate-url detection across platforms |
 * | `pub_date` parses | ISO-8601 check |
 *
 * **Not** verified here: that a signature is cryptographically valid for its payload.
 * That requires the minisign public key and the payload bytes, and it belongs next to
 * the artifacts — `verifyUpdaterSignatures` below does it when the payloads are
 * available, and reports `NOT_VERIFIED` when they are not. Claiming a signature is
 * "valid" because it is non-empty is the failure mode this module exists to prevent.
 */

/** The platforms a complete `latest.json` must carry. */
export const REQUIRED_PLATFORMS = ['darwin-aarch64', 'darwin-x86_64', 'windows-x86_64', 'linux-x86_64']

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/

/**
 * Judge a parsed manifest.
 *
 * `expected` is `{version, tag, repository}`. `repository` is `owner/name`, used to
 * build the only URL prefix a payload may use.
 */
export function judgeManifest(manifest, expected) {
  const problems = []
  const push = (code, message) => problems.push({ code, message })

  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { ok: false, problems: [{ code: 'manifest-not-object', message: 'the manifest is not a JSON object' }] }
  }

  // --- version -------------------------------------------------------------
  const version = manifest.version
  if (typeof version !== 'string' || version.length === 0) {
    push('manifest-version-missing', `version is ${JSON.stringify(version ?? null)}, expected a non-empty string`)
  } else if (expected?.version !== undefined && version !== expected.version) {
    push(
      'manifest-version-mismatch',
      `the manifest advertises ${JSON.stringify(version)} but this release is ${JSON.stringify(expected.version)}`,
    )
  }

  // --- pub_date ------------------------------------------------------------
  if (manifest.pub_date !== undefined) {
    if (typeof manifest.pub_date !== 'string' || !ISO_DATE.test(manifest.pub_date)) {
      push(
        'manifest-pub-date',
        `pub_date is ${JSON.stringify(manifest.pub_date)}, expected an ISO-8601 UTC timestamp`,
      )
    }
  }

  // --- platforms -----------------------------------------------------------
  const platforms = manifest.platforms
  if (platforms === null || typeof platforms !== 'object' || Array.isArray(platforms)) {
    push('manifest-platforms-missing', 'platforms is missing or not an object')
    return { ok: false, problems }
  }

  const present = Object.keys(platforms)
  const missing = REQUIRED_PLATFORMS.filter(name => !present.includes(name))
  if (missing.length > 0) {
    push('manifest-platforms-incomplete', `missing platform(s): ${missing.join(', ')}`)
  }
  const unexpected = present.filter(name => !REQUIRED_PLATFORMS.includes(name))
  if (unexpected.length > 0) {
    // Not fatal by itself, but it means a client on that platform would be offered a
    // payload nobody tested. Reported so it is a decision rather than an accident.
    push('manifest-platforms-unexpected', `unexpected platform(s): ${unexpected.join(', ')}`)
  }

  const baseUrl =
    expected?.repository && expected?.tag
      ? `https://github.com/${expected.repository}/releases/download/${expected.tag}/`
      : null

  const seenUrls = new Map()
  for (const [name, entry] of Object.entries(platforms)) {
    if (entry === null || typeof entry !== 'object') {
      push('manifest-platform-not-object', `${name} is ${JSON.stringify(entry)}`)
      continue
    }
    if (typeof entry.signature !== 'string' || entry.signature.trim().length === 0) {
      // An empty signature is exactly what the jq expression accepted.
      push('manifest-signature-empty', `${name} has no signature`)
    }
    const url = entry.url
    if (typeof url !== 'string' || url.trim().length === 0) {
      push('manifest-url-empty', `${name} has no url`)
      continue
    }
    let parsed
    try {
      parsed = new URL(url)
    } catch {
      push('manifest-url-invalid', `${name} url is not a valid URL: ${JSON.stringify(url)}`)
      continue
    }
    if (parsed.protocol !== 'https:') {
      push('manifest-url-not-https', `${name} url uses ${parsed.protocol}`)
    }
    if (baseUrl !== null && !url.startsWith(baseUrl)) {
      // The "points at an older release" failure: the manifest advertises a payload
      // from a different tag, so clients download a version that is not this one.
      push(
        'manifest-url-wrong-release',
        `${name} url points outside this release: ${url} does not start with ${baseUrl}`,
      )
    }
    if (seenUrls.has(url)) {
      push(
        'manifest-payload-duplicated',
        `${name} and ${seenUrls.get(url)} share the same payload url (${url})`,
      )
    } else {
      seenUrls.set(url, name)
    }
  }

  return { ok: problems.length === 0, problems }
}

/**
 * Verify each signature against its payload, when the payloads are on disk.
 *
 * `verify(payloadPath, signature)` is injected: in the release workflow it shells out
 * to `minisign`/`tauri signer verify`; in tests it is a stub. When a payload is not
 * available the result is `NOT_VERIFIED` — never `VALID`.
 */
export function verifyUpdaterSignatures(manifest, { payloads, verify }) {
  const results = []
  for (const [platform, entry] of Object.entries(manifest.platforms ?? {})) {
    const payloadPath = payloads?.[platform]
    if (!payloadPath) {
      results.push({
        platform,
        status: 'NOT_VERIFIED',
        reason: `the payload for ${platform} was not available, so its signature could not be checked`,
      })
      continue
    }
    let verdict
    try {
      verdict = verify(payloadPath, entry.signature)
    } catch (error) {
      results.push({ platform, status: 'INVALID', reason: error.message })
      continue
    }
    results.push({
      platform,
      status: verdict?.ok ? 'VALID' : 'INVALID',
      reason: verdict?.ok ? 'the signature verifies against the payload' : verdict?.reason ?? 'signature did not verify',
    })
  }
  // A release must not proceed on an unverified signature; the caller decides whether
  // NOT_VERIFIED is acceptable (it is not, for a release channel).
  return {
    results,
    allValid: results.every(entry => entry.status === 'VALID'),
    unverified: results.filter(entry => entry.status === 'NOT_VERIFIED').map(entry => entry.platform),
    invalid: results.filter(entry => entry.status === 'INVALID').map(entry => entry.platform),
  }
}

/**
 * Detect the window where the live channel has no manifest.
 *
 * `gh release upload --clobber` deletes the existing asset and writes the new one, so
 * between the two there is a moment with no `latest.json`. A client polling then gets
 * no manifest — indistinguishable, from the client's side, from "no update available".
 *
 * The mitigation is ordering: upload the manifest to the *release* first, verify it
 * there, and only then clobber the channel. This function reports whether a proposed
 * operation sequence has that gap.
 */
export function findChannelGap(operations) {
  const gaps = []
  operations.forEach((operation, index) => {
    if (operation.kind === 'clobber-channel' && !operation.afterChannelVerified) {
      gaps.push({
        index,
        operation: operation.name ?? 'clobber-channel',
        message:
          'this clobbers the live channel manifest before the replacement was verified on the ' +
          'release, leaving a window with no manifest and no rollback',
      })
    }
  })
  return gaps
}
