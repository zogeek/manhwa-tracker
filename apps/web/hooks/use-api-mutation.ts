"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { describeApiFailure, NETWORK_FAILURE_MESSAGE } from "@/app/lib/api-errors";

/** Sous-ensemble de `ClientResponse` (Hono RPC) nécessaire pour juger du succès d'une mutation. */
type MutationResponse = { ok: boolean; status: number };

type MutationOptions<TResponse extends MutationResponse> = {
  /** Mise à jour optimiste (`useOptimistic`), appliquée tant que la mutation est en cours. */
  optimistic?: () => void;
  /** Après un succès, avant le rafraîchissement (lire le corps typé, afficher un toast…). */
  onSuccess?: (res: TResponse) => void | Promise<void>;
  /** Après un échec, avec le message déjà rédigé pour l'utilisateur (toast…). */
  onError?: (message: string) => void;
};

/**
 * Exécute une mutation Hono RPC depuis le navigateur puis redemande aux Server Components
 * un rendu à jour (`router.refresh()`). Le tout dans une transition React : l'interface reste
 * réactive et l'éventuel état optimiste est annulé automatiquement en cas d'échec.
 */
export function useApiMutation() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const mutate = <TResponse extends MutationResponse>(
    request: () => Promise<TResponse>,
    { optimistic, onSuccess, onError }: MutationOptions<TResponse> = {},
  ) => {
    startTransition(async () => {
      setError(null);
      optimistic?.();
      // Échec réseau (API injoignable) : on l'affiche au lieu de faire planter la page entière.
      const res = await request().catch(() => null);
      if (!res?.ok) {
        const message = res ? describeApiFailure(res.status) : NETWORK_FAILURE_MESSAGE;
        setError(message);
        onError?.(message);
        return;
      }
      await onSuccess?.(res);
      router.refresh();
    });
  };

  return { mutate, isPending, error };
}
