"use client";

import { useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api } from "@/app/lib/api";
import type { ExternalProvider } from "@/app/lib/api-types";
import { EXTERNAL_PROVIDERS, PROVIDER_LABELS } from "@/app/lib/labels";
import { parseSeriesReference, type SeriesReference } from "@/app/lib/series-reference";
import { useApiMutation } from "@/hooks/use-api-mutation";

type AddResult = { ok: true; status: number; title: string } | { ok: false; status: number };

/**
 * Import dans le catalogue (`POST /manhwas/import`, idempotent : 200 si l'œuvre existe déjà) puis
 * ajout à la bibliothèque (`PUT` à corps vide : n'écrase jamais une progression existante).
 * Rejouer l'ensemble après un échec partiel est donc sans risque.
 */
async function trackSeries({ provider, externalId }: SeriesReference): Promise<AddResult> {
  const imported = await api.manhwas.import.$post({ json: { provider, externalId } });
  if (!imported.ok) return { ok: false, status: imported.status };
  const { data: manhwa } = await imported.json();
  const tracked = await api.reading.progress[":manhwaId"].$put({ param: { manhwaId: manhwa.id }, json: {} });
  return tracked.ok ? { ok: true, status: tracked.status, title: manhwa.title } : { ok: false, status: tracked.status };
}

const isProvider = (value: string): value is ExternalProvider => EXTERNAL_PROVIDERS.some((provider) => provider === value);

/** Bouton « Ajouter une série » + modale : URL de fiche (AniList, MangaDex, Kitsu) ou identifiant. */
export function AddSeriesDialog() {
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState<ExternalProvider>("anilist");
  const [inputError, setInputError] = useState<string | null>(null);
  const { mutate, isPending } = useApiMutation();

  const changeOpen = (next: boolean) => {
    // Pas de fermeture pendant l'envoi : le résultat (toast) doit rester rattaché à l'action.
    if (isPending) return;
    setOpen(next);
    if (!next) setInputError(null);
  };

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = parseSeriesReference(String(new FormData(event.currentTarget).get("reference") ?? ""), provider);
    if (!parsed.ok) {
      setInputError(parsed.message);
      return;
    }
    setInputError(null);
    mutate(() => trackSeries(parsed.reference), {
      onSuccess: (res) => {
        if (!res.ok) return;
        toast.success(`« ${res.title} » est maintenant suivi.`, {
          description: "Chapitres et couverture arrivent en arrière-plan.",
        });
        setOpen(false);
      },
      onError: (message) => toast.error("Ajout impossible", { description: message }),
    });
  };

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus data-icon="inline-start" />
          Ajouter une série
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="contents">
          <DialogHeader>
            <DialogTitle>Ajouter une série</DialogTitle>
            <DialogDescription>
              Collez le lien de sa fiche AniList, MangaDex ou Kitsu : elle rejoint le catalogue et votre suivi.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field data-invalid={inputError ? true : undefined}>
              <FieldLabel htmlFor="series-reference">URL ou identifiant</FieldLabel>
              <Input
                id="series-reference"
                name="reference"
                placeholder="https://anilist.co/manga/105398"
                autoComplete="off"
                aria-invalid={inputError ? true : undefined}
                required
              />
              {inputError ? (
                <FieldError>{inputError}</FieldError>
              ) : (
                <FieldDescription>Le catalogue est déduit de l&apos;URL.</FieldDescription>
              )}
            </Field>
            <Field>
              <FieldLabel htmlFor="series-provider">Catalogue (identifiant seul)</FieldLabel>
              <Select value={provider} onValueChange={(value) => isProvider(value) && setProvider(value)}>
                <SelectTrigger id="series-provider" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EXTERNAL_PROVIDERS.map((value) => (
                    <SelectItem key={value} value={value}>
                      {PROVIDER_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="submit" disabled={isPending} aria-busy={isPending}>
              {isPending && <Loader2 data-icon="inline-start" className="animate-spin" />}
              {isPending ? "Ajout en cours…" : "Ajouter"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
