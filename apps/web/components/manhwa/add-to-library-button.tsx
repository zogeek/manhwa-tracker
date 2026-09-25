"use client";

import { useOptimistic } from "react";
import { BookmarkCheck, BookmarkPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/app/lib/api";
import { useApiMutation } from "@/hooks/use-api-mutation";

type AddToLibraryButtonProps = {
  manhwaId: string;
  /** Calculé côté serveur à partir de la bibliothèque de l'utilisateur. */
  inLibrary: boolean;
};

// Client Component : seul morceau interactif de la carte (le reste est rendu côté serveur).
export function AddToLibraryButton({ manhwaId, inLibrary }: AddToLibraryButtonProps) {
  const { mutate, isPending, error } = useApiMutation();
  const [optimisticInLibrary, setOptimisticInLibrary] = useOptimistic(inLibrary);

  const addToLibrary = () =>
    // Upsert avec un corps vide : crée l'entrée (statut par défaut « À lire ») sans jamais
    // écraser une progression existante (ex. ajout déjà fait depuis un autre onglet).
    mutate(() => api.reading.progress[":manhwaId"].$put({ param: { manhwaId }, json: {} }), {
      optimistic: () => setOptimisticInLibrary(true),
    });

  if (optimisticInLibrary) {
    return (
      <Button variant="secondary" disabled aria-busy={isPending}>
        <BookmarkCheck data-icon="inline-start" />
        Dans ma bibliothèque
      </Button>
    );
  }

  return (
    <>
      <Button onClick={addToLibrary} disabled={isPending}>
        <BookmarkPlus data-icon="inline-start" />
        Ajouter à ma bibliothèque
      </Button>
      {error && (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      )}
    </>
  );
}
