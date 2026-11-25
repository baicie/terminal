// SSH host-key trust and preflight copy.
//
// Split out of `app.ts` when that file reached its 300-line limit, the same way
// `terminalDiagnostic.ts` was. Keys are unchanged; only the module moved.
export default {
  'terminal.hostKeyChangedTitle': "La clé d'hôte SSH a changé",
  'terminal.hostKeyTrustTitle': 'Faire confiance à cet hôte SSH ?',
  'terminal.hostKeyChangedDescription':
    "L'identité du serveur ne correspond plus à la clé enregistrée. La connexion a été bloquée.",
  'terminal.hostKeyTrustDescription':
    "Vérifiez cette empreinte auprès de l'administrateur du serveur avant de vous connecter.",
  'terminal.hostKeyJumpDescription':
    "Cette identité appartient à l'hôte de rebond utilisé pour atteindre la cible.",
  'terminal.hostKeyTargetDescription':
    "Cette identité appartient à la cible atteinte via l'hôte de rebond vérifié.",
  'terminal.hostKeyHost': 'Hôte',
  'terminal.hostKeyAlgorithm': 'Algorithme',
  'terminal.hostKeyFingerprint': 'Empreinte',
  'terminal.hostKeyChangedWarning':
    "Ne continuez pas avant d'avoir vérifié la clé enregistrée par un canal indépendant de cette connexion.",
  'terminal.hostKeyTrustOnce': 'Faire confiance une fois',
  'terminal.hostKeyTrustAndSave': 'Faire confiance et enregistrer',
  'terminal.hostKeyCheckingAria': "Vérification de la clé d'hôte SSH",
  'terminal.hostKeyChecking': "Vérification de la clé d'hôte SSH...",
  'terminal.hostKeyVerifyFailed': "Impossible de vérifier la clé d'hôte SSH",
  'terminal.hostKeyFailed':
    'Échec de la vérification de la clé hôte. Vérifiez known_hosts.',
  'terminal.hostKeyUnreachable': "Le serveur n'a pas répondu",
  'terminal.hostKeyHandshakeFailed': "Le serveur a répondu, mais sans clé d'hôte SSH exploitable",
  'terminal.hostKeyJumpAuthenticationFailed': "L'hôte de rebond a refusé les identifiants",
  'terminal.hostKeyKnownHostsFailed': 'Impossible de lire ou de mettre à jour known_hosts',
  'terminal.hostKeyDeadline': "Le délai de connexion a expiré avant la vérification de la clé d'hôte",
  'terminal.hostKeyInputRejected': "L'hôte ou la clé a été refusé avant la connexion",  'terminal.hostKeyConfiguration': "La configuration de l'hôte est incomplète ou pointe vers un hôte de rebond supprimé",
}
