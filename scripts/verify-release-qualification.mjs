#!/usr/bin/env node
/**
 * Decide whether a commit is allowed to become a release.
 *
 * ## What this adds over the existing tag/version check
 *
 * `prepare-release` already proves the tag, `package.json`, `tauri.conf.json` and
 * `Cargo.toml` agree. That is necessary and nowhere near sufficient: it says nothing
 * about whether the commit ever passed CI, or whether the evidence describes *this*
 * commit rather than an older one.
 *
 * This script answers the release question with the facts a release needs:
 *
 * | Fact | Why a release needs it |
 * | --- | --- |
 * | the tag resolves to a commit | prevents tagging an unmerged idea |
 * | every required check **succeeded on this SHA** | a green run of a *different* commit is not evidence for this one |
 * | the evidence fingerprint matches this tree | otherwise the acceptance measurements describe other code |
 * | every required scenario is present and PASS | a missing scenario is a missing proof, not a pass |
 * | the release mode's own requirements | `fully-signed` needs signatures that `unsigned-qa` does not |
 *
 * ## Why it takes a JSON file instead of calling the API itself
 *
 * The facts come from `gh`, which the workflow already uses. Keeping the decision pure
 * — give it facts, get a verdict — is what makes it testable without a live
 * repository, and a release gate that cannot be tested is a release gate nobody
 * trusts.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

/**
 * Jobs that must have succeeded **on the release commit itself**.
 *
 * Deliberately the same list as `CI / required` plus the GUI gate: a release makes
 * stronger claims than a merge (installers, updater payloads, notarization state), so
 * it cannot be allowed to skip a check a merge would have required.
 */
export const REQUIRED_RELEASE_CHECKS = [
  'required',
  'Frontend quality',
  'Rust quality',
  'Team Server quality',
  'Repository gates (source size, evidence, script tests)',
  'Tauri build (macos-latest)',
  'Tauri build (ubuntu-latest)',
  'Tauri build (windows-latest)',
  'cargo audit (blocking)',
  'Dependency audit (npm)',
]

/** Modes and what each promises the user. */
export const RELEASE_MODES = {
  'unsigned-qa': {
    requiresSignatures: false,
    description: 'QA installers with no OS-level signature and no updater signature',
  },
  'updater-signed': {
    requiresSignatures: true,
    description: 'Installers plus a minisign-signed updater payload',
  },
  'fully-signed': {
    requiresSignatures: true,
    requiresNotarization: true,
    description: 'Apple notarization and Windows Authenticode on top of the updater signature',
  },
}

/**
 * Judge a release.
 *
 * `facts` is the shape `scripts/release-facts.mjs` emits. Every field it needs is
 * required: a missing fact is a failure, because "we could not determine this" and
 * "this is true" are different answers and only one of them is safe to publish on.
 */
export function judgeRelease(facts) {
  const problems = []
  const push = (code, message) => problems.push({ code, message })

  // --- the commit itself ---------------------------------------------------
  if (!/^[0-9a-f]{40}$/.test(facts.commit ?? '')) {
    push('commit-malformed', `commit is ${JSON.stringify(facts.commit ?? null)}, expected a 40-character sha`)
  }
  if (!/^v\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(facts.tag ?? '')) {
    push('tag-malformed', `tag is ${JSON.stringify(facts.tag ?? null)}`)
  }
  if (facts.tagCommit !== facts.commit) {
    push(
      'tag-not-on-commit',
      `tag ${facts.tag} resolves to ${facts.tagCommit ?? '<unknown>'}, not to ${facts.commit}`,
    )
  }

  // --- CI must have passed on THIS commit ----------------------------------
  //
  // The failure this prevents: a release cut from a branch whose CI was green on an
  // earlier commit, with the last few commits untested. A run of a different SHA is
  // reported here rather than being allowed to stand in.
  const checks = facts.checks ?? {}
  for (const name of REQUIRED_RELEASE_CHECKS) {
    const entry = checks[name]
    if (!entry) {
      push('check-missing', `required check ${JSON.stringify(name)} has no run for this commit`)
      continue
    }
    if (entry.headSha !== facts.commit) {
      push(
        'check-wrong-sha',
        `required check ${JSON.stringify(name)} last ran on ${entry.headSha ?? '<unknown>'}, ` +
          `which is not the release commit ${facts.commit}`,
      )
      continue
    }
    if (entry.conclusion !== 'success') {
      push(
        'check-not-success',
        `required check ${JSON.stringify(name)} concluded ${JSON.stringify(entry.conclusion ?? null)}`,
      )
    }
  }

  // --- the evidence --------------------------------------------------------
  if (!facts.evidence?.qualificationPassed) {
    push(
      'evidence-not-qualified',
      'the acceptance evidence does not describe this commit ' +
        `(${facts.evidence?.problemCount ?? '?'} problem(s)); re-run ` +
        'real-machine-matrix.yml on this commit instead of editing the manifest',
    )
  }
  const missingScenarios = facts.evidence?.missingScenarios ?? []
  if (missingScenarios.length > 0) {
    push(
      'evidence-missing-scenarios',
      `the evidence is missing ${missingScenarios.length} required scenario(s): ` +
        missingScenarios.join(', '),
    )
  }
  const notPassed = facts.evidence?.notPassed ?? []
  if (notPassed.length > 0) {
    push(
      'evidence-not-passed',
      `these scenarios did not pass: ${notPassed.map(entry => `${entry.name}=${entry.verdict}`).join(', ')}`,
    )
  }

  // --- the mode's own promises ---------------------------------------------
  const mode = RELEASE_MODES[facts.mode]
  if (!mode) {
    push('mode-unknown', `release mode ${JSON.stringify(facts.mode ?? null)} is not one of ${Object.keys(RELEASE_MODES).join(', ')}`)
  } else {
    if (mode.requiresSignatures && !facts.signing?.updaterKeyPresent) {
      push(
        'mode-needs-updater-key',
        `mode ${facts.mode} publishes a signed updater payload but no signing key was available`,
      )
    }
    if (mode.requiresNotarization && !facts.signing?.notarized) {
      push(
        'mode-needs-notarization',
        `mode ${facts.mode} promises notarized installers and the build is not notarized`,
      )
    }
    // The inverse check matters as much: an unsigned build must not be described as
    // signed. This is the "do not silently downgrade" rule.
    if (!mode.requiresSignatures && facts.signing?.updaterKeyPresent) {
      push(
        'mode-mismatch',
        `mode ${facts.mode} does not publish updater signatures, but a signing key is ` +
          'present. Pick the mode that matches what you are shipping rather than ' +
          'leaving the product described as more signed than it is',
      )
    }
  }

  return { ok: problems.length === 0, problems }
}

function main() {
  const factsPath = process.argv[2]
  if (!factsPath) {
    console.error('usage: verify-release-qualification.mjs <facts.json>')
    return 2
  }
  let facts
  try {
    facts = JSON.parse(readFileSync(path.resolve(factsPath), 'utf8'))
  } catch (error) {
    console.error(`could not read facts from ${factsPath}: ${error.message}`)
    return 2
  }

  const { ok, problems } = judgeRelease(facts)
  if (ok) {
    console.log(`release qualification: PASS for ${facts.tag} @ ${facts.commit} (mode ${facts.mode})`)
    return 0
  }
  console.error(`release qualification: FAIL — ${problems.length} problem(s)`)
  for (const problem of problems) console.error(`  [${problem.code}] ${problem.message}`)
  return 1
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  process.exit(main())
}
