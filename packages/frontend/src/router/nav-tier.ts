/**
 * Sidebar tiers.
 *
 * A terminal a person opens every day should show the things they use every day
 * first. Tiering is presentational: every route keeps working, and nothing is
 * hidden — `advanced` items are still listed, just below the daily ones.
 */

export type NavTier = 'primary' | 'secondary' | 'advanced'

/** Where an item sits when it does not say. */
export const DEFAULT_NAV_TIER: NavTier = 'primary'

export function navTierOf(item: { tier?: NavTier }): NavTier {
  return item.tier ?? DEFAULT_NAV_TIER
}
