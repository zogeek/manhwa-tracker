"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { api } from "@/app/lib/api";
import { describeApiFailure, NETWORK_FAILURE_MESSAGE } from "@/app/lib/api-errors";
import type { ProgressPatch } from "@/app/lib/api-types";
import { useApiMutation } from "./use-api-mutation";

type UpdateOptions = {
  /** Mise à jour optimiste (`useOptimistic`) appliquée pendant la requête. */
  optimistic?: () => void;
  /** Message du toast de succès. */
  success: string;
  /** Patch qui annule l'action : ajoute un bouton « Annuler » au toast. */
  undo?: ProgressPatch;
};

/**
 * Mise à jour de la progression (`PUT /reading/progress/:manhwaId`, upsert partiel et absolu) :
 * requête, toast de confirmation avec « Annuler », toast d'erreur, puis `router.refresh()`.
 * Partagé par le champ « chapitre actuel », le sélecteur de statut, le « +1 » et « Lu jusqu'ici ».
 */
export function useProgressUpdate(manhwaId: string) {
  const router = useRouter();
  const { mutate, isPending, error } = useApiMutation();

  const put = (patch: ProgressPatch) => api.reading.progress[":manhwaId"].$put({ param: { manhwaId }, json: patch });

  const undoWith = (patch: ProgressPatch) => async () => {
    const res = await put(patch).catch(() => null);
    if (res?.ok) {
      toast.info("Modification annulée.");
      router.refresh();
    } else {
      toast.error("Annulation impossible", { description: res ? describeApiFailure(res.status) : NETWORK_FAILURE_MESSAGE });
    }
  };

  const update = (patch: ProgressPatch, { optimistic, success, undo }: UpdateOptions) =>
    mutate(() => put(patch), {
      optimistic,
      onSuccess: () => {
        toast.success(success, undo ? { action: { label: "Annuler", onClick: undoWith(undo) } } : undefined);
      },
      onError: (message) => toast.error("Progression non enregistrée", { description: message }),
    });

  return { update, isPending, error };
}
