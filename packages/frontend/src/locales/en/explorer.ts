/**
 * Connection Explorer strings.
 *
 * Every entry is a sentence a person reads, not a key with words in it: the
 * parity test compares key sets across locales, and a missing key shows the raw
 * key name to the user.
 */
export default {
  'explorer.title': 'Connections',
  'explorer.searchPlaceholder': 'Search hosts…',
  'explorer.recent': 'Recent',
  'explorer.favorites': 'Favorites',
  'explorer.ungrouped': 'Ungrouped',
  'explorer.empty': 'No saved hosts yet. Add one with the + button.',
  'explorer.noMatches': 'No host matches “{{query}}”',
  'explorer.count_one': '{{count}} host',
  'explorer.count_other': '{{count}} hosts',
  'explorer.connectTo': 'Connect to {{name}}',
  'explorer.editHost': 'Edit {{name}}',
  'explorer.addFavorite': 'Add {{name}} to favorites',
  'explorer.removeFavorite': 'Remove {{name}} from favorites',
  'explorer.loadFailed': 'Could not load connections',
  'explorer.dbUnavailableTitle': 'Storage unavailable',
  'explorer.dbUnavailable':
    'The host database cannot be opened in this environment. Existing sessions keep running.',
  'explorer.recentUnavailable': 'Recent connections are unavailable right now.',
  'explorer.justNow': 'just now',
  'explorer.minutesAgo_one': '{{count}} minute ago',
  'explorer.minutesAgo_other': '{{count}} minutes ago',
  'explorer.hoursAgo_one': '{{count}} hour ago',
  'explorer.hoursAgo_other': '{{count}} hours ago',
  'explorer.daysAgo_one': '{{count}} day ago',
  'explorer.daysAgo_other': '{{count}} days ago',
}
