// SSH11 — what each connection diagnosis means for the machine the user must open.
//
// Its own module for the same reason `terminalStatus` has one: the sentence set is
// a feature, not a subset of `app`, and `app.ts` is at its line limit.
export default {
  'terminal.diagnostic.bastionAuthRejected':
    "Le bastion a refusé cette connexion. L'hôte derrière lui n'a jamais été contacté — vérifiez le compte du bastion.",
  'terminal.diagnostic.targetAuthRejected':
    "Le bastion a accepté la connexion, mais l'hôte cible a refusé cette connexion. Vérifiez le compte de la cible.",
  'terminal.diagnostic.bastionUnreachable':
    "Le bastion est injoignable. Rien n'a été tenté après lui.",
  'terminal.diagnostic.targetHandshakeFailed':
    "Le bastion a fonctionné, mais l'hôte cible au bout du tunnel n'a pas répondu.",
  'terminal.diagnostic.tunnelFailed':
    "Le tunnel du bastion vers la cible n'a pas pu être ouvert. Le bastion refuse peut-être le transfert, ou l'adresse cible est injoignable depuis lui.",
  'terminal.diagnostic.bastionHostKeyRejected':
    "Le bastion a présenté une clé d'hôte différente de celle enregistrée. La connexion a été bloquée.",
  'terminal.diagnostic.targetHostKeyRejected':
    "L'hôte cible a présenté une clé d'hôte différente de celle enregistrée. La connexion au bastion, elle, a réussi.",
}
