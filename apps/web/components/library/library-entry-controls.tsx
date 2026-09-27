"use client";

import { useOptimistic } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProgressBar } from "@/components/reading/progress-bar";
import { StatusSelect } from "@/components/reading/status-select";
import type { LibraryEntry } from "@/app/lib/api-types";
import { formatChapter } from "@/app/lib/format";
import { useProgressUpdate } from "@/hooks/use-progress-update";

type LibraryEntryControlsProps = {
  entry: Pick<LibraryEntry, "manhwaId" | "status" | "currentChapter"> & {
    manhwa: Pick<LibraryEntry["manhwa"], "title" | "totalChapters">;
  };
};

// Contrôles compacts d'une carte de bibliothèque : statut modifiable sur place et « +1 » optimiste.
// (La fiche détaillée propose en plus la saisie directe du chapitre, cf. ProgressEditor.)
export function LibraryEntryControls({ entry }: LibraryEntryControlsProps) {
  const { title, totalChapters } = entry.manhwa;
  const { update, isPending } = useProgressUpdate(entry.manhwaId);
  const [currentChapter, setOptimisticChapter] = useOptimistic(entry.currentChapter);

  // Chapitre suivant « entier » : depuis un bonus (10.5), +1 mène au chapitre 11.
  const nextChapter = Math.floor(currentChapter) + 1;

  const readNext = () =>
    update(
      { currentChapter: nextChapter },
      {
        optimistic: () => setOptimisticChapter(nextChapter),
        success: `« ${title} » : chapitre ${formatChapter(nextChapter)} lu.`,
        undo: { currentChapter: entry.currentChapter },
      },
    );

  return (
    <div className="flex flex-col gap-3" aria-busy={isPending}>
      <ProgressBar title={title} currentChapter={currentChapter} totalChapters={totalChapters} />
      <div className="flex gap-2">
        <StatusSelect manhwaId={entry.manhwaId} title={title} status={entry.status} className="min-w-0 flex-1" />
        <Button
          variant="outline"
          onClick={readNext}
          disabled={isPending}
          aria-label={`Marquer le chapitre ${nextChapter} de ${title} comme lu`}
          title={`Marquer le chapitre ${nextChapter} comme lu`}
        >
          <Plus data-icon="inline-start" />1
        </Button>
      </div>
    </div>
  );
}
