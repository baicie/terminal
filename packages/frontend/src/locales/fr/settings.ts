export default {
  // Settings
  'settings.settings': 'Paramètres',
  'settings.title': 'Paramètres',
  'settings.description':
    'Configurez les préférences de votre application terminal',
  'settings.appearance': 'Apparence',
  'settings.terminal': 'Terminal',
  'settings.general': 'Général',
  'settings.connection': 'Connexion',
  'settings.storage': 'Stockage',
  'settings.team': 'Équipe',
  'settings.data': 'Données',
  'settings.sync': 'Synchronisation',
  'settings.light': 'Clair',
  'settings.dark': 'Sombre',
  'settings.system': 'Système',
  'settings.english': 'English',
  'settings.chinese': '中文',
  'settings.french': 'Français',
  'settings.blockCursor': 'Bloc',
  'settings.underlineCursor': 'Souligné',
  'settings.barCursor': 'Barre',
  'settings.exportData': 'Exporter les données',
  'settings.exportDesc':
    'Exportez tous les hôtes, groupes, snippets et paramètres vers un fichier JSON pour la sauvegarde ou la synchronisation.',
  'settings.exportJson': 'Exporter en fichier JSON',
  'settings.importData': 'Importer les données',
  'settings.importDesc':
    'Sélectionnez un fichier JSON précédemment exporté pour importer des données.',
  'settings.selectImportFile': 'Sélectionner le fichier',
  'settings.importPreview': "Aperçu de l'importation :",
  'settings.hosts': '{count} hôte(s)',
  'settings.groups': '{count} groupe(s)',
  'settings.snippets': '{count} snippet(s)',
  'settings.snippetPackages': '{count} forfait(s) snippet',
  'settings.importMode': "Mode d'importation",
  'settings.merge': 'Fusionner',
  'settings.mergeDesc':
    'Les nouveaux éléments seront ajoutés, les éléments existants seront conservés.',
  'settings.replace': 'Remplacer',
  'settings.replaceDesc':
    'Les éléments existants avec le même ID seront écrasés.',
  'settings.importing': 'Importation...',
  'settings.importSuccess': 'Importation réussie !',
  'settings.securityWarning':
    "Les données sont exportées au format JSON brut. Les informations sensibles comme les mots de passe peuvent être incluses. Gardez vos fichiers d'exportation en sécurité.",

  // Appearance
  'settings.theme': 'Thème',
  'settings.language': 'Langue',

  // Terminal
  'settings.font': 'Police',
  'settings.fontSize': 'Taille de police',
  'settings.fontFamily': 'Famille de police',
  'settings.cursor': 'Curseur',
  'settings.cursorStyle': 'Style du curseur',
  'settings.cursorBlink': 'Clignotement du curseur',
  'settings.cursorBlinkDesc': "Activer l'animation de clignotement du curseur",
  'settings.scrollback': 'Historique',
  'settings.scrollbackLines': "Lignes d'historique",
  'settings.scrollbackDesc':
    "Nombre de lignes à conserver dans le tampon d'historique",
  'settings.terminalTheme': 'Thème du terminal',
  'settings.terminalThemeDesc':
    'Choisissez un thème de couleur pour le terminal',

  // Connection
  'settings.selection': 'Sélection et presse-papiers',
  'settings.copyOnSelect': 'Copier à la sélection',
  'settings.copyOnSelectDesc':
    'Copier automatiquement la sélection dans le presse-papiers',
  'settings.pasteOnMiddleClick': 'Coller au clic molette',
  'settings.pasteOnMiddleClickDesc':
    'Coller le contenu du presse-papiers au clic de la molette',
  'settings.advanced': 'Avancé',
  'settings.allowProposedApi': "Autoriser l'API proposée",
  'settings.allowProposedApiDesc':
    'Activer les fonctionnalités API proposées de xterm.js',

  // Storage
  'settings.storageMode': 'Mode de stockage',
  'settings.storageModeDesc':
    'Choisissez comment vos données sont stockées. Le mode local garde tout sur cet appareil. Le mode service permet la synchronisation sur plusieurs appareils via un serveur distant.',
  'settings.local': 'Local',
  'settings.localDesc': 'SQLite sur cet appareil',
  'settings.service': 'Service',
  'settings.serviceDesc': 'Synchronisation via serveur distant',
  'settings.syncService': 'Service de synchronisation',
  'settings.syncServiceDesc':
    'Configurez un service distant pour synchroniser vos données sur plusieurs appareils. Les identifiants sont stockés localement.',
  'settings.serviceType': 'Type de service',
  'settings.endpoint': 'URL du point de terminaison',
  'settings.username': "Nom d'utilisateur",
  'settings.password': 'Mot de passe',
  'settings.bucket': 'Nom du bucket',
  'settings.testing': 'Test...',
  'settings.connected': 'Connecté',
  'settings.failed': 'Échoué',
  'settings.testConnection': 'Tester la connexion',
  'settings.syncNow': 'Synchroniser maintenant',
  'settings.syncing': 'Synchronisation...',
  'settings.lastSync': 'Dernière sync',
  'settings.never': 'Jamais',
  'settings.restoreMode': 'Mode de restauration',
  'settings.restoreFromServer': 'Restaurer depuis le serveur',
  'settings.restoring': 'Restauration...',
  'settings.noBackupFound': 'Aucune sauvegarde trouvée',
  'settings.noBackupFoundDesc': "Il n'y a pas de données de sauvegarde sur le serveur à restaurer",
  'settings.syncSuccess': 'Synchronisation réussie',
  'settings.syncFailed': 'Échec de la synchronisation',
  'settings.restoreSuccess': 'Restauration réussie',
  'settings.restoreFailed': 'Échec de la restauration',
  'settings.serviceModeEnabled': 'Mode service activé',
  'settings.serviceModeEnabledDesc':
    'Vos données se synchroniseront avec le service de stockage configuré. Cliquez d\'abord sur "Tester la connexion" pour vérifier que le service est accessible.',
  'settings.connectionServiceNotReachable': "Le service a répondu mais n'est pas en bonne santé",
  'settings.connectionUploadFailed': "Échec de l'envoi des données au serveur",
  'settings.connectionNoBackupFound': "Il n'y a pas de données de sauvegarde sur le serveur à restaurer",
  'settings.enterEndpoint':
    "Veuillez entrer une URL de point de terminaison pour tester la connexion",

  // Team
  'settings.teamCollaboration': "Collaboration d'équipe",
  'settings.teamCollaborationDesc':
    "Activez les fonctionnalités d'équipe pour partager les hôtes et les snippets avec les membres de votre équipe.",
  'settings.teamEnabled': 'Mode équipe activé',
  'settings.teamEnabledDesc':
    'La navigation Équipe est visible dans la barre latérale. Gérez vos équipes depuis la vue Équipe.',
  'settings.teamDisabled': 'Mode équipe désactivé',
  'settings.teamDisabledDesc':
    'Activez le mode équipe pour collaborer avec les membres de votre équipe.',
  'settings.openTeams': 'Ouvrir la vue Équipe',
  'settings.enableTeam': 'Activer le mode équipe',
  'settings.serverConfig': 'Configuration du serveur',
  'settings.serverConfigDesc':
    "Configurez un serveur d'équipe auto-hébergé pour la synchronisation cloud. Laissez vide pour le mode local uniquement.",
  'settings.mode': 'Mode',
  'settings.cloud': 'Cloud',
  'settings.cloudModeDesc': 'Synchronisation via serveur',
  'settings.localModeDesc': 'Exporter/Importer des fichiers JSON',
  'settings.serverEndpoint': 'Point de terminaison du serveur',
  'settings.serverEndpointDesc': "L'URL de votre serveur d'équipe auto-hébergé",
  'settings.apiToken': 'Jeton API',
  'settings.enterApiToken': 'Entrez votre jeton API',
  'settings.apiTokenDesc':
    "Obtenez votre jeton API auprès de l'administrateur du serveur ou créez-en un dans les paramètres de votre compte",
  'settings.autoSync': 'Synchronisation auto',
  'settings.autoSyncDesc':
    'Synchroniser automatiquement les données avec le serveur',
  'settings.syncInterval': 'Intervalle de synchronisation',
  'settings.seconds15': '15 secondes',
  'settings.seconds30': '30 secondes',
  'settings.minute1': '1 minute',
  'settings.minutes5': '5 minutes',
  'settings.minutes10': '10 minutes',
  'settings.saveConfig': 'Enregistrer la configuration',
  'settings.enterEndpointTeam':
    'Veuillez entrer le point de terminaison du serveur',
  'settings.connectionSuccess': 'Connexion réussie !',
  'settings.connectionFailed': 'Échec de la connexion',
  'settings.teamSettingsSaved': "Paramètres d'équipe enregistrés",

  // Actions
  'settings.import': 'Importer',
  'settings.exporting': 'Exportation...',
  'settings.tryAgain': 'Réessayer',
  'settings.saved': 'Paramètres enregistrés',
  'settings.saveFailed': "Échec de l'enregistrement des paramètres",
}
