"use client";

import { useId, useOptimistic, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatChapterInput, parseChapterInput } from "@/app/lib/chapter-input";
import { formatChapter } from "@/app/lib/format";
import { useProgressUpdate } from "@/hooks/use-progress-update";
import { ProgressBar } from "./progress-bar";

type ProgressEditorProps = {
  manhwaId: string;
  title: string;
  /** Valeur confirmée par le serveur (rendu serveur, mise à jour par `router.refresh()`). */
  currentChapter: number;
  totalChapters: number | null;
};

/**
 * Édition rapide de la progression : l'utilisateur tape directement son chapitre (« 120 », « 10,5 »)
 * et valide (Entrée ou bouton). Trois valeurs coexistent :
 * - `currentChapter` : la vérité du serveur ;
 * - `optimisticChapter` : ce qu'on affiche pendant l'enregistrement (annulé seul en cas d'échec) ;
 * - `draft` : le texte du champ, que l'utilisateur modifie librement sans rien envoyer.
 */
export function ProgressEditor({ manhwaId, title, currentChapter, totalChapters }: ProgressEditorProps) {
  const inputId = useId();
  const errorId = useId();
  const { update, isPending } = useProgressUpdate(manhwaId);
  const [optimisticChapter, setOptimisticChapter] = useOptimistic(currentChapter);
  const [draft, setDraft] = useState(() => formatChapterInput(currentChapter));
  const [syncedWith, setSyncedWith] = useState(currentChapter);
  const [validationError, setValidationError] = useState<string | null>(null);

  // La valeur serveur a changé (refresh après enregistrement, « +1 » ou « Lu jusqu'ici » ailleurs
  // sur la page, autre onglet…) : on recopie la nouvelle valeur dans le champ, SAUF si l'utilisateur
  // est en train d'y taper autre chose — on n'écrase jamais une saisie en cours.
  // (Ajustement d'état pendant le rendu : motif recommandé par React plutôt qu'un useEffect.)
  if (currentChapter !== syncedWith) {
    setSyncedWith(currentChapter);
    if (draft === formatChapterInput(syncedWith)) setDraft(formatChapterInput(currentChapter));
  }

  const unchanged = draft.trim() === formatChapterInput(optimisticChapter);

  const submit = () => {
    const parsed = parseChapterInput(draft);
    if (!parsed.ok) {
      setValidationError(parsed.error);
      return;
    }
    setValidationError(null);
    // Normalise l'affichage (« 010.50 » → « 10,5 ») ; rien à envoyer si la valeur ne change pas.
    setDraft(formatChapterInput(parsed.value));
    if (parsed.value === optimisticChapter) return;

    update(
      { currentChapter: parsed.value },
      {
        optimistic: () => setOptimisticChapter(parsed.value),
        success: `Progression enregistrée : chapitre ${formatChapter(parsed.value)}.`,
        undo: { currentChapter },
      },
    );
  };

  const reset = () => {
    setDraft(formatChapterInput(optimisticChapter));
    setValidationError(null);
  };

  return (
    <div className="flex flex-col gap-3">
      <ProgressBar title={title} currentChapter={optimisticChapter} totalChapters={totalChapters} />
      <form
        className="flex flex-col gap-1.5"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <label htmlFor={inputId} className="text-sm font-medium">
          Chapitre actuel
        </label>
        <div className="flex gap-2">
          <Input
            id={inputId}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              setValidationError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") reset();
            }}
            // Texte + clavier numérique : `type="number"` refuse la virgule française et change
            // de valeur à la molette de la souris.
            inputMode="decimal"
            autoComplete="off"
            className="tabular-nums"
            aria-invalid={validationError !== null}
            aria-describedby={validationError ? errorId : undefined}
          />
          <Button type="submit" disabled={isPending || unchanged} aria-busy={isPending}>
            {isPending ? <Loader2 data-icon="inline-start" className="animate-spin" /> : <Check data-icon="inline-start" />}
            Valider
          </Button>
        </div>
        {validationError ? (
          <p id={errorId} role="alert" className="text-destructive text-xs">
            {validationError}
          </p>
        ) : (
          <p className="text-muted-foreground text-xs">Entrée pour valider, Échap pour annuler la saisie.</p>
        )}
      </form>
    </div>
  );
}
