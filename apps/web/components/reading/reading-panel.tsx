import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AddToLibraryButton } from "@/components/manhwa/add-to-library-button";
import type { ManhwaDetail } from "@/app/lib/api-types";
import { getProgress } from "@/app/lib/queries";
import { ProgressEditor } from "./progress-editor";
import { StatusSelect } from "./status-select";

/** Encart « Ma lecture » : ajout à la bibliothèque, puis saisie directe du chapitre et statut. */
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
          <>
            <ProgressEditor
              manhwaId={manhwa.id}
              title={manhwa.title}
              currentChapter={progress.currentChapter}
              totalChapters={manhwa.totalChapters}
            />
            <StatusSelect manhwaId={manhwa.id} title={manhwa.title} status={progress.status} className="w-full" />
          </>
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
