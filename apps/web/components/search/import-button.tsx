"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/app/lib/api";
import type { ExternalProvider } from "@/app/lib/api-types";
import { useApiMutation } from "@/hooks/use-api-mutation";

type ImportButtonProps = {
  provider: ExternalProvider;
  externalId: string;
  title: string;
};

/**
 * Importe une œuvre externe dans le catalogue (`POST /manhwas/import`). En cas de succès :
 * un toast propose d'ouvrir la fiche, puis `router.refresh()` rejoue la recherche côté serveur —
 * la carte affiche alors « Voir la fiche » (ainsi que les cartes de la même œuvre chez les
 * autres fournisseurs, reconnues par l'API grâce aux références croisées).
 */
export function ImportButton({ provider, externalId, title }: ImportButtonProps) {
  const router = useRouter();
  const { mutate, isPending } = useApiMutation();

  const importWork = () =>
    mutate(() => api.manhwas.import.$post({ json: { provider, externalId } }), {
      onSuccess: async (res) => {
        const { data: manhwa } = await res.json();
        // 201 : fiche créée ; 200 : l'œuvre existait déjà (importée entre-temps, ou via un autre fournisseur).
        toast.success(
          res.status === 201 ? `« ${manhwa.title} » a été ajouté au catalogue.` : `« ${manhwa.title} » était déjà au catalogue.`,
          {
            description: "Couverture et chapitres arrivent en arrière-plan.",
            action: { label: "Voir la fiche", onClick: () => router.push(`/manhwas/${manhwa.id}`) },
          },
        );
      },
      onError: (message) => toast.error(`Import de « ${title} » impossible`, { description: message }),
    });

  return (
    <Button onClick={importWork} disabled={isPending} aria-busy={isPending}>
      {isPending ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Download data-icon="inline-start" />}
      {isPending ? "Import en cours…" : "Importer"}
    </Button>
  );
}
