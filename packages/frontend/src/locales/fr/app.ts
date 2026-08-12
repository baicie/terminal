export default {
  // App layout
  'app.name': 'Terminal',
  'app.version': 'Terminal v1.0',

  // Navigation sidebar
  'nav.hosts': 'Hôtes',
  'nav.teams': 'Équipes',
  'nav.keychain': 'Trousseau',
  'nav.portForward': 'Transfert de port',
  'nav.snippets': 'Extraits',
  'nav.knownHosts': 'Hôtes connus',
  'nav.logs': 'Journaux',
  'nav.sftp': 'SFTP',
  'nav.scripts': 'Scripts',
  'nav.settings': 'Paramètres',
  'nav.experiments': 'Expériences',

  // Top toolbar
  'toolbar.toggleSidebar': 'Afficher/masquer la barre latérale',
  'toolbar.sftp': 'SFTP',
  'toolbar.newTab': 'Nouvel onglet',
  'toolbar.more': 'Plus',
  'toolbar.serial': 'Série',
  'toolbar.commandPalette': 'Palette de commandes',
  'toolbar.commandHistory': 'Historique des commandes',
  'toolbar.notifications': 'Notifications',

  // Tabs
  'tabs.splitVertical': 'Diviser verticalement',
  'tabs.splitHorizontal': 'Diviser horizontalement',
  'tabs.closeSplit': 'Fermer la division',
  'tabs.home': 'Accueil',

  // Shortcuts help dialog
  'shortcuts.title': 'Raccourcis clavier',
  'shortcuts.description':
    'Tous les raccourcis disponibles. Appuyez sur ? ou Cmd/Ctrl + / à tout moment.',
  'shortcuts.search': 'Rechercher un raccourci...',
  'shortcuts.empty': 'Aucun raccourci correspondant',
  'shortcuts.action': 'Action',
  'shortcuts.keys': 'Touches',

  // Terminal context menu
  'terminal.copy': 'Copier',
  'terminal.paste': 'Coller',
  'terminal.selectAll': 'Tout sélectionner',
  'terminal.clear': 'Effacer',
  'terminal.search': 'Rechercher',
  'terminal.zoomIn': 'Agrandir',
  'terminal.zoomOut': 'Réduire',
  'terminal.showTools': 'Afficher les outils',
  'terminal.hideTools': 'Masquer les outils',
  'terminal.fullscreen': 'Plein écran',
  'terminal.exitFullscreen': 'Quitter le plein écran',
  'terminal.resetZoom': 'Réinitialiser le zoom',
  'terminal.splitVertical': 'Diviser verticalement',
  'terminal.splitHorizontal': 'Diviser horizontalement',
  'terminal.closeTab': "Fermer l'onglet",
  'terminal.copyEmpty': 'Aucune sélection',
  'terminal.pasteEmpty': 'Presse-papiers vide',
  'terminal.searchPlaceholder': 'Rechercher dans le terminal…',
  'terminal.searchNext': 'Correspondance suivante',
  'terminal.searchPrev': 'Correspondance précédente',
  'terminal.searchCaseSensitive': 'Respecter la casse',
  'terminal.searchWholeWord': 'Mot entier',
  'terminal.searchRegex': 'Expression régulière',
  'terminal.windowUnfocused':
    'Fenêtre inactive — la saisie est envoyée au terminal en arrière-plan',

  // Settings
  'settings.copyOnSelect': 'Copier à la sélection',
  'settings.copyOnSelectDesc':
    'Copier automatiquement le texte sélectionné dans le presse-papiers',
  'settings.pasteOnMiddleClick': 'Coller au clic du milieu',
  'settings.pasteOnMiddleClickDesc':
    'Coller le contenu du presse-papiers via le bouton central de la souris',
  'settings.allowProposedApi': 'Autoriser les API proposées',
  'settings.allowProposedApiDesc':
    'Activer les API expérimentales de xterm.js (requises par le module image)',
  'settings.desktopSection': 'Expérience bureau',
  'settings.minimizeToTray': "Minimiser dans la barre d'état à la fermeture",
  'settings.minimizeToTrayDesc':
    "Masquer la fenêtre au lieu de quitter ; l'application continue dans la barre d'état",
  'settings.nativeNotifications': 'Notifications système natives',
  'settings.nativeNotificationsDesc':
    "Afficher des notifications OS à la déconnexion ou à la fin d'une tâche longue",
  'settings.notifyOnlyWhenUnfocused': 'Uniquement si la fenêtre est inactive',
  'settings.notifyOnlyWhenUnfocusedDesc':
    'Ne pas envoyer de notifications natives quand la fenêtre est au premier plan',

  // Shortcuts
  'settings.shortcuts.tip':
    'Cliquez sur un raccourci pour le reconfigurer. Appuyez sur Échap pour annuler.',
  'settings.shortcuts.recording': 'Enregistrement...',
  'settings.shortcuts.enabled': 'Actif',
  'settings.shortcuts.disabled': 'Inactif',
  'settings.shortcuts.resetToDefault': 'Réinitialiser',
  'settings.shortcuts.resetAll': 'Tout réinitialiser',
  'settings.shortcuts.searchPlaceholder': 'Rechercher des raccourcis...',
  'settings.shortcuts.noResults': 'Aucun raccourci trouvé',
  'settings.shortcuts.conflictWith': 'Conflit avec',
  'settings.shortcuts.resetSuccess': 'Raccourcis réinitialisés',
  'settings.shortcuts.recordingHint':
    'Appuyez sur une combinaison de touches pour lier, ou Échap pour annuler...',

  // SFTP transfer queue
  'sftp.transfersTitle': 'Transferts',
  'sftp.transferActive_one': '{{count}} en cours',
  'sftp.transferActive_other': '{{count}} en cours',
  'sftp.transferErrors_one': '{{count}} échec',
  'sftp.transferErrors_other': '{{count}} échecs',
  'sftp.transferEta': '{{eta}} restantes',
  'sftp.transferDone': 'Terminé',
  'sftp.clearFinished': 'Effacer terminés',
  'sftp.dropToUpload': 'Déposez les fichiers pour les envoyer dans {{path}}',

  // Common actions
  'common.save': 'Enregistrer',
  'common.cancel': 'Annuler',
  'common.delete': 'Supprimer',
  'common.edit': 'Modifier',
  'common.add': 'Ajouter',
  'common.new': 'Nouveau',
  'common.copied': 'Copié dans le presse-papiers',
  'common.refresh': 'Actualiser',
  'common.search': 'Rechercher',
  'common.loading': 'Chargement...',
  'common.error': 'Erreur',
  'common.success': 'Succès',
  'common.confirm': 'Confirmer',
  'common.close': 'Fermer',
  'common.name': 'Nom',
  'common.description': 'Description',
  'common.actions': 'Actions',
  'common.settings': 'Paramètres',
  'common.language': 'Langue',
  'common.theme': 'Thème',
  'common.fontSize': 'Taille de police',
  'common.fontFamily': 'Police',
  'common.cursorStyle': 'Style du curseur',
  'common.cursorBlink': 'Curseur clignotant',
  'common.scrollback': 'Lignes de défilement',
  'common.copyOnSelect': 'Copier à la sélection',
  'common.pasteOnMiddleClick': 'Coller au clic molette',
  'common.allowProposedApi': "Autoriser l'API expérimentale",
  'common.retry': 'Réessayer',
  'common.goHome': "Retour à l'accueil",
  'common.errorOccurred': 'Une erreur est survenue',

  // Error boundary
  'error.title': 'Échec du chargement de la page',
  'error.message': '{{message}}',

  // Common (for experiments)
  'common.back': 'Retour',
  'common.clear': 'Effacer',
  'common.on': 'ON',
  'common.off': 'OFF',

  // Experiments page
  'experiments.recording': 'Enregistrement',
  'experiments.paused': 'En pause',
  'experiments.auto': 'Auto',
  'experiments.hide': 'Masquer',
  'experiments.show': 'Afficher',
  'experiments.controlChars': 'Caractères contrôle',
  'experiments.hex': 'Hex',
  'experiments.named': 'Nom',
  'experiments.eventLog': "Journal d'événements",
  'experiments.noEvents': "Pas d'événements...",
  'experiments.testDesc': 'Description du test :',
  'experiments.eventDesc1': 'événement : contient data et inputType',
  'experiments.eventDesc2':
    'événement : contient key, code, which et touches de modification',
  'experiments.eventDesc3':
    "Note : Certaines combinaisons (comme Ctrl+C) peuvent ne pas déclencher d'événements input",
  // Xterm test
  'experiments.xtermTitle': "Test d'entrée Xterm.js",
  'experiments.xtermDesc':
    "Surveiller les événements onData / onKey de l'instance Terminal xterm.js et les événements textarea sous-jacents",
  'experiments.xtermTerminal': 'Terminal Xterm',
  'experiments.xtermHint':
    'Cliquez sur le terminal et tapez pour voir les événements. Essayez les touches spéciales (flèches, Ctrl+C, etc.)',
  'experiments.eventExplanation': 'Explication des événements :',
  'experiments.onDataDesc':
    "Événement principal de données de xterm, contient toutes les données envoyées au PTY, y compris les caractères, les codes de contrôle et les séquences d'échappement.",
  'experiments.onKeyDesc':
    'Déclenché à chaque pression de touche, contient les informations key, code, which et touches de modification.',
  'experiments.textareaEventDesc':
    'Événements natifs du textarea sous-jacent. Note : textarea_input peut ne pas se déclencher sur certains navigateurs/plates-formes.',
  // Textarea test
  'experiments.textareaTitle': "Test d'entrée Textarea",
  'experiments.textareaDesc':
    "Surveiller les événements input / keydown / keyup de l'élément textarea",
  'experiments.textarea': 'Zone de texte',
  'experiments.textareaPlaceholder': 'Tapez quelque chose ici...',
  'experiments.textareaHint':
    'Cliquez sur cette zone de texte et tapez pour voir les événements capturés ci-dessous.',
  'experiments.copy': 'Copier',
  'experiments.copyEvents': "Copier le journal d'événements",
  'experiments.copied': 'Copié !',
  'experiments.copyFailed': 'Échec de la copie',
  // Terminal agent auth readable errors
  'terminal.errorTitle': 'Erreur du terminal',
  'terminal.agentNoPipe':
    'Aucun canal SSH agent trouvé. Démarrez le service Windows OpenSSH Authentication Agent, ou définissez SSH_AUTH_SOCK vers un canal valide.',
  'terminal.agentSockInvalid':
    "Le chemin de canal défini dans SSH_AUTH_SOCK n'existe pas. Vérifiez la configuration.",
  'terminal.agentPermissionDenied':
    "Accès refusé lors de l'ouverture du canal SSH agent. Assurez-vous que l'application et l'agent utilisent le même niveau de privilèges.",
  'terminal.agentNoIdentities':
    "Aucune identité (clé) disponible dans l'agent SSH.",
  'terminal.agentRejected':
    "Toutes les identités de l'agent SSH ont été rejetées par le serveur.",
  'terminal.agentReadFailed':
    "Impossible de lire les identités de l'agent SSH. Vérifiez l'état de l'agent.",
  'terminal.agentNotRunning':
    "Le service Windows OpenSSH Authentication Agent n'est pas en cours d'exécution. Démarrez-le via services.msc ou installez OpenSSH.",
  'terminal.agentPageantNotRunning':
    "Pageant (l'agent SSH PuTTY) ne semble pas être en cours d'exécution. Démarrez Pageant ou ajoutez des clés à l'agent Windows OpenSSH à la place.",
  'terminal.agentAccessDenied':
    "Accès refusé au canal de l'agent SSH. L'agent peut fonctionner sous une autre session utilisateur. Essayez d'exécuter l'application avec le même compte utilisateur.",
  'terminal.agentNotAvailable':
    "Le canal de l'agent SSH n'est pas disponible. Le service de l'agent peut avoir été arrêté.",
  'terminal.agentAuthFailed':
    "L'authentification par l'agent SSH a échoué. Consultez les journaux de l'agent pour plus de détails.",
  'terminal.agentUnixNoSocket':
    'Socket SSH_AUTH_SOCK introuvable sur Unix. Démarrez ssh-agent ou définissez SSH_AUTH_SOCK.',
  'terminal.connectionFailed':
    "Connexion échouée. Vérifiez l'adresse de l'hôte et le réseau.",
  'terminal.authFailed':
    "Échec de l'authentification. Vérifiez le nom d'utilisateur et les identifiants.",
  'terminal.hostKeyFailed':
    'Échec de la vérification de la clé hôte. Vérifiez known_hosts.',
  'terminal.sessionTimeout':
    "Délai d'expiration de la session. La connexion peut avoir été fermée.",
}
