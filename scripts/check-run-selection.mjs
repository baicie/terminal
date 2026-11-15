/**
 * Turn a page of GitHub check runs into one verdict per check name.
 *
 * ## Why this is a separate, pure function
 *
 * The first version did this inline while parsing `gh` output, which made every
 * decision untestable: the only way to exercise "which of two runs wins" was to be a
 * real repository at a real moment. The rules below are the whole of T12, and they
 * are wrong in ways that a release gate cannot afford:
 *
 * | Assumption | Why it is wrong |
 * | --- | --- |
 * | "the last item is the newest" | the API documents no ordering; `gh` does not sort |
 * | "one entry per name" | a re-run produces a second entry with the same name |
 * | "`conclusion` is enough" | a run in `queued`/`in_progress` has `conclusion: null` |
 * | "100 is enough" | the endpoint paginates; a busy repo has more runs than that |
 * | "any run with this name counts" | a fork or another App can publish the same name |
 *
 * ## The selection rule
 *
 * For each name, the winner is the run with the **highest `id`** among runs that
 * belong to the expected source. GitHub assigns ids monotonically, so a higher id is
 * a later run — that is a documented property, unlike array order.
 *
 * A run whose source is not in `allowedApps` is ignored rather than trusted: the
 * check-run API returns runs from every App that reported on the commit, and only
 * this repository's workflow is allowed to satisfy a required check.
 */

/**
 * @param {Array<object>} runs raw check-run objects from the API
 * @param {object} options
 * @param {Set<number>|null} options.allowedAppIds App ids allowed to satisfy a check
 * @returns {{checks: Record<string, {conclusion: string|null, status: string, headSha: string, id: number}>, ignored: Array<{name: string, id: number, reason: string}>}}
 */
export function selectCheckRuns(runs, { allowedAppIds = null } = {}) {
  const checks = {}
  const ignored = []

  for (const run of Array.isArray(runs) ? runs : []) {
    const name = run?.name
    const id = Number(run?.id)
    if (typeof name !== 'string' || !Number.isFinite(id)) {
      // A run without a name or id cannot be attributed or ordered. Ignoring it
      // rather than guessing keeps a malformed response from becoming a pass.
      ignored.push({ name: String(name ?? '<unnamed>'), id, reason: 'malformed' })
      continue
    }

    if (allowedAppIds !== null && !allowedAppIds.has(Number(run?.app?.id))) {
      ignored.push({ name, id, reason: `app ${run?.app?.id ?? '<none>'} not trusted` })
      continue
    }

    const entry = {
      conclusion: run.conclusion ?? null,
      status: run.status ?? null,
      headSha: run.head_sha ?? null,
      id,
    }

    const existing = checks[name]
    if (existing === undefined || id > existing.id) {
      // A higher id is a later run. The one exception is a *pending* run replacing a
      // finished one: that is correct too — the newest statement about this check is
      // "still running", and a release must wait rather than read the older success.
      checks[name] = entry
    }
  }

  return { checks, ignored }
}

/**
 * Merge several pages, keeping the newest run per name.
 *
 * Separate from `selectCheckRuns` so pagination cannot silently change the answer:
 * the pages are concatenated first, then one selection runs over all of them.
 */
export function selectAcrossPages(pages, options) {
  const all = []
  for (const page of pages) all.push(...(Array.isArray(page) ? page : []))
  return selectCheckRuns(all, options)
}

/**
 * Did every required check finish successfully on this exact commit?
 *
 * `status` matters independently of `conclusion`: a run that is `in_progress` has a
 * `null` conclusion, and treating that as "not failure" would let a release start
 * while CI is still deciding.
 */
export function summarizeForRelease(checks, requiredNames, commit) {
  const problems = []
  for (const name of requiredNames) {
    const entry = checks[name]
    if (!entry) {
      problems.push({ code: 'check-missing', name, detail: 'no run recorded' })
      continue
    }
    if (entry.headSha !== commit) {
      problems.push({
        code: 'check-wrong-sha',
        name,
        detail: `ran on ${entry.headSha ?? '<unknown>'}`,
      })
      continue
    }
    if (entry.status !== 'completed') {
      problems.push({
        code: 'check-incomplete',
        name,
        detail: `status ${entry.status ?? '<unknown>'}`,
      })
      continue
    }
    if (entry.conclusion !== 'success') {
      problems.push({
        code: 'check-not-success',
        name,
        detail: `conclusion ${entry.conclusion ?? '<null>'}`,
      })
    }
  }
  return problems
}
