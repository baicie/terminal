/**
 * SPDX license classification, for the production license inventory.
 *
 * The question this module answers is not "what string is in the license
 * field" but "does this package put a copyleft obligation on us". Those differ
 * in a way that matters:
 *
 *   - "MIT OR GPL-3.0" names a copyleft license, yet carries no copyleft
 *     obligation: the OR lets us take MIT. Reporting it as copyleft would be a
 *     false alarm, and false alarms are how real findings get ignored.
 *   - "MIT AND GPL-3.0" names the same license and does carry the obligation,
 *     because AND means both apply.
 *
 * So an expression is resolved, not substring-matched. Each top-level OR branch
 * is a choice we may take; if any branch is free of copyleft terms, the
 * obligation is avoidable. Within a branch, AND means every term binds.
 *
 * Unknown license identifiers are never silently treated as permissive. An
 * unrecognized string is reported as 'unknown' so it shows up for a human,
 * because "we did not recognize it" and "it is fine" are different facts.
 */

/**
 * The categories, named once so callers compare against a constant instead of
 * retyping a string literal that a typo would silently turn into a miss.
 */
export const STRONG = 'strong-copyleft'
export const WEAK = 'weak-copyleft'
export const PERMISSIVE_CATEGORY = 'permissive'
export const UNKNOWN = 'unknown'
export const ABSENT = 'absent'

/** Categories that carry a copyleft obligation, in reporting order. */
export const COPYLEFT_CATEGORIES = [STRONG, WEAK]

/**
 * Copyleft that reaches the whole derived work. An AGPL dependency in a
 * distributed product is a genuine compliance problem, not a footnote.
 */
const STRONG_COPYLEFT = [
  /^AGPL-/,
  /^GPL-/,
  /^SSPL-/,
  /^OSL-/,
  /^EUPL-/,
  /^CeCILL-2/,
  /^NGPL$/,
  /^QPL-/,
  /^Sleepycat$/,
]

/**
 * File-level / weak copyleft: reciprocal for the component's own files, and it
 * does not relicense the product around it. Still an obligation (notice, and
 * source availability for that component), so it is reported — but reporting it
 * at the same volume as AGPL would be misleading.
 */
const WEAK_COPYLEFT = [
  /^LGPL-/,
  /^MPL-/,
  /^EPL-/,
  /^CDDL-/,
  /^CPL-/,
  /^CeCILL-C$/,
  /^MS-RL$/,
  /^Ms-RL$/,
  /^APSL-/,
  /^IPL-/,
  /^Artistic-1/,
]

/**
 * Identifiers we accept as permissive without further thought. Kept explicit
 * rather than "anything not matched above": an unknown identifier must not
 * default to permissive, which is the whole point of the 'unknown' category.
 */
const PERMISSIVE = [
  /^MIT$/,
  /^MIT-0$/,
  /^ISC$/,
  /^Apache-2\.0$/,
  /^BSD-2-Clause$/,
  /^BSD-3-Clause$/,
  /^BSD-3-Clause-Clear$/,
  /^0BSD$/,
  /^BlueOak-1\.0\.0$/,
  /^CC0-1\.0$/,
  /^CC-BY-3\.0$/,
  /^CC-BY-4\.0$/,
  /^Unlicense$/,
  /^WTFPL$/,
  /^Zlib$/,
  /^Python-2\.0$/,
  /^PSF-2\.0$/,
  /^BSL-1\.0$/,
  /^UPL-1\.0$/,
  /^Apache-1\.1$/,
]

/** Category of a single SPDX identifier (not an expression). */
export function classifyTerm(term) {
  const id = term.trim().replace(/^\(|\)$/g, '').trim()
  // "GPL-2.0-only WITH Classpath-exception-2.0": the exception changes the
  // obligation's reach, not whether there is one. Classify on the license.
  const head = id.split(/\s+WITH\s+/i)[0].trim()
  // A trailing "+" ("GPL-2.0+") means "or later"; same family either way.
  const normalized = head.replace(/\+$/, '')

  if (normalized === '') return UNKNOWN
  if (STRONG_COPYLEFT.some(re => re.test(normalized))) return STRONG
  if (WEAK_COPYLEFT.some(re => re.test(normalized))) return WEAK
  if (PERMISSIVE.some(re => re.test(normalized))) return PERMISSIVE_CATEGORY
  return UNKNOWN
}

/**
 * Split an SPDX expression on a top-level operator, respecting parentheses, so
 * "(MIT OR GPL-3.0) AND ISC" splits on AND into two parts rather than being
 * torn apart at the inner OR.
 */
export function splitTopLevel(expression, operator) {
  const parts = []
  let depth = 0
  let current = ''
  const tokens = expression.split(/(\s+|\(|\))/).filter(t => t !== '')

  for (const token of tokens) {
    if (token === '(') {
      depth += 1
      current += token
    } else if (token === ')') {
      depth -= 1
      current += token
    } else if (depth === 0 && token.trim().toUpperCase() === operator) {
      parts.push(current.trim())
      current = ''
    } else {
      current += token
    }
  }
  parts.push(current.trim())

  return parts.filter(p => p !== '')
}

