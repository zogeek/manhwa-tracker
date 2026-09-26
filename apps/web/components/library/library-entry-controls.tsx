"use client";

import { useOptimistic } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api } from "@/app/lib/api";
import type { LibraryEntry, ProgressPatch } from "@/app/lib/api-types";
import { READING_STATUS_LABELS, READING_STATUSES } from "@/app/lib/labels";
import { useApiMutation } from "@/hooks/use-api-mutation";

type LibraryEntryControlsProps = {
  entry: Pick<LibraryEntry, "manhwaId" | "status" | "currentChapter"> & {
    manhwa: Pick<LibraryEntry["manhwa"], "title" | "totalChapters">;
  };
};

const formatChapter = (chapter: number) => chapter.toLocaleString("fr-FR", { maximumFractionDigits: 2 });

// Client Component : +1 chapitre et changement de statut, avec retour visuel immédiat (optimiste).
export function LibraryEntryControls({ entry }: LibraryEntryControlsProps) {
  const { mutate, isPending, error } = useApiMutation();
  const [progress, applyPatch] = useOptimistic(
    { status: entry.status, currentChapter: entry.currentChapter },
    (state, patch: ProgressPatch) => ({ ...state, ...patch }),
  );
  const { totalChapters } = entry.manhwa;

  const update = (patch: ProgressPatch) =>
    mutate(() => api.reading.progress[":manhwaId"].$put({ param: { manhwaId: entry.manhwaId }, json: patch }), {
      optimistic: () => applyPatch(patch),
    });

  // Chapitre suivant « entier » : depuis un bonus (10.5), +1 mène au chapitre 11.
  const nextChapter = Math.floor(progress.currentChapter) + 1;

  const changeStatus = (value: string) => {
    const status = READING_STATUSES.find((candidate) => candidate === value);
    if (status && status !== progress.status) update({ status });
  };

  return (
    <div className="flex flex-col gap-3" aria-busy={isPending}>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="text-muted-foreground">Chapitre</span>
          <span className="font-medium tabular-nums">
            {formatChapter(progress.currentChapter)}
            {totalChapters !== null && <span className="text-muted-foreground"> / {totalChapters}</span>}
          </span>
        </div>
        {totalChapters !== null && totalChapters > 0 && (
          <div
            role="progressbar"
            aria-label={`Progression de lecture de ${entry.manhwa.title}`}
            aria-valuemin={0}
            aria-valuemax={totalChapters}
            aria-valuenow={Math.min(progress.currentChapter, totalChapters)}
            className="bg-muted h-1.5 overflow-hidden rounded-full"
          >
            <div
              className="bg-primary h-full rounded-full transition-[width]"
              style={{ width: `${Math.min(100, (progress.currentChapter / totalChapters) * 100)}%` }}
            />
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <Select value={progress.status} onValueChange={changeStatus} disabled={isPending}>
          <SelectTrigger className="flex-1" aria-label={`Statut de lecture de ${entry.manhwa.title}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {READING_STATUSES.map((status) => (
              <SelectItem key={status} value={status}>
                {READING_STATUS_LABELS[status]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          onClick={() => update({ currentChapter: nextChapter })}
          disabled={isPending}
          aria-label={`Marquer le chapitre ${nextChapter} de ${entry.manhwa.title} comme lu`}
          title={`Marquer le chapitre ${nextChapter} comme lu`}
        >
          <Plus data-icon="inline-start" />1
        </Button>
      </div>

      {error && (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      )}
    </div>
  );
}
