"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/** Sous-ensemble de `ClientResponse` (Hono RPC) nécessaire pour juger du succès d'une mutation. */
type MutationResponse = { ok: boolean; status: number };

type MutationOptions = {
  /** Mise à jour optimiste (`useOptimistic`), appliquée tant que la mutation est en cours. */
  optimistic?: () => void;
};

function describeFailure(status: number): string {
  if (status === 401) return "Votre session a expiré, reconnectez-vous.";
  if (status === 403) return "Action non autorisée.";
  return `Action impossible (erreur ${status}). Réessayez.`;
}

/**
 * Exécute une mutation Hono RPC depuis le navigateur puis redemande aux Server Components
 * un rendu à jour (`router.refresh()`). Le tout dans une transition React : l'interface reste
 * réactive et l'éventuel état optimiste est annulé automatiquement en cas d'échec.
 */
export function useApiMutation() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const mutate = (request: () => Promise<MutationResponse>, { optimistic }: MutationOptions = {}) => {
    startTransition(async () => {
      setError(null);
      optimistic?.();
      // Échec réseau (API injoignable) : on l'affiche au lieu de faire planter la page entière.
      const res = await request().catch(() => null);
      if (!res?.ok) {
        setError(res ? describeFailure(res.status) : "Serveur injoignable. Vérifiez votre connexion.");
        return;
      }
      router.refresh();
    });
  };

  return { mutate, isPending, error };
}
