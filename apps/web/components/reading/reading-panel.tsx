import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { LibraryEntryControls } from "@/components/library/library-entry-controls";
import { AddToLibraryButton } from "@/components/manhwa/add-to-library-button";
import type { ManhwaDetail } from "@/app/lib/api-types";
import { getProgress } from "@/app/lib/queries";

/** Encart « Ma lecture » : ajout à la bibliothèque, puis progression (+1 chapitre, statut). */
export async function ReadingPanel({ manhwa }: { manhwa: Pick<ManhwaDetail, "id" | "title" | "totalChapters"> }) {
  const progress = await getProgress(manhwa.id);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ma lecture</CardTitle>
        {!progress && <CardDescription>Ajoutez cette série pour suivre votre progression.</CardDescription>}
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {progress ? (
          // Même composant que dans la bibliothèque : une seule façon de mettre à jour sa progression.
          <LibraryEntryControls
            entry={{
              manhwaId: manhwa.id,
              status: progress.status,
              currentChapter: progress.currentChapter,
              manhwa: { title: manhwa.title, totalChapters: manhwa.totalChapters },
            }}
          />
        ) : (
          <AddToLibraryButton manhwaId={manhwa.id} inLibrary={false} />
        )}
      </CardContent>
    </Card>
  );
}

export function ReadingPanelSkeleton() {
  return (
    <Card role="status" aria-label="Chargement de votre progression…">
      <CardHeader>
        <Skeleton className="h-5 w-24" />
      </CardHeader>
      <CardContent className="space-y-3">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-9 w-full" />
      </CardContent>
    </Card>
  );
}
