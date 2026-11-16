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
 * The checks a release must prove, and where each comes from.
 *
 * This used to be a hand-typed list of job display names whose comment claimed it
 * mirrored `CI / required` "plus the GUI gate". The GUI gate was not in it — a release
 * could ship with the GUI E2E red while the comment said otherwise, and no test
 * compared the two lists.
 *
 * The list now comes from `release-check-contract.mjs`, which is validated against the
 * real workflow files by `release-check-contract.test.mjs`. Re-exported here so existing
 * callers keep working.
 */
export {
  RELEASE_CHECKS,
  REQUIRED_RELEASE_CHECKS,
  PR_EVIDENCE_CHECKS,
} from './release-check-contract.mjs'
// A re-export does not create a local binding, so the loop below needs its own import.
import {
  PR_EVIDENCE_CHECKS as PR_CHECKS,
  RELEASE_CHECKS as CHECKS,
  REQUIRED_RELEASE_CHECKS as REQUIRED_NAMES,
} from './release-check-contract.mjs'

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
  //
  // ## A collector failure is not a check failure
  //
  // If the API could not be read, the honest answer is "we do not know", and the two
  // must not be reported as the same thing: one sends someone to look at CI, the other
  // sends them to look at GitHub's availability. `checksError` carries the first.
  const checks = facts.checks ?? {}
  if (facts.checksError) {
    push(
      'checks-unreadable',
      `the check-run listing could not be read (${facts.checksError}); this is a ` +
        'fact-collection failure, not a failed check — re-run the release after the API ' +
        'is reachable rather than treating the release as reviewed',
    )
  }
  for (const check of CHECKS) {
    const name = check.name
    const entry = checks[name]
    if (!entry) {
      // A PR-evidence check is expected on the *commit's PR run*, not on the tag. Its
      // absence is a distinct problem: the fact collector must supply it, and a
      // missing one means the release cannot be qualified — not that it may proceed.
      const code = check.freshness === 'pr-evidence' ? 'check-missing-pr-evidence' : 'check-missing'
      push(
        code,
        `required check ${JSON.stringify(name)} has no run for this commit` +
          (check.freshness === 'pr-evidence'
            ? ` (this gate is verified against the commit's PR-time run in ${check.owner}; ` +
              'the workflow has no tag trigger, so a tag run cannot satisfy it)'
            : ''),
      )
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
      continue
    }
    // ## A `success` conclusion is not enough: the run must have finished
    //
    // The Checks API reports `status` and `conclusion` separately, and GitHub writes
    // `conclusion: "success"` on a re-requested or re-run check whose new attempt is
    // still queued — the previous attempt's conclusion lingers. `summarizeForRelease`
    // in `check-run-selection.mjs` guards this; `judgeRelease` is the function the
    // release path actually calls, and it did not. Measured: facts with every required
    // check `{status: 'in_progress', conclusion: 'success'}` returned ok=true.
    // A missing `status` is treated the same as a non-final one: the facts file must
    // be able to say the run finished, or the release cannot claim it did.
    if (entry.status !== 'completed') {
      push(
        'check-incomplete',
        `required check ${JSON.stringify(name)} has status ` +
          `${JSON.stringify(entry.status ?? null)}, so its success is not final; ` +
          'a release must wait for the run to finish',
      )
    }
    // ## Provenance, not just a name
    //
    // `entry.workflowPath` is what the collector resolved from the check's details URL.
    // Without this comparison, a workflow file added to the repository could publish a
    // check named `Rust quality` and satisfy this gate — GitHub Actions is one App for
    // every workflow, so app id proves nothing.
    //
    // The field is **required**. An earlier version skipped the comparison when it was
    // absent, which meant a collector that never populated it (or a facts file written
    // by hand) passed with no provenance at all — the check would have been decorative.
    // `null` means "could not determine", and that is a refusal, not a pass.
    if (entry.workflowPath !== check.owner) {
      push(
        'check-wrong-workflow',
        `required check ${JSON.stringify(name)} came from ` +
          `${entry.workflowPath === null || entry.workflowPath === undefined ? '<unresolved>' : entry.workflowPath}, ` +
          `not from ${check.owner}; its name is not proof of its source`,
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
