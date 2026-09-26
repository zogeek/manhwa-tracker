import { Skeleton } from "@/components/ui/skeleton";
import { ChapterListSkeleton } from "@/components/reading/chapter-list";
import { ReadingPanelSkeleton } from "@/components/reading/reading-panel";

// Affiché instantanément pendant la navigation vers une fiche, le temps que la page serveur réponde.
export default function Loading() {
  return (
    <div role="status" aria-label="Chargement de la fiche…" className="grid gap-8 lg:grid-cols-[280px_1fr]">
      <div className="flex flex-col gap-4">
        <Skeleton className="aspect-[2/3] rounded-xl" />
        <ReadingPanelSkeleton />
      </div>
      <div className="flex flex-col gap-6">
        <div className="space-y-3">
          <Skeleton className="h-9 w-2/3" />
          <Skeleton className="h-5 w-1/3" />
          <div className="flex gap-2">
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-5 w-28" />
            <Skeleton className="h-5 w-20" />
          </div>
        </div>
        <div className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
        <ChapterListSkeleton />
      </div>
    </div>
  );
}
