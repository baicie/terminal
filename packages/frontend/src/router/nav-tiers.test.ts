// Terminal-first navigation: the daily entries come first, everything else is
// still reachable, and opening the app lands on the terminal layer.

import { describe, expect, it } from 'vitest'
import { getNavItemsByTier, getVisibleNavItems } from './nav-config'
import { buildRoutes } from './nav-config'

describe('navigation tiers', () => {
  it('keeps terminal, hosts and SFTP as the primary tier', () => {
    const primary = getNavItemsByTier('primary').map(item => item.path)
    expect(primary).toContain('/hosts')
    expect(primary).toContain('/sftp')
    // The dev-only experiments entry is shown in dev builds; it is not a daily
    // entry, so it must not be the only thing deciding this assertion.
    expect(primary.filter(path => path !== '/experiments')).toEqual([
      '/hosts',
      '/sftp',
    ])
  })

  it('demotes team, vault, known hosts and logs out of the primary tier', () => {
    const primary = getNavItemsByTier('primary').map(item => item.path)
    for (const advanced of ['/teams', '/vaults', '/known-hosts', '/logs']) {
      expect(primary).not.toContain(advanced)
    }
  })

  it('loses no navigation entry: every item belongs to exactly one tier', () => {
    const all = getVisibleNavItems()
    const tiered = [
      ...getNavItemsByTier('primary'),
      ...getNavItemsByTier('secondary'),
      ...getNavItemsByTier('advanced'),
    ]
    expect(tiered.map(item => item.path).sort()).toEqual(
      all.map(item => item.path).sort(),
    )
  })

  it('keeps every route reachable', () => {
    const paths = buildRoutes().map((route: { path?: string }) => route.path ?? '(index)')
    for (const path of [
      'hosts',
      'sftp',
      'keychain',
      'port-forward',
      'snippets',
      'known-hosts',
      'logs',
      'settings',
      'teams',
      'vaults',
    ]) {
      expect(paths).toContain(path)
    }
  })
})

describe('startup route', () => {
  it('makes the index route the terminal layer, not the host list', () => {
    const indexRoute = buildRoutes().find((route: { index?: boolean }) => route.index === true)
    expect(indexRoute).toBeDefined()
    // The terminal is rendered by the always-mounted layer in the layout; a route
    // element here would mount a second TerminalContainer for the same tab.
    expect(indexRoute?.element).toBeNull()
  })
})
