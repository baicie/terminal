export default {
  // Port Forward
  'portForward.portForwards': 'Transferts de port',
  'portForward.addPortForward': 'Ajouter un transfert',
  'portForward.type': 'Type',
  'portForward.local': 'Local',
  'portForward.remote': 'Distant',
  'portForward.socksProxy': 'Proxy SOCKS',
  'portForward.addForward': 'Ajouter',
  'portForward.localForward': 'Transfert local (-L)',
  'portForward.remoteForward': 'Transfert distant (-R)',
  'portForward.dynamicForward': 'Transfert dynamique (-D)',
  'portForward.name': 'Nom',
  'portForward.myForward': 'Mon transfert',
  'portForward.stop': 'Arrêter',
  'portForward.start': 'Démarrer',
  'portForward.configured': '{{count}} transfert(s) configuré(s)',
  'portForward.noConfigured': 'Aucun transfert configuré',
  'portForward.socksDesc': 'Crée un proxy SOCKS sur {{host}}:{{port}}',
  'portForward.active': 'Actif',
  'portForward.stopped': 'Arrêté',
  'portForward.dynamic': 'Dynamique',
  'portForward.via': 'via {{host}}',

  // Port Forward view
  'portForwardView.title': 'Transfert de port',
  'portForwardView.searchForwards': 'Rechercher des transferts...',
  'portForwardView.newForward': 'Nouveau transfert',
  'portForwardView.addForward': 'Ajouter',
  'portForwardView.noForwards': 'Aucun transfert configuré',
  'portForwardView.forwardsDesc':
    'Configurez le transfert de port pour accéder aux bases de données, applications web et autres services',
  'portForwardView.remoteRequired': "L'hôte distant et le port sont requis",
  'portForwardView.invalidLocalPort': 'Numéro de port local invalide',
  'portForwardView.started': 'Transfert de port démarré sur {{address}}',
  'portForwardView.stopSuccess': 'Transfert de port arrêté',
  'portForwardView.startFailed':
    'Échec du démarrage du transfert de port : {{message}}',
  'portForwardView.stopFailed':
    "Échec de l'arrêt du transfert de port : {{message}}",
  'portForwardView.removed': 'Transfert de port supprimé',
  'portForwardView.loadFailed':
    'Échec du chargement des transferts de port : {{message}}',
  'portForwardView.stopTitle': 'Arrêter le transfert de port',
  'portForwardView.stopConfirm':
    'Arrêter « {{name}} » ? Toutes les connexions utilisant ce tunnel seront immédiatement fermées.',
  'portForwardView.savedNotStarted':
    "Règle enregistrée, mais aucune session SSH n'est connectée : le tunnel n'a pas été démarré.",
  'portForwardView.noSession':
    'Aucune session SSH connectée : le tunnel ne peut pas démarrer.',
  'portForwardView.startAction': 'Démarrer {{name}}',
  'portForwardView.stopAction': 'Arrêter {{name}}',
  'portForwardView.deleteAction': 'Supprimer {{name}}',
  'portForwardView.deleteTitle': 'Supprimer le transfert de port',
  'portForwardView.deleteConfirm':
    "Supprimer « {{name}} » ? La règle sera définitivement supprimée. Un tunnel actif n'est pas arrêté : arrêtez-le d'abord.",
}
