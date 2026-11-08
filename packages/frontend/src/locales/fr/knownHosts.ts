export default {
  // Known Hosts
  'knownHosts.title': 'Hôtes connus',
  'knownHosts.searchHosts': 'Rechercher des hôtes connus...',
  'knownHosts.import': 'Importer',
  'knownHosts.noKnownHosts': 'Aucun hôte connu',
  'knownHosts.importFromFile':
    'Importer des hôtes depuis le fichier known_hosts SSH',
  'knownHosts.clearAll': 'Tout effacer',
  'knownHosts.description':
    "Sauvegardez les empreintes dans l'application ; la confiance SSH utilise le fichier OpenSSH .ssh/known_hosts de votre répertoire personnel",
  'knownHosts.emptyDescription':
    "Importez une copie de sauvegarde ; mettez à jour séparément votre fichier OpenSSH .ssh/known_hosts pour faire confiance à un hôte",
  'knownHosts.portLabel': 'Port {{port}}',
  'knownHosts.detailsDescription':
    "Sauvegarde de l'application uniquement ; cet enregistrement ne contrôle pas la confiance SSH.",
  'knownHosts.keyType': 'Type de clé :',
  'knownHosts.port': 'Port :',
  'knownHosts.fingerprint': 'Empreinte :',
  'knownHosts.added': 'Ajouté : {{date}}',
  'knownHosts.deleteTitle': "Supprimer l'hôte connu",
  'knownHosts.deleteConfirm':
    "Supprimer la sauvegarde de \"{{hostname}}\" dans l'application ? Cela ne retire pas la confiance de votre fichier OpenSSH .ssh/known_hosts.",
  'knownHosts.clearAllTitle': 'Effacer tous les hôtes connus',
  'knownHosts.clearAllConfirm':
    "Supprimer les {{count}} enregistrements de sauvegarde de l'application ? Cela ne modifie pas votre fichier OpenSSH .ssh/known_hosts.",
  'knownHosts.importTitle': 'Importer des hôtes connus',
  'knownHosts.importDescription':
    "Cette opération importe une copie de sauvegarde dans l'application uniquement. Elle ne met pas à jour votre fichier OpenSSH .ssh/known_hosts et ne modifie pas la confiance SSH. Format pris en charge : OpenSSH known_hosts.",
  'knownHosts.importContentLabel': 'Contenu des hôtes connus',
  'knownHosts.importPlaceholder': 'Collez le contenu de known_hosts ici...',
  'knownHosts.invalidImport':
    'Aucune entrée SSH connue valide trouvée. Le format doit être : hostname ssh-rsa KEY',
}
