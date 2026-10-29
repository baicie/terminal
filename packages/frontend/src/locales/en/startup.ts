export default {
  // Startup failure screen, shown before the main application chunk loads.
  'startup.failure.title': 'Terminal could not start',
  'startup.failure.description':
    'The application failed before the workspace was ready.',
  'startup.failure.details': 'Startup details',
  'startup.failure.retry': 'Retry startup',
  'startup.failure.hint':
    'This is usually caused by the local database being unavailable or locked. Retrying re-runs workspace recovery. If it keeps failing, restart the app or check the Logs view for details.',
  // Shown when the app starts but the saved preferences could not be read.
  'startup.settingsRestoreFailed':
    'Your saved settings could not be loaded, so defaults are being used. Check the Logs view for details.',
}
