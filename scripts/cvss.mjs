#!/usr/bin/env node
/**
 * CVSS v3.1 base score, computed from the vector string alone.
 *
 * The specification's base-score equations are deterministic, so every number
 * this module prints can be recomputed by anyone holding the same vector. That
 * is the point of putting scores in the ledger: "9 条 high (7.5)" with no vector
 * and no formula is a claim, not evidence.
 *
 * Source: CVSS v3.1 Specification Document, section 7.1 (Base metrics
 * equations), 7.4 (metric weights) and section 5 (qualitative severity scale).
 * No network lookup and no estimation: an unscorable vector returns null rather
 * than a guess.
 */

// Metric weights, specification section 7.4. Privileges Required is
// scope-dependent, so it carries two tables.
const WEIGHT_AV = { N: 0.85, A: 0.62, L: 0.55, P: 0.2 }
const WEIGHT_AC = { L: 0.77, H: 0.44 }
const WEIGHT_PR_SCOPE_UNCHANGED = { N: 0.85, L: 0.62, H: 0.27 }
const WEIGHT_PR_SCOPE_CHANGED = { N: 0.85, L: 0.68, H: 0.5 }
const WEIGHT_UI = { N: 0.85, R: 0.62 }
const WEIGHT_IMPACT = { H: 0.56, L: 0.22, N: 0 }

// The eight base metrics a vector must define. A vector missing any of them is
// not a base vector and cannot be scored.
export const BASE_METRICS = ['AV', 'AC', 'PR', 'UI', 'S', 'C', 'I', 'A']

const LEGAL_VALUES = {
  AV: ['N', 'A', 'L', 'P'],
  AC: ['L', 'H'],
  PR: ['N', 'L', 'H'],
  UI: ['N', 'R'],
  S: ['U', 'C'],
  C: ['H', 'L', 'N'],
  I: ['H', 'L', 'N'],
  A: ['H', 'L', 'N'],
}

// Temporal and environmental metrics are legal in a vector string but play no
// part in the base score; they are accepted and ignored rather than rejected.
const NON_BASE_METRICS = ['E', 'RL', 'RC', 'CR', 'IR', 'AR', 'MAV', 'MAC', 'MPR', 'MUI', 'MS', 'MC', 'MI', 'MA']

/**
 * Split a vector string into its metrics.
 *
 * Accepts the real shape RustSec publishes - double-letter metric keys after a
 * `CVSS:3.1` prefix - and returns null for anything it cannot score, including
 * v2 vectors, bare metric strings with no version prefix, duplicated keys and
 * illegal values.
 */
export function parseCvssVector(vector) {
  if (typeof vector !== 'string') return null
  const trimmed = vector.trim()
  const head = /^CVSS:(\d+\.\d+)\/(.+)$/.exec(trimmed)
  if (!head) return null
  const [, version, body] = head
  // Only the 3.x weight tables live in this module. Scoring a v4.0 vector with
  // them would produce a confident wrong number, which is worse than no number.
  if (!version.startsWith('3.')) return null

  const metrics = {}
  for (const part of body.split('/')) {
    const pair = /^([A-Z]+):([A-Z]+)$/.exec(part)
    if (!pair) return null
    const [, key, value] = pair
    if (key in metrics) return null
    if (NON_BASE_METRICS.includes(key)) {
      metrics[key] = value
      continue
    }
    if (!(key in LEGAL_VALUES)) return null
    if (!LEGAL_VALUES[key].includes(value)) return null
    metrics[key] = value
  }

  if (!BASE_METRICS.every(key => key in metrics)) return null
  return { version, metrics, body }
}

/**
 * Round half up to one decimal place, specification section 7.1 Roundup().
 *
 * Plain `Math.ceil(value * 10) / 10` is not the same function: the spec's
 * integer-arithmetic form exists so that a float such as 7.4999999999999999
 * does not round up to 7.5.
 */
export function roundUp1(value) {
  const scaled = Math.round(value * 100000)
  if (scaled % 10000 === 0) return scaled / 100000
  return (Math.floor(scaled / 10000) + 1) / 10
}

/** Qualitative severity rating, specification section 5. */
export function severityRating(score) {
  if (!Number.isFinite(score)) return null
  if (score <= 0) return 'None'
  if (score < 4) return 'Low'
  if (score < 7) return 'Medium'
  if (score < 9) return 'High'
  return 'Critical'
}

/** Severity labels, worst first, so summaries always order columns the same way. */
export const SEVERITY_ORDER = ['Critical', 'High', 'Medium', 'Low', 'None']

/**
 * Base score and severity for a vector, or null when the vector cannot be
 * scored. Callers must treat null as "not published" and keep such entries out
 * of severity tallies instead of defaulting them to zero.
 */
export function cvssBaseScore(vector) {
  const parsed = parseCvssVector(vector)
  if (!parsed) return null
  const { metrics } = parsed
  const scopeChanged = metrics.S === 'C'

  const exploitability =
    8.22 *
    WEIGHT_AV[metrics.AV] *
    WEIGHT_AC[metrics.AC] *
    (scopeChanged ? WEIGHT_PR_SCOPE_CHANGED : WEIGHT_PR_SCOPE_UNCHANGED)[metrics.PR] *
    WEIGHT_UI[metrics.UI]

  const iss =
    1 -
    (1 - WEIGHT_IMPACT[metrics.C]) *
      (1 - WEIGHT_IMPACT[metrics.I]) *
      (1 - WEIGHT_IMPACT[metrics.A])

  const impact = scopeChanged
    ? 7.52 * (iss - 0.029) - 3.25 * (iss - 0.02) ** 15
    : 6.42 * iss

  // Section 7.1: no impact means no base score, whatever the exploitability.
  const score = impact <= 0 ? 0 : roundUp1(Math.min((scopeChanged ? 1.08 : 1) * (impact + exploitability), 10))

  return {
    version: parsed.version,
    metrics: parsed.body,
    score,
    severity: severityRating(score),
  }
}
