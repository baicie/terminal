export default {
  // Écran d'échec de démarrage, affiché avant le chargement du chunk principal.
  'startup.failure.title': "Le terminal n'a pas pu démarrer",
  'startup.failure.description':
    "L'application a échoué avant que l'espace de travail soit prêt.",
  'startup.failure.details': "Détails du démarrage",
  'startup.failure.retry': 'Réessayer le démarrage',
  'startup.failure.hint':
    "Cela vient généralement d'une base de données locale indisponible ou verrouillée. Réessayer relance la récupération de l'espace de travail. Si l'échec persiste, redémarrez l'application ou consultez la vue Logs pour plus de détails.",
  // Shown when the app starts but the saved preferences could not be read.
  'startup.settingsRestoreFailed':
    "Vos paramètres enregistrés n'ont pas pu être chargés ; les valeurs par défaut sont utilisées. Consultez la vue Logs pour plus de détails.",
}