/** Strip one layer of wrapping parentheses: "(MIT OR ISC)" -> "MIT OR ISC". */
function unwrap(expression) {
  const trimmed = expression.trim()
  if (!trimmed.startsWith('(') || !trimmed.endsWith(')')) return trimmed

  let depth = 0
  for (let index = 0; index < trimmed.length; index += 1) {
    if (trimmed[index] === '(') depth += 1
    else if (trimmed[index] === ')') {
      depth -= 1
      // The opening paren closes before the end, so it does not wrap the whole
      // expression ("(MIT) AND (ISC)") and must not be stripped.
      if (depth === 0 && index < trimmed.length - 1) return trimmed
    }
  }
  return unwrap(trimmed.slice(1, -1))
}

const RANK = {
  [PERMISSIVE_CATEGORY]: 0,
  [UNKNOWN]: 1,
  [WEAK]: 2,
  [STRONG]: 3,
}

/** The worse of two categories, by obligation weight. */
function worse(a, b) {
  return RANK[a] >= RANK[b] ? a : b
}

/**
 * Resolve a full SPDX expression to the obligation it actually imposes.
 *
 * Returns the effective category, every copyleft identifier named anywhere in
 * the expression (so a human can see what was considered even when an OR makes
 * it avoidable), and whether a copyleft term was present but escapable.
 */
export function classifyExpression(expression) {
  if (expression === null || expression === undefined || String(expression).trim() === '') {
    return {
      effective: ABSENT,
      terms: [],
      copyleftNamed: [],
      avoidable: false,
      conjunctive: false,
    }
  }

  const raw = String(expression).trim()
  // Non-SPDX free text ("SEE LICENSE IN LICENSE") is not parseable as an
  // expression; it needs a human to read the file, so say so rather than guess.
  if (/^SEE\s+LICENSE/i.test(raw) || raw.toUpperCase() === 'UNLICENSED') {
    return {
      effective: UNKNOWN,
      terms: [raw],
      copyleftNamed: [],
      avoidable: false,
      conjunctive: false,
    }
  }

  const inner = unwrap(raw)
  const branches = splitTopLevel(inner, 'OR')

  const named = new Set()
  const branchCategories = branches.map(branch => {
    const terms = splitTopLevel(unwrap(branch), 'AND')
    let category = PERMISSIVE_CATEGORY
    for (const term of terms) {
      const unwrapped = unwrap(term)
      // A nested expression ("(MIT OR GPL-3.0)" inside an AND) recurses.
      const termCategory = /\s(OR|AND)\s/i.test(unwrapped)
        ? (() => {
            const nested = classifyExpression(unwrapped)
            nested.copyleftNamed.forEach(n => named.add(n))
            return nested.effective
          })()
        : classifyTerm(unwrapped)

      if (termCategory === STRONG || termCategory === WEAK) {
        named.add(unwrap(term).trim())
      }
      category = worse(category, termCategory)
    }
    return category
  })

  // Any OR branch is a choice available to us, so the obligation is the
  // lightest branch, not the heaviest term.
  const effective = branchCategories.reduce(
    (best, current) => (RANK[current] < RANK[best] ? current : best),
    branchCategories[0] ?? UNKNOWN
  )

  const copyleftNamed = [...named].sort()
  return {
    effective,
    terms: branches,
    copyleftNamed,
    // A copyleft license is named, but an OR branch lets us avoid its terms.
    avoidable:
      copyleftNamed.length > 0 && effective !== STRONG && effective !== WEAK,
    // Every branch binds more than one license at once ("MIT AND ISC"):
    // permissive on both halves, but the notice obligations stack, so it is
    // worth a human read rather than being counted as a plain MIT row.
    conjunctive: branches.every(
      branch => splitTopLevel(unwrap(branch), 'AND').length > 1,
    ),
  }
}

/**
 * Read the license a package declares, and say where the value came from.
 *
 * npm's current field is `license`; some older packages only have the
 * deprecated `licenses` array (busboy, streamsearch both do). Falling back to
 * it turns two "no license field" rows into the MIT they actually are. A
 * package with neither is reported absent, never assumed permissive.
 */
export function readDeclaredLicense(manifest) {
  if (manifest && typeof manifest.license === 'string' && manifest.license.trim() !== '') {
    return { expression: manifest.license.trim(), source: 'license' }
  }
  // Object form: {"type": "MIT", "url": "..."} - long deprecated, still in the wild.
  if (manifest && manifest.license && typeof manifest.license === 'object') {
    const type = manifest.license.type
    if (typeof type === 'string' && type.trim() !== '') {
      return { expression: type.trim(), source: 'license.type' }
    }
  }
  if (Array.isArray(manifest?.licenses) && manifest.licenses.length > 0) {
    const types = manifest.licenses
      .map(entry => (typeof entry === 'string' ? entry : entry?.type))
      .filter(t => typeof t === 'string' && t.trim() !== '')
      .map(t => t.trim())
    if (types.length > 0) {
      // Multiple entries in the array are alternatives the package offers.
      return { expression: types.join(' OR '), source: 'licenses[]' }
    }
  }
  return { expression: null, source: ABSENT }
}
