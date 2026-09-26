/** Message lisible pour un échec HTTP de l'API (mutations déclenchées depuis le navigateur). */
export function describeApiFailure(status: number): string {
  switch (status) {
    case 401:
      return "Votre session a expiré, reconnectez-vous.";
    case 403:
      return "Action non autorisée.";
    case 404:
      return "Cette œuvre est introuvable chez le fournisseur.";
    case 409:
      return "Cette œuvre a été retirée du catalogue par un administrateur.";
    case 502:
    case 503:
      return "Le fournisseur externe ne répond pas pour l'instant. Réessayez dans un moment.";
    default:
      return `Action impossible (erreur ${status}). Réessayez.`;
  }
}

export const NETWORK_FAILURE_MESSAGE = "Serveur injoignable. Vérifiez votre connexion.";
