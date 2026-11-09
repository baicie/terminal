export default {
  // Settings
  'settings.settings': 'Paramètres',
  'settings.title': 'Paramètres',
  'settings.description':
    'Configurez les préférences de votre application terminal',
  'settings.appearance': 'Apparence',
  'settings.terminal': 'Terminal',
  'settings.shortcutsTab': 'Raccourcis',
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
  'settings.hosts': '{{count}} hôte(s)',
  'settings.groups': '{{count}} groupe(s)',
  'settings.snippets': '{{count}} snippet(s)',
  'settings.snippetPackages': '{{count}} forfait(s) snippet',
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
    "Le fichier exporté ne contient aucun mot de passe ni clé privée. Chaque hôte ne conserve qu'une description des identifiants qu'il avait ; une restauration sur un autre appareil vous demandera de les redéfinir.",
  'settings.importSecretsTitle': 'Cette sauvegarde contient des identifiants en clair',
  'settings.importSecretsDesc':
    "Une sauvegarde produite par une ancienne version stocke les mots de passe et les clés privées dans le fichier. Choisissez ce qu'il advient d'eux.",
  'settings.importSecretsNone': 'Ce fichier ne contient aucun identifiant en clair.',
  'settings.importSecretsCounts':
    '{{hostPasswords}} mot(s) de passe d\'hôte, {{hostPrivateKeys}} clé(s) privée(s) d\'hôte, {{sshKeyPrivateKeys}} clé(s) privée(s) de clé, {{sshKeyPassphrases}} phrase(s) secrète(s).',
  'settings.importSecretsMigrate': 'Les déplacer vers le coffre',
  'settings.importSecretsMigrateDesc':
    "Écrit chaque valeur dans le coffre de cet appareil, la relit, puis n'importe qu'une référence. Le coffre doit être déverrouillé.",
  'settings.importSecretsDiscard': 'Importer sans les identifiants',
  'settings.importSecretsDiscardDesc':
    "Importe les hôtes et les clés comme métadonnées seulement. Chacun devra être reconfiguré avant de pouvoir se connecter.",
  'settings.importSecretsCancel': "Ne pas importer",
  'settings.importNeedsRebind': '{{count}} élément(s) importé(s) sans identifiants',
  'settings.importNeedsRebindDesc':
    "Ceux-ci nécessitent un mot de passe ou une clé avant de pouvoir se connecter :",

  'settings.migrationTitle': 'Identifiants stockés en clair',
  'settings.migrationDesc':
    "Les hôtes et les clés enregistrés par une ancienne version peuvent encore contenir leur mot de passe ou leur clé privée dans la base locale. Les déplacer vers le coffre efface ces colonnes.",
  'settings.migrationChecking': 'Vérification de la base...',
  'settings.migrationWarning':
    "Une sauvegarde de la base est effectuée d'abord. Effacer une colonne ne réécrit pas un ancien WAL ni un fichier d'export existant ; protégez-les aussi.",
  'settings.migrationRun': 'Déplacer les identifiants en clair vers le coffre',
  'settings.migrationCounts':
    '{{hosts}} hôte(s) et {{keys}} clé(s) déplacés ; {{failed}} échec(s).',
  'settings.migrationSnapshot': 'Sauvegarde de la base : {{path}}',
  'settings.migrationVerified':
    'Vérifié : aucune colonne en clair ne subsiste et chaque référence se résout dans le coffre.',
  'settings.migrationVerifyFailed':
    'La vérification a trouvé {{count}} problème(s) — certaines lignes peuvent encore nécessiter une action.',
  'settings.migrationSucceeded': 'Identifiants déplacés vers le coffre.',
  'settings.migrationPartial':
    '{{failed}} ligne(s) n\'ont pas pu être migrées et conservent leur clair.',
  'settings.migrationVaultUnavailable':
    "Le coffre n'est pas disponible. Créez-le ou déverrouillez-le, puis relancez.",

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
  'settings.previewChanges': 'Aperçu des modifications',
  'settings.refreshPreview': "Actualiser l'aperçu",
  'settings.conflictDetails': 'Détails du conflit',
  'settings.restoring': 'Restauration...',
  'settings.noBackupFound': 'Aucune sauvegarde trouvée',
  'settings.noBackupFoundDesc':
    "Il n'y a pas de données de sauvegarde sur le serveur à restaurer",
  'settings.syncSuccess': 'Synchronisation réussie',
  'settings.syncFailed': 'Échec de la synchronisation',
  'settings.restoreSuccess': 'Restauration réussie',
  'settings.restoreFailed': 'Échec de la restauration',
  'settings.serviceModeEnabled': 'Mode service activé',
  'settings.serviceModeEnabledDesc':
    'Vos données se synchroniseront avec le service de stockage configuré. Cliquez d\'abord sur "Tester la connexion" pour vérifier que le service est accessible.',
  'settings.connectionServiceNotReachable':
    "Le service a répondu mais n'est pas en bonne santé",
  'settings.connectionUploadFailed': "Échec de l'envoi des données au serveur",
  'settings.connectionNoBackupFound':
    "Il n'y a pas de données de sauvegarde sur le serveur à restaurer",
  'settings.enterEndpoint':
    'Veuillez entrer une URL de point de terminaison pour tester la connexion',

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
  'settings.showApiToken': 'Afficher le jeton API',
  'settings.hideApiToken': 'Masquer le jeton API',
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

  // Textes transversaux des paramètres (nettoyage i18n, 2026-11-07)
  'settings.localExportImport': 'Export / Import local',
  'settings.exportImportDesc': "Exportez ou importez vos données au format JSON, indépendamment du mode équipe.",
  'settings.importFromFileDesc': "Importez des données depuis un fichier JSON exporté. Prend en charge les exports complets et les paquets d'équipe.",
  'settings.cursorBlock': 'Bloc',
  'settings.cursorUnderline': 'Souligné',
  'settings.cursorBar': 'Barre',
  'settings.region': 'Région',
  'settings.clickToApply': 'Cliquer pour appliquer',
  'settings.teamModeEnabled': 'Mode équipe activé',
  'settings.teamModeDisabled': 'Mode équipe désactivé',
  'settings.updates': 'Mises à jour',
  'settings.currentVersionReading': 'Version actuelle : lecture…',
  'settings.currentVersion': 'Version actuelle',
  'settings.versionNotReported': 'non signalée par ce runtime',
  'settings.updateDesktopOnly': "La vérification des mises à jour nécessite l'application de bureau.",
  'settings.updateDesktopOnlyHint': 'Cette fenêtre fonctionne sans le plugin de mise à jour.',
  'settings.updateLatest': 'Vous êtes sur la dernière version.',
  'settings.updateLatestVersion': 'Vous êtes sur la dernière version ({{version}}).',
  'settings.updateAvailable': 'La version {{version}} est disponible.',
  'settings.updateInstallBlocked': "L'installation depuis cet écran reste bloquée volontairement : la clé publique de mise à jour compilée dans cette version est un placeholder, donc le paquet téléchargé ne peut pas être vérifié. Téléchargez la version publiée et installez-la par-dessus.",
  'settings.updateNoSigning': "Cette version n'est pas signée par Apple ou Windows. Une vérification lit uniquement le manifeste ; l'installation vérifie la signature et échoue par défaut tant que la clé publique est un placeholder.",
  'settings.updateFailed': 'La vérification des mises à jour a échoué.',
  'settings.updateOffline': 'Cet appareil est hors ligne.',
  'settings.updateOfflineHint': 'Sans réseau, impossible de joindre le serveur de publication. Reconnectez-vous et réessayez.',
  'settings.updateTimeout': "Le serveur de publication n'a pas répondu à temps.",
  'settings.updateTimeoutHint': "La requête a expiré. Le point de terminaison est peut-être lent ou bloqué ; réessayez.",
  'settings.updateUnreachable': 'Le serveur de publication est injoignable.',
  'settings.updateUnreachableHint': "Le point de terminaison a répondu par une erreur ou sans manifeste utilisable. Rien n'a été téléchargé.",
  'settings.updateUnconfigured': "La vérification des mises à jour n'est pas configurée dans cette version.",
  'settings.updateUnconfiguredHint': "Aucun point de terminaison n'est activé ou la clé publique est encore un placeholder ; cette version refuse de faire confiance au manifeste.",
  'settings.updateSignature': 'La mise à jour a échoué à la vérification de signature et a été rejetée.',
  'settings.updateSignatureHint': "Le manifeste ou le paquet ne correspond pas à la clé de confiance. Le programme de mise à jour échoue par défaut et n'installe rien.",
  'settings.sshKeys': '{{count}} clé(s) SSH',
  'settings.workspaces': '{{count}} espace(s) de travail',
  'settings.knownHosts': '{{count}} hôte(s) connu(s)',
  'settings.checking': 'Vérification…',
  'settings.checkForUpdates': 'Rechercher des mises à jour',
  'settings.loadFailed': 'Échec du chargement des paramètres.',
  'settings.saving': 'Enregistrement…',
  'settings.unsavedChanges': 'Modifications non enregistrées',
}
