// The two endpoint checks must agree on what is allowed.
//
// ## The gap
//
// `checkEndpoint` (frontend) accepts a non-loopback `http://` endpoint when the user
// confirms it — `allowPlaintextRemote`. `check_endpoint` (Rust) refuses that same URL
// unconditionally:
//
//     "The frontend may have stored this after the user confirmed it. The transport
//      layer still refuses: consent recorded earlier is not a property of this request."
//
// Each side is tested. Nothing tested that they *agree*, so a user can confirm a
// plaintext remote endpoint, see it saved, and only discover at request time that it
// can never be used.
//
// ## What "agree" means here
//
// Not "identical": the transport refusing more than the UI is the right direction. The
// rule is that the UI must not accept something the transport will always reject —
// otherwise the save is a promise the app cannot keep.

import { describe, expect, it } from 'vitest'
import { checkEndpoint } from './model-profile'

/**
 * The Rust verdict, reproduced from `src-tauri/src/ai/endpoint.rs`.
 *
 * Kept as the literal rule rather than parsed from the Rust source: a drift here is
 * exactly what the pairing test below is for, and parsing source text would make the
 * test pass by agreeing with itself.
 */
function rustVerdict(endpoint: string): 'allowed' | 'refused' {
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    return 'refused'
  }
  if (url.protocol === 'https:') return 'allowed'
  if (url.protocol !== 'http:') return 'refused'
  const host = url.hostname
  const loopback =
    host === 'localhost' ||
    host === '::1' ||
    host === '[::1]' ||
    /^127\./.test(host)
  return loopback ? 'allowed' : 'refused'
}

const URLS = [
  'https://api.example.com/v1',
  'https://localhost/v1',
  'https://127.0.0.1/v1',
  'http://localhost:11434/v1',
  'http://127.0.0.1:8080/v1',
  'http://127.1.2.3:8080/v1',
  'http://[::1]:8080/v1',
  'http://api.example.com/v1',
  'ftp://example.com/v1',
  'not a url',
  '',
]

describe('there is no opt-in for plaintext remote', () => {
  it('the check takes no confirmation parameter', () => {
    /*
     * The defect was an opt-in: `checkEndpoint(url, true)` returned `ok` for a remote
     * http endpoint the transport always refuses. Removing the branch but keeping the
     * parameter would leave the same trap one default away — measured: restoring
     * `allowPlaintextRemote = false` kept the pairing test green, because no caller
     * passed it.
     *
     * So the assertion is on the signature: a function that cannot accept the argument
     * cannot honour it.
     */
    // `Function.length` stops at the first defaulted parameter, so it cannot see an
    // opt-in. The parameter list itself is the thing to read.
    const signature = checkEndpoint.toString().slice(0, checkEndpoint.toString().indexOf(')'))
    expect(
      signature,
      'checkEndpoint must declare exactly one parameter; a second is an opt-in',
    ).not.toMatch(/,/)
  })
})

describe('the frontend cannot accept what the transport will refuse', () => {
  it('no URL is accepted by the UI and refused by the Rust check', () => {
    const disagreements: string[] = []
    for (const url of URLS) {
      const ui = checkEndpoint(url)
      if (!ui.ok) continue
      if (rustVerdict(url) === 'refused') disagreements.push(url)
    }
    expect(
      disagreements,
      'the user can save these, then every request is refused — the save is a lie',
    ).toEqual([])
  })
})
